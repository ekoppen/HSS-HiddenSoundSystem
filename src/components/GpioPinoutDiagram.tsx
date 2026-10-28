import React from 'react';

export type GpioRole = 'pinA' | 'pinB' | 'pinButton';

interface PinInfo {
  physical: number;
  bcm: number | null;
  label: string;
  kind: 'power' | 'ground' | 'gpio';
}

// Standard 40-pin GPIO header, physical pin 1 at top-left — identical
// across every Pi model with a 40-pin header (A+, B+, 2, 3, 4, 5, Zero).
// BCM 0/1 (physical 27/28) are the HAT EEPROM ID pins — not general-purpose
// by convention, always excluded below regardless of the active DAC.
const PIN_TABLE: PinInfo[] = [
  { physical: 1, bcm: null, label: '3V3', kind: 'power' },
  { physical: 2, bcm: null, label: '5V', kind: 'power' },
  { physical: 3, bcm: 2, label: 'GPIO2', kind: 'gpio' },
  { physical: 4, bcm: null, label: '5V', kind: 'power' },
  { physical: 5, bcm: 3, label: 'GPIO3', kind: 'gpio' },
  { physical: 6, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 7, bcm: 4, label: 'GPIO4', kind: 'gpio' },
  { physical: 8, bcm: 14, label: 'GPIO14', kind: 'gpio' },
  { physical: 9, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 10, bcm: 15, label: 'GPIO15', kind: 'gpio' },
  { physical: 11, bcm: 17, label: 'GPIO17', kind: 'gpio' },
  { physical: 12, bcm: 18, label: 'GPIO18', kind: 'gpio' },
  { physical: 13, bcm: 27, label: 'GPIO27', kind: 'gpio' },
  { physical: 14, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 15, bcm: 22, label: 'GPIO22', kind: 'gpio' },
  { physical: 16, bcm: 23, label: 'GPIO23', kind: 'gpio' },
  { physical: 17, bcm: null, label: '3V3', kind: 'power' },
  { physical: 18, bcm: 24, label: 'GPIO24', kind: 'gpio' },
  { physical: 19, bcm: 10, label: 'GPIO10', kind: 'gpio' },
  { physical: 20, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 21, bcm: 9, label: 'GPIO9', kind: 'gpio' },
  { physical: 22, bcm: 25, label: 'GPIO25', kind: 'gpio' },
  { physical: 23, bcm: 11, label: 'GPIO11', kind: 'gpio' },
  { physical: 24, bcm: 8, label: 'GPIO8', kind: 'gpio' },
  { physical: 25, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 26, bcm: 7, label: 'GPIO7', kind: 'gpio' },
  { physical: 27, bcm: 0, label: 'ID_SD', kind: 'gpio' },
  { physical: 28, bcm: 1, label: 'ID_SC', kind: 'gpio' },
  { physical: 29, bcm: 5, label: 'GPIO5', kind: 'gpio' },
  { physical: 30, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 31, bcm: 6, label: 'GPIO6', kind: 'gpio' },
  { physical: 32, bcm: 12, label: 'GPIO12', kind: 'gpio' },
  { physical: 33, bcm: 13, label: 'GPIO13', kind: 'gpio' },
  { physical: 34, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 35, bcm: 19, label: 'GPIO19', kind: 'gpio' },
  { physical: 36, bcm: 16, label: 'GPIO16', kind: 'gpio' },
  { physical: 37, bcm: 26, label: 'GPIO26', kind: 'gpio' },
  { physical: 38, bcm: 20, label: 'GPIO20', kind: 'gpio' },
  { physical: 39, bcm: null, label: 'GND', kind: 'ground' },
  { physical: 40, bcm: 21, label: 'GPIO21', kind: 'gpio' },
];

const ALWAYS_RESERVED_BCM = [0, 1]; // HAT EEPROM ID pins

export const ROLE_COLORS: Record<GpioRole, string> = {
  pinA: '#38bdf8',
  pinB: '#a78bfa',
  pinButton: '#f59e0b',
};

export const ROLE_LABELS: Record<GpioRole, string> = {
  pinA: 'Pin A',
  pinB: 'Pin B',
  pinButton: 'Druktoets',
};

interface GpioPinoutDiagramProps {
  reservedPins: number[];
  assignments: Partial<Record<GpioRole, number | null>>;
  activeRole: GpioRole | null;
  onPinClick: (bcmPin: number) => void;
}

export const GpioPinoutDiagram: React.FC<GpioPinoutDiagramProps> = ({ reservedPins, assignments, activeRole, onPinClick }) => {
  const assignedRoleFor = (bcm: number): GpioRole | null => {
    for (const role of Object.keys(assignments) as GpioRole[]) {
      if (assignments[role] === bcm) return role;
    }
    return null;
  };

  const isReserved = (bcm: number) => ALWAYS_RESERVED_BCM.includes(bcm) || reservedPins.includes(bcm);

  const renderPin = (pin: PinInfo) => {
    if (pin.kind !== 'gpio' || pin.bcm === null) {
      return (
        <div
          key={pin.physical}
          style={{
            padding: '5px 6px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            font: 'var(--text-mono-sm)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            fontSize: 10,
          }}
          title={`Fysieke pin ${pin.physical} — ${pin.label}`}
        >
          {pin.label}
        </div>
      );
    }

    const bcm = pin.bcm;
    const reserved = isReserved(bcm);
    const ownedByRole = assignedRoleFor(bcm);
    const selectable = !reserved && !ownedByRole && activeRole !== null;

    let background = 'var(--bg-inset)';
    let border = '1px solid var(--border-default)';
    let color = 'var(--text-secondary)';

    if (reserved) {
      background = 'rgba(251,113,133,0.10)';
      border = '1px solid rgba(251,113,133,0.25)';
      color = 'var(--status-danger)';
    } else if (ownedByRole) {
      background = ROLE_COLORS[ownedByRole] + '2A';
      border = `1px solid ${ROLE_COLORS[ownedByRole]}`;
      color = ROLE_COLORS[ownedByRole];
    } else if (selectable) {
      color = 'var(--text-primary)';
    }

    return (
      <button
        key={pin.physical}
        type="button"
        disabled={!selectable}
        onClick={() => selectable && onPinClick(bcm)}
        title={reserved ? `BCM${bcm} — gereserveerd` : `Fysieke pin ${pin.physical} — BCM${bcm}`}
        style={{
          padding: '5px 6px',
          borderRadius: 'var(--radius-sm)',
          background,
          border,
          color,
          font: 'var(--text-mono-sm)',
          fontSize: 10,
          textAlign: 'center',
          cursor: selectable ? 'pointer' : reserved ? 'not-allowed' : 'default',
          transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast)',
        }}
      >
        {pin.label}
      </button>
    );
  };

  const left = PIN_TABLE.filter((p) => p.physical % 2 === 1);
  const right = PIN_TABLE.filter((p) => p.physical % 2 === 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {left.map((p, i) => (
          <React.Fragment key={p.physical}>
            {renderPin(p)}
            {renderPin(right[i])}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, font: 'var(--text-mono-sm)', fontSize: 10, color: 'var(--text-muted)' }}>
        <span><span style={{ color: 'var(--status-danger)' }}>■</span> Gereserveerd</span>
        {(Object.keys(ROLE_LABELS) as GpioRole[]).map((role) => (
          <span key={role}><span style={{ color: ROLE_COLORS[role] }}>■</span> {ROLE_LABELS[role]}</span>
        ))}
      </div>
    </div>
  );
};
