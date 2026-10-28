import React, { useEffect, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import { Badge, Card } from './ui';

interface ProvisioningLog {
  step: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

interface KioskDisplayStatus {
  packagesInstalled: boolean;
  serviceEnabled: boolean;
  serviceActive: boolean;
}

const logStatusColor: Record<ProvisioningLog['status'], string> = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-danger)',
  pending: 'var(--accent)',
};

// Boot-managed local HDMI kiosk display — shows the exact same ?kiosk=1
// page a Nest Hub gets cast to, but rendered directly on a screen attached
// to the Pi itself via a systemd-managed cage+chromium-browser process.
// See docs/superpowers/specs/2026-08-24-local-hdmi-display-design.md.
export const KioskDisplayCard: React.FC = () => {
  const [status, setStatus] = useState<KioskDisplayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ProvisioningLog[]>([]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/setup/kiosk-display').then((r) => r.json());
      if (res.status) setStatus(res.status);
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleToggle = async () => {
    setBusy(true);
    const enabling = !status?.serviceEnabled;
    setLogs([
      {
        step: 'Init',
        status: 'pending',
        message: enabling ? 'Lokaal scherm inschakelen...' : 'Lokaal scherm uitschakelen...',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    try {
      const response = await fetch(`/api/setup/kiosk-display/${enabling ? 'enable' : 'disable'}`, { method: 'POST' });
      const res = await response.json();
      if (!response.ok) {
        setLogs((prev) => [
          ...prev,
          { step: 'Fout', status: 'error', message: res.error || `Verzoek mislukt (${response.status})`, timestamp: new Date().toLocaleTimeString() },
        ]);
        return;
      }
      if (res.logs) setLogs(res.logs);
      if (res.status) setStatus(res.status);
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { step: 'Fout', status: 'error', message: err.message || 'Onbekende fout', timestamp: new Date().toLocaleTimeString() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const badge = !status ? null : status.serviceActive ? (
    <Badge variant="success">Actief</Badge>
  ) : status.serviceEnabled ? (
    <Badge variant="warning">Scherm niet gevonden</Badge>
  ) : !status.packagesInstalled ? (
    <Badge variant="neutral">Nog niet geïnstalleerd</Badge>
  ) : (
    <Badge variant="neutral">Uitgeschakeld</Badge>
  );

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Monitor size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Lokaal HDMI-scherm
          </span>
        </div>
        {badge}
      </div>

      <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Toont dezelfde kiosk-weergave rechtstreeks op een scherm dat op de Pi zelf is aangesloten (HDMI),
        naast — of in plaats van — casten naar een Nest Hub. Start automatisch bij het opstarten van de Pi.
      </p>

      <button
        onClick={handleToggle}
        disabled={busy}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 16px',
          borderRadius: 'var(--radius-md)',
          background: status?.serviceEnabled ? 'rgba(251,113,133,0.12)' : 'var(--accent)',
          color: status?.serviceEnabled ? 'var(--status-danger)' : 'var(--on-accent)',
          border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
          font: 'var(--text-body-strong)',
        }}
      >
        {busy && <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />}
        {status?.serviceEnabled ? 'Lokaal scherm uitschakelen' : 'Lokaal scherm inschakelen'}
      </button>

      {logs.length > 0 && (
        <div
          className="scrollbar-thin"
          style={{
            marginTop: 14,
            padding: 14,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            maxHeight: 180,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            font: 'var(--text-mono-sm)',
          }}
        >
          {logs.map((log, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>[{log.timestamp}]</span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  flexShrink: 0,
                  color: logStatusColor[log.status],
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {log.step}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
