import React from 'react';

export interface IconButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  /** Solid accent/danger fill instead of the default transparent-until-hover
   * look — for a toolbar action that needs to stand out (e.g. a primary
   * action) or warn (a destructive one), as opposed to `active` which marks
   * a toggle's current on/off state. */
  variant?: 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  size?: number;
}

const variantStyles: Record<'primary' | 'danger', React.CSSProperties> = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'rgba(251,113,133,0.12)',
    color: 'var(--status-danger)',
    border: '1px solid rgba(251,113,133,0.3)',
  },
};

export const IconButton: React.FC<IconButtonProps> = ({ icon, active, variant, disabled, title, onClick, size = 36 }) => {
  const variantStyle = variant ? variantStyles[variant] : undefined;
  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
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
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast)',
        ...variantStyle,
      }}
      onMouseEnter={(e) => {
        if (!active && !variant && !disabled) e.currentTarget.style.background = 'var(--bg-card-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active && !variant && !disabled) e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
    </button>
  );
};
