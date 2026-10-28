import React, { useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Save } from 'lucide-react';
import { HubConfig } from '../types';
import { Button, Card, Toggle } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabNasProps {
  daemonConfig: HubConfig;
  setDaemonConfig: React.Dispatch<React.SetStateAction<HubConfig>>;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onFeedback: (msg: string) => void;
}

// NAS/SMB mount config — a one-time connection setting, so it lives here
// rather than in the Bronnen tab where day-to-day browsing/playing happens.
export const AuthTabNas: React.FC<AuthTabNasProps> = ({ daemonConfig, setDaemonConfig, onSaveConfig, onFeedback }) => {
  const [nasHost, setNasHost] = useState('');
  const [nasSharePath, setNasSharePath] = useState('');
  const [nasUsername, setNasUsername] = useState('');
  const [nasPassword, setNasPassword] = useState('');
  const [nasMountName, setNasMountName] = useState('');
  const [nasShareType, setNasShareType] = useState<'nfs' | 'smb'>('nfs');
  const [nasMountStatus, setNasMountStatus] = useState<string | null>(null);

  const handleMountNas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nasHost || !nasSharePath || !nasMountName) return;
    try {
      const res = await fetch('/api/nas/mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nasMountName,
          shareType: nasShareType,
          host: nasHost,
          sharePath: nasSharePath,
          username: nasUsername,
          password: nasPassword,
        }),
      }).then((r) => r.json());
      if (res.message) setNasMountStatus(res.message);
    } catch (e) {}
  };

  // Whole-library NAS↔Catalogic scan — see nasLibraryScan.ts
  const [scanStatus, setScanStatus] = useState<any>(null);
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [scanResultsFilter, setScanResultsFilter] = useState<'unmatched' | 'matched' | 'all'>('unmatched');
  const [nasShares, setNasShares] = useState<any[]>([]);

  const loadNasShares = async () => {
    try {
      const res = await fetch('/api/nas/shares').then((r) => r.json());
      if (res.shares) setNasShares(res.shares);
    } catch (e) {}
  };

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/nas/scan/status').then((r) => r.json());
        if (!cancelled && res.status) setScanStatus(res.status);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    loadNasShares();
  }, []);

  const handleStartScan = async () => {
    try {
      const res = await fetch('/api/nas/scan/start', { method: 'POST' }).then((r) => r.json());
      if (res.status) setScanStatus(res.status);
    } catch {}
  };

  const handleStopScan = async () => {
    try {
      const res = await fetch('/api/nas/scan/stop', { method: 'POST' }).then((r) => r.json());
      if (res.status) setScanStatus(res.status);
    } catch {}
  };

  const handleLoadScanResults = async (filter: 'unmatched' | 'matched' | 'all') => {
    setScanResultsFilter(filter);
    try {
      const res = await fetch(`/api/nas/scan/results?filter=${filter}`).then((r) => r.json());
      if (res.results) setScanResults(res.results);
    } catch {}
  };

  const handleSaveScanPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig({ catalogicScanLookupEnabled: daemonConfig.catalogicScanLookupEnabled });
    onFeedback('Scan-instelling opgeslagen!');
  };

  return (
    <>
      {/* Whole-library scan — walks every mounted share, indexes every file, reconciles against Catalogic.
          Shown first (above the mount form) so its progress is visible without scrolling. */}
      <Card padding={0}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Bibliotheek scannen</h3>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Loopt één keer door je hele NAS-schijf, leest alle tags in en houdt bij wat Catalogic wel en niet
                herkent — in plaats van alleen de mappen die je toevallig doorbladert.
              </p>
            </div>
            {scanStatus?.running ? (
              <Button type="button" variant="danger" icon={<RefreshCw size={15} />} onClick={handleStopScan}>
                Scan stoppen
              </Button>
            ) : (
              <Button type="button" icon={<HardDrive size={15} />} onClick={handleStartScan}>
                Scan starten
              </Button>
            )}
          </div>

          <form
            onSubmit={handleSaveScanPermission}
            style={{
              padding: 16,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Toggle
              checked={!!daemonConfig.catalogicScanLookupEnabled}
              onChange={(v) => setDaemonConfig({ ...daemonConfig, catalogicScanLookupEnabled: v })}
              label="Sta toe dat een volledige scan Catalogic mag raadplegen"
              description="Los van de Catalogic-koppeling hiernaast (die alleen losse opzoekingen tijdens bladeren regelt) — een volledige scan kan duizenden aanvragen sturen. Staat standaard uit; zonder deze aan te zetten indexeert een scan alleen je lokale tags."
            />
            <div>
              <Button size="sm" icon={<Save size={13} />}>Opslaan</Button>
            </div>
          </form>

          {scanStatus && (scanStatus.running || scanStatus.startedAt) && (
            <div
              style={{
                padding: 16,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft-strong)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', fontWeight: 600 }}>
                {scanStatus.running
                  ? `Bezig — ${scanStatus.filesScanned}/${scanStatus.filesFound || '?'} bestanden`
                  : 'Laatste scan voltooid'}
              </div>
              {scanStatus.currentFile && (
                <div
                  style={{
                    font: 'var(--text-mono-sm)',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {scanStatus.currentFile}
                </div>
              )}
              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>
                {scanStatus.matched} gematcht · {scanStatus.unmatched} niet gematcht · {scanStatus.filesSkippedUnchanged}{' '}
                ongewijzigd overgeslagen
                {scanStatus.error && <span style={{ color: 'var(--status-danger)' }}> · Fout: {scanStatus.error}</span>}
              </div>
              {scanStatus.catalogicLookupFailures > 0 && (
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--status-warning)' }}>
                  ⚠ Catalogic was {scanStatus.catalogicLookupFailures}x onbereikbaar tijdens deze scan — het aantal
                  "niet gematcht" is daardoor mogelijk niet compleet. Draai de scan later nog eens om zeker te zijn.
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center" style={{ gap: 10, marginBottom: 12 }}>
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Resultaten:</span>
              {(['unmatched', 'matched', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleLoadScanResults(f)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-md)',
                    font: 'var(--text-mono-sm)',
                    fontWeight: 600,
                    background: scanResultsFilter === f ? 'var(--accent)' : 'var(--bg-inset)',
                    color: scanResultsFilter === f ? 'var(--on-accent)' : 'var(--text-muted)',
                  }}
                >
                  {f === 'unmatched' ? 'Niet gematcht' : f === 'matched' ? 'Gematcht' : 'Alles'}
                </button>
              ))}
            </div>
            {scanResults.length > 0 ? (
              <div className="scrollbar-thin" style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {scanResults.map((r) => (
                  <div
                    key={r.file_path}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--bg-inset)',
                      borderRadius: 'var(--radius-sm)',
                      font: 'var(--text-mono-sm)',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.artist} — {r.title}
                    </span>
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                      {r.catalogic_song_id ? `Catalogic (${r.match_confidence})` : 'geen match'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                Klik "{scanResultsFilter === 'unmatched' ? 'Niet gematcht' : scanResultsFilter === 'matched' ? 'Gematcht' : 'Alles'}"
                om resultaten te laden, of start eerst een scan.
              </div>
            )}
          </div>
        </div>
      </Card>

      {nasShares.length > 0 && (
        <Card padding={0} style={{ marginTop: 20 }}>
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Gekoppelde netwerkschijven</h3>
            {nasShares.map((share: any) => (
              <div
                key={share.id}
                style={{
                  padding: 14,
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div className="min-w-0">
                  <div style={{ font: 'var(--text-body)', color: 'var(--text-primary)', fontWeight: 600 }}>{share.name}</div>
                  <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    {String(share.shareType).toUpperCase()} · {share.host} · {share.mountPoint}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ font: 'var(--text-mono-sm)', color: 'var(--status-success)', fontWeight: 600 }}>{share.status}</div>
                  <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    {share.fileCount > 0 ? `${share.fileCount} bestanden geïndexeerd` : 'Nog niet gescand'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padding={0} style={{ marginTop: 20 }}>
        <form onSubmit={handleMountNas} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Netwerkschijf & lokale muziek (NAS / SMB / NFS)</h3>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Koppel je Synology, QNAP of Windows netwerkmap. Bladeren en afspelen doe je daarna via Bronnen of de
                "Bron kiezen"-knop op het Afspeel- en Cast-scherm.
              </p>
            </div>
            <Button icon={<HardDrive size={15} />}>{`Koppel ${nasShareType.toUpperCase()} schijf`}</Button>
          </div>

          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Netwerk protocol:</span>
            <button
              type="button"
              onClick={() => setNasShareType('nfs')}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-mono-sm)',
                fontWeight: 600,
                background: nasShareType === 'nfs' ? 'var(--accent)' : 'var(--bg-inset)',
                color: nasShareType === 'nfs' ? 'var(--on-accent)' : 'var(--text-muted)',
              }}
            >
              NFS (Linux / Unix / Synology NFS)
            </button>
            <button
              type="button"
              onClick={() => setNasShareType('smb')}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-mono-sm)',
                fontWeight: 600,
                background: nasShareType === 'smb' ? 'var(--accent)' : 'var(--bg-inset)',
                color: nasShareType === 'smb' ? 'var(--on-accent)' : 'var(--text-muted)',
              }}
            >
              SMB / CIFS (Windows / Synology SMB)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            <div>
              <label style={labelStyle}>Naam netwerkschijf</label>
              <input
                type="text"
                placeholder="Bijv. Synology HiFi Audio"
                value={nasMountName}
                onChange={(e) => setNasMountName(e.target.value)}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>Host IP-adres / hostname</label>
              <input
                type="text"
                placeholder="Bijv. 192.168.178.50"
                value={nasHost}
                onChange={(e) => setNasHost(e.target.value)}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>
                {nasShareType === 'nfs' ? 'NFS export pad (bijv. /volume1/music)' : 'SMB netwerk share (bijv. /Music)'}
              </label>
              <input
                type="text"
                placeholder={nasShareType === 'nfs' ? '/volume1/music' : '/Music of /Muziek'}
                value={nasSharePath}
                onChange={(e) => setNasSharePath(e.target.value)}
                style={inputStyle}
                required
              />
            </div>

            {nasShareType === 'smb' && (
              <>
                <div>
                  <label style={labelStyle}>Gebruikersnaam (optioneel)</label>
                  <input
                    type="text"
                    placeholder="admin"
                    value={nasUsername}
                    onChange={(e) => setNasUsername(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Wachtwoord (optioneel)</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={nasPassword}
                    onChange={(e) => setNasPassword(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </>
            )}

            {nasShareType === 'nfs' && (
              <div
                style={{
                  font: 'var(--text-mono-sm)',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 12,
                  background: 'var(--bg-inset)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                NFS vereist geen gebruikersnaam/wachtwoord. Zorg dat het IP van de Pi toestemming heeft in de NFS exports.
              </div>
            )}
          </div>

          {nasMountStatus && (
            <div
              style={{
                padding: 12,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft-strong)',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-mono-sm)',
                color: 'var(--accent)',
              }}
            >
              {nasMountStatus}
            </div>
          )}
        </form>
      </Card>
    </>
  );
};
