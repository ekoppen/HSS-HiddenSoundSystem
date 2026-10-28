import React from 'react';

export interface ProgressBarProps {
  pct: number;
  label?: React.ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ pct, label, tone = 'accent' }) => {
  const color = tone === 'accent' ? 'var(--accent)' : 'var(--status-' + tone + ')';
  return (
    <div style={{ width: '100%' }}>
      {label && <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>}
      <div style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--bg-inset)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: pct + '%',
            background: color,
            borderRadius: 'var(--radius-full)',
            transition: 'width var(--duration-base) var(--ease-standard)',
          }}
        />
      </div>
    </div>
  );
};
