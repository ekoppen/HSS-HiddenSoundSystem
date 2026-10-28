import React from 'react';
import { Folder, Music, Play, Plus } from 'lucide-react';
import type { NasFile } from './NasBrowser';

interface NasFileViewProps {
  files: NasFile[];
  onOpenFolder: (path: string) => void;
  onPlayFile: (file: NasFile) => void;
  onQueueFile: (file: NasFile) => void;
}

function isHiRes(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext);
}

export const NasFileTable: React.FC<NasFileViewProps> = ({ files, onOpenFolder, onPlayFile, onQueueFile }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--text-mono-sm)' }}>
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
        <th style={{ padding: '6px 8px' }}>Naam</th>
        <th style={{ padding: '6px 8px' }}>Artiest</th>
        <th style={{ padding: '6px 8px' }}>Album</th>
        <th style={{ padding: '6px 8px', textAlign: 'right' }}></th>
      </tr>
    </thead>
    <tbody>
      {files.map((file, idx) => {
        if (file.isDir) {
          return (
            <tr key={`dir-${idx}`} onClick={() => onOpenFolder(file.path)} style={{ cursor: 'pointer' }}>
              <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Folder size={13} style={{ color: 'var(--accent)' }} />
                {file.name}
              </td>
              <td colSpan={3} />
            </tr>
          );
        }
        if (!file.isAudio) return null;
        return (
          <tr key={`audio-${idx}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>
              {file.title || file.name}
              {isHiRes(file.name) && <span style={{ color: 'var(--text-muted)' }}> · Hi-Res</span>}
            </td>
            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{file.artist || '—'}</td>
            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{file.album || '—'}</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <button onClick={() => onPlayFile(file)} title="Speel af" style={{ padding: 4, color: 'var(--accent)' }}>
                <Play size={12} fill="currentColor" />
              </button>
              <button onClick={() => onQueueFile(file)} title="Voeg toe aan wachtrij" style={{ padding: 4, color: 'var(--accent)' }}>
                <Plus size={12} />
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const NasFileIconGrid: React.FC<NasFileViewProps> = ({ files, onOpenFolder, onPlayFile }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" style={{ gap: 14 }}>
    {files.map((file, idx) => {
      if (file.isDir) {
        return (
          <div
            key={`dir-${idx}`}
            onClick={() => onOpenFolder(file.path)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Folder size={28} style={{ color: 'var(--accent)' }} />
            </div>
            <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%' }}>{file.name}</span>
          </div>
        );
      }
      if (!file.isAudio) return null;
      return (
        <div
          key={`audio-${idx}`}
          onClick={() => onPlayFile(file)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {file.coverUrl ? (
              <img src={file.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Music size={22} style={{ color: 'var(--status-success)' }} />
            )}
          </div>
          <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
            {file.title || file.name}
          </span>
        </div>
      );
    })}
  </div>
);
