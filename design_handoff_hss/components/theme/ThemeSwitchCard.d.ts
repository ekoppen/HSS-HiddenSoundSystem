/**
 * Selectable theme preview tile used in the theme picker — shows category,
 * name, accent swatch and meter-gradient strip so users can compare themes
 * at a glance without leaving the dialog.
 * @startingPoint section="Theme" subtitle="Theme picker preview tile" viewport="700x160"
 */
export interface ThemeSwitchCardProps {
  themeId: 'obsidian' | 'slate' | 'emerald' | 'copper';
  active?: boolean;
  onSelect: (themeId: string) => void;
}
export function ThemeSwitchCard(props: ThemeSwitchCardProps): JSX.Element;
