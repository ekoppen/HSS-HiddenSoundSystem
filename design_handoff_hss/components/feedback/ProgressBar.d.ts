/**
 * Determinate progress indicator — crossfade transition, sync/setup steps.
 * @startingPoint section="Feedback" subtitle="Determinate progress bar" viewport="700x110"
 */
export interface ProgressBarProps {
  pct: number;
  label?: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
}
export function ProgressBar(props: ProgressBarProps): JSX.Element;
