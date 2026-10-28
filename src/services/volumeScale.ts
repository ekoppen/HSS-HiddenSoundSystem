// How full to draw a bar or slider track. Shared by the design-system Slider
// and the cast/kiosk screen's own hand-drawn volume bar, which used to
// compute this itself against a hardcoded 100 — so with "Maximaal volume" set
// to 40, a volume of 40 filled the web page's slider completely while the
// HDMI screen showed it at 40%. Same level, two different pictures depending
// on which screen you stood in front of.

/** Position of `value` within [min, max] as a percentage, clamped to 0-100.
 * An empty range (max <= min) yields 0 rather than dividing by zero: a
 * maximum volume of 0 is a legitimate setting (silence), and NaN here would
 * reach the DOM as an invalid width and quietly draw nothing at all. */
export function fillPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}
