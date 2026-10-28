import React from 'react';

const THEME_META = {
  obsidian: { name: 'Obsidian Indigo', category: 'Standaard', accent: '#6366f1', bg: '#101216', meters: ['#4f46e5','#6366f1','#38bdf8'] },
  slate: { name: 'Nordic Slate', category: 'Studio', accent: '#4fa3c7', bg: '#0e1218', meters: ['#3b87aa','#4fa3c7','#8fd4ec'] },
  emerald: { name: 'Spotify Emerald', category: 'Streaming', accent: '#10b981', bg: '#0b1712', meters: ['#0c9268','#10b981','#6ee7b7'] },
  copper: { name: 'Vintage Tube', category: 'Audiophile Retro', accent: '#c8781f', bg: '#161009', meters: ['#a8631a','#c8781f','#eab06a'] },
};

export function ThemeSwitchCard({ themeId, active, onSelect }) {
  const t = THEME_META[themeId];
  if (!t) return null;
  return (
    <div
      onClick={() => onSelect(themeId)}
      style={{
        position: 'relative', cursor: 'pointer', padding: 16, borderRadius: 'var(--radius-lg)',
        background: t.bg, border: '1px solid ' + (active ? t.accent : 'var(--border-default)'),
        boxShadow: active ? '0 0 0 1px ' + t.accent + ' inset' : 'none',
        transition: 'border-color var(--duration-fast)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase',
          color: t.accent, background: t.accent + '22', padding: '3px 8px', borderRadius: 'var(--radius-sm)',
        }}>{t.category}</span>
        {active && <span style={{ font: 'var(--text-mono-sm)', color: t.accent }}>ACTIEF</span>}
      </div>
      <div style={{ font: 'var(--text-subtitle)', color: '#f4f5f7', marginTop: 10 }}>{t.name}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: t.accent }} />
        <div style={{ flex: 1, height: 12, borderRadius: 6, background: 'linear-gradient(to right,' + t.meters.join(',') + ')' }} />
      </div>
    </div>
  );
}
