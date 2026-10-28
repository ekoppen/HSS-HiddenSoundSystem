import React from 'react';

const variants = {
  accent: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  success: { background: 'rgba(52,211,153,0.14)', color: 'var(--status-success)' },
  warning: { background: 'rgba(245,158,11,0.14)', color: 'var(--status-warning)' },
  danger: { background: 'rgba(251,113,133,0.14)', color: 'var(--status-danger)' },
  neutral: { background: 'var(--bg-inset)', color: 'var(--text-secondary)' },
};

export function Badge({ variant = 'neutral', icon, mono = true, children }) {
  const v = variants[variant] || variants.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 'var(--radius-sm)',
        font: mono ? 'var(--text-mono-sm)' : 'var(--text-label)',
        letterSpacing: mono ? 0 : 'var(--letter-label)',
        textTransform: mono ? 'none' : 'uppercase',
        ...v,
      }}
    >
      {icon}
      {children}
    </span>
  );
}
