import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Disc, Disc3, HardDrive, Mic, Music2, Play, Radio as RadioIcon, RefreshCw, Square } from 'lucide-react';
import { ExternalSourceState, Track } from '../types';
import { Modal, Tabs } from './ui';
import { NasBrowser } from './NasBrowser';
import { NasMusicLibrary } from './NasMusicLibrary';

interface WebRadioStation {
  id: string;
  name: string;
  genre: string;
  url: string;
  bitrate: number;
  logoUrl?: string;
}

interface StatusInfo {
  hasSpotifyCredentials: boolean;
  spotifyConnected: boolean;
  spotifyDeviceName: string;
}

interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  isSpotify: boolean;
  uri: string;
}

interface SourcePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Jumps to the full Spotify browser (search, own playlists) in the Bronnen tab.
   * Only meaningful in the admin app — omitted on the cast kiosk, which has no such tab. */
  onBrowseSpotify?: () => void;
  /** %, 100 = normal size. Only the cast/kiosk screen passes this (from
   * castDesign.sourcePickerScale) — the admin app's own picker always stays
   * at 100%. Applied as CSS zoom so every icon/text/thumbnail inside scales
   * together without touching each one individually. */
  scale?: number;
}

/**
 * Quick "choose a source" popover — reachable from both the Afspelen screen and
 * the Cast screen (including directly on the Nest Hub touchscreen while casting).
 * Fully self-contained: fetches its own station list/status, so it drops into
 * either screen without threading state through App.tsx.
 */
export const SourcePicker: React.FC<SourcePickerProps> = ({ isOpen, onClose, onBrowseSpotify, scale = 100 }) => {
  const [tab, setTab] = useState<'radio' | 'nas' | 'spotify' | 'external'>('radio');
  // Shares its localStorage key with PlaylistManager's NAS toggle so the
  // library-vs-files choice stays consistent between the two places NAS
  // browsing shows up, rather than each remembering its own.
  const [nasSubView, setNasSubView] = useState<'library' | 'files'>(
    () => (localStorage.getItem('nas-sub-view') as 'library' | 'files') || 'library',
  );
  const [stations, setStations] = useState<WebRadioStation[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [externalSource, setExternalSource] = useState<ExternalSourceState | null>(null);
  const [externalReady, setExternalReady] = useState<{ hasApiKey: boolean; hasMicDevice: boolean } | null>(null);

  const fetchExternalStatus = () => {
    fetch('/api/recognize/status')
      .then((r) => r.json())
      .then((res) => {
        if (res.externalSource) setExternalSource(res.externalSource);
        setExternalReady({ hasApiKey: !!res.hasApiKey, hasMicDevice: !!res.hasMicDevice });
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/radio/stations')
      .then((r) => r.json())
      .then((res) => {
        if (res.stations) setStations(res.stations);
      })
      .catch(() => {});
    fetch('/api/status')
      .then((r) => r.json())
      .then((res) => {
        setStatus({
          hasSpotifyCredentials: !!res.hubConfig?.hasSpotifyCredentials,
          spotifyConnected: !!res.playback?.spotifyConnected,
          spotifyDeviceName: res.hubConfig?.spotifyDeviceName || 'je HSS Hub',
        });
      })
      .catch(() => {});
    fetchExternalStatus();
    // Only the kiosk (no onBrowseSpotify — see the prop's doc comment) needs
    // this: the admin app already has a full Spotify browser/search behind
    // that button, so fetching the same list again here would be wasted
    // work there.
    if (!onBrowseSpotify) {
      fetch('/api/spotify/user-playlists')
        .then((r) => r.json())
        .then((res) => {
          if (res.playlists) setSpotifyPlaylists(res.playlists.filter((p: SpotifyPlaylistSummary) => p.isSpotify));
        })
        .catch(() => {});
    }
  }, [isOpen, onBrowseSpotify]);

  // Light polling for the "now recognizing" state while this tab is actually
  // visible — the modal has no WebSocket subscription of its own.
  useEffect(() => {
    if (!isOpen || tab !== 'external') return;
    const interval = setInterval(fetchExternalStatus, 5000);
    return () => clearInterval(interval);
  }, [isOpen, tab]);

  const handleStartListening = async (source: 'turntable' | 'cd') => {
    try {
      const res = await fetch('/api/recognize/listen/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      }).then((r) => r.json());
      if (res.success) setExternalSource(res.externalSource);
      else if (res.error) alert(res.error);
    } catch (e) {}
  };

  const handleStopListening = async () => {
    try {
      await fetch('/api/recognize/listen/stop', { method: 'POST' });
      fetchExternalStatus();
    } catch (e) {}
  };

  // Fallback for when the automatic silence-detection misses a real track
  // change (e.g. a gapless album with no silence between tracks at all) —
  // forces one fresh recognition attempt right now.
  const handleRescan = async () => {
    try {
      const res = await fetch('/api/recognize/rescan', { method: 'POST' }).then((r) => r.json());
      if (res.success) fetchExternalStatus();
      else if (res.error) alert(res.error);
    } catch (e) {}
  };

  const handlePlayStation = async (station: WebRadioStation) => {
    try {
      await fetch('/api/radio/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: station.id,
          url: station.url,
          name: station.name,
          genre: station.genre,
          logoUrl: station.logoUrl,
        }),
      });
    } catch (e) {}
    onClose();
  };

  const handlePlaySpotifyPlaylist = async (playlist: SpotifyPlaylistSummary) => {
    try {
      await fetch('/api/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: playlist.uri }),
      });
    } catch (e) {}
    onClose();
  };

  const handleAddToQueue = async (track: Track) => {
    try {
      await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track }),
      });
    } catch (e) {}
  };

  // One request/one toast for the whole batch (e.g. "play this whole
  // album") instead of one queue_update per track — see handlePlayAlbum.
  const handleAddManyToQueue = async (tracks: Track[], label?: string) => {
    try {
      await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks, label }),
      });
    } catch (e) {}
  };

  const tabs = [
    { id: 'radio', label: `Radio (${stations.length})`, icon: <RadioIcon size={14} /> },
    { id: 'nas', label: 'NAS', icon: <HardDrive size={14} /> },
    ...(status?.hasSpotifyCredentials ? [{ id: 'spotify', label: 'Spotify', icon: <Music2 size={14} /> }] : []),
    { id: 'external', label: 'Extern (LP/CD)', icon: <Mic size={14} /> },
  ];

  return (
    <Modal open={isOpen} onClose={onClose} icon={<ArrowLeftRight size={18} />} title="Bron kiezen" subtitle="Kies wat er nu afgespeeld wordt" maxWidth={Math.round(760 * (scale / 100))}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, zoom: scale / 100 } as React.CSSProperties}>
        <Tabs items={tabs} activeId={tab} onChange={(id) => setTab(id as any)} />

        {tab === 'radio' && (
          <div className="scrollbar-thin grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {stations.length === 0 && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
                Nog geen zenders opgeslagen. Voeg er een toe bij Bronnen → Web Radio.
              </p>
            )}
            {stations.map((station) => (
              <button
                key={station.id}
                onClick={() => handlePlayStation(station)}
                className="flex items-center justify-between min-w-0"
                style={{
                  gap: 10,
                  padding: 12,
                  background: 'var(--bg-inset)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                }}
              >
                <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                  {station.logoUrl ? (
                    <img src={station.logoUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <RadioIcon size={14} style={{ color: 'var(--accent)' }} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate" style={{ font: 'var(--text-body)', fontSize: 12.5, color: 'var(--text-primary)' }}>{station.name}</div>
                    <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{station.genre}</div>
                  </div>
                </div>
                <Play size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} fill="currentColor" />
              </button>
            ))}
          </div>
        )}

        {tab === 'nas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="flex items-center" style={{ gap: 2, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)', padding: 2, alignSelf: 'flex-start' }}>
              <button
                onClick={() => { setNasSubView('library'); localStorage.setItem('nas-sub-view', 'library'); }}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', font: 'var(--text-mono-sm)', background: nasSubView === 'library' ? 'var(--accent-soft)' : 'transparent', color: nasSubView === 'library' ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                Muziekbibliotheek
              </button>
              <button
                onClick={() => { setNasSubView('files'); localStorage.setItem('nas-sub-view', 'files'); }}
                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', font: 'var(--text-mono-sm)', background: nasSubView === 'files' ? 'var(--accent-soft)' : 'transparent', color: nasSubView === 'files' ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                Bestanden
              </button>
            </div>
            <div className="scrollbar-thin" style={{ maxHeight: 480, overflowY: 'auto' }}>
              {nasSubView === 'library' ? (
                <NasMusicLibrary onAddToQueue={handleAddToQueue} onAddManyToQueue={handleAddManyToQueue} />
              ) : (
                <NasBrowser onAddToQueue={handleAddToQueue} />
              )}
            </div>
          </div>
        )}

        {tab === 'spotify' && status?.hasSpotifyCredentials && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                padding: 16,
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                font: 'var(--text-body)',
                color: 'var(--text-secondary)',
              }}
            >
              {status.spotifyConnected ? (
                <span>Spotify Connect is actief verbonden en speelt nu af.</span>
              ) : (
                <span>
                  Open Spotify op je telefoon of laptop en kies <strong>{status.spotifyDeviceName}</strong> als
                  afspeelapparaat, of blader hieronder direct in je eigen Spotify-bibliotheek.
                </span>
              )}
            </div>
            {onBrowseSpotify ? (
              <button
                onClick={() => {
                  onBrowseSpotify();
                  onClose();
                }}
                className="flex items-center justify-center"
                style={{
                  gap: 8,
                  padding: '10px 14px',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  borderRadius: 'var(--radius-md)',
                  font: 'var(--text-body-strong)',
                  fontSize: 13,
                }}
              >
                <Music2 size={14} />
                <span>Blader door Spotify (playlists & zoeken)</span>
              </button>
            ) : (
              // No "Bladeren" tab to jump to here (kiosk has none) — and
              // searching needs a keyboard this touchscreen doesn't have.
              // Own playlists need only tapping, so show those directly.
              <div className="scrollbar-thin grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {spotifyPlaylists.length === 0 && (
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
                    Geen Spotify-playlists gevonden.
                  </p>
                )}
                {spotifyPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() => handlePlaySpotifyPlaylist(playlist)}
                    className="flex items-center justify-between min-w-0"
                    style={{
                      gap: 10,
                      padding: 12,
                      background: 'var(--bg-inset)',
                      borderRadius: 'var(--radius-md)',
                      textAlign: 'left',
                    }}
                  >
                    <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                      {playlist.coverUrl ? (
                        <img src={playlist.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music2 size={14} style={{ color: 'var(--accent)' }} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate" style={{ font: 'var(--text-body)', fontSize: 12.5, color: 'var(--text-primary)' }}>{playlist.name}</div>
                        <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{playlist.trackCount} nummers</div>
                      </div>
                    </div>
                    <Play size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} fill="currentColor" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'external' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
              Deze app speelt dit geluid niet af — het is alleen een "nu speelt"-weergave voor je platenspeler of
              CD-speler, via een USB-microfoon.
            </p>

            {(!externalReady?.hasMicDevice || !externalReady?.hasApiKey) && (
              <div style={{ padding: 12, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: '#fbbf24' }}>
                {!externalReady?.hasMicDevice
                  ? 'Nog geen microfoon ingesteld bij Instellingen → Muziekherkenning.'
                  : 'Nog geen AcoustID API-sleutel ingesteld bij Instellingen → Muziekherkenning.'}
              </div>
            )}

            {externalSource?.active ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="flex items-center justify-between" style={{ padding: 14, background: 'var(--bg-inset)', borderRadius: 'var(--radius-lg)' }}>
                  <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                    {externalSource.sourceType === 'turntable' ? (
                      <Disc size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    ) : (
                      <Disc3 size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                    <div className="min-w-0">
                      <div style={{ font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' }}>{externalSource.sourceLabel}</div>
                      <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                        {externalSource.status === 'recognizing' && 'Luisteren...'}
                        {externalSource.status === 'no_match' && 'Geen match gevonden'}
                        {externalSource.status === 'error' && (externalSource.errorMessage || 'Fout bij herkenning')}
                        {externalSource.status === 'listening' && externalSource.track && (
                          <>
                            {externalSource.track.title} · {externalSource.track.artist}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={handleRescan}
                      disabled={externalSource.status === 'recognizing'}
                      title="Scan opnieuw — als de automatische herkenning een nummer heeft gemist"
                      style={{
                        padding: 8,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--accent)',
                        opacity: externalSource.status === 'recognizing' ? 0.5 : 1,
                      }}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={handleStopListening}
                      title="Stop luisteren"
                      style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--status-danger)' }}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 10 }}>
                <button
                  onClick={() => handleStartListening('turntable')}
                  disabled={!externalReady?.hasMicDevice}
                  className="flex items-center justify-center"
                  style={{
                    gap: 8,
                    padding: '14px',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    color: 'var(--text-primary)',
                    font: 'var(--text-body-strong)',
                    fontSize: 13,
                    opacity: externalReady?.hasMicDevice ? 1 : 0.5,
                  }}
                >
                  <Disc size={16} style={{ color: 'var(--accent)' }} />
                  <span>Platenspeler</span>
                </button>
                <button
                  onClick={() => handleStartListening('cd')}
                  disabled={!externalReady?.hasMicDevice}
                  className="flex items-center justify-center"
                  style={{
                    gap: 8,
                    padding: '14px',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    color: 'var(--text-primary)',
                    font: 'var(--text-body-strong)',
                    fontSize: 13,
                    opacity: externalReady?.hasMicDevice ? 1 : 0.5,
                  }}
                >
                  <Disc3 size={16} style={{ color: 'var(--accent)' }} />
                  <span>CD-speler</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
