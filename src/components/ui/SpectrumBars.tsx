import React from 'react';
import { SpectrumStyle } from '../../types.ts';

export interface SpectrumBarsProps {
  values?: number[];
  active?: boolean;
  opacity?: number; // 0-1, overrides the `active`-based default when given
  bars?: number;
  visualStyle?: SpectrumStyle;
  colors?: [string, string, string]; // gradient stops; falls back to the theme meter CSS vars when omitted
  glowColor?: string;
  height?: number | string;
  width?: number | string;
  align?: 'left' | 'center';
}

// Rows per column in the LED-matrix style, bottom to top.
const LED_SEGMENTS = 12;

export const SpectrumBars: React.FC<SpectrumBarsProps> = ({
  values,
  active = true,
  opacity,
  bars = 16,
  visualStyle = 'bars',
  colors,
  glowColor,
  height = 64,
  width = '100%',
  align = 'left',
}) => {
  const data = values && values.length ? values : Array.from({ length: bars }, () => 8);
  const alpha = opacity ?? (active ? 0.95 : 0.25);
  const gradient = colors
    ? `linear-gradient(to top, ${colors[0]}, ${colors[1]}, ${colors[2]})`
    : 'linear-gradient(to top, var(--meter-1), var(--meter-2) 60%, var(--meter-3))';
  const justify = align === 'center' ? 'center' : 'flex-start';

  if (visualStyle === 'waveform') {
    // Same bars, but centered instead of bottom-anchored — each one grows both
    // up and down from a shared midline, like a classic audio waveform.
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, height, width, opacity: alpha, justifyContent: justify, transition: 'opacity var(--duration-base)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: colors ? colors[0] : 'var(--meter-1)', opacity: 0.3 }} />
        {data.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(6, Math.min(100, h))}%`,
              borderRadius: 2,
              background: gradient,
              boxShadow: glowColor ? `0 0 6px ${glowColor}` : undefined,
              transition: 'height var(--duration-fast) linear',
            }}
          />
        ))}
      </div>
    );
  }

  if (visualStyle === 'led_matrix') {
    // A classic hardware graphic-EQ bargraph: each band is a stack of discrete
    // segments that light up bottom-to-top, green -> yellow -> red by zone,
    // rather than one smooth gradient bar.
    return (
      <div style={{ display: 'flex', gap: 3, height, width, opacity: alpha, justifyContent: justify, transition: 'opacity var(--duration-base)' }}>
        {data.map((level, col) => {
          const lit = Math.round((Math.max(0, Math.min(100, level)) / 100) * LED_SEGMENTS);
          return (
            <div key={col} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
              {Array.from({ length: LED_SEGMENTS }, (_, seg) => {
                const isLit = seg < lit;
                const zone = seg / LED_SEGMENTS;
                const litColor = colors ? (zone > 0.83 ? colors[2] : zone > 0.58 ? colors[1] : colors[0]) : 'var(--meter-2)';
                return (
                  <div
                    key={seg}
                    style={{
                      flex: 1,
                      borderRadius: 1,
                      background: isLit ? litColor : 'rgba(255,255,255,0.08)',
                      boxShadow: isLit && glowColor ? `0 0 4px ${glowColor}` : undefined,
                      transition: 'background var(--duration-fast) linear',
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height, width, justifyContent: justify }}>
      {data.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: Math.max(4, h) + '%',
            borderRadius: 2,
            background: gradient,
            opacity: alpha,
            boxShadow: glowColor ? `0 0 10px ${glowColor}` : undefined,
            transition: 'height var(--duration-fast) linear, opacity var(--duration-base)',
          }}
        />
      ))}
    </div>
  );
};
