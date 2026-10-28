import React from 'react';

export function Slider({ value, min = 0, max = 100, onChange, label, valueLabel }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ width: '100%' }}>
      {(label || valueLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          {label && <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>}
          {valueLabel && <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>{valueLabel}</span>}
        </div>
      )}
      <div style={{ position: 'relative', height: 4, borderRadius: 'var(--radius-full)', background: 'var(--bg-inset)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', borderRadius: 'var(--radius-full)', background: 'var(--accent)' }} />
        <input
          type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            position: 'absolute', inset: '-8px 0', width: '100%', height: 20,
            appearance: 'none', background: 'transparent', cursor: 'pointer', margin: 0,
          }}
        />
        <div style={{
          position: 'absolute', top: '50%', left: 'calc(' + pct + '% - 7px)', transform: 'translateY(-50%)',
          width: 14, height: 14, borderRadius: '50%', background: 'var(--on-accent)',
          border: '2px solid var(--accent)', boxShadow: 'var(--shadow-card)', pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}
