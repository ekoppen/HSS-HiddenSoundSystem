import React from 'react';

export function SpectrumBars({ values, active = true, bars = 16 }) {
  const data = values && values.length ? values : Array.from({ length: bars }, () => 8);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
      {data.map((h, i) => (
        <div key={i} style={{
          flex: 1, height: Math.max(4, h) + '%', borderRadius: 2,
          background: 'linear-gradient(to top, var(--meter-1), var(--meter-2) 60%, var(--meter-3))',
          opacity: active ? 0.95 : 0.25,
          transition: 'height var(--duration-fast) linear, opacity var(--duration-base)',
        }} />
      ))}
    </div>
  );
}
