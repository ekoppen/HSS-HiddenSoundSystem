import React from 'react';

export function IconButton({ icon, active, title, onClick, size = 36 }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: active ? '1px solid var(--accent-soft-strong)' : '1px solid transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
    </button>
  );
}
