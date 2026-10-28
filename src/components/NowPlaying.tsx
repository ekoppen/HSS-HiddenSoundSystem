import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Cast, Disc, FastForward, ListMusic, Pause, Play, Repeat, Rewind, Shuffle, Volume2, VolumeX, Waves } from 'lucide-react';
import { ExternalSourceState, LikedTrack, PlaybackState, Track } from '../types';
import { LikeButton } from './LikeButton';
import { SpotifyArtworkModal } from './SpotifyArtworkModal';
import { SourcePicker } from './SourcePicker';
import { Badge, Card, IconButton, ProgressBar, SpecStat, Slider, SpectrumBars } from '../components/ui';

interface NowPlayingProps {
  playback: PlaybackState;
  externalSource?: ExternalSourceState | null;
  likes: LikedTrack[];
  onPlay: () => void;
  onPause: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onSelectTrackFromQueue: (track: Track) => void;
  onOpenCast?: () => void;
  onBrowseSpotify?: () => void;
}

const label: React.CSSProperties = {
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
};

export const NowPlaying: React.FC<NowPlayingProps> = ({
  playback,
  externalSource,
  likes,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onToggleRepeat,
  onSelectTrackFromQueue,
  onOpenCast,
  onBrowseSpotify,
}) => {
  const [isArtworkModalOpen, setIsArtworkModalOpen] = useState(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);

  const {
    currentTrack: playbackTrack,
    isPlaying,
    positionMs,
    durationMs,
    volume,
    isMuted,
    shuffle,
    repeat,
    queue,
    spectrum,
    systemStats,
    spotifyConnected,
  } = playback;

  // A recognized turntable/CD track (see the "Extern" tab in the source picker)
  // takes over the display entirely — this app has no transport control over
  // it, the audio never passes through here. Checked on `active` alone (not
  // `active && track`): the backend briefly sets track to null while it's
  // re-recognizing a new track (see state.ts's onTransitionDetected) — if we
  // required track here too, that gap would fall through to the stale
  // `playbackTrack` from whatever played before this external source was
  // selected, flashing that old source's info.
  const isExternalActive = Boolean(externalSource?.active);
  const currentTrack = isExternalActive ? externalSource!.track : playbackTrack;

  // Local/NAS files and web radio are fully backend-controlled and always respond to
  // transport commands. Spotify only responds while a real Connect session is live —
  // without one (nobody has connected yet, or the session ended) the buttons here
  // would do nothing, so we hide them instead of showing dead controls. An external
  // source is display-only — there's never anything to control.
  type Source = 'spotify' | 'local' | 'radio' | 'external' | 'none';
  const source: Source = isExternalActive
    ? 'external'
    : !currentTrack
    ? 'none'
    : currentTrack.uri?.startsWith('spotify:')
    ? 'spotify'
    : currentTrack.uri?.startsWith('file://')
    ? 'local'
    : 'radio';
  const controlsEnabled = source === 'external' ? false : source === 'spotify' ? spotifyConnected : source !== 'none';
  // Display (art/title/artist) shows for external too — there's a real
  // recognized track, it's only the transport controls that don't apply.
  const showTrackInfo = controlsEnabled || isExternalActive;

  // Ticks once a second while an external track's estimated position is on
  // screen — nothing else here re-renders on a plain clock tick, since the
  // normal playback progress bar already updates from the backend's own
  // progress_tick WebSocket event.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isExternalActive || !externalSource?.trackStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isExternalActive, externalSource?.trackStartedAt]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const artUrl = showTrackInfo ? currentTrack?.highResCoverUrl || currentTrack?.coverUrl : undefined;
  const sourceBadgeLabel =
    source === 'local' ? 'NAS' : source === 'radio' ? 'RADIO' : source === 'external' ? (externalSource?.sourceLabel || 'EXTERN').toUpperCase() : 'SPOTIFY HD';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {systemStats.crossfadeActive && (
        <Card style={{ borderColor: 'var(--accent-soft-strong)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Waves size={16} style={{ color: 'var(--accent)' }} />
              <div>
                <div style={{ ...label, color: 'var(--accent)' }}>Live Crossfade Overgang Actief</div>
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                  Vloeiend overvloeien naar: {queue[0]?.title || 'volgende track'}
                </div>
              </div>
            </div>
            <div style={{ width: 160 }}>
              <ProgressBar pct={systemStats.crossfadeProgressPct ?? 0} />
            </div>
          </div>
        </Card>
      )}

      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,280px)_1fr]" style={{ gap: 32, padding: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div
              onClick={() => setIsArtworkModalOpen(true)}
              title="Klik om Spotify artwork te bekijken"
              style={{
                width: 232,
                height: 232,
                maxWidth: '100%',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              {artUrl ? (
                <img src={artUrl} alt={currentTrack?.title || 'Album art'} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Disc size={48} style={{ color: 'var(--text-muted)' }} />
              )}
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <Badge variant={showTrackInfo && isPlaying ? 'success' : 'neutral'}>
                  {showTrackInfo ? sourceBadgeLabel : 'STANDBY'}
                </Badge>
              </div>
            </div>
            <div style={{ display: 'flex', width: '100%', padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', justifyContent: 'space-between' }}>
              <SpecStat label="Bitrate" value={`${systemStats.streamBitrate} kbps`} tone="status-success" />
              <SpecStat label="DAC" value={`${systemStats.streamBitDepth}/${(systemStats.streamSampleRate / 1000).toFixed(1)}`} tone="accent" />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20, minWidth: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ ...label, color: 'var(--accent)' }}>
                  {isExternalActive
                    ? externalSource?.sourceLabel || 'Externe bron'
                    : controlsEnabled
                    ? isPlaying
                      ? 'Nu Wordt Afgespeeld'
                      : 'Gepauzeerd'
                    : 'Wachten op bron'}
                </span>
                <LikeButton track={showTrackInfo ? currentTrack : null} likes={likes} />
                <IconButton icon={<ArrowLeftRight size={16} />} title="Bron kiezen" onClick={() => setIsSourcePickerOpen(true)} />
                {onOpenCast && <IconButton icon={<Cast size={16} />} title="Casten" onClick={onOpenCast} />}
              </div>
              <h2 style={{ font: 'var(--text-display)', color: 'var(--text-primary)', margin: '6px 0 2px' }}>
                {showTrackInfo ? currentTrack?.title || 'Onbekende track' : source === 'spotify' ? 'Gereed voor Spotify Connect' : 'Wachten op bron'}
              </h2>
              <p style={{ font: 'var(--text-subtitle)', color: 'var(--text-secondary)', margin: 0 }}>
                {showTrackInfo
                  ? currentTrack?.artist || 'Onbekende artiest'
                  : source === 'spotify'
                  ? "Selecteer 'HSSwoonkamer' in je Spotify app"
                  : 'Kies Radio, NAS, Spotify of een externe bron via het bronkeuze-icoon'}
              </p>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
                {source === 'radio' ? 'Zender' : 'Album'}: {showTrackInfo ? currentTrack?.album || '—' : 'HSS HiFi Hub'}
                {showTrackInfo && currentTrack?.recordLabel && ` · Label: ${currentTrack.recordLabel}`}
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>REAL-TIME I2S FREQUENTIE SPECTRUM</span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>31Hz &ndash; 16kHz</span>
              </div>
              <SpectrumBars values={spectrum} active={isPlaying} />
            </div>

            {controlsEnabled ? (
              <>
                <Slider
                  value={positionMs}
                  max={durationMs}
                  onChange={onSeek}
                  valueLabel={`${formatTime(positionMs)} / -${formatTime(Math.max(0, durationMs - positionMs))}`}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <IconButton icon={<Shuffle size={18} />} active={shuffle} onClick={onToggleShuffle} title="Shuffle" />
                  <IconButton icon={<Rewind size={20} />} onClick={onPrevious} title="Vorige" size={40} />
                  <button
                    onClick={onToggle}
                    title={isPlaying ? 'Pauzeren' : 'Afspelen'}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      color: 'var(--on-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-accent-glow)',
                    }}
                  >
                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 2 }} />}
                  </button>
                  <IconButton icon={<FastForward size={20} />} onClick={onNext} title="Volgende" size={40} />
                  <div style={{ position: 'relative' }}>
                    <IconButton icon={<Repeat size={18} />} active={repeat !== 'off'} onClick={onToggleRepeat} title={`Repeat: ${repeat}`} />
                    {repeat === 'track' && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -2,
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          color: 'var(--on-accent)',
                          font: 'var(--text-mono-sm)',
                          fontSize: 9,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        1
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={onToggleMute} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }} title={isMuted ? 'Dempen opheffen' : 'Dempen'}>
                    {isMuted || volume === 0 ? <VolumeX size={16} style={{ color: 'var(--status-danger)' }} /> : <Volume2 size={16} style={{ color: 'var(--text-muted)' }} />}
                  </button>
                  <Slider value={isMuted ? 0 : volume} onChange={onVolumeChange} />
                </div>
              </>
            ) : isExternalActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {externalSource?.trackStartedAt && currentTrack?.durationMs ? (
                  (() => {
                    // Estimate only — this app never sees the physical
                    // source's real transport position, so a manual pause
                    // or seek on the turntable/CD player desyncs this
                    // silently. See ExternalSourceState.trackStartedAt.
                    const estimatedPositionMs = Math.min(currentTrack.durationMs, Math.max(0, now - externalSource.trackStartedAt!));
                    return (
                      <ProgressBar
                        pct={(estimatedPositionMs / currentTrack.durationMs) * 100}
                        label={`${formatTime(estimatedPositionMs)} / -${formatTime(Math.max(0, currentTrack.durationMs - estimatedPositionMs))} (geschat)`}
                      />
                    );
                  })()
                ) : null}
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                  Alleen weergave — {externalSource?.sourceLabel || 'deze bron'} wordt niet door de Hub bediend.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                  Verbind via Spotify Connect, of blader hieronder direct in je Spotify-bibliotheek.
                </p>
                {onBrowseSpotify && (
                  <button
                    onClick={onBrowseSpotify}
                    className="flex items-center"
                    style={{
                      gap: 8,
                      padding: '8px 14px',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent-soft-strong)',
                      borderRadius: 'var(--radius-md)',
                      font: 'var(--text-body-strong)',
                      fontSize: 13,
                    }}
                  >
                    <Disc size={14} />
                    <span>Blader door Spotify</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <ListMusic size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ ...label, color: 'var(--text-primary)' }}>Volgende in Wachtrij ({queue.length})</span>
        </div>
        {queue.length === 0 ? (
          <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
            {source === 'spotify'
              ? 'De afspeelwachtrij wordt live beheerd in je Spotify app.'
              : 'De wachtrij is leeg.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 12 }}>
            {queue.slice(0, 3).map((track, i) => (
              <div
                key={track.id || i}
                onClick={() => onSelectTrackFromQueue(track)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)', cursor: 'pointer' }}
              >
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{i + 1}</span>
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt={track.title} referrerPolicy="no-referrer" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg-card)', flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </div>
                  <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                </div>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{formatTime(track.durationMs)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SpotifyArtworkModal
        isOpen={isArtworkModalOpen}
        onClose={() => setIsArtworkModalOpen(false)}
        track={currentTrack}
        playback={playback}
        onTogglePlay={onToggle}
        onSeek={onSeek}
        onVolumeChange={onVolumeChange}
      />

      <SourcePicker isOpen={isSourcePickerOpen} onClose={() => setIsSourcePickerOpen(false)} onBrowseSpotify={onBrowseSpotify} />
    </div>
  );
};
