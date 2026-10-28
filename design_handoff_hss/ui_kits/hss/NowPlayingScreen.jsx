
function NowPlayingScreen() {
  const { Card, IconButton, Slider, SpecStat, SpectrumBars, Badge } = window.SoloistDS;
  const { Shuffle, Rewind, Play, Pause, FastForward, Repeat, Volume2, Cast, ListMusic, Disc } = window.Icons;

  const [isPlaying, setIsPlaying] = React.useState(true);
  const [shuffle, setShuffle] = React.useState(false);
  const [repeat, setRepeat] = React.useState(false);
  const [volume, setVolume] = React.useState(62);
  const [position, setPosition] = React.useState(84000);
  const duration = 220000;
  const [spectrum, setSpectrum] = React.useState(() => Array.from({ length: 16 }, () => 20));

  React.useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setSpectrum(Array.from({ length: 16 }, () => 10 + Math.random() * 80));
      setPosition((p) => Math.min(duration, p + 1000));
    }, 700);
    return () => clearInterval(id);
  }, [isPlaying]);

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  };

  const queue = [
    { title: 'Nightcall', artist: 'Kavinsky', dur: '4:18' },
    { title: 'Sunset Boulevard', artist: 'FM-84', dur: '3:52' },
    { title: 'Turbo Killer', artist: 'Carpenter Brut', dur: '4:41' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 32, padding: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 232, height: 232, borderRadius: 'var(--radius-lg)', background: 'var(--bg-inset)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
              <Disc size={48} style={{ color: 'var(--text-muted)' }} />
              <div style={{ position: 'absolute', top: 10, left: 10 }}>
                <Badge variant={isPlaying ? 'success' : 'neutral'}>{isPlaying ? 'SPOTIFY HD' : 'STANDBY'}</Badge>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 0, width: '100%', padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', justifyContent: 'space-between' }}>
              <SpecStat label="Bitrate" value="320 kbps" tone="status-success" />
              <SpecStat label="DAC" value="24/44.1" tone="accent" />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--accent)' }}>
                  {isPlaying ? 'Nu Wordt Afgespeeld' : 'Gepauzeerd'}
                </span>
                <IconButton icon={<Cast size={16} />} title="Casten" />
              </div>
              <h2 style={{ font: 'var(--text-display)', color: 'var(--text-primary)', margin: '6px 0 2px' }}>Nightcall</h2>
              <p style={{ font: 'var(--text-subtitle)', color: 'var(--text-secondary)', margin: 0 }}>Kavinsky</p>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>Album: OutRun · Label: Record Makers</p>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>REAL-TIME I2S FREQUENTIE SPECTRUM</span>
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>31Hz – 16kHz</span>
              </div>
              <SpectrumBars values={spectrum} active={isPlaying} />
            </div>

            <Slider value={position} max={duration} onChange={setPosition} valueLabel={fmt(position) + ' / -' + fmt(duration - position)} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <IconButton icon={<Shuffle size={18} />} active={shuffle} onClick={() => setShuffle(!shuffle)} title="Shuffle" />
              <IconButton icon={<Rewind size={20} />} title="Vorige" size={40} />
              <button onClick={() => setIsPlaying(!isPlaying)} style={{
                width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: 'var(--on-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer',
                boxShadow: 'var(--shadow-accent-glow)',
              }}>
                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <IconButton icon={<FastForward size={20} />} title="Volgende" size={40} />
              <IconButton icon={<Repeat size={18} />} active={repeat} onClick={() => setRepeat(!repeat)} title="Repeat" />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Volume2 size={16} style={{ color: 'var(--text-muted)' }} />
              <Slider value={volume} onChange={setVolume} />
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', width: 36, textAlign: 'right' }}>{volume}%</span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <ListMusic size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-primary)' }}>Volgende in Wachtrij ({queue.length})</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {queue.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)' }}>
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{i + 1}</span>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg-card)', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{t.artist}</div>
              </div>
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{t.dur}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

window.NowPlayingScreen = NowPlayingScreen;
