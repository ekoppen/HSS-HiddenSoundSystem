/**
 * Range control for volume, playback position, EQ bands and crossfade duration.
 * @startingPoint section="Forms" subtitle="Range slider — volume, seek, EQ bands" viewport="700x140"
 */
export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label?: string;
  valueLabel?: string;
}
export function Slider(props: SliderProps): JSX.Element;
