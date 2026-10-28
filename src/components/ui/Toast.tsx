import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

export interface ToastItem {
  id: string;
  message: string;
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  // onDismiss is a plain inline function in App.tsx (new reference on
  // basically every render, since the app re-renders on every WS tick) —
  // depending on it directly restarted this timer before it could ever
  // fire, so the toast never auto-dismissed. A ref sidesteps that: the
  // effect only re-runs when toast.id itself changes (a genuinely new
  // toast), while still always calling the latest onDismiss.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id]);

  return (
    <div
      role="status"
      className="flex items-center"
      style={{
        gap: 12,
        padding: '14px 20px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        font: 'var(--text-body-strong)',
        color: 'var(--text-primary)',
        minWidth: 280,
        maxWidth: 420,
      }}
    >
      <Check size={18} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
      {toast.message}
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

// Fixed bottom-right stack, out of the way of the main content and any
// modal — a track/queue confirmation shouldn't demand attention, just
// briefly confirm the action happened.
export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed flex flex-col items-end"
      style={{ bottom: 24, right: 24, gap: 10, zIndex: 200, pointerEvents: 'none' }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
};
