import React from 'react';

const sizes = {
  sm: { padding: '6px 12px', font: 'var(--text-label)', gap: 6 },
  md: { padding: '10px 18px', font: 'var(--text-body-strong)', gap: 8 },
};

const variants = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'rgba(251,113,133,0.12)',
    color: 'var(--status-danger)',
    border: '1px solid rgba(251,113,133,0.3)',
  },
};

export function Button({ variant = 'primary', size = 'md', icon, disabled, onClick, children }) {
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        padding: s.padding,
        font: s.font,
        letterSpacing: size === 'sm' ? 'var(--letter-label)' : 'normal',
        textTransform: size === 'sm' ? 'uppercase' : 'none',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background var(--duration-fast) var(--ease-standard), transform var(--duration-fast)',
        ...v,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
