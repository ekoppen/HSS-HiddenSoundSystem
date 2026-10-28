import React from 'react';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}

export const Modal: React.FC<ModalProps> = ({ open, title, icon, subtitle, onClose, children, footer, maxWidth = 640 }) => {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,5,7,0.72)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '85%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {icon && (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                {icon}
              </div>
            )}
            <div>
              <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{title}</div>
              {subtitle && (
                <div style={{ font: 'var(--text-body)', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
        <div className="scrollbar-thin" style={{ padding: 24, overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-inset)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
