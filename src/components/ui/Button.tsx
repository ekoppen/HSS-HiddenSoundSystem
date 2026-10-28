import React from 'react';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  id?: string;
}

const sizes = {
  sm: { padding: '6px 12px', font: 'var(--text-label)', gap: 6 },
  md: { padding: '10px 18px', font: 'var(--text-body-strong)', gap: 8 },
};

const variants: Record<string, React.CSSProperties> = {
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

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  onClick,
  children,
  className,
  type,
  id,
}) => {
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  return (
    <button
      id={id}
      type={type}
      className={className}
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
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
};
