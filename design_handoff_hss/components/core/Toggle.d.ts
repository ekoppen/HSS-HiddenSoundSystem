/**
 * On/off switch for boolean settings — cast display elements, automation flags.
 * @startingPoint section="Core" subtitle="On/off switch with optional label" viewport="700x140"
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
}
export function Toggle(props: ToggleProps): JSX.Element;
