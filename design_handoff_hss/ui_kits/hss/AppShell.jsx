
function AppShell({ activeTab, setActiveTab, onOpenTheme, children }) {
  const { Radio, Cast, Volume2, Sliders, Sparkles, Key, Cpu, Wifi, Palette } = window.Icons;
  const tabs = [
    { id: 'player', label: 'Nu Afspelen', icon: Radio },
    { id: 'cast', label: 'Cast & Smart Display', icon: Cast },
    { id: 'volume-dac', label: 'Volume & DAC Output', icon: Volume2 },
    { id: 'playlists', label: 'Media Center & Radio', icon: Sliders },
    { id: 'advanced-audio', label: 'Geavanceerde Audio & EQ', icon: Sparkles },
    { id: 'auth-api', label: 'Spotify & Instellingen', icon: Key },
    { id: 'scripts', label: 'Raspberry Pi Script Center', icon: Cpu },
    { id: 'websocket-stream', label: 'Live WebSocket Stream', icon: Wifi },
  ];

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-page)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', display: 'flex' }}>
      <aside style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)', minHeight: '100vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 20px 20px' }}>
          <div style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Radio size={18} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ font: 'var(--text-title)', fontSize: 16, color: 'var(--text-primary)' }}>Soloist Hub</span>
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 6px', borderRadius: 4 }}>v2.4</span>
            </div>
            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>Raspberry Pi 5</div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px', flex: 1 }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 'var(--radius-md)',
                font: 'var(--text-body-strong)', fontSize: 13, textAlign: 'left', cursor: 'pointer',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                border: '1px solid ' + (isActive ? 'var(--accent-soft-strong)' : 'transparent'),
              }}>
                <Icon size={16} style={{ flexShrink: 0 }} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onOpenTheme} title="Thema wijzigen" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
            font: 'var(--text-body-strong)', fontSize: 13, cursor: 'pointer',
          }}>
            <Palette size={16} style={{ color: 'var(--accent)' }} />
            <span>Thema</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '0 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-success)', flexShrink: 0 }} />
            <span>CPU 47°C · 320kbps</span>
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 32px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{tabs.find((t) => t.id === activeTab)?.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: 'var(--status-success)', font: 'var(--text-mono-sm)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-success)' }} />
            <span>Live WebSocket verbonden</span>
          </div>
        </header>
        <main style={{ maxWidth: 1080, padding: '28px 32px 60px' }}>{children}</main>
      </div>
    </div>
  );
}



window.AppShell = AppShell;
