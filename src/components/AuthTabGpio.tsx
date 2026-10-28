import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Pencil, PlusCircle, Radio } from 'lucide-react';
import { Badge, Card, Toggle } from './ui';
import { ActionButton, cardHeaderStyle } from './AuthViewShared';
import { AuthGpioDeviceModal } from './AuthGpioDeviceModal';
import { ROLE_COLORS, ROLE_LABELS } from './GpioPinoutDiagram';

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

// GPIO hardwarekoppeling — rotary-encoder-met-druktoets naar afspeelacties.
// Zie docs/superpowers/specs/2026-08-24-gpio-hardware-mapping-design.md.
export const AuthTabGpio: React.FC = () => {
  const [status, setStatus] = useState<GpioStatus | null>(null);
  const [config, setConfig] = useState<GpioDeviceConfig | null>(null);
  const [toggling, setToggling] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [liveLog, setLiveLog] = useState<{ action: GpioAction; timestamp: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/gpio/status').then((r) => r.json());
      if (res.status) setStatus(res.status);
      if (res.config) setConfig(res.config);
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Re-fetch when the tab/window regains focus — a status fetched once on
  // mount goes stale if the backend restarted (deploy, DB recovery) while
  // this settings page sat open in the background; the main app already
  // re-fetches on WS reconnect for exactly this reason, but this component
  // is deliberately self-contained (no shared WS), so it needs its own
  // trigger. Reproduced live: a saved GPIO device kept showing as
  // unconfigured here after a backend restart until a manual page reload.
  useEffect(() => {
    const onFocus = () => fetchStatus();
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchStatus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Live test feed — a small, self-contained WS connection (matches this
  // component's own zero-prop, own-fetch-calls convention rather than
  // threading gpio_action events down from App.tsx's shared socket) that
  // only opens while there's something worth watching for.
  useEffect(() => {
    if (!config?.enabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('hss_auth_token');
    const wsUri = `${protocol}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const socket = new WebSocket(wsUri);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'gpio_action' && payload.data?.action) {
          setLiveLog((prev) => [{ action: payload.data.action, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
        }
      } catch {}
    };

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [config?.enabled]);

  const showFeedback = (msg: string, isError = false) => {
    setFeedback({ message: msg, isError });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleToggleEnabled = async () => {
    if (!config || toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/gpio/${config.enabled ? 'disable' : 'enable'}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Actie mislukt', true);
        return;
      }
      if (data.status) setStatus(data.status);
      setConfig((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev));
    } catch (err: any) {
      showFeedback(err.message || 'Actie mislukt', true);
    } finally {
      setToggling(false);
    }
  };

  const badge = !config ? null : !status?.gpiodInstalled ? (
    <Badge variant="neutral">gpiod niet geïnstalleerd</Badge>
  ) : status.watcherRunning ? (
    <Badge variant="success">Actief</Badge>
  ) : (
    <Badge variant="neutral">Uitgeschakeld</Badge>
  );

  return (
    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>GPIO-hardwarekoppeling</h3>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Koppel een rotary encoder met druktoets aan GPIO-pinnen — draaien en drukken sturen dezelfde
              acties aan die de webinterface ook gebruikt.
            </p>
          </div>
          {badge}
        </div>

        {status && !status.gpiodInstalled && (
          <div style={{ padding: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>
            Installeer eerst <code>gpiod</code> op de Pi: <code>sudo apt-get install -y gpiod</code>
          </div>
        )}

        {feedback && (
          <div
            style={{
              padding: 10,
              background: feedback.isError ? 'rgba(251,113,133,0.12)' : 'rgba(52,211,153,0.12)',
              border: '1px solid ' + (feedback.isError ? 'rgba(251,113,133,0.3)' : 'rgba(52,211,153,0.3)'),
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
              color: feedback.isError ? 'var(--status-danger)' : 'var(--status-success)',
            }}
          >
            {feedback.message}
          </div>
        )}

        {!config ? (
          <div
            style={{
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              textAlign: 'center',
              background: 'var(--bg-inset)',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <Cpu size={22} style={{ color: 'var(--text-muted)' }} />
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0, maxWidth: 420 }}>
              Nog geen GPIO-apparaat ingesteld. Voeg een rotary encoder toe om volume en afspelen
              met fysieke hardware te bedienen.
            </p>
            <ActionButton icon={<PlusCircle size={15} />} onClick={() => setModalOpen(true)}>
              Apparaat toevoegen
            </ActionButton>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {([
                ['pinA', config.pinA, ROLE_LABELS.pinA],
                ['pinB', config.pinB, ROLE_LABELS.pinB],
                ['pinButton', config.pinButton, ROLE_LABELS.pinButton],
              ] as const).map(([role, pin, label]) => (
                <div key={role} style={{ padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ROLE_COLORS[role] }} />
                    <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
                  </div>
                  <div style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>BCM {pin}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
              <span>Met de klok mee → {ACTION_LABELS[config.actionRotateCw]}</span>
              <span>Tegen de klok in → {ACTION_LABELS[config.actionRotateCcw]}</span>
              <span>Druktoets → {ACTION_LABELS[config.actionButtonPress]}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <ActionButton variant="secondary" icon={<Pencil size={14} />} onClick={() => setModalOpen(true)}>
                Bewerken
              </ActionButton>
              <Toggle checked={config.enabled} onChange={handleToggleEnabled} label={config.enabled ? 'Ingeschakeld' : 'Uitgeschakeld'} />
            </div>

            {config.enabled && (
              <div style={{ padding: 14, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: liveLog.length ? 10 : 0 }}>
                  <Radio size={13} style={{ color: liveLog.length ? 'var(--status-success)' : 'var(--text-muted)' }} />
                  <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Live test — draai of druk op de encoder
                  </span>
                </div>
                {liveLog.length === 0 ? (
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
                    Nog geen signaal ontvangen. Draai aan de encoder of druk op de knop om te testen.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {liveLog.map((entry, i) => (
                      <div
                        key={entry.timestamp + i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          font: 'var(--text-mono-sm)',
                          color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        <span>{ACTION_LABELS[entry.action]}</span>
                        <span>{entry.timestamp}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <AuthGpioDeviceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reservedPins={status?.reservedPins || []}
        existingConfig={config}
        onSaved={(newConfig, newStatus) => {
          setConfig(newConfig);
          if (newStatus) setStatus(newStatus);
          showFeedback('GPIO-configuratie opgeslagen');
        }}
      />
    </Card>
  );
};
