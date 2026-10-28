/**
 * Focused overlay dialog — theme picker, artwork viewer, onboarding steps.
 * @startingPoint section="Surfaces" subtitle="Overlay dialog with header, scroll body & footer" viewport="700x260"
 */
export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}
export function Modal(props: ModalProps): JSX.Element;
