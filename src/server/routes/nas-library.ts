// Muziekbibliotheek-weergave: artiest → album → song, met Catalogic-
// verrijking op artiest- en albumniveau. Zie
// docs/superpowers/specs/2026-08-22-nas-music-library-design.md.
// Songs-niveau hergebruikt resolveLocalTrack/de bestaande /api/nas/enrich
// ongewijzigd — dit bestand voegt alleen artiest- en albumniveau toe.
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  getDbNasArtistEntry,
  getDbNasAlbumEntry,
  getDbNasLibraryEntry,
  updateDbNasLibraryLyricsStatus,
  upsertDbNasArtistEntry,
  upsertDbNasAlbumEntry,
  upsertDbNasLibraryEntry,
} from '../../../db.ts';
import { isAudioFile, isSystemDirectory, readLocalTags } from '../../services/localTrackMetadata.ts';
import { resolveLocalTrack } from '../../services/nasLibraryScan.ts';
import {
  lookupCatalogicArtist,
  lookupCatalogicAlbum,
  lookupCatalogicLyrics,
  lookupOrCreateCatalogicSong,
  fetchCatalogicArtwork,
} from '../../services/catalogicClient.ts';
import { getEffectiveNasShares, validateWithinNasShares } from '../../services/nasPathGuard.ts';
import { hubConfig } from '../state.ts';

const router = express.Router();

router.get('/api/nas/library/artists', (req, res) => {
  const queryShare = req.query.share;
  const share = queryShare !== undefined ? validateWithinNasShares(queryShare) : getEffectiveNasShares()[0];
  if (!share) {
    return res.status(400).json({ success: false, error: 'invalid share', artists: [] });
  }
  try {
    if (!fs.existsSync(share)) {
      return res.json({ success: true, artists: [] });
    }
    const entries = fs.readdirSync(share, { withFileTypes: true }).filter((e) => e.isDirectory() && !isSystemDirectory(e.name));
    const artists = entries
      .map((e) => {
        const artistPath = path.join(share, e.name);
        const cached = getDbNasArtistEntry(artistPath);
        return { name: e.name, path: artistPath, artworkUrl: cached?.artwork_url || null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, artists });
  } catch (e: any) {
    res.json({ success: false, error: e.message, artists: [] });
  }
});

router.post('/api/nas/library/enrich-artists', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, artists: {} });
  }
  try {
    const shares = getEffectiveNasShares();
    const artistPaths = paths
      .filter((p: unknown) => validateWithinNasShares(p, shares) !== null)
      .filter((p: string) => !getDbNasArtistEntry(p)?.checked_at)
      .slice(0, 100);
    const CONCURRENCY = 4;
    const artists: Record<string, { artworkUrl: string | null }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < artistPaths.length) {
        const artistPath = artistPaths[cursor++];
        try {
          const artistName = path.basename(artistPath);
          const match = await lookupCatalogicArtist(artistName);
          if (match === undefined) continue; // transient Catalogic failure — leave unchecked, retry on a later enrich pass
          upsertDbNasArtistEntry({
            artistPath,
            artistName,
            catalogicArtistId: match?.artistId || null,
            artworkUrl: match?.artworkUrl || null,
            checked: true,
          });
          artists[artistPath] = { artworkUrl: match?.artworkUrl || null };
        } catch {
          // skip unreadable/unresolvable artist folder, caller keeps whatever it already had
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, artistPaths.length) }, worker));
    res.json({ success: true, artists });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Applies the hierarchy rule from the design spec: audio files directly in
 * the artist folder → the folder itself is the one (synthetic) album;
 * otherwise each subfolder is an album, with any deeper nesting inside it
 * (discs, an organizational folder like `_FLAC`) flattened away — this
 * route only lists the album-level folders, it doesn't need to look inside
 * them (that's the songs route's job).
 */
router.get('/api/nas/library/albums', (req, res) => {
  const artistPath = validateWithinNasShares(req.query.artistPath);
  if (!artistPath) {
    return res.status(400).json({ success: false, error: 'invalid artistPath', albums: [] });
  }
  try {
    if (!fs.existsSync(artistPath)) {
      return res.json({ success: true, albums: [] });
    }
    const entries = fs.readdirSync(artistPath, { withFileTypes: true });
    const hasDirectAudio = entries.some((e) => !e.isDirectory() && isAudioFile(e.name));

    if (hasDirectAudio) {
      const cached = getDbNasAlbumEntry(artistPath);
      return res.json({
        success: true,
        albums: [{ name: path.basename(artistPath), path: artistPath, artworkUrl: cached?.artwork_url || null }],
      });
    }

    const albums = entries
      .filter((e) => e.isDirectory() && !isSystemDirectory(e.name))
      .map((e) => {
        const albumPath = path.join(artistPath, e.name);
        const cached = getDbNasAlbumEntry(albumPath);
        return { name: e.name, path: albumPath, artworkUrl: cached?.artwork_url || null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, albums });
  } catch (e: any) {
    res.json({ success: false, error: e.message, albums: [] });
  }
});

router.post('/api/nas/library/enrich-albums', async (req, res) => {
  const { paths, artistPath: rawArtistPath } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0 || !rawArtistPath) {
    return res.status(400).json({ error: 'paths (array) en artistPath zijn verplicht' });
  }
  const artistPath = validateWithinNasShares(rawArtistPath);
  if (!artistPath) {
    return res.status(400).json({ error: 'invalid artistPath' });
  }

  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, albums: {} });
  }
  try {
    const artistEntry = getDbNasArtistEntry(artistPath);
    const artistCatalogicId = artistEntry?.catalogic_artist_id;
    if (!artistCatalogicId) {
      // Artist itself never resolved — nothing to disambiguate albums
      // against, so there's genuinely no safe match to attempt.
      return res.json({ success: true, albums: {} });
    }

    const shares = getEffectiveNasShares();
    const albumPaths = paths
      .filter((p: unknown) => validateWithinNasShares(p, shares) !== null)
      .filter((p: string) => !getDbNasAlbumEntry(p)?.checked_at)
      .slice(0, 100);
    const CONCURRENCY = 4;
    const albums: Record<string, { artworkUrl: string | null }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < albumPaths.length) {
        const albumPath = albumPaths[cursor++];
        try {
          // No album subfolder (the "album" IS the artist folder, per the
          // hierarchy rule's direct-audio case) — its basename would just
          // repeat the artist name, a meaningless album search query. There's
          // no real album to disambiguate here, so just reuse the artist's
          // own artwork instead of searching Catalogic for a nonsensical
          // "album" titled after the artist.
          if (albumPath === artistPath) {
            upsertDbNasAlbumEntry({
              albumPath,
              artistPath,
              albumName: path.basename(albumPath),
              catalogicAlbumId: null,
              artworkUrl: artistEntry?.artwork_url || null,
              checked: true,
            });
            albums[albumPath] = { artworkUrl: artistEntry?.artwork_url || null };
            continue;
          }

          const albumName = path.basename(albumPath);
          const match = await lookupCatalogicAlbum(albumName, artistCatalogicId);
          if (match === undefined) continue; // transient Catalogic failure — leave unchecked, retry on a later enrich pass
          upsertDbNasAlbumEntry({
            albumPath,
            artistPath,
            albumName,
            catalogicAlbumId: match?.albumId || null,
            artworkUrl: match?.artworkUrl || null,
            checked: true,
          });
          albums[albumPath] = { artworkUrl: match?.artworkUrl || null };
        } catch {
          // skip unreadable/unresolvable album folder
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, albumPaths.length) }, worker));
    res.json({ success: true, albums });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Recursively walks the album folder (flattening any disc/organizational
 * subfolders per the hierarchy rule) and resolves each file the same way
 * the raw file browser does — no new song-matching logic, this just picks
 * a different starting point for the walk.
 */
function walkAudioFilesFlat(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && isSystemDirectory(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAudioFilesFlat(full));
    else if (isAudioFile(entry.name)) out.push(full);
  }
  return out;
}

router.get('/api/nas/library/songs', async (req, res) => {
  const albumPath = validateWithinNasShares(req.query.albumPath);
  if (!albumPath) {
    return res.status(400).json({ success: false, error: 'invalid albumPath', songs: [] });
  }

  try {
    if (!fs.existsSync(albumPath)) {
      return res.json({ success: true, songs: [] });
    }
    const filePaths = walkAudioFilesFlat(albumPath).sort((a, b) => a.localeCompare(b));
    const CONCURRENCY = 4;
    const rawSongs: ({ path: string; playable: boolean } & Record<string, unknown>)[] = new Array(filePaths.length);
    let cursor = 0;
    async function worker() {
      while (cursor < filePaths.length) {
        const i = cursor++;
        const track = await resolveLocalTrack(filePaths[i], { allowCatalogicLookup: false });
        const dbEntry = getDbNasLibraryEntry(filePaths[i]) as any;
        const hasLyrics = dbEntry?.has_lyrics === 1 ? true : dbEntry?.has_lyrics === 0 ? false : null;
        rawSongs[i] = { ...track, path: filePaths[i], hasLyrics };
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker));
    const songs = rawSongs.filter((s) => s.playable !== false);
    res.json({ success: true, songs });
  } catch (e: any) {
    res.json({ success: false, error: e.message, songs: [] });
  }
});

router.post('/api/nas/library/enrich-lyrics', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, songs: {} });
  }
  try {
    const shares = getEffectiveNasShares();
    const filePaths = paths
      .filter((p: unknown) => validateWithinNasShares(p, shares) !== null)
      .filter((p: string) => {
        const entry = getDbNasLibraryEntry(p) as any;
        return !!entry?.catalogic_song_id && entry?.lyrics_checked_at == null;
      })
      .slice(0, 100);
    const CONCURRENCY = 4;
    const songs: Record<string, { hasLyrics: boolean }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < filePaths.length) {
        const filePath = filePaths[cursor++];
        try {
          const entry = getDbNasLibraryEntry(filePath) as any;
          const lyrics = await lookupCatalogicLyrics(entry.catalogic_song_id);
          if (lyrics === undefined) continue; // transient Catalogic failure — leave unchecked, retry on a later enrich pass
          const hasLyrics = lyrics.length > 0;
          updateDbNasLibraryLyricsStatus(filePath, hasLyrics);
          songs[filePath] = { hasLyrics };
        } catch {
          // skip unreadable/unresolvable entry
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker));
    res.json({ success: true, songs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/nas/library/lyrics', async (req, res) => {
  const filePath = validateWithinNasShares(req.query.path);
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'invalid path', lyrics: [] });
  }
  try {
    const entry = getDbNasLibraryEntry(filePath) as any;
    if (!entry?.catalogic_song_id) {
      return res.json({ success: true, lyrics: [] });
    }
    const lyrics = await lookupCatalogicLyrics(entry.catalogic_song_id);
    if (lyrics === undefined) {
      return res.json({ success: false, error: 'catalogic unavailable', lyrics: [] });
    }
    res.json({ success: true, lyrics });
  } catch (e: any) {
    res.json({ success: false, error: e.message, lyrics: [] });
  }
});

/**
 * Opt-in, explicit "create this song in Catalogic via Spotify" endpoint —
 * only ever triggered by a user click, never by automatic background
 * matching (see lookupOrCreateCatalogicSong's doc comment). Separate from
 * the existing enrich-* routes above, which stay match-only.
 */
// Deliberately NOT gated on hubConfig.catalogicScanLookupEnabled — that
// flag governs background/automatic lookups; this route is only ever
// reached by a single explicit user click, never a batch sweep.
router.post('/api/nas/library/create-from-catalogic', async (req, res) => {
  const filePath = validateWithinNasShares(req.body?.path);
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'invalid path' });
  }
  try {
    if (!fs.existsSync(filePath) || !isAudioFile(filePath)) {
      return res.json({ success: false, error: 'bestand bestaat niet of is geen audiobestand' });
    }
    const stat = fs.statSync(filePath);
    const tags = await readLocalTags(filePath);
    const title = tags?.title || path.basename(filePath, path.extname(filePath));
    const artist = tags?.artist;
    if (!artist) {
      return res.json({ success: false, error: 'geen artiestnaam bekend voor dit bestand' });
    }
    // Full-row upsert — carry forward whatever this row already had so
    // this write only actually changes the Catalogic-match fields, not
    // the freshness-gate fields (fileSize/mtimeMs) or artwork/share_id.
    // Getting this wrong previously caused resolveLocalTrack's next
    // resolve to treat the row as stale and silently erase the match.
    const existing = getDbNasLibraryEntry(filePath) as any;
    // Disambiguates which release Catalogic's Spotify search should prefer
    // (see pickBestAlbumMatch server-side) — without it, popularity-ranked
    // search very often returns a "Greatest Hits" compilation or an
    // anniversary remaster instead of the actual local album.
    const created = await lookupOrCreateCatalogicSong(title, artist, tags?.album || existing?.album, Boolean(req.body?.forceRefresh));
    if (!created) {
      return res.json({ success: false, error: 'Catalogic niet bereikbaar of geen resultaat' });
    }

    upsertDbNasLibraryEntry({
      filePath,
      shareId: existing?.share_id || undefined,
      title,
      artist,
      album: tags?.album || existing?.album || '',
      fileSize: stat.size,
      mtimeMs: stat.mtimeMs,
      catalogicSongId: created.songId,
      matchConfidence: 'created',
      artworkUrl: existing?.artwork_url || undefined,
      playable: existing?.playable !== 0,
      durationMs: existing?.duration_ms ?? tags?.durationMs,
    });

    // The artist/album folder the caller is currently viewing — sent by
    // the client rather than derived from filePath, because the
    // hierarchy rule's direct-audio case means albumPath can legitimately
    // equal artistPath, which path.dirname(filePath) can't distinguish
    // safely. Each is independently validated and independently optional
    // — a missing/invalid one just skips that half of the persistence,
    // it never fails the song creation that already succeeded above.
    const { artistPath: rawArtistPath, albumPath: rawAlbumPath } = req.body || {};
    const artistPath = validateWithinNasShares(rawArtistPath);
    const albumPath = validateWithinNasShares(rawAlbumPath);

    let artistArtworkUrl: string | null = null;
    let albumArtworkUrl: string | null = null;
    if (created.artistId) {
      artistArtworkUrl = await fetchCatalogicArtwork('artist', created.artistId);
      if (artistPath) {
        upsertDbNasArtistEntry({
          artistPath,
          artistName: path.basename(artistPath),
          catalogicArtistId: created.artistId,
          artworkUrl: artistArtworkUrl,
          checked: true,
        });
      }
    }
    if (created.albumId) {
      albumArtworkUrl = await fetchCatalogicArtwork('album', created.albumId);
      if (albumPath) {
        upsertDbNasAlbumEntry({
          albumPath,
          artistPath: artistPath || albumPath,
          albumName: path.basename(albumPath),
          catalogicAlbumId: created.albumId,
          artworkUrl: albumArtworkUrl,
          checked: true,
        });
      }
    }

    res.json({ success: true, song: created, artistArtworkUrl, albumArtworkUrl });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
