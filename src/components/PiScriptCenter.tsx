import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  DownloadCloud,
  Power,
  RefreshCw,
  RotateCw,
  Terminal,
  Upload,
  Volume2,
  Wifi,
} from 'lucide-react';
import { Badge, Button, Card, IconButton } from './ui';

interface ProvisioningLog {
  step: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

const logStatusColor: Record<ProvisioningLog['status'], string> = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-danger)',
  pending: 'var(--accent)',
};

interface HardwareStatus {
  isLinux: boolean;
  isRaspberryPi: boolean;
  model: string;
  kernel: string;
  alsaDetectedCards: string[];
  hasHifiberry: boolean;
  mixerControlFound: string | null;
  eqPluginWorking: boolean;
  librespotRunning: boolean;
}

interface ServiceStatus {
  unit: string;
  label: string;
  active: boolean;
  state: string;
  restarts: number;
  startedAt: number | null;
  restartable: boolean;
}

interface HealthIssue {
  id: string;
  source: string;
  severity: 'warning' | 'error';
  message: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

interface NetworkInterfaceInfo {
  name: string;
  type: 'ethernet' | 'wifi' | 'other';
  state: string;
  ip: string | null;
  ssid: string | null;
}

export const PiScriptCenter: React.FC = () => {
  const [powerBusy, setPowerBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<ProvisioningLog[]>([]);
  const [systemFeedback, setSystemFeedback] = useState<string | null>(null);

  const handleRestart = async () => {
    if (!window.confirm('Raspberry Pi nu herstarten? De verbinding valt kort weg.')) return;
    setPowerBusy(true);
    try {
      await fetch('/api/setup/reboot', { method: 'POST' });
    } catch (e) {}
    // Deliberately not resetting powerBusy — the Pi is rebooting, so this
    // page is about to lose its connection anyway.
  };

  const handleShutdown = async () => {
    if (!window.confirm('Raspberry Pi nu uitschakelen? Hij komt niet vanzelf terug — daar is fysiek de stroom voor nodig (of een aan/uit-knop op de behuizing, als die er is).')) return;
    setPowerBusy(true);
    try {
      await fetch('/api/setup/shutdown', { method: 'POST' });
    } catch (e) {}
  };

  const handleUpdate = async () => {
    if (!window.confirm('Nu updaten naar de nieuwste versie? De app herstart automatisch zodra de build klaar is, en draait de update terug als de nieuwe versie niet gezond opstart.')) return;
    setUpdateBusy(true);
    setUpdateLogs([]);
    try {
      const res = await fetch('/api/system/update', { method: 'POST' }).then((r) => r.json());
      if (res.logs) setUpdateLogs(res.logs);
      if (!res.success) setSystemFeedback('Update mislukt — zie het log hieronder');
    } catch (e) {
      setSystemFeedback('Kon geen verbinding maken om te updaten');
    }
    setUpdateBusy(false);
    setTimeout(() => setSystemFeedback(null), 4000);
  };

  const handleDownloadBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await fetch('/api/system/backup');
      if (!res.ok) {
        setSystemFeedback('Backup mislukt');
      } else {
        const disposition = res.headers.get('content-disposition') || '';
        const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || 'hss-backup.db';
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setSystemFeedback('Backup mislukt');
    }
    setBackupBusy(false);
    setTimeout(() => setSystemFeedback(null), 4000);
  };

  const [settingsBackupBusy, setSettingsBackupBusy] = useState(false);
  const [settingsRestoreBusy, setSettingsRestoreBusy] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadSettingsBackup = async () => {
    setSettingsBackupBusy(true);
    try {
      const res = await fetch('/api/system/settings-backup');
      if (!res.ok) {
        setSystemFeedback('Instellingen-backup mislukt');
      } else {
        const disposition = res.headers.get('content-disposition') || '';
        const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || 'hss-instellingen.json';
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setSystemFeedback('Instellingen-backup mislukt');
    }
    setSettingsBackupBusy(false);
    setTimeout(() => setSystemFeedback(null), 4000);
  };

  const handleRestoreSettingsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (
      !window.confirm(
        'Dit vervangt je huidige radiozenders, netwerkshares, known hubs, favorieten, afspeellijsten en cast/GPIO-instellingen ' +
          'met de inhoud van dit bestand. Wachtwoorden/API-sleutels zaten niet in de backup en moeten na het herstellen opnieuw ' +
          'ingevuld worden. Doorgaan?',
      )
    ) {
      return;
    }

    setSettingsRestoreBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/system/settings-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      }).then((r) => r.json());
      setSystemFeedback(res.success ? 'Instellingen hersteld' : res.error || 'Herstellen mislukt');
    } catch (e) {
      setSystemFeedback('Herstellen mislukt — geen geldig backup-bestand');
    }
    setSettingsRestoreBusy(false);
    setTimeout(() => setSystemFeedback(null), 4000);
  };

  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [wifiNetworks, setWifiNetworks] = useState<{ ssid: string; signal: number; security: string }[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [wifiConnectBusy, setWifiConnectBusy] = useState(false);
  const [selectedSsid, setSelectedSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [networkFeedback, setNetworkFeedback] = useState<string | null>(null);

  const fetchNetworkStatus = () => {
    fetch('/api/system/network')
      .then((r) => r.json())
      .then((res) => {
        if (res.interfaces) setNetworkInterfaces(res.interfaces);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchNetworkStatus();
  }, []);

  const handleScanWifi = async () => {
    setScanBusy(true);
    try {
      const res = await fetch('/api/system/network/wifi-scan').then((r) => r.json());
      if (res.networks) setWifiNetworks(res.networks);
    } catch (e) {}
    setScanBusy(false);
  };

  const handleConnectWifi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSsid) return;
    if (
      !window.confirm(
        `Verbinden met '${selectedSsid}'? Bij een verkeerd wachtwoord of een netwerk buiten bereik kan de Pi onbereikbaar worden over WiFi totdat iemand er fysiek bij kan (of via ethernet, als dat is aangesloten).`,
      )
    )
      return;
    setWifiConnectBusy(true);
    setNetworkFeedback(null);
    try {
      const res = await fetch('/api/system/network/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: selectedSsid, password: wifiPassword }),
      }).then((r) => r.json());
      if (res.success) {
        setNetworkFeedback(`Verbonden met '${selectedSsid}'.`);
        setWifiPassword('');
        if (res.interfaces) setNetworkInterfaces(res.interfaces);
      } else {
        setNetworkFeedback(res.error || 'Verbinden mislukt');
      }
    } catch (e) {
      setNetworkFeedback('Verbinden mislukt');
    }
    setWifiConnectBusy(false);
    setTimeout(() => setNetworkFeedback(null), 6000);
  };

  const [hwStatus, setHwStatus] = useState<HardwareStatus | null>(null);
  const [isLoadingHw, setIsLoadingHw] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [restartingUnit, setRestartingUnit] = useState<string | null>(null);

  const fetchHwStatus = async () => {
    setIsLoadingHw(true);
    try {
      const res = await fetch('/api/system/hardware-status').then((r) => r.json());
      if (res.hardware) {
        setHwStatus(res.hardware);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingHw(false);
    }
  };

  const fetchHealthIssues = async () => {
    try {
      const res = await fetch('/api/system/health').then((r) => r.json());
      if (Array.isArray(res.issues)) setHealthIssues(res.issues);
    } catch {
      // Offline fallback — leave whatever was last known
    }
  };

  const fetchServices = async () => {
    try {
      const res = await fetch('/api/system/services').then((r) => r.json());
      if (Array.isArray(res.services)) setServices(res.services);
    } catch {
      // Offline fallback — leave whatever was last known
    }
  };

  const handleRestartService = async (unit: string) => {
    setRestartingUnit(unit);
    try {
      const res = await fetch('/api/system/services/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit }),
      }).then((r) => r.json());
      if (Array.isArray(res.services)) setServices(res.services);
      // The warning that prompted this only disappears once the watchdog has
      // seen a calm interval, so refresh both rather than assuming success.
      fetchHealthIssues();
    } catch {
      // Server unreachable — the status list below simply stays as it was
    } finally {
      setRestartingUnit(null);
    }
  };

  useEffect(() => {
    fetchHwStatus();
    fetchHealthIssues();
    fetchServices();
    // A crash loop is a moving target: without polling you would be looking
    // at whatever happened to be true when you opened the page.
    const poll = setInterval(() => {
      fetchHealthIssues();
      fetchServices();
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  const handleRunAudioTest = async () => {
    setTestResult('Testoon wordt verzonden naar ALSA DAC...');
    try {
      const res = await fetch('/api/system/test-audio', { method: 'POST' }).then((r) => r.json());
      if (res.success) {
        setTestResult('440Hz sine sweep succesvol verzonden naar HiFiBerry DAC.');
      }
    } catch {
      setTestResult('Testoon kon niet worden verzonden.');
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const statChipStyle: React.CSSProperties = {
    padding: 12,
    background: 'var(--bg-inset)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
  const statLabelStyle: React.CSSProperties = {
    font: 'var(--text-label)',
    letterSpacing: 'var(--letter-label)',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  };
  const statValueRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };
  const statValueStyle: React.CSSProperties = {
    font: 'var(--text-mono)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  };

  return (
    <div className="space-y-6">
      {/* Real hardware diagnostics status card — first thing on the page,
          the user wants the live "is anything actually wrong" signal
          before the management controls, not after them. */}
      <Card padding={24}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 16,
            marginBottom: 16,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: hwStatus?.isLinux ? 'rgba(52,211,153,0.14)' : 'rgba(245,158,11,0.14)',
                color: hwStatus?.isLinux ? 'var(--status-success)' : 'var(--status-warning)',
              }}
            >
              <Cpu size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ font: 'var(--text-title)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>
                  Raspberry Pi live hardware status
                </h3>
                <Badge variant={hwStatus?.isLinux ? 'success' : 'warning'} mono={false}>
                  {hwStatus?.isLinux ? 'Linux Raspberry Pi actief' : 'Emulatie / dev modus'}
                </Badge>
              </div>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                {hwStatus?.model || 'Raspberry Pi 4 Model B'} · Kernel: {hwStatus?.kernel || 'Linux 6.6'}
              </p>
            </div>
          </div>

          {/* Icon-only — text labels for six actions no longer fit
              comfortably in one header row; `title` keeps them identifiable
              on hover. A dedicated icon per action (no two buttons sharing
              one, e.g. "refresh status" vs "restart the Pi" vs "download an
              update" vs "download a backup" all used to render the same
              glyph) and IconButton (a true centered square) rather than
              Button-with-empty-label (its icon+label gap left the icon
              off-center in a wider-than-tall box) — see IconButton.tsx. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <IconButton
              size={34}
              title="Ververs hardware check"
              icon={<RefreshCw size={15} style={isLoadingHw ? { animation: 'spin 1s linear infinite' } : undefined} />}
              disabled={isLoadingHw}
              onClick={() => {
                fetchHwStatus();
                fetchHealthIssues();
              }}
            />
            <IconButton
              size={34}
              variant="primary"
              title="Test HiFi DAC ALSA sweep (1kHz)"
              icon={<Volume2 size={15} />}
              onClick={handleRunAudioTest}
            />
            <IconButton
              size={34}
              title="Herstarten"
              icon={<RotateCw size={15} style={powerBusy ? { animation: 'spin 1s linear infinite' } : undefined} />}
              onClick={handleRestart}
              disabled={powerBusy || updateBusy}
            />
            <IconButton
              size={34}
              variant="danger"
              title="Uitschakelen"
              icon={<Power size={15} />}
              onClick={handleShutdown}
              disabled={powerBusy || updateBusy}
            />
            <IconButton
              size={34}
              title="Nu updaten"
              icon={<DownloadCloud size={15} style={updateBusy ? { animation: 'spin 1s linear infinite' } : undefined} />}
              onClick={handleUpdate}
              disabled={powerBusy || updateBusy}
            />
            <IconButton
              size={34}
              title="Back-up downloaden"
              icon={<Download size={15} />}
              onClick={handleDownloadBackup}
              disabled={backupBusy}
            />
          </div>
        </div>

        {/* Hardware status chips grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div style={statChipStyle}>
            <span style={statLabelStyle}>ALSA geluidskaart</span>
            <div style={statValueRowStyle}>
              <CheckCircle2
                size={16}
                style={{ color: hwStatus?.hasHifiberry ? 'var(--status-success)' : 'var(--accent)', flexShrink: 0 }}
              />
              <span style={statValueStyle}>
                {hwStatus?.hasHifiberry
                  ? 'HiFiBerry DAC+ gedetecteerd'
                  : (hwStatus?.alsaDetectedCards[0] || 'HiFiBerry I2S emulatie')}
              </span>
            </div>
          </div>

          <div style={statChipStyle}>
            <span style={statLabelStyle}>ALSA hardware mixer</span>
            <div style={statValueRowStyle}>
              {hwStatus?.mixerControlFound ? (
                <CheckCircle2 size={16} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
              )}
              <span style={statValueStyle}>
                {hwStatus?.mixerControlFound ? `Mixer: '${hwStatus.mixerControlFound}'` : 'Geen mixer gevonden — volume/balans werken mogelijk niet'}
              </span>
            </div>
          </div>

          <div style={statChipStyle}>
            <span style={statLabelStyle}>Equalizer-plugin (alsaequal)</span>
            <div style={statValueRowStyle}>
              {hwStatus?.eqPluginWorking ? (
                <CheckCircle2 size={16} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
              )}
              <span style={statValueStyle}>
                {hwStatus?.eqPluginWorking ? "Actief ('eqbase')" : 'Niet gevonden — EQ heeft geen effect'}
              </span>
            </div>
          </div>

          <div style={statChipStyle}>
            <span style={statLabelStyle}>Spotify daemon (librespot)</span>
            <div style={statValueRowStyle}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: hwStatus?.librespotRunning ? 'var(--status-success)' : 'var(--status-warning)',
                }}
              />
              <span style={statValueStyle}>
                {hwStatus?.librespotRunning ? 'Librespot actief (live)' : 'Stand-by / gereed voor Connect'}
              </span>
            </div>
          </div>

          <div style={statChipStyle}>
            <span style={statLabelStyle}>Live event bridge</span>
            <div style={statValueRowStyle}>
              <Wifi size={16} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
              <span style={statValueStyle}>/api/spotify/event (actief)</span>
            </div>
          </div>
        </div>

        {testResult && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-soft-strong)',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
              color: 'var(--accent)',
            }}
          >
            {testResult}
          </div>
        )}

        {updateLogs.length > 0 && (
          <div
            className="scrollbar-thin"
            style={{
              marginTop: 16,
              padding: 14,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              maxHeight: 220,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              font: 'var(--text-mono-sm)',
            }}
          >
            {updateLogs.map((log, idx) => (
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

        {systemFeedback && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-soft-strong)',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
              color: 'var(--accent)',
            }}
          >
            {systemFeedback}
          </div>
        )}
      </Card>

      {/* Instellingen backup/restore — a JSON export of configuration only
          (cast design, GPIO, radio stations, network shares, favorites,
          playlists), complementary to the raw hss.db download above which
          has no restore path and drags along caches/library index too. */}
      <Card padding={24}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ font: 'var(--text-title)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>
            Instellingen back-up
          </h3>
          <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Cast-vormgeving, GPIO, radiozenders, netwerkshares, known hubs, favorieten en afspeellijsten als één
            JSON-bestand. Wachtwoorden en API-sleutels (Spotify-koppeling, netwerkshares, Catalogic/AcoustID/Listener)
            zitten er bewust niet in — die vul je na het herstellen opnieuw in.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            icon={<Download size={14} />}
            onClick={handleDownloadSettingsBackup}
            disabled={settingsBackupBusy}
          >
            Downloaden
          </Button>
          <input
            ref={restoreFileInputRef}
            type="file"
            accept="application/json"
            onChange={handleRestoreSettingsFile}
            disabled={settingsRestoreBusy}
            style={{ display: 'none' }}
          />
          <Button
            variant="secondary"
            icon={<Upload size={14} />}
            disabled={settingsRestoreBusy}
            onClick={() => restoreFileInputRef.current?.click()}
          >
            Herstellen
          </Button>
        </div>
      </Card>

      {/* Network status + WiFi switching */}
      <Card padding={24}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ font: 'var(--text-title)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>
            Netwerk
          </h3>
          <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Actieve netwerk-interfaces en hun IP-adres. WiFi-netwerk wisselen kan hieronder.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {networkInterfaces.length === 0 && (
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>Geen actieve interfaces gevonden.</p>
          )}
          {networkInterfaces.map((iface) => (
            <div
              key={iface.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {iface.type === 'wifi' ? <Wifi size={15} style={{ color: 'var(--accent)' }} /> : <Terminal size={15} style={{ color: 'var(--text-muted)' }} />}
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', fontWeight: 700, flexShrink: 0 }}>{iface.name}</span>
              <Badge variant={iface.state === 'connected' ? 'success' : 'neutral'} mono={false}>{iface.state}</Badge>
              {iface.ssid && <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>'{iface.ssid}'</span>}
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', marginLeft: 'auto' }}>{iface.ip || '—'}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} style={scanBusy ? { animation: 'spin 1s linear infinite' } : undefined} />} disabled={scanBusy} onClick={handleScanWifi}>
            Scan WiFi-netwerken
          </Button>
        </div>

        {wifiNetworks.length > 0 && (
          <form onSubmit={handleConnectWifi} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }} className="scrollbar-thin">
              {wifiNetworks.map((net) => (
                <button
                  key={net.ssid}
                  type="button"
                  onClick={() => setSelectedSsid(net.ssid)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: selectedSsid === net.ssid ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                    background: selectedSsid === net.ssid ? 'var(--accent-soft)' : 'var(--bg-inset)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    font: 'var(--text-mono-sm)',
                    textAlign: 'left',
                  }}
                >
                  <Wifi size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{net.ssid}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{net.security || 'open'}</span>
                  <span style={{ color: 'var(--text-muted)', width: 40, textAlign: 'right' }}>{net.signal}%</span>
                </button>
              ))}
            </div>

            {selectedSsid && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Wachtwoord voor '{selectedSsid}'
                  </label>
                  <input
                    type="password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-default)',
                      background: 'var(--bg-inset)',
                      color: 'var(--text-primary)',
                      font: 'var(--text-mono-sm)',
                    }}
                  />
                </div>
                <Button disabled={wifiConnectBusy} icon={<Wifi size={14} style={wifiConnectBusy ? { animation: 'spin 1s linear infinite' } : undefined} />}>
                  Verbinden
                </Button>
              </div>
            )}
          </form>
        )}

        {networkFeedback && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-soft-strong)',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
              color: 'var(--accent)',
            }}
          >
            {networkFeedback}
          </div>
        )}
      </Card>

      {/* The systemd units this app leans on. Shown always, not only when
          something is wrong: "is librespot even running" was a question that
          previously had no answer anywhere in the app, and an auto-restarting
          service looks alive at almost any moment you happen to look. */}
      {services.length > 0 && (
        <Card padding={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Diensten</span>
            </div>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={fetchServices}>
              {''}
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {services.map((service) => (
              <div
                key={service.unit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {service.active ? (
                      <CheckCircle2 size={14} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
                    ) : (
                      <AlertTriangle size={14} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
                    )}
                    <span style={{ font: 'var(--text-body)', color: 'var(--text-primary)' }}>{service.label}</span>
                  </div>
                  <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
                    {service.unit} · {service.state}
                    {service.startedAt ? ` · sinds ${new Date(service.startedAt).toLocaleString('nl-NL')}` : ''}
                    {/* A restart count is only worth a mention once it stops
                        looking like an ordinary deploy or two. */}
                    {service.restarts > 2 ? ` · ${service.restarts}x herstart` : ''}
                  </div>
                </div>
                {service.restartable && (
                  <span title={`${service.label} opnieuw starten`} style={{ flexShrink: 0 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={
                        <RefreshCw
                          size={14}
                          style={restartingUnit === service.unit ? { animation: 'spin 1s linear infinite' } : undefined}
                        />
                      }
                      disabled={restartingUnit !== null}
                      onClick={() => handleRestartService(service.unit)}
                    >
                      {''}
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Only rendered when something's actually wrong — previously-silent
          failures (ALSA mixer not found, a DB write that failed, mpv
          refusing to start) surface here instead of only in journalctl. */}
      {healthIssues.length > 0 && (
        <Card padding={24} style={{ border: '1px solid rgba(251,113,133,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <AlertTriangle size={16} style={{ color: 'var(--status-danger)' }} />
            <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Systeemwaarschuwingen</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {healthIssues.map((issue) => (
              <div
                key={issue.id}
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: issue.severity === 'error' ? 'rgba(251,113,133,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${issue.severity === 'error' ? 'rgba(251,113,133,0.25)' : 'rgba(245,158,11,0.25)'}`,
                }}
              >
                <div style={{ font: 'var(--text-body)', color: 'var(--text-primary)' }}>{issue.message}</div>
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
                  {issue.source} · sinds {new Date(issue.firstSeen).toLocaleString('nl-NL')}
                  {issue.count > 1 ? ` · ${issue.count}x opgetreden` : ''}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
