import React, { useState } from 'react';
import {
  Check,
  Copy,
  Disc,
  ExternalLink,
  Maximize2,
  Pause,
  Play,
  Sparkles,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { PlaybackState, Track } from '../types';
import { IconButton, Slider } from './ui';

interface SpotifyArtworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  playback: PlaybackState;
  onTogglePlay: () => void;
  onSeek: (positionMs: number) => void;
  onVolumeChange: (volume: number) => void;
}

const SegButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      padding: '6px 12px',
      borderRadius: 'var(--radius-sm)',
      font: 'var(--text-mono-sm)',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      background: active ? 'var(--accent-soft)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      border: '1px solid ' + (active ? 'var(--accent-soft-strong)' : 'transparent'),
      transition: 'all var(--duration-fast) var(--ease-standard)',
    }}
  >
    {children}
  </button>
);

const specTile: React.CSSProperties = {
  padding: 12,
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

export const SpotifyArtworkModal: React.FC<SpotifyArtworkModalProps> = ({
  isOpen,
  onClose,
  track,
  playback,
  onTogglePlay,
  onSeek,
  onVolumeChange,
}) => {
  const [activeViewMode, setActiveViewMode] = useState<'sleeve' | 'vinyl' | 'back' | 'artist'>('sleeve');
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  if (!isOpen || !track) return null;

  const coverImage = track.highResCoverUrl || track.coverUrl;

  const handleCopyArtworkUrl = () => {
    navigator.clipboard.writeText(coverImage);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const viewModes: { id: typeof activeViewMode; label: string }[] = [
    { id: 'sleeve', label: 'Front sleeve' },
    { id: 'vinyl', label: 'Vinyl record' },
    { id: 'back', label: 'Liner notes' },
    ...(track.artistCoverUrl ? [{ id: 'artist' as const, label: 'Artist photo' }] : []),
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(4,5,7,0.82)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1120,
          maxHeight: '92%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <Disc size={18} style={{ animation: 'spin 8s linear infinite' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--accent)' }}>
                  Spotify hi-res artwork gallery
                </span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', background: 'var(--bg-inset)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
                  {track.format || 'HiFi Master'}
                </span>
              </div>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {track.title} · {track.artist}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              {viewModes.map((m) => (
                <SegButton key={m.id} active={activeViewMode === m.id} onClick={() => setActiveViewMode(m.id)}>
                  {m.label}
                </SegButton>
              ))}
            </div>
            <IconButton
              icon={copiedUrl ? <Check size={16} color="var(--status-success)" /> : <Copy size={16} />}
              title="Kopieer high-res artwork link"
              onClick={handleCopyArtworkUrl}
            />
            <IconButton icon={<X size={18} />} title="Sluiten" onClick={onClose} />
          </div>
        </div>

        {/* Body: two-column showcase */}
        <div
          className="scrollbar-thin grid-cols-1 lg:grid"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            display: 'grid',
            gridTemplateColumns: 'minmax(0,7fr) minmax(280px,5fr)',
            gap: 28,
            alignItems: 'start',
          }}
        >
          {/* Artwork display area */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, position: 'relative' }}>
            {activeViewMode === 'sleeve' && (
              <div
                onClick={() => setIsZoomed(!isZoomed)}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-default)',
                  boxShadow: 'var(--shadow-elevated)',
                  background: '#000',
                  width: 'min(100%, 420px)',
                  aspectRatio: '1/1',
                  transform: isZoomed ? 'scale(1.06)' : 'scale(1)',
                  transition: 'transform var(--duration-slow) var(--ease-standard)',
                }}
              >
                <img src={coverImage} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />

                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(4,5,7,0.8)',
                    border: '1px solid var(--border-default)',
                    font: 'var(--text-mono-sm)',
                    color: 'var(--status-success)',
                  }}
                >
                  <Zap size={12} />
                  <span>SPOTIFY HD 1200x1200</span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    insetInline: 0,
                    bottom: 0,
                    padding: 14,
                    background: 'linear-gradient(to top, rgba(4,5,7,0.9), transparent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    font: 'var(--text-mono-sm)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>Klik om in te zoomen</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
                    <Maximize2 size={13} />
                    HD preview
                  </span>
                </div>
              </div>
            )}

            {activeViewMode === 'vinyl' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', width: '100%', maxWidth: 380 }}>
                <div
                  style={{
                    width: 300,
                    height: 300,
                    borderRadius: '50%',
                    background: 'var(--bg-inset)',
                    border: '4px solid var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    animation: playback.isPlaying ? 'spin 10s linear infinite' : 'none',
                  }}
                >
                  {[12, 28, 44, 60, 76].map((inset) => (
                    <div
                      key={inset}
                      style={{
                        position: 'absolute',
                        inset,
                        borderRadius: '50%',
                        border: '1px solid var(--border-subtle)',
                        pointerEvents: 'none',
                      }}
                    />
                  ))}

                  <div
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      border: '2px solid var(--accent-soft-strong)',
                      boxShadow: 'var(--shadow-accent-glow)',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#000',
                    }}
                  >
                    <img src={coverImage} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }} referrerPolicy="no-referrer" />
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(4,5,7,0.45)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: 8,
                      }}
                    >
                      <span
                        style={{
                          font: 'var(--text-label)',
                          textTransform: 'uppercase',
                          color: 'var(--text-primary)',
                          lineHeight: 1.1,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 1,
                          WebkitBoxOrient: 'vertical' as any,
                        }}
                      >
                        {track.title}
                      </span>
                      <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', marginTop: 3, fontSize: 9 }}>
                        33⅓ RPM STEREO
                      </span>
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: 'var(--bg-page)',
                        border: '1px solid var(--border-default)',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeViewMode === 'back' && (
              <div
                style={{
                  width: '100%',
                  maxWidth: 420,
                  aspectRatio: '1/1',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 28,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: 'var(--shadow-card)',
                  font: 'var(--text-mono-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
                    <div>
                      <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--accent)' }}>
                        Original master recording
                      </span>
                      <h4 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: '4px 0 0' }}>{track.album}</h4>
                    </div>
                    <span style={{ color: 'var(--text-muted)' }}>{track.releaseYear || '1998'}</span>
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      ['Artist / ensemble', track.artist],
                      ['Platenlabel', track.recordLabel || 'Virgin / Circa'],
                      ['Genre stijl', track.genre || 'Audiophile reference'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
                        <span style={{ color: 'var(--text-primary)' }}>{value}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Master source:</span>
                      <span style={{ color: 'var(--status-success)' }}>Direct ALSA I2S bit-perfect</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 20, padding: 12, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontStyle: 'italic', color: 'var(--text-secondary)', margin: 0 }}>
                    "Gecodificeerd voor HiFi Raspberry Pi HSS DAC streaming met ultra-lage jitter en 10-bands ALSA DSP equalizer
                    correctie."
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, color: 'var(--text-muted)', fontSize: 10 }}>
                    <span>SPOTIFY URI: {track.uri}</span>
                    <span>24-BIT / 44.1kHz</span>
                  </div>
                </div>
              </div>
            )}

            {activeViewMode === 'artist' && track.artistCoverUrl && (
              <div
                style={{
                  width: '100%',
                  maxWidth: 420,
                  aspectRatio: '1/1',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-default)',
                  boxShadow: 'var(--shadow-card)',
                  background: '#000',
                  position: 'relative',
                }}
              >
                <img src={track.artistCoverUrl} alt={track.artist} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to top, rgba(4,5,7,0.92), rgba(4,5,7,0.2) 55%, transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    padding: 24,
                  }}
                >
                  <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--accent)' }}>
                    Spotify artist profile
                  </span>
                  <h3 style={{ font: 'var(--text-display)', color: 'var(--text-primary)', margin: '4px 0 0' }}>{track.artist}</h3>
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    Hoofdact van {track.album} · {track.genre}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(52,211,153,0.14)',
                    color: 'var(--status-success)',
                    font: 'var(--text-mono-sm)',
                  }}
                >
                  <Sparkles size={12} />
                  Authentic Spotify artwork
                </span>
                {track.releaseYear && <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{track.releaseYear}</span>}
              </div>
              <h2 style={{ font: 'var(--text-display)', color: 'var(--text-primary)', margin: '10px 0 0' }}>{track.title}</h2>
              <p style={{ font: 'var(--text-subtitle)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>{track.artist}</p>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Album: <span style={{ color: 'var(--text-secondary)' }}>{track.album}</span>
              </p>
            </div>

            {/* Palette swatches */}
            <div style={{ padding: 14, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                }}
              >
                <span>Artwork kleurenpalet</span>
                <span style={{ color: 'var(--accent)' }}>{track.dominantColor || 'var(--accent)'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: 'Primair', bg: track.dominantColor || 'var(--accent)', color: '#fff' },
                  { label: 'Diep nacht', bg: 'var(--bg-inset)', color: 'var(--text-secondary)' },
                  { label: 'Accent zacht', bg: 'var(--accent-soft)', color: 'var(--accent)' },
                  { label: 'Success', bg: 'rgba(52,211,153,0.16)', color: 'var(--status-success)' },
                ].map((sw) => (
                  <div
                    key={sw.label}
                    style={{
                      height: 30,
                      flex: 1,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      font: 'var(--text-mono-sm)',
                      fontSize: 9,
                      background: sw.bg,
                      color: sw.color,
                    }}
                  >
                    {sw.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Spec grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={specTile}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block' }}>
                  Stream kwaliteit
                </span>
                <span style={{ font: 'var(--text-mono)', fontWeight: 600, color: 'var(--status-success)', display: 'block', marginTop: 4 }}>320 kbps HiFi</span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Ogg Vorbis direct</span>
              </div>
              <div style={specTile}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block' }}>
                  DAC resolutie
                </span>
                <span style={{ font: 'var(--text-mono)', fontWeight: 600, color: 'var(--accent)', display: 'block', marginTop: 4 }}>24-bit / 44.1kHz</span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>I2S ALSA master</span>
              </div>
              <div style={specTile}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block' }}>
                  Platenlabel
                </span>
                <span style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)', display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {track.recordLabel || 'Virgin Records'}
                </span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{track.genre || 'Trip Hop'}</span>
              </div>
              <div style={specTile}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block' }}>
                  Spotify track URI
                </span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {track.uri}
                </span>
                <a
                  href={`https://open.spotify.com/track/${track.spotifyId || track.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, font: 'var(--text-mono-sm)', color: 'var(--status-success)', textDecoration: 'none' }}
                >
                  Open in Spotify
                  <ExternalLink size={11} />
                </a>
              </div>
            </div>

            {/* Player controls */}
            <div style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Slider
                value={playback.positionMs}
                min={0}
                max={playback.durationMs || 100}
                onChange={onSeek}
                label={formatTime(playback.positionMs)}
                valueLabel={formatTime(playback.durationMs)}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={onTogglePlay}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--accent)',
                      color: 'var(--on-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {playback.isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} fill="currentColor" />}
                  </button>
                  <div style={{ font: 'var(--text-mono-sm)' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Status</span>
                    <span style={{ color: playback.isPlaying ? 'var(--status-success)' : 'var(--text-secondary)', fontWeight: 600 }}>
                      {playback.isPlaying ? 'Afspelen (I2S DAC)' : 'Gepauzeerd'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 160 }}>
                  <Volume2 size={16} color="var(--text-secondary)" />
                  <Slider value={playback.volume} min={0} max={100} onChange={onVolumeChange} />
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', width: 32, textAlign: 'right' }}>{playback.volume}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
