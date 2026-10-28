/**
 * Primary interactive action. Used for transport commit actions (Toepassen,
 * Verbinden) and secondary utility actions (Annuleren, Vernieuwen).
 * @startingPoint section="Core" subtitle="Buttons — primary, secondary, ghost, danger" viewport="700x220"
 */
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
