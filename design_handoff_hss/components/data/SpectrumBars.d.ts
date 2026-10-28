/**
 * Real-time frequency spectrum meter for the Now Playing view.
 * @startingPoint section="Data" subtitle="16-band frequency meter" viewport="700x140"
 */
export interface SpectrumBarsProps {
  values?: number[];
  active?: boolean;
  bars?: number;
}
export function SpectrumBars(props: SpectrumBarsProps): JSX.Element;
