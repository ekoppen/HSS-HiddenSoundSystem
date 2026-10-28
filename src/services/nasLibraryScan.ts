// Whole-library "Bibliotheek scannen" — proactively walks every configured
// NAS share, indexes every audio file it finds, and optionally reconciles
// each one against Catalogic. Distinct from the lazy, per-folder lookups in
// localTrackMetadata.ts (which only ever touch what's been browsed so far):
// this builds a real index of the whole collection, including files nobody
// has opened yet, and surfaces what Catalogic couldn't match.
//
// Same pattern already proven for turntable/CD recognition: local-first,
// skip/cache before ever calling out, and a concurrency cap so a shared
// community service like Catalogic never gets hammered by one big library.
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  getDbNasAlbumEntry,
  getDbNasLibraryEntry,
  getDbNasLibraryResults,
  getDbNetworkShares,
  upsertDbNasLibraryEntry,
} from '../../db.ts';
import { isAudioFile, isSystemDirectory, readLocalTags } from './localTrackMetadata.ts';
import { getSongLookupFailureCount, lookupCatalogicSong, submitCatalogicBacklog } from './catalogicClient.ts';
import { Track } from '../types.ts';

const PLACEHOLDER_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

function idFor(filePath: string): string {
  // A truncated encoding of the path (rather than a hash of the whole thing)
  // would collide for any two files sharing a long common directory prefix —
  // hash the full path instead so every file gets a distinct id.
  const hash = createHash('sha1').update(filePath).digest('base64url').slice(0, 24);
  return 'local-' + hash;
}

function toTrack(
  filePath: string,
  meta: { title: string; artist: string; album: string; durationMs: number },
  coverUrl: string,
  highResCoverUrl: string,
): Track {
  const ext = path.extname(filePath).toLowerCase();
  const isHiRes = ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext);
  return {
    id: idFor(filePath),
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    coverUrl,
    highResCoverUrl,
    durationMs: meta.durationMs,
    uri: `file://${filePath}`,
    bitrate: isHiRes ? 1411 : 320,
    sampleRate: isHiRes ? 96000 : 44100,
    bitDepth: isHiRes ? 24 : 16,
    dominantColor: '#0ea5e9',
  };
}

export interface NasScanStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  filesFound: number;
  filesScanned: number;
  filesSkippedUnchanged: number;
  matched: number;
  unmatched: number;
  currentFile: string | null;
  error: string | null;
  // Files where a Catalogic lookup was attempted but failed outright
  // (non-ok response, network error, or timeout) rather than genuinely
  // returning "no match" — these are folded into `unmatched` above (the
  // file still has no Catalogic match), but without this the user has no
  // way to tell "not in Catalogic's catalog" apart from "couldn't reach
  // Catalogic during this scan," which makes the unmatched count look like
  // real coverage data even when it's actually just an outage.
  catalogicLookupFailures: number;
}

const CONCURRENCY = 4;

let status: NasScanStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  filesFound: 0,
  filesScanned: 0,
  filesSkippedUnchanged: 0,
  matched: 0,
  unmatched: 0,
  currentFile: null,
  error: null,
  catalogicLookupFailures: 0,
};
let stopRequested = false;
let reconciling = false;

export function getNasScanStatus(): NasScanStatus {
  return { ...status };
}

export function getNasScanResults(filter: 'all' | 'matched' | 'unmatched') {
  return getDbNasLibraryResults(filter);
}

function walkAudioFiles(dir: string): string[] {
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
    if (entry.isDirectory()) out.push(...walkAudioFiles(full));
    else if (isAudioFile(entry.name)) out.push(full);
  }
  return out;
}

export function stopNasLibraryScan(): void {
  stopRequested = true;
}

/**
 * Single entry point for resolving a local/NAS file's Track metadata,
 * shared by the whole-library scan, folder browsing, playback, and
 * playlist creation — the one place that decides "is this row still
 * fresh, or do we need to re-read/re-look-up." A row is trusted as-is
 * only when it exists, was last found playable, and the file's size/mtime
 * haven't changed since — otherwise (new file, changed file, or a
 * previously-unplayable file, which always gets retried) tags are re-read
 * and, when requested, Catalogic is re-queried, then the result is
 * persisted so every other caller sees it too.
 *
 * `opts.shareId` is only known by the whole-library scan (which walked the
 * file from a specific share's mount point) — browse/play/playlist callers
 * omit it, in which case an existing row's share_id is preserved rather
 * than overwritten with null.
 */
/** A song's own Catalogic match (title+artist lookup) is far less reliable
 * than its album's (folder/artist-name lookup, done separately by
 * enrich-albums when browsing) — a song can easily fail to match on its own
 * while its album already has confirmed art. Falls back to that already-
 * cached album art rather than giving up to the placeholder, so a track
 * that showed real art while browsing doesn't lose it the moment it plays. */
function albumArtworkFallback(filePath: string): string | null {
  return getDbNasAlbumEntry(path.dirname(filePath))?.artwork_url || null;
}

export async function resolveLocalTrack(
  filePath: string,
  opts: { allowCatalogicLookup: boolean; shareId?: string },
): Promise<Track & { playable: boolean; fromCache: boolean; catalogicSongId: string | null }> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // File vanished between directory listing and resolution (deletion
    // race, dangling symlink with an audio-like extension, flaky SMB
    // EIO/ESTALE) — no size/mtime to persist, so skip the upsert entirely
    // rather than writing a bogus row; just report it as not playable so
    // the caller can filter/skip it, matching how a genuinely
    // corrupt-but-present file already degrades via readLocalTags's own
    // catch.
    return {
      ...toTrack(
        filePath,
        { title: path.basename(filePath), artist: '', album: '', durationMs: 240000 },
        PLACEHOLDER_COVER,
        PLACEHOLDER_COVER,
      ),
      playable: false,
      fromCache: false,
      catalogicSongId: null,
    };
  }
  const existing = getDbNasLibraryEntry(filePath);

  // When the caller wants a Catalogic lookup, a cached row only counts as
  // fresh if a lookup was actually attempted for it before (match_confidence
  // non-null covers 'hoog'/'laag'/'geen' — see the 'geen' sentinel above).
  // Otherwise a row written by a browse (allowCatalogicLookup: false, so
  // match_confidence is still null) would wrongly satisfy this gate the
  // moment enrich/play asks for a real lookup on that same unchanged file.
  const catalogicSatisfied = !opts.allowCatalogicLookup || existing?.match_confidence != null;

  if (
    existing &&
    existing.playable !== 0 &&
    existing.file_size === stat.size &&
    existing.mtime_ms === stat.mtimeMs &&
    catalogicSatisfied
  ) {
    const coverUrl = existing.artwork_url || albumArtworkFallback(filePath) || PLACEHOLDER_COVER;
    return {
      ...toTrack(
        filePath,
        {
          title: existing.title,
          artist: existing.artist,
          album: existing.album,
          durationMs: existing.duration_ms ?? 240000,
        },
        coverUrl,
        coverUrl,
      ),
      playable: true,
      fromCache: true,
      catalogicSongId: existing.catalogic_song_id ?? null,
    };
  }

  const tags = await readLocalTags(filePath);
  let catalogicSongId: string | null = null;
  let matchConfidence: string | null = null;
  let artworkUrl: string | null = null;
  let durationMs = tags.durationMs;

  if (opts.allowCatalogicLookup) {
    const match = await lookupCatalogicSong(tags.title, tags.artist);
    if (match) {
      catalogicSongId = match.songId;
      artworkUrl = match.artworkUrl;
      if (match.durationMs) durationMs = match.durationMs;
      matchConfidence =
        match.artistName && match.artistName.toLowerCase().includes(tags.artist.toLowerCase()) ? 'hoog' : 'laag';
    } else {
      // A lookup was actually attempted and genuinely found nothing —
      // distinct from `null`, which means "never asked" (e.g. a
      // browse-triggered resolve that didn't request a Catalogic lookup at
      // all). Without this distinction, a browse-written row with
      // matchConfidence still `null` would satisfy the freshness gate below
      // even when a caller explicitly asks for allowCatalogicLookup,
      // silently skipping the very lookup it requested.
      matchConfidence = 'geen';
    }
  }

  upsertDbNasLibraryEntry({
    filePath,
    shareId: opts.shareId ?? existing?.share_id ?? undefined,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
    catalogicSongId,
    matchConfidence,
    artworkUrl,
    playable: tags.playable,
    durationMs,
  });

  const coverUrl = artworkUrl || albumArtworkFallback(filePath) || PLACEHOLDER_COVER;
  return {
    ...toTrack(filePath, { title: tags.title, artist: tags.artist, album: tags.album, durationMs }, coverUrl, coverUrl),
    playable: tags.playable,
    fromCache: false,
    catalogicSongId,
  };
}

/**
 * Fires off an async whole-library scan in the background and returns
 * immediately (`true`) — poll getNasScanStatus() for progress, or pass
 * `onProgress` to get pushed updates. Returns `false` (no-op) if a scan is
 * already running.
 */
export function startNasLibraryScan(opts: {
  allowCatalogicLookup: boolean;
  onProgress?: (status: NasScanStatus) => void;
}): boolean {
  if (status.running) return false;

  stopRequested = false;
  status = {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    filesFound: 0,
    filesScanned: 0,
    filesSkippedUnchanged: 0,
    matched: 0,
    unmatched: 0,
    currentFile: null,
    error: null,
    catalogicLookupFailures: 0,
  };
  const lookupFailuresAtStart = getSongLookupFailureCount();

  (async () => {
    try {
      // Several saved shares can point at the same mount point (e.g. after
      // reconfiguring the same NAS) — only one is actually mounted there at a
      // time, so walk each distinct mount point once rather than re-scanning
      // the same directory tree once per duplicate share entry.
      const shares = getDbNetworkShares()
        .filter((s) => s.mountPoint && fs.existsSync(s.mountPoint))
        .filter((s, i, arr) => arr.findIndex((x) => x.mountPoint === s.mountPoint) === i);
      const files = shares.flatMap((share) =>
        walkAudioFiles(share.mountPoint).map((filePath) => ({ filePath, shareId: share.id })),
      );
      status.filesFound = files.length;
      opts.onProgress?.(getNasScanStatus());

      let cursor = 0;
      async function worker() {
        while (cursor < files.length) {
          if (stopRequested) return;
          const { filePath, shareId } = files[cursor++];
          status.currentFile = filePath;

          try {
            const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: opts.allowCatalogicLookup, shareId });
            if (track.fromCache) status.filesSkippedUnchanged++;
            if (track.catalogicSongId) status.matched++;
            else status.unmatched++;
          } catch {
            // unreadable file — skip, doesn't block the rest of the scan
          }

          status.catalogicLookupFailures = getSongLookupFailureCount() - lookupFailuresAtStart;
          status.filesScanned++;
          if (status.filesScanned % 10 === 0 || status.filesScanned === files.length) {
            opts.onProgress?.(getNasScanStatus());
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    } catch (e: any) {
      status.error = e.message;
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
      status.currentFile = null;
      if (opts.allowCatalogicLookup) {
        const unmatched = getDbNasLibraryResults('unmatched', 500);
        void submitCatalogicBacklog(
          unmatched.map((r: any) => ({ externalId: r.file_path, title: r.title, artist: r.artist })),
        );
      }
      opts.onProgress?.(getNasScanStatus());
    }
  })();

  return true;
}

/**
 * Re-checks every still-unmatched library entry against Catalogic — meant to
 * be triggered by the `song.created` webhook (see the design spec's §3):
 * treat the webhook purely as "go check your backlog again," not as
 * per-song detail, since the reconcile itself is cheap and idempotent (it
 * only ever touches rows that are already unmatched).
 */
export async function reconcileNasBacklog(
  allowCatalogicLookup: boolean,
  onReconciled?: (result: { checked: number; matched: number }) => void,
): Promise<{ checked: number; matched: number }> {
  if (!allowCatalogicLookup) return { checked: 0, matched: 0 };
  // ponytail: global lock rather than per-webhook-delivery dedup — fine here
  // since the whole point is "just check the backlog again," a dropped
  // overlapping call loses nothing that the next webhook won't re-trigger.
  if (reconciling) return { checked: 0, matched: 0 };
  reconciling = true;
  try {
    const unmatched = getDbNasLibraryResults('unmatched', 500);
    let matched = 0;
    for (const row of unmatched as any[]) {
      const match = await lookupCatalogicSong(row.title, row.artist);
      if (!match) continue;
      upsertDbNasLibraryEntry({
        filePath: row.file_path,
        shareId: row.share_id,
        title: row.title,
        artist: row.artist,
        album: row.album,
        fileSize: row.file_size,
        mtimeMs: row.mtime_ms,
        catalogicSongId: match.songId,
        matchConfidence:
          match.artistName && match.artistName.toLowerCase().includes(String(row.artist).toLowerCase()) ? 'hoog' : 'laag',
        artworkUrl: match.artworkUrl,
        playable: row.playable !== 0,
        durationMs: row.duration_ms ?? undefined,
      });
      matched++;
    }
    const result = { checked: unmatched.length, matched };
    if (matched > 0) onReconciled?.(result);
    return result;
  } finally {
    reconciling = false;
  }
}
