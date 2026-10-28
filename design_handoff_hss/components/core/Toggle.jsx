import React from 'react';

export function Toggle({ checked, onChange, label, description }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        cursor: 'pointer', padding: (label || description) ? '2px 0' : 0,
      }}
    >
      {(label || description) && (
        <div style={{ minWidth: 0 }}>
          {label && <div style={{ font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' }}>{label}</div>}
          {description && <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>}
        </div>
      )}
      <div style={{
        width: 38, height: 22, borderRadius: 'var(--radius-full)', flexShrink: 0, position: 'relative',
        background: checked ? 'var(--accent)' : 'var(--bg-inset)',
        border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-default)'),
        transition: 'background var(--duration-fast) var(--ease-standard)',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left var(--duration-fast) var(--ease-standard)',
        }} />
      </div>
    </div>
  );
}
