import React, { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Modal, Button } from './ui';
import { ActionButton, labelStyle, inputStyle } from './AuthViewShared';
import { GpioPinoutDiagram, GpioRole, ROLE_COLORS, ROLE_LABELS } from './GpioPinoutDiagram';

type GpioAction = 'volume_up' | 'volume_down' | 'play_pause';

interface GpioDeviceConfig {
  id: string;
  deviceType: 'rotary_encoder_button';
  pinA: number;
  pinB: number;
  pinButton: number;
  actionRotateCw: GpioAction;
  actionRotateCcw: GpioAction;
  actionButtonPress: GpioAction;
  enabled: boolean;
}

interface GpioStatus {
  gpiodInstalled: boolean;
  watcherRunning: boolean;
  reservedPins: number[];
}

const ACTION_LABELS: Record<GpioAction, string> = {
  volume_up: 'Volume omhoog',
  volume_down: 'Volume omlaag',
  play_pause: 'Afspelen/pauzeren',
};

const ROLE_ORDER: GpioRole[] = ['pinA', 'pinB', 'pinButton'];

interface AuthGpioDeviceModalProps {
  open: boolean;
  onClose: () => void;
  reservedPins: number[];
  existingConfig: GpioDeviceConfig | null;
  onSaved: (config: GpioDeviceConfig, status?: GpioStatus) => void;
}

export const AuthGpioDeviceModal: React.FC<AuthGpioDeviceModalProps> = ({ open, onClose, reservedPins, existingConfig, onSaved }) => {
  const [pins, setPins] = useState<Record<GpioRole, string>>({ pinA: '', pinB: '', pinButton: '' });
  const [activeRole, setActiveRole] = useState<GpioRole | null>('pinA');
  const [actionRotateCw, setActionRotateCw] = useState<GpioAction>('volume_up');
  const [actionRotateCcw, setActionRotateCcw] = useState<GpioAction>('volume_down');
  const [actionButtonPress, setActionButtonPress] = useState<GpioAction>('play_pause');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed every time the modal opens — either from the device being
  // edited, or empty so a new device starts with no pins pre-guessed,
  // guiding the user through the diagram-tap flow from Pin A onward.
  useEffect(() => {
    if (!open) return;
    if (existingConfig) {
      setPins({ pinA: String(existingConfig.pinA), pinB: String(existingConfig.pinB), pinButton: String(existingConfig.pinButton) });
      setActionRotateCw(existingConfig.actionRotateCw);
      setActionRotateCcw(existingConfig.actionRotateCcw);
      setActionButtonPress(existingConfig.actionButtonPress);
      setActiveRole(null);
    } else {
      setPins({ pinA: '', pinB: '', pinButton: '' });
      setActionRotateCw('volume_up');
      setActionRotateCcw('volume_down');
      setActionButtonPress('play_pause');
      setActiveRole('pinA');
    }
    setError(null);
  }, [open, existingConfig]);

  const handlePinDiagramClick = (bcm: number) => {
    if (!activeRole) return;
    const nextPins = { ...pins, [activeRole]: String(bcm) };
    setPins(nextPins);
    // Advance to the next still-empty role (in fixed order), or none once all three are filled.
    setActiveRole(ROLE_ORDER.find((r) => !nextPins[r]) || null);
  };

  const assignments: Partial<Record<GpioRole, number | null>> = {
    pinA: pins.pinA ? Number(pins.pinA) : null,
    pinB: pins.pinB ? Number(pins.pinB) : null,
    pinButton: pins.pinButton ? Number(pins.pinButton) : null,
  };

  const allPinsFilled = pins.pinA !== '' && pins.pinB !== '' && pins.pinButton !== '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gpio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinA: Number(pins.pinA),
          pinB: Number(pins.pinB),
          pinButton: Number(pins.pinButton),
          actionRotateCw,
          actionRotateCcw,
          actionButtonPress,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Opslaan mislukt');
        return;
      }
      onSaved(data.config, data.status);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Opslaan mislukt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<RotateCw size={18} />}
      title={existingConfig ? 'GPIO-apparaat bewerken' : 'GPIO-apparaat toevoegen'}
      subtitle="Tik op een pin in het schema hieronder om 'm toe te wijzen, of typ het BCM-nummer direct in."
      maxWidth={860}
    >
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>Apparaattype</label>
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--accent-soft-strong)',
              background: 'var(--accent-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>Rotary encoder + druktoets</div>
              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                Meer apparaattypen (bijv. potentiometer) volgen later.
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: 10, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-danger)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <label style={labelStyle}>Pi GPIO-header (tik om toe te wijzen)</label>
            <div style={{ padding: 14, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <GpioPinoutDiagram
                reservedPins={reservedPins}
                assignments={assignments}
                activeRole={activeRole}
                onPinClick={handlePinDiagramClick}
              />
            </div>
          </div>

          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={labelStyle}>Pin-toewijzing</label>
            {ROLE_ORDER.map((role) => {
              const isReservedValue = pins[role] !== '' && reservedPins.includes(Number(pins[role]));
              return (
                <div
                  key={role}
                  onClick={() => setActiveRole(role)}
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid ' + (activeRole === role ? ROLE_COLORS[role] : 'var(--border-default)'),
                    background: activeRole === role ? ROLE_COLORS[role] + '14' : 'var(--bg-inset)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLORS[role], flexShrink: 0 }} />
                    <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      {ROLE_LABELS[role]}
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    placeholder="Tik een pin aan..."
                    value={pins[role]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setPins((prev) => ({ ...prev, [role]: e.target.value }))}
                    style={inputStyle}
                    required
                  />
                  {isReservedValue && (
                    <p style={{ font: 'var(--text-mono-sm)', color: 'var(--status-danger)', marginTop: 4 }}>Gereserveerd voor de actieve DAC</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Draaien met de klok mee</label>
            <select value={actionRotateCw} onChange={(e) => setActionRotateCw(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Draaien tegen de klok in</label>
            <select value={actionRotateCcw} onChange={(e) => setActionRotateCcw(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Druktoets</label>
            <select value={actionButtonPress} onChange={(e) => setActionButtonPress(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
          Draait de knop de verkeerde kant op? Wissel gewoon welke actie hierboven aan "met de klok mee"
          versus "tegen de klok in" hangt — geen herbedrading nodig.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <ActionButton variant="ghost" onClick={onClose}>
            Annuleren
          </ActionButton>
          <Button disabled={saving || !allPinsFilled} type="submit">
            {saving ? 'Bezig...' : existingConfig ? 'Wijzigingen opslaan' : 'Apparaat toevoegen'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
