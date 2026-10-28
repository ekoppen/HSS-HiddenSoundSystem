import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Cast,
  Check,
  CheckCircle2,
  Layers,
  Play,
  Power,
  RefreshCw,
  Sparkles,
  Terminal,
  Volume2,
  X,
} from 'lucide-react';
import { AudioDevice, HubConfig } from '../types';
import { Badge, Button, IconButton, Toggle } from './ui';

interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioDevices: AudioDevice[];
  hubConfig: HubConfig;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onSwitchAudioDevice: (deviceId: string) => Promise<void>;
}

interface DetectionData {
  isLinux: boolean;
  isRaspberryPi: boolean;
  piModel: string;
  kernel: string;
  configFile: string | null;
  hasDacOverlay: boolean;
  overlayName: string | null;
  detectedAlsaCards: { id: string; name: string; raw: string }[];
  isHifiberryDetected: boolean;
  hasLibrespotBinary: boolean;
  isLibrespotServiceActive: boolean;
  hasEventHookScript: boolean;
  needsReboot: boolean;
}

interface ProvisioningLog {
  step: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

const STEPS = [
  { num: 1, title: 'Hardware detectie' },
  { num: 2, title: 'Spotify instellingen' },
  { num: 3, title: 'Auto-provisioning' },
  { num: 4, title: 'Audio output test' },
  { num: 5, title: 'Klaar om te spelen' },
];

// minHeight reserves 2 lines' worth of --text-label so a label that wraps
// to 2 lines doesn't push just its own column's input down relative to
// shorter, single-line sibling labels in the same grid row.
const labelStyle: React.CSSProperties = {
  display: 'block',
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  marginBottom: 8,
  minHeight: 29,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  font: 'var(--text-body)',
  color: 'var(--text-primary)',
  outline: 'none',
};

const logStatusColor: Record<ProvisioningLog['status'], string> = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-danger)',
  pending: 'var(--accent)',
};

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  isOpen,
  onClose,
  audioDevices,
  hubConfig,
  onSaveConfig,
  onSwitchAudioDevice,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [detection, setDetection] = useState<DetectionData | null>(null);
  const [isLoadingDetection, setIsLoadingDetection] = useState<boolean>(true);

  // Form State
  const [selectedDacId, setSelectedDacId] = useState<string>('hifiberry-dacplus');
  const [deviceName, setDeviceName] = useState<string>(hubConfig.spotifyDeviceName || 'Pi-HSS-HiFi');
  const [bitrate, setBitrate] = useState<'320' | '160' | '96'>(hubConfig.spotifyBitrate || '320');
  const [enableNormalisation, setEnableNormalisation] = useState<boolean>(hubConfig.spotifyNormalisation !== false);

  // Provisioning state
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);
  const [logs, setLogs] = useState<ProvisioningLog[]>([]);
  const [provisionCompleted, setProvisionCompleted] = useState<boolean>(false);
  const [needsReboot, setNeedsReboot] = useState<boolean>(false);

  // Audio test state
  const [isTestingAudio, setIsTestingAudio] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Load detection on mount
  useEffect(() => {
    if (isOpen) {
      fetchDetection();
    }
  }, [isOpen]);

  const fetchDetection = async () => {
    setIsLoadingDetection(true);
    try {
      const res = await fetch('/api/setup/detect').then((r) => r.json());
      if (res.detection) {
        setDetection(res.detection);
        if (res.detection.isHifiberryDetected) {
          setSelectedDacId('hifiberry-dacplus');
        }
      }
    } catch (e) {
      console.warn('Detection failed:', e);
    } finally {
      setIsLoadingDetection(false);
    }
  };

  if (!isOpen) return null;

  const handleStartProvisioning = async () => {
    setIsProvisioning(true);
    setLogs([
      {
        step: 'Initialisatie',
        status: 'pending',
        message: 'Communiceren met Raspberry Pi setup daemon...',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      const res = await fetch('/api/setup/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dacId: selectedDacId,
          deviceName,
          bitrate,
          enableVolumeNormalisation: enableNormalisation,
        }),
      }).then((r) => r.json());

      if (res.logs) {
        setLogs(res.logs);
      }
      if (res.needsReboot) {
        setNeedsReboot(true);
      }
      setProvisionCompleted(true);
      await onSwitchAudioDevice(selectedDacId);
      await onSaveConfig({
        spotifyDeviceName: deviceName,
        spotifyBitrate: bitrate,
        spotifyNormalisation: enableNormalisation,
      });
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        {
          step: 'Fout',
          status: 'error',
          message: `Fout tijdens provisioning: ${err.message}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsProvisioning(false);
    }
  };

  const handleRunAudioSweep = async () => {
    setIsTestingAudio(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/system/test-audio', { method: 'POST' }).then((r) => r.json());
      if (res.success) {
        setTestResult('ALSA 440Hz sine sweep succesvol verzonden naar de HiFiBerry DAC.');
      } else {
        setTestResult('Test verzonden — controleer de speaker output.');
      }
    } catch {
      setTestResult('Test kon niet worden uitgevoerd.');
    } finally {
      setIsTestingAudio(false);
    }
  };

  const handleTriggerReboot = async () => {
    if (confirm('Weet je zeker dat je de Raspberry Pi wilt herstarten om de I2S DAC overlay te laden?')) {
      try {
        await fetch('/api/setup/reboot', { method: 'POST' });
        alert('De Raspberry Pi wordt nu herstart. Wacht circa 40 seconden en vernieuw deze pagina.');
        onClose();
      } catch {
        alert('Herstartopdracht verzonden.');
      }
    }
  };

  const selectedDac = audioDevices.find((d) => d.id === selectedDacId) || audioDevices[0];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(4,5,7,0.82)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 860,
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <Sparkles size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  HSS HiFi setup- &amp; onboardingwizard
                </h3>
                <Badge variant="accent">Stap {currentStep} van 5</Badge>
              </div>
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                Geautomatiseerde I2S DAC configuratie, ALSA routering en Spotify Connect activatie
              </p>
            </div>
          </div>

          <IconButton icon={<X size={18} />} title="Sluiten" onClick={onClose} />
        </div>

        {/* Stepper */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 8,
            padding: '12px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-inset)',
            flexShrink: 0,
          }}
        >
          {STEPS.map((s) => {
            const isActive = currentStep === s.num;
            const isDone = currentStep > s.num;
            return (
              <div
                key={s.num}
                onClick={() => s.num < currentStep && setCurrentStep(s.num)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: s.num < currentStep ? 'pointer' : 'default',
                  font: 'var(--text-mono-sm)',
                  color: isActive ? 'var(--accent)' : isDone ? 'var(--status-success)' : 'var(--text-muted)',
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    background: isActive ? 'var(--accent)' : isDone ? 'var(--status-success)' : 'var(--bg-card)',
                    color: isActive ? 'var(--on-accent)' : isDone ? 'var(--bg-page)' : 'var(--text-muted)',
                    border: isActive || isDone ? 'none' : '1px solid var(--border-default)',
                  }}
                >
                  {isDone ? <Check size={11} /> : s.num}
                </div>
                <span className="hidden md:inline" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step Body */}
        <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* STEP 1: HARDWARE & DAC DETECTION */}
          {currentStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h4 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Stap 1 — hardware &amp; ALSA DAC detectie
                </h4>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  We hebben jouw Raspberry Pi gescand om aangesloten I2S geluidskaarten en hardware drivers te identificeren.
                </p>
              </div>

              {/* Hardware Scan Results Card */}
              <div style={{ padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 10, font: 'var(--text-mono-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Raspberry Pi model:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{detection?.piModel || 'Raspberry Pi 4 Model B'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Linux kernel / OS:</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{detection?.kernel || 'Linux 6.6 ALSA'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ALSA hardware detectie:</span>
                  <span style={{ color: detection?.isHifiberryDetected ? 'var(--status-success)' : 'var(--status-warning)', fontWeight: 600 }}>
                    {detection?.isHifiberryDetected
                      ? 'HiFiBerry DAC+ kaart gevonden'
                      : detection?.detectedAlsaCards[0]?.name || 'Geen fysieke ALSA kaart geladen (emulatie)'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Boot config bestand:</span>
                  <span style={{ color: 'var(--accent)' }}>{detection?.configFile || '/boot/firmware/config.txt'}</span>
                </div>
              </div>

              {/* Choose / Confirm DAC */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={labelStyle}>Selecteer jouw HiFi DAC HAT:</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {audioDevices.map((d) => {
                    const selected = selectedDacId === d.id;
                    return (
                      <div
                        key={d.id}
                        onClick={() => setSelectedDacId(d.id)}
                        style={{
                          padding: 16,
                          borderRadius: 'var(--radius-lg)',
                          cursor: 'pointer',
                          border: '1px solid ' + (selected ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                          background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
                          transition: 'all var(--duration-fast) var(--ease-standard)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Layers size={15} color="var(--accent)" />
                            <h5 style={{ font: 'var(--text-mono-sm)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{d.name}</h5>
                          </div>
                          {selected && <CheckCircle2 size={16} color="var(--accent)" />}
                        </div>
                        <p style={{ font: 'var(--text-body)', color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: 12 }}>{d.description}</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                          <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', background: 'var(--bg-inset)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{d.chipset}</span>
                          <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', background: 'var(--bg-inset)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{d.dtoverlay}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: SPOTIFY CONNECT CONFIGURATION */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h4 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Stap 2 — Spotify Connect &amp; streaming instellingen
                </h4>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  Stel in hoe jouw Raspberry Pi zichtbaar is in de officiële Spotify app op je telefoon of desktop.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Spotify Connect apparaatnaam (zichtbaar in Spotify):</label>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="bijv. Pi-HSS-HiFi of Woonkamer HiFi"
                    style={inputStyle}
                  />
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
                    Dit is de naam die verschijnt onder "Verbinden met een apparaat" in Spotify.
                  </p>
                </div>

                <div>
                  <label style={labelStyle}>Streaming kwaliteit (audio bitrate):</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { value: '320', label: '320 kbps', sub: 'HiFi master — hoogste Ogg Vorbis kwaliteit' },
                      { value: '160', label: '160 kbps', sub: 'Standaard streaming' },
                      { value: '96', label: '96 kbps', sub: 'Lage bandbreedte — bespaart data' },
                    ].map((b) => {
                      const selected = bitrate === b.value;
                      return (
                        <div
                          key={b.value}
                          onClick={() => setBitrate(b.value as any)}
                          style={{
                            padding: 12,
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            border: '1px solid ' + (selected ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                            background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
                            transition: 'all var(--duration-fast) var(--ease-standard)',
                          }}
                        >
                          <span style={{ font: 'var(--text-mono-sm)', fontWeight: 700, color: selected ? 'var(--accent)' : 'var(--text-primary)', display: 'block' }}>{b.label}</span>
                          <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>{b.sub}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ padding: 14, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                  <Toggle
                    checked={enableNormalisation}
                    onChange={setEnableNormalisation}
                    label="Spotify volume normalisatie"
                    description="Zorgt voor een consistent volume tussen verschillende albums zonder dynamiekverlies."
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: AUTOMATED PROVISIONING */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h4 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Stap 3 — automatische 1-klik systeem provisioning
                </h4>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  We gaan nu automatisch alle benodigde Linux bestanden, ALSA configuraties en de Spotify daemon instellen.
                </p>
              </div>

              {!provisionCompleted && !isProvisioning && (
                <div style={{ padding: 28, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-lg)', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <h5 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', margin: 0 }}>Gereed voor automatische configuratie</h5>
                    <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px auto 0', maxWidth: 420 }}>
                      Klik hieronder om direct <span style={{ color: 'var(--accent)' }}>/etc/asound.conf</span>,{' '}
                      <span style={{ color: 'var(--accent)' }}>/opt/hss/spotify-event.sh</span> en{' '}
                      <span style={{ color: 'var(--accent)' }}>librespot-hss.service</span> te genereren en activeren.
                    </p>
                  </div>
                  <Button icon={<Play size={16} fill="currentColor" />} onClick={handleStartProvisioning}>
                    Start automatische provisioning
                  </Button>
                </div>
              )}

              {/* Live Terminal Log Viewer */}
              {(isProvisioning || logs.length > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Terminal size={14} color="var(--accent)" />
                      Provisioning console log output:
                    </span>
                    {isProvisioning && (
                      <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Bezig met uitvoeren...
                      </span>
                    )}
                  </div>
                  <div className="scrollbar-thin" style={{ padding: 14, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, font: 'var(--text-mono-sm)' }}>
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
                </div>
              )}

              {needsReboot && (
                <div style={{ padding: 16, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', font: 'var(--text-mono-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <AlertCircle size={18} color="var(--status-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--status-warning)', display: 'block' }}>Herstart vereist voor I2S DAC overlay</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        De overlay is toegevoegd aan <span style={{ color: 'var(--text-primary)' }}>/boot/firmware/config.txt</span>. Herstart je Pi
                        om ALSA de DAC te laten laden.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleTriggerReboot}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius-md)', background: 'var(--status-warning)', color: '#1a1006', border: 'none', fontWeight: 700, font: 'var(--text-mono-sm)', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Power size={14} />
                    Herstart Pi
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: LIVE AUDIO TEST */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h4 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Stap 4 — HiFi DAC audio output test
                </h4>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  Test of het audiosignaal zonder vervorming direct uit jouw {selectedDac.name} komt.
                </p>
              </div>

              <div style={{ padding: 28, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-lg)', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <Volume2 size={24} />
                </div>
                <div>
                  <h5 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', margin: 0 }}>ALSA 440Hz sine wave sweep</h5>
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px auto 0', maxWidth: 420 }}>
                    Dit commando stuurt via ALSA direct een zuivere testoon naar{' '}
                    <span style={{ color: 'var(--accent)' }}>hw:0,0 ({selectedDac.name})</span>.
                  </p>
                </div>

                <Button icon={<Volume2 size={16} />} disabled={isTestingAudio} onClick={handleRunAudioSweep}>
                  {isTestingAudio ? 'Testtoon wordt afgespeeld...' : 'Speel HiFi DAC testtoon af'}
                </Button>

                {testResult && (
                  <div style={{ padding: 12, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-success)', maxWidth: 420 }}>
                    {testResult}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: READY & FINISHED */}
          {currentStep === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, textAlign: 'center', padding: '16px 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-xl)', background: 'rgba(52,211,153,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--status-success)' }}>
                <Check size={30} strokeWidth={3} />
              </div>

              <div>
                <h4 style={{ font: 'var(--text-display)', color: 'var(--text-primary)', margin: 0 }}>
                  Gefeliciteerd — je HSS HiFi Hub is gereed!
                </h4>
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', margin: '8px auto 0', maxWidth: 460 }}>
                  Jouw Raspberry Pi streamt nu bit-perfect via de{' '}
                  <span style={{ color: 'var(--status-success)', fontWeight: 700 }}>{selectedDac.name}</span>.
                </p>
              </div>

              {/* How to Connect Spotify Instructions */}
              <div style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', textAlign: 'left', maxWidth: 460, width: '100%', font: 'var(--text-mono-sm)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--letter-label)', fontSize: 11 }}>
                  <Cast size={15} />
                  Zo verbind je nu vanaf Spotify:
                </span>
                <ol style={{ marginTop: 10, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-secondary)' }}>
                  <li>Open Spotify op je smartphone, tablet of computer.</li>
                  <li>Speel een track af en klik op het apparaten / connect icoon.</li>
                  <li>
                    Selecteer{' '}
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700, background: 'var(--bg-inset)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{deviceName}</span>.
                  </li>
                  <li>De muziek speelt direct over je HiFi DAC en de album artwork verschijnt live in dit dashboard.</li>
                </ol>
              </div>

              <Button icon={<ArrowRight size={16} />} onClick={onClose}>
                Open speler dashboard
              </Button>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-inset)', flexShrink: 0 }}>
          <Button
            variant="secondary"
            icon={<ArrowLeft size={14} />}
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
          >
            Vorige stap
          </Button>

          {currentStep < 5 && (
            <Button icon={<ArrowRight size={14} />} onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1))}>
              Volgende stap
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
