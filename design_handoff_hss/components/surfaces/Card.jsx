import React from 'react';

export function Card({ padding = 24, hoverable = false, children, style }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-card)',
        padding,
        transition: 'background var(--duration-base) var(--ease-standard), border-color var(--duration-base)',
        ...style,
      }}
      onMouseEnter={hoverable ? (e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.borderColor = 'var(--border-default)'; } : undefined}
      onMouseLeave={hoverable ? (e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; } : undefined}
    >
      {children}
    </div>
  );
}
