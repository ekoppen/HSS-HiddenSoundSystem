/**
 * Small status/metadata chip — connection state, format tags, role labels.
 * @startingPoint section="Core" subtitle="Status & metadata chips" viewport="700x140"
 */
export interface BadgeProps {
  variant?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  icon?: React.ReactNode;
  mono?: boolean;
  children: React.ReactNode;
}
export function Badge(props: BadgeProps): JSX.Element;
