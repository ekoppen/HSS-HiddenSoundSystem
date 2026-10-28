import React, { useEffect, useState } from 'react';
import { Folder, LayoutGrid, List, ListPlus, Music, Play, Plus, Rows3 } from 'lucide-react';
import { Track } from '../types';
import { Button, Card } from './ui';
import { NasFileIconGrid, NasFileTable } from './NasFileViews';

export interface NasFile {
  isDir: boolean;
  isAudio: boolean;
  name: string;
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  durationMs?: number;
}

interface NasBrowserProps {
  onAddToQueue: (track: Track) => void;
  /** Fires after "Maak afspeellijst van deze map" succeeds, so a parent showing a playlist count/list can refetch. */
  onPlaylistCreated?: () => void;
}

/**
 * Browse & play NAS/local audio files — breadcrumbs, folder listing, play a
 * single file, play/queue a whole folder. Self-contained (owns its own browse
 * state and starts at /mnt/nas), so it can be dropped into the Bronnen tab
 * and into the SourcePicker without sharing state between the two.
 */
export const NasBrowser: React.FC<NasBrowserProps> = ({ onAddToQueue, onPlaylistCreated }) => {
  const [nasFiles, setNasFiles] = useState<NasFile[]>([]);
  const [nasCurrentPath, setNasCurrentPath] = useState('/mnt/nas');
  const [nasView, setNasView] = useState<'detail' | 'table' | 'icon'>(
    () => (localStorage.getItem('nas-browser-view') as 'detail' | 'table' | 'icon') || 'detail',
  );

  const changeNasView = (view: 'detail' | 'table' | 'icon') => {
    setNasView(view);
    localStorage.setItem('nas-browser-view', view);
  };

  useEffect(() => {
    handleBrowseNasPath('/mnt/nas');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBrowseNasPath = async (dirPath: string) => {
    try {
      const res = await fetch(`/api/nas/browse?path=${encodeURIComponent(dirPath)}`).then((r) => r.json());
      if (res.files) {
        setNasFiles(res.files);
        setNasCurrentPath(res.currentPath || dirPath);

        // Fire-and-forget artwork/metadata enrichment (real tags already came
        // back from /browse; this adds Catalogic art on top) — merges in once
        // it resolves, doesn't block the listing itself.
        const audioPaths = res.files.filter((f: NasFile) => f.isAudio).map((f: NasFile) => f.path);
        if (audioPaths.length > 0) {
          fetch('/api/nas/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: audioPaths }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.tracks) return;
              setNasFiles((prev) =>
                prev.map((f) => (enrichRes.tracks[f.path] ? { ...f, ...enrichRes.tracks[f.path] } : f)),
              );
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const handlePlayLocalFile = async (file: NasFile) => {
    try {
      await fetch('/api/nas/play-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: file.path, name: file.name }),
      });
    } catch (e) {}
  };

  const handleQueueFile = (file: NasFile) => {
    const ext = file.name.slice(file.name.lastIndexOf('.'));
    const isHiRes = ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext.toLowerCase());
    onAddToQueue({
      id: 'local-' + Date.now(),
      title: file.title || file.name,
      artist: file.artist || 'Lokale Audio',
      album: file.album || nasCurrentPath,
      coverUrl: file.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
      durationMs: file.durationMs || 240000,
      uri: `file://${file.path}`,
      bitrate: isHiRes ? 1411 : 320,
      sampleRate: isHiRes ? 96000 : 44100,
      bitDepth: isHiRes ? 24 : 16,
      dominantColor: '#0ea5e9',
    });
  };

  const handlePlayNasFolder = async (dirPath: string) => {
    try {
      const res = await fetch('/api/nas/play-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath }),
      }).then((r) => r.json());
      if (!res.success) alert(res.error || 'Kon map niet afspelen');
    } catch (e) {}
  };

  const handleCreatePlaylistFromFolder = async () => {
    try {
      const res = await fetch('/api/nas/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: nasCurrentPath }),
      }).then((r) => r.json());

      if (res.playlist) {
        onPlaylistCreated?.();
        alert(`Afspeellijst '${res.playlist.name}' aangemaakt met ${res.playlist.trackCount} nummers!`);
      }
    } catch (e) {}
  };

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          className="flex flex-wrap items-center justify-between"
          style={{ gap: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}
        >
          <div className="flex items-center" style={{ gap: 10 }}>
            <Folder size={18} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Bestanden verkenner</div>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>{nasCurrentPath}</p>
            </div>
          </div>

          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => handlePlayNasFolder(nasCurrentPath)}>
              Speel deze map af
            </Button>
            <Button variant="secondary" size="sm" icon={<ListPlus size={13} />} onClick={handleCreatePlaylistFromFolder}>
              Maak afspeellijst van deze map
            </Button>
            <div className="flex items-center" style={{ gap: 2, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
              {([
                ['detail', Rows3, 'Detailweergave'],
                ['table', List, 'Tabelweergave'],
                ['icon', LayoutGrid, 'Icoonweergave'],
              ] as const).map(([view, Icon, label]) => (
                <button
                  key={view}
                  onClick={() => changeNasView(view)}
                  title={label}
                  style={{
                    padding: 6,
                    borderRadius: 'var(--radius-sm)',
                    background: nasView === view ? 'var(--accent-soft)' : 'transparent',
                    color: nasView === view ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center flex-wrap self-start" style={{ gap: 4, font: 'var(--text-mono-sm)' }}>
          {(() => {
            const segments = nasCurrentPath.split('/').filter(Boolean);
            const crumbs = [{ label: '/', path: '/' }, ...segments.map((seg, i) => ({
              label: seg,
              path: '/' + segments.slice(0, i + 1).join('/'),
            }))];
            return crumbs.map((crumb, i) => (
              <React.Fragment key={crumb.path}>
                {i > 0 && <span style={{ color: 'var(--text-muted)' }}>/</span>}
                <button
                  onClick={() => handleBrowseNasPath(crumb.path)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    color: i === crumbs.length - 1 ? 'var(--accent)' : 'var(--text-secondary)',
                    background: i === crumbs.length - 1 ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ));
          })()}
        </div>

        {nasView === 'table' ? (
          <NasFileTable files={nasFiles} onOpenFolder={handleBrowseNasPath} onPlayFile={handlePlayLocalFile} onQueueFile={handleQueueFile} />
        ) : nasView === 'icon' ? (
          <NasFileIconGrid files={nasFiles} onOpenFolder={handleBrowseNasPath} onPlayFile={handlePlayLocalFile} onQueueFile={handleQueueFile} />
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 10 }}>
          {nasFiles.map((file, idx) => {
            if (file.isDir) {
              return (
                <div
                  key={`dir-${idx}`}
                  onClick={() => handleBrowseNasPath(file.path)}
                  className="flex items-center min-w-0"
                  style={{
                    gap: 10,
                    padding: 12,
                    background: 'var(--bg-inset)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  <Folder size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                    {file.name}
                  </span>
                </div>
              );
            }

            if (file.isAudio) {
              const ext = file.name.slice(file.name.lastIndexOf('.'));
              const isHiRes = ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext.toLowerCase());
              return (
                <div
                  key={`audio-${idx}`}
                  className="flex items-center justify-between min-w-0"
                  style={{ gap: 10, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
                >
                  <div className="flex items-center min-w-0" style={{ gap: 9 }}>
                    {file.coverUrl ? (
                      <img src={file.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Music size={14} style={{ color: 'var(--status-success)' }} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate" style={{ font: 'var(--text-body)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                        {file.title || file.name}
                      </div>
                      {file.artist && (
                        <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                          {file.artist}
                          {isHiRes && ' · Hi-Res'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
                    <button
                      onClick={() => handlePlayLocalFile(file)}
                      title="Speel af op Pi DAC"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--accent)',
                        color: 'var(--on-accent)',
                      }}
                    >
                      <Play size={12} fill="currentColor" style={{ marginLeft: 1 }} />
                    </button>
                    <button
                      onClick={() => handleQueueFile(file)}
                      title="Voeg toe aan wachtrij"
                      style={{ color: 'var(--accent)', padding: 4 }}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
        )}

        {nasFiles.length === 0 && (
          <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
            Geen bestanden gevonden in {nasCurrentPath}. Koppel je NAS schijf bij Instellingen → Netwerkschijf (NAS/SMB).
          </p>
        )}
      </div>
    </Card>
  );
};
