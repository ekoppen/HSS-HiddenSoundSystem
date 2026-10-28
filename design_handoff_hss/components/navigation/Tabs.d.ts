/**
 * Top-level section switcher (Nu Afspelen, Cast, Volume & DAC, ...).
 * @startingPoint section="Navigation" subtitle="Primary section switcher" viewport="700x140"
 */
export interface TabItem { id: string; label: string; icon?: React.ReactNode; }
export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}
export function Tabs(props: TabsProps): JSX.Element;
