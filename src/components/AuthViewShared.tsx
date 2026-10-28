import React from 'react';

// minHeight reserves 2 lines' worth of --text-label (11px/1.3 ≈ 14.3px per
// line) regardless of whether THIS particular label actually wraps — in a
// multi-column grid row, a label that wraps to 2 lines while its neighbors
// stay on 1 pushes only that column's input down, since grid stretch only
// resizes the outer cell, not where content sits inside it. Reserving the
// same space for every label keeps every input in a row starting at the
// same Y position no matter how long each one's own label text is.
export const labelStyle: React.CSSProperties = {
  display: 'block',
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  marginBottom: 6,
  minHeight: 29,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  font: 'var(--text-body)',
  color: 'var(--text-primary)',
  outline: 'none',
};

export const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  paddingBottom: 16,
  borderBottom: '1px solid var(--border-subtle)',
};

// Plain type="button" action button matching the shared Button's visual variants — used inside
// <form> elements where the shared Button (which always renders a bare, submit-defaulting
// <button>) would incorrectly trigger the form's onSubmit.
const ACTION_BUTTON_VARIANTS: Record<string, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid transparent' },
  secondary: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' },
  ghost: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' },
  danger: { background: 'rgba(251,113,133,0.12)', color: 'var(--status-danger)', border: '1px solid rgba(251,113,133,0.3)' },
};

export const ActionButton: React.FC<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ variant = 'primary', icon, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '10px 18px',
      font: 'var(--text-body-strong)',
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--duration-fast) var(--ease-standard), transform var(--duration-fast)',
      ...ACTION_BUTTON_VARIANTS[variant],
    }}
  >
    {icon}
    <span>{children}</span>
  </button>
);
