import React from 'react';

export interface SpecStatProps {
  label: string;
  value: string;
  tone?: 'primary' | 'accent' | 'status-success' | 'status-warning' | 'status-danger';
}

export const SpecStat: React.FC<SpecStatProps> = ({ label, value, tone = 'primary' }) => {
  const color = tone === 'primary' ? 'var(--text-primary)' : 'var(--' + tone + ')';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          font: 'var(--text-label)',
          letterSpacing: 'var(--letter-label)',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ font: 'var(--text-mono)', fontWeight: 600, color }}>{value}</span>
    </div>
  );
};
