/**
 * Small technical readout: label above a mono value. Bitrate, sample rate,
 * DAC clock, CPU temp — the vocabulary of the whole "system status" register.
 * @startingPoint section="Data" subtitle="Label + mono value readout" viewport="700x110"
 */
export interface SpecStatProps {
  label: string;
  value: string;
  tone?: 'primary' | 'accent' | 'status-success' | 'status-warning' | 'status-danger';
}
export function SpecStat(props: SpecStatProps): JSX.Element;
