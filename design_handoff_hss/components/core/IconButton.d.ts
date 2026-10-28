/**
 * Icon-only control for transport and toolbar actions (shuffle, repeat, mute, cast).
 * @startingPoint section="Core" subtitle="Icon-only toolbar control, with active state" viewport="700x140"
 */
export interface IconButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  title?: string;
  onClick?: () => void;
  size?: number;
}
export function IconButton(props: IconButtonProps): JSX.Element;
