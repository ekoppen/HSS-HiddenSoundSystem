
function MediaCenterScreen() {
  const { Card, Button, Badge } = window.SoloistDS;
  const { Disc, Radio, HardDrive, ListMusic, Search, Plus, Play } = window.Icons;

  const [source, setSource] = React.useState('spotify');
  const [selectedPlaylist, setSelectedPlaylist] = React.useState(0);

  const sources = [
    { id: 'spotify', label: 'Spotify Playlists (12)', icon: Disc },
    { id: 'radio', label: 'Web Radio (6)', icon: Radio },
    { id: 'local_nas', label: 'Lokale & NAS Muziek (3)', icon: HardDrive },
    { id: 'queue', label: 'Wachtrij (3)', icon: ListMusic },
  ];

  const playlists = [
    { name: 'Synthwave Essentials', count: 42 },
    { name: 'Zondagochtend Jazz', count: 28 },
    { name: 'Deep Focus', count: 65 },
    { name: 'Vinyl Classics', count: 19 },
  ];

  const tracks = [
    { title: 'Nightcall', artist: 'Kavinsky', dur: '4:18' },
    { title: 'Sunset Boulevard', artist: 'FM-84', dur: '3:52' },
    { title: 'Turbo Killer', artist: 'Carpenter Brut', dur: '4:41' },
    { title: 'A Real Hero', artist: 'College, Electric Youth', dur: '5:35' },
  ];

  const radioStations = [
    { name: 'NPO Radio 1', genre: 'Nieuws & Achtergronden' },
    { name: 'Concertzender', genre: 'Klassiek & Jazz' },
    { name: 'Studio Brussel', genre: 'Alternative' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Disc size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Media Center & Audio Bronnen</span>
            </div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>Koppel Spotify, Web Radio, Lokale/NAS bestanden en beheer je live wachtrij</p>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-inset)', borderRadius: 'var(--radius-lg)', flexWrap: 'wrap' }}>
            {sources.map((s) => {
              const Icon = s.icon;
              const active = source === s.id;
              return (
                <button key={s.id} onClick={() => setSource(s.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  font: 'var(--text-mono-sm)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                  background: active ? 'var(--bg-card)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: '1px solid ' + (active ? 'var(--border-default)' : 'transparent'),
                }}>
                  <Icon size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {source === 'spotify' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Search size={14} />}>Zoek live in Spotify catalogus</Button>
            <Button variant="primary" icon={<Plus size={14} />}>Spotify playlist importeren (URL)</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 4px' }}>Mijn Spotify playlists ({playlists.length})</span>
              {playlists.map((p, i) => (
                <div key={i} onClick={() => setSelectedPlaylist(i)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  background: selectedPlaylist === i ? 'var(--accent-soft)' : 'var(--bg-card)',
                  border: '1px solid ' + (selectedPlaylist === i ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg-inset)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' }}>{p.name}</div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{p.count} nummers</div>
                  </div>
                  <Play size={14} style={{ color: 'var(--accent)' }} />
                </div>
              ))}
            </div>

            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)' }} />
                  <div>
                    <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{playlists[selectedPlaylist].name}</div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>{playlists[selectedPlaylist].count} nummers</div>
                  </div>
                </div>
                <Button variant="primary" icon={<Play size={14} fill="currentColor" />}>Speel alles af</Button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tracks.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 'var(--radius-md)' }}>
                    <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', width: 18 }}>{i + 1}</span>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg-inset)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>{t.title}</div>
                      <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{t.artist}</div>
                    </div>
                    <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{t.dur}</span>
                    <Plus size={14} style={{ color: 'var(--accent)' }} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {source === 'radio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Mijn Web Radio zenders ({radioStations.length})</span>
            <Button variant="secondary" icon={<Plus size={14} />}>Zender handmatig toevoegen</Button>
          </div>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', marginBottom: 16 }}>
              <Search size={15} style={{ color: 'var(--text-muted)' }} />
              <span style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>Zoek wereldwijd in 40.000+ internet radio zenders...</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {radioStations.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-card)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>{s.name}</div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{s.genre}</div>
                  </div>
                  <Radio size={14} style={{ color: 'var(--accent)' }} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {(source === 'local_nas' || source === 'queue') && (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <HardDrive size={28} style={{ margin: '0 auto 12px', display: 'block' }} />
            <p style={{ font: 'var(--text-body)' }}>Zelfde kaart- en lijstpatronen als hierboven, met de tokens van deze bron.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

window.MediaCenterScreen = MediaCenterScreen;
