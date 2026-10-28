import React, { useEffect, useState } from 'react';
import { fillPercent } from '../../services/volumeScale.ts';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
}

export const Slider: React.FC<SliderProps> = ({ value, min = 0, max = 100, onChange, label, valueLabel }) => {
  // Clamped inside fillPercent: value can legitimately sit outside [min, max]
  // transiently — e.g. the master volume slider's own max shrinks live when
  // "Maximaal volume" is lowered, and a stale `value` from before that change
  // (not yet re-synced) would otherwise compute a >100%/<0% CSS position and
  // push the thumb and number box outside the track entirely.
  const pct = fillPercent(value, min, max);

  // Local draft so the number field can be freely edited (cleared, a leading
  // "-" typed for a negative offset) without every keystroke round-tripping
  // through Number() and snapping the field back to 0 mid-edit. Committed on
  // blur/Enter; resynced whenever the real value changes from outside (drag,
  // or another control).
  const [draftText, setDraftText] = useState(String(value));
  useEffect(() => {
    setDraftText(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number(draftText);
    if (Number.isFinite(parsed)) {
      onChange(Math.min(max, Math.max(min, parsed)));
    } else {
      setDraftText(String(value));
    }
  };

  return (
    <div style={{ width: '100%' }}>
      {(label || valueLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          {label && (
            <span
              style={{
                font: 'var(--text-label)',
                letterSpacing: 'var(--letter-label)',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {label}
            </span>
          )}
          {valueLabel && <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>{valueLabel}</span>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', height: 4, borderRadius: 'var(--radius-full)', background: 'var(--bg-inset)', flex: 1 }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: pct + '%',
              borderRadius: 'var(--radius-full)',
              background: 'var(--accent)',
            }}
          />
          <input
            className="hss-slider-input"
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              position: 'absolute',
              inset: '-8px 0',
              width: '100%',
              height: 20,
              background: 'transparent',
              cursor: 'pointer',
              margin: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 'calc(' + pct + '% - 7px)',
              transform: 'translateY(-50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'var(--on-accent)',
              border: '2px solid var(--accent)',
              boxShadow: 'var(--shadow-card)',
              pointerEvents: 'none',
            }}
          />
        </div>
        <input
          type="number"
          value={draftText}
          min={min}
          max={max}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitDraft();
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            width: 60,
            flexShrink: 0,
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
            font: 'var(--text-mono-sm)',
            textAlign: 'right',
          }}
        />
      </div>
    </div>
  );
};
