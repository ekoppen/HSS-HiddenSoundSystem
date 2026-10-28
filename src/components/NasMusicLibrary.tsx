import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Disc3, Music, Play, Plus, User } from 'lucide-react';
import { Track } from '../types';
import { Button, Card } from './ui';

interface LibraryArtist {
  name: string;
  path: string;
  artworkUrl: string | null;
}
interface LibraryAlbum {
  name: string;
  path: string;
  artworkUrl: string | null;
}
interface LibrarySong {
  path: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  uri: string;
  playable: boolean;
  catalogicSongId?: string | null;
  hasLyrics?: boolean | null;
}

interface NasMusicLibraryProps {
  onAddToQueue: (track: Track) => void;
  // Optional: without it, "play whole album" falls back to looping
  // onAddToQueue (one toast per track) rather than failing outright.
  onAddManyToQueue?: (tracks: Track[], label?: string) => void;
  playlists?: { id: string; name: string }[];
  onAddTrackToPlaylist?: (playlistId: string, track: Track) => void;
}

const PLACEHOLDER_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

/**
 * Artiest → album → song weergave van de NAS-bibliotheek — los van de rauwe
 * bestandenverkenner (NasBrowser), zie
 * docs/superpowers/specs/2026-08-22-nas-music-library-design.md. Zelfde
 * "snel tonen, dan los verrijken"-principe als NasBrowser, nu op drie
 * niveaus.
 */
export const NasMusicLibrary: React.FC<NasMusicLibraryProps> = ({ onAddToQueue, onAddManyToQueue, playlists, onAddTrackToPlaylist }) => {
  const [level, setLevel] = useState<'artists' | 'albums' | 'songs'>('artists');
  const [artists, setArtists] = useState<LibraryArtist[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [currentArtistPath, setCurrentArtistPath] = useState<string | null>(null);
  const [currentArtistName, setCurrentArtistName] = useState('');
  const [currentAlbumName, setCurrentAlbumName] = useState('');
  const [currentAlbumPath, setCurrentAlbumPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tileSize, setTileSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem('nas-library-tile-size'));
    return stored >= 80 && stored <= 200 ? stored : 120;
  });
  const [selectedSong, setSelectedSong] = useState<LibrarySong | null>(null);
  const [lyricsText, setLyricsText] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [creatingCatalogicEntry, setCreatingCatalogicEntry] = useState(false);
  const [bulkCatalogicProgress, setBulkCatalogicProgress] = useState<{ total: number; done: number } | null>(null);
  const [bulkCatalogicSummary, setBulkCatalogicSummary] = useState<string | null>(null);
  const lyricsRequestId = useRef(0);

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadArtists = async () => {
    try {
      const res = await fetch('/api/nas/library/artists').then((r) => r.json());
      if (res.artists) {
        setArtists(res.artists);
        const paths = res.artists.map((a: LibraryArtist) => a.path);
        if (paths.length > 0) {
          fetch('/api/nas/library/enrich-artists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.artists) return;
              setArtists((prev) =>
                prev.map((a) => (enrichRes.artists[a.path] ? { ...a, ...enrichRes.artists[a.path] } : a)),
              );
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const openArtist = async (artist: LibraryArtist) => {
    setCurrentArtistPath(artist.path);
    setCurrentArtistName(artist.name);
    setSearchQuery('');
    setBulkCatalogicSummary(null);
    setLevel('albums');
    try {
      const res = await fetch(`/api/nas/library/albums?artistPath=${encodeURIComponent(artist.path)}`).then((r) => r.json());
      if (res.albums) {
        setAlbums(res.albums);
        const paths = res.albums.map((a: LibraryAlbum) => a.path);
        if (paths.length > 0) {
          fetch('/api/nas/library/enrich-albums', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths, artistPath: artist.path }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.albums) return;
              setAlbums((prev) =>
                prev.map((a) => (enrichRes.albums[a.path] ? { ...a, ...enrichRes.albums[a.path] } : a)),
              );
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const openAlbum = async (album: LibraryAlbum) => {
    setCurrentAlbumName(album.name);
    setCurrentAlbumPath(album.path);
    setSearchQuery('');
    setBulkCatalogicSummary(null);
    setLevel('songs');
    try {
      const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
      if (res.songs) {
        const mapped = res.songs.map((s: LibrarySong) => ({
          ...s,
          coverUrl: s.coverUrl && s.coverUrl !== PLACEHOLDER_COVER ? s.coverUrl : album.artworkUrl || s.coverUrl,
        }));
        setSongs(mapped);

        const paths = mapped.map((s: LibrarySong) => s.path);
        if (paths.length > 0) {
          fetch('/api/nas/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.tracks) return;
              setSongs((prev) =>
                prev.map((s) =>
                  enrichRes.tracks[s.path] ? { ...s, catalogicSongId: enrichRes.tracks[s.path].catalogicSongId } : s,
                ),
              );
              const matchedPaths = paths.filter((p: string) => enrichRes.tracks[p]?.catalogicSongId);
              if (matchedPaths.length > 0) {
                fetch('/api/nas/library/enrich-lyrics', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ paths: matchedPaths }),
                })
                  .then((r) => r.json())
                  .then((lyricsRes) => {
                    if (!lyricsRes.songs) return;
                    setSongs((prev) =>
                      prev.map((s) => (lyricsRes.songs[s.path] ? { ...s, hasLyrics: lyricsRes.songs[s.path].hasLyrics } : s)),
                    );
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const handlePlaySong = async (song: LibrarySong) => {
    try {
      await fetch('/api/nas/play-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: song.path, name: song.title }),
      });
    } catch (e) {}
  };

  const buildTrack = (song: LibrarySong): Track => ({
    id: 'local-' + Date.now(),
    title: song.title,
    artist: song.artist,
    album: song.album,
    coverUrl: song.coverUrl || PLACEHOLDER_COVER,
    durationMs: song.durationMs || 240000,
    uri: song.uri,
    bitrate: song.bitrate,
    sampleRate: song.sampleRate,
    bitDepth: song.bitDepth,
    dominantColor: '#0ea5e9',
  });

  const handleQueueSong = (song: LibrarySong) => {
    onAddToQueue(buildTrack(song));
  };

  /** Volumio-style "play this whole album": starts the first song via the
   * normal single-file play route, then queues the rest — same effect as
   * NasBrowser's /api/nas/play-folder, but built from the already-loaded
   * `songs` list instead, since that one is recursively flattened (disc
   * subfolders) while play-folder only reads one directory non-recursively
   * and would silently miss anything in a nested disc folder. Queues the
   * remaining tracks as one batch (one toast) rather than one onAddToQueue
   * call per song — a user pressing "play album" made one request, not N. */
  const handlePlayAlbum = async () => {
    if (songs.length === 0) return;
    await handlePlaySong(songs[0]);
    const rest = songs.slice(1).map(buildTrack);
    if (rest.length === 0) return;
    if (onAddManyToQueue) {
      onAddManyToQueue(rest, currentAlbumName || undefined);
    } else {
      for (const t of rest) onAddToQueue(t);
    }
  };

  const openLyrics = async (song: LibrarySong) => {
    const requestId = ++lyricsRequestId.current;
    setLyricsLoading(true);
    setLyricsText(null);
    try {
      const res = await fetch(`/api/nas/library/lyrics?path=${encodeURIComponent(song.path)}`).then((r) => r.json());
      if (lyricsRequestId.current !== requestId) return; // superseded by a later click/close — drop
      if (res.success === false) {
        setLyricsText('Kon lyrics niet ophalen.');
        return;
      }
      const first = res.lyrics?.[0];
      setLyricsText(first ? first.text : 'Geen lyrics gevonden.');
    } catch (e) {
      if (lyricsRequestId.current !== requestId) return;
      setLyricsText('Kon lyrics niet ophalen.');
    } finally {
      if (lyricsRequestId.current === requestId) setLyricsLoading(false);
    }
  };

  const handleCreateFromCatalogic = async (song: LibrarySong, forceRefresh?: boolean) => {
    setCreatingCatalogicEntry(true);
    try {
      const res = await fetch('/api/nas/library/create-from-catalogic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: song.path, artistPath: currentArtistPath, albumPath: currentAlbumPath, forceRefresh }),
      }).then((r) => r.json());
      if (res.success) {
        setSongs((prev) => prev.map((s) => (s.path === song.path ? { ...s, catalogicSongId: res.song.songId } : s)));
        setSelectedSong((prev) => (prev && prev.path === song.path ? { ...prev, catalogicSongId: res.song.songId } : prev));
        // Herlaad de albumlijst zodat een nieuw-aangemaakte albumhoes
        // meteen zichtbaar wordt, zonder losse per-veld state-merging te
        // hoeven bouwen — zelfde pragmatische aanpak als elders in dit
        // bestand na een muterende actie.
        if (currentArtistPath) {
          try {
            const albumsRes = await fetch(`/api/nas/library/albums?artistPath=${encodeURIComponent(currentArtistPath)}`).then((r) => r.json());
            if (albumsRes.albums) setAlbums(albumsRes.albums);
          } catch (e) {
            // Best-effort UI refresh only — the creation itself already
            // succeeded above, so a refresh hiccup here must never surface
            // as a failure alert for an operation that actually worked.
          }
        }
      } else {
        alert(res.error || 'Aanmaken via Catalogic is niet gelukt.');
      }
    } catch (e) {
      alert('Aanmaken via Catalogic is niet gelukt.');
    } finally {
      setCreatingCatalogicEntry(false);
    }
  };

  /**
   * Sweeps every unmatched song under an artist or the current album and asks
   * Catalogic to create each one — there's no artist/album-only "create"
   * endpoint on the Catalogic side (only songs.lookup?create_if_missing via
   * Spotify), but creating a song already cascades to create its artist and
   * album too (see create-from-catalogic on the server), so driving that same
   * endpoint per song is the whole mechanism, just looped client-side instead
   * of clicking into every song one at a time.
   */
  const handleBulkCreateFromCatalogic = async (scope: 'artist' | 'album', forceRefresh?: boolean) => {
    if (bulkCatalogicProgress) return;
    setBulkCatalogicSummary(null);
    const targets: { albumPath: string; song: LibrarySong }[] = [];
    // Normally only unmatched songs are worth asking Catalogic about again —
    // but a song matched to the wrong release before `album` was passed to
    // Catalogic stays "matched" forever otherwise, so forceRefresh includes
    // everything and tells the server to re-search instead of trusting the
    // existing match.
    if (scope === 'album' && currentAlbumPath) {
      for (const s of songs) {
        if (forceRefresh || !s.catalogicSongId) targets.push({ albumPath: currentAlbumPath, song: s });
      }
    } else if (scope === 'artist' && currentArtistPath) {
      for (const album of albums) {
        try {
          const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
          for (const s of (res.songs || []) as LibrarySong[]) {
            if (forceRefresh || !s.catalogicSongId) targets.push({ albumPath: album.path, song: s });
          }
        } catch (e) {
          // skip an unreadable album folder, sweep continues with the rest
        }
      }
    }
    if (targets.length === 0) {
      setBulkCatalogicSummary('Alles in deze ' + (scope === 'artist' ? 'artiest' : 'album') + ' is al gematcht.');
      return;
    }

    setBulkCatalogicProgress({ total: targets.length, done: 0 });
    const CONCURRENCY = 3;
    let failures = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const { albumPath, song } = targets[cursor++];
        try {
          const res = await fetch('/api/nas/library/create-from-catalogic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: song.path, artistPath: currentArtistPath, albumPath, forceRefresh }),
          }).then((r) => r.json());
          if (res.success) {
            setSongs((prev) => prev.map((s) => (s.path === song.path ? { ...s, catalogicSongId: res.song.songId } : s)));
          } else {
            failures++;
          }
        } catch (e) {
          failures++;
        }
        setBulkCatalogicProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setBulkCatalogicProgress(null);
    setBulkCatalogicSummary(
      `${targets.length - failures}/${targets.length} nummers ${forceRefresh ? 'opnieuw gecontroleerd' : 'aangemaakt'} via Catalogic.`
    );

    // Refresh so newly-created artwork shows up immediately, same as the
    // per-song creation flow does.
    if (currentArtistPath) {
      try {
        const albumsRes = await fetch(`/api/nas/library/albums?artistPath=${encodeURIComponent(currentArtistPath)}`).then((r) => r.json());
        if (albumsRes.albums) setAlbums(albumsRes.albums);
      } catch (e) {}
    }
  };

  const visibleArtists = artists.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const visibleAlbums = albums.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const visibleSongs = songs.filter(
    (s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()) || s.artist.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="flex flex-wrap items-center" style={{ gap: 10, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          {level !== 'artists' && (
            <button
              onClick={() => {
                setSearchQuery('');
                setLevel(level === 'songs' ? 'albums' : 'artists');
              }}
              style={{ padding: 4, color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <Disc3 size={18} style={{ color: 'var(--accent)' }} />
          <div className="min-w-0" style={{ flex: 1 }}>
            <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Muziekbibliotheek</div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {level === 'artists' ? 'Alle artiesten' : level === 'albums' ? currentArtistName : `${currentArtistName} — ${currentAlbumName}`}
            </p>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={level === 'artists' ? 'Zoek artiest…' : level === 'albums' ? 'Zoek album…' : 'Zoek nummer…'}
            style={{
              width: 180,
              maxWidth: '100%',
              padding: '7px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-inset)',
              color: 'var(--text-primary)',
              font: 'var(--text-mono-sm)',
            }}
          />
          {level !== 'songs' && (
            <input
              type="range"
              min={80}
              max={200}
              step={10}
              value={tileSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTileSize(v);
                localStorage.setItem('nas-library-tile-size', String(v));
              }}
              title="Grootte van de tegels"
              style={{ width: 100 }}
            />
          )}
        </div>

        {level === 'songs' && songs.length > 0 && (
          <div>
            <Button onClick={handlePlayAlbum} icon={<Play size={13} />}>Speel dit hele album af</Button>
          </div>
        )}

        {(level === 'albums' || level === 'songs') && (
          <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
            <Pill
              label={
                bulkCatalogicProgress
                  ? `Bezig… ${bulkCatalogicProgress.done}/${bulkCatalogicProgress.total}`
                  : level === 'songs'
                    ? 'Vraag Catalogic dit hele album aan te maken'
                    : 'Vraag Catalogic deze hele artiest aan te maken'
              }
              onClick={bulkCatalogicProgress ? undefined : () => handleBulkCreateFromCatalogic(level === 'songs' ? 'album' : 'artist')}
            />
            {!bulkCatalogicProgress && (
              <Pill
                label="Toch opnieuw proberen"
                title="Vraagt Catalogic ook voor al gematchte nummers opnieuw te zoeken — gebruik dit als de albumhoes of het album niet klopt"
                onClick={() => handleBulkCreateFromCatalogic(level === 'songs' ? 'album' : 'artist', true)}
              />
            )}
            {bulkCatalogicSummary && (
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{bulkCatalogicSummary}</span>
            )}
          </div>
        )}

        {level === 'artists' && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`, gap: 14 }}>
            {visibleArtists.map((artist) => (
              <div
                key={artist.path}
                onClick={() => openArtist(artist)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <div style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {artist.artworkUrl ? (
                    <img src={artist.artworkUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={28} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
                  {artist.name}
                </span>
              </div>
            ))}
            {artists.length === 0 && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                Geen artiesten gevonden. Koppel je NAS schijf bij Instellingen → Netwerkschijf (NAS/SMB).
              </p>
            )}
          </div>
        )}

        {level === 'albums' && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`, gap: 14 }}>
            {visibleAlbums.map((album) => (
              <div
                key={album.path}
                onClick={() => openAlbum(album)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {album.artworkUrl ? (
                    <img src={album.artworkUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Music size={22} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
                  {album.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {level === 'songs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleSongs.map((song) => (
              <div
                key={song.path}
                className="flex items-center justify-between min-w-0"
                onClick={() => setSelectedSong(song)}
                style={{ gap: 10, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                <div className="flex items-center min-w-0" style={{ gap: 9 }}>
                  {song.coverUrl ? (
                    <img src={song.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Music size={14} style={{ color: 'var(--status-success)' }} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate" style={{ font: 'var(--text-body)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                      {song.title}
                    </div>
                    <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                      {song.artist} · {song.bitrate ? `${song.bitrate}kbps` : ''}
                    </div>
                  </div>
                  {song.hasLyrics && <Pill label="Lyrics" />}
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handlePlaySong(song)}
                    title="Speel af op Pi DAC"
                    style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)', color: 'var(--on-accent)' }}
                  >
                    <Play size={12} fill="currentColor" style={{ marginLeft: 1 }} />
                  </button>
                  <button onClick={() => handleQueueSong(song)} title="Voeg toe aan wachtrij" style={{ color: 'var(--accent)', padding: 4 }}>
                    <Plus size={13} />
                  </button>
                  {playlists && playlists.length > 0 && onAddTrackToPlaylist && (
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        onAddTrackToPlaylist(e.target.value, buildTrack(song));
                        e.target.value = '';
                      }}
                      title="Toevoegen aan playlist"
                      value=""
                      style={{ font: 'var(--text-mono-sm)', fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '2px 4px', maxWidth: 90 }}
                    >
                      <option value="">+ Playlist</option>
                      {playlists.map((pl) => (
                        <option key={pl.id} value={pl.id}>{pl.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedSong && (
          <div
            onClick={() => {
              setSelectedSong(null);
              setLyricsText(null);
              setLyricsLoading(false);
              lyricsRequestId.current++;
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="scrollbar-thin"
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                padding: 24,
                maxWidth: 420,
                width: '100%',
                maxHeight: '80vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div className="flex items-center" style={{ gap: 14 }}>
                <img
                  src={selectedSong.coverUrl || PLACEHOLDER_COVER}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }}
                />
                <div className="min-w-0">
                  <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{selectedSong.title}</div>
                  <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    {selectedSong.artist} — {selectedSong.album}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {selectedSong.hasLyrics && <Pill label="Lyrics" onClick={() => openLyrics(selectedSong)} />}
                {selectedSong.catalogicSongId ? (
                  <>
                    <Pill label="Catalogic-match" />
                    <Pill
                      label={creatingCatalogicEntry ? 'Bezig…' : 'Opnieuw proberen'}
                      title="Vraagt Catalogic opnieuw te zoeken — gebruik dit als de albumhoes of het album niet klopt"
                      onClick={creatingCatalogicEntry ? undefined : () => handleCreateFromCatalogic(selectedSong, true)}
                    />
                  </>
                ) : (
                  <Pill
                    label={creatingCatalogicEntry ? 'Bezig…' : 'Vraag Catalogic dit aan te maken'}
                    onClick={creatingCatalogicEntry ? undefined : () => handleCreateFromCatalogic(selectedSong)}
                  />
                )}
              </div>

              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>Duur: {Math.round((selectedSong.durationMs || 0) / 1000)}s</div>
                {selectedSong.bitrate && <div>Bitrate: {selectedSong.bitrate}kbps</div>}
                {selectedSong.sampleRate && <div>Sample rate: {selectedSong.sampleRate}Hz</div>}
                {selectedSong.bitDepth && <div>Bit depth: {selectedSong.bitDepth}bit</div>}
              </div>

              <div className="flex" style={{ gap: 8 }}>
                <Button onClick={() => handlePlaySong(selectedSong)} icon={<Play size={13} />}>Afspelen</Button>
                <Button variant="secondary" onClick={() => handleQueueSong(selectedSong)} icon={<Plus size={13} />}>Aan wachtrij toevoegen</Button>
              </div>

              {lyricsLoading && (
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Lyrics laden…</div>
              )}
              {lyricsText && (
                <div
                  style={{
                    font: 'var(--text-mono-sm)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    padding: 12,
                    background: 'var(--bg-inset)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {lyricsText}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

function Pill({ label, onClick, title }: { label: string; onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '3px 10px',
        borderRadius: 999,
        font: 'var(--text-mono-sm)',
        fontSize: 11,
        fontWeight: 600,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {label}
    </button>
  );
}
