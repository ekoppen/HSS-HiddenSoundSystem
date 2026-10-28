/**
 * Base surface for grouped content — the deck container, queue strip, settings groups.
 * @startingPoint section="Surfaces" subtitle="Base container — flat, soft-shadowed, no border glow" viewport="700x220"
 */
export interface CardProps {
  padding?: number;
  hoverable?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Card(props: CardProps): JSX.Element;
