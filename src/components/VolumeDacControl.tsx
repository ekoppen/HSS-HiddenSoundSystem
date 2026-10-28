import React, { useState } from 'react';
import { CheckCircle2, Cpu, Layers, ShieldAlert, Volume1, Volume2, VolumeX, Zap } from 'lucide-react';
import { AudioDevice, DacConfig, PlaybackState } from '../types';
import { Badge, Button, Card, SpecStat, Slider } from './ui';

interface VolumeDacControlProps {
  playback: PlaybackState;
  audioDevices: AudioDevice[];
  maxVolumeLimit: number;
  onUpdateMaxVolumeLimit: (limit: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onBalanceChange: (balance: number) => void;
  onSwitchAudioDevice: (deviceId: string) => void;
  onUpdateDacConfig: (config: Partial<DacConfig>) => void;
  onTestAudioSweep: () => Promise<void>;
}

const labelMuted: React.CSSProperties = {
  font: 'var(--text-mono-sm)',
  color: 'var(--text-muted)',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
};

export const VolumeDacControl: React.FC<VolumeDacControlProps> = ({
  playback,
  audioDevices,
  maxVolumeLimit,
  onUpdateMaxVolumeLimit,
  onVolumeChange,
  onToggleMute,
  onBalanceChange,
  onSwitchAudioDevice,
  onTestAudioSweep,
}) => {
  const { volume, isMuted, dacConfig } = playback;
  const [testToneStatus, setTestToneStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const activeDevice = audioDevices.find((d) => d.id === dacConfig.activeDeviceId) || audioDevices[0];

  const handleTestSweep = async () => {
    setIsTesting(true);
    setTestToneStatus('Genereren van 1kHz 0dBFS ALSA testtoon naar DAC...');
    try {
      await onTestAudioSweep();
      setTestToneStatus('Signaal succesvol afgespeeld via ALSA hardware output!');
    } catch (e) {
      setTestToneStatus('Fout bij verzenden van testtoon.');
    } finally {
      setTimeout(() => {
        setIsTesting(false);
      }, 2500);
    }
  };

  const volumePresets = [
    { label: 'Mute', val: 0, db: '-60 dB' },
    { label: 'Laag (-25dB)', val: 25, db: '-45 dB' },
    { label: 'Medium (-15dB)', val: 50, db: '-30 dB' },
    { label: 'HiFi (-6dB)', val: 75, db: '-15 dB' },
    { label: 'Max (0dBFS)', val: 100, db: '0.0 dB' },
  ];

  const balanceLabel =
    dacConfig.balance === 0
      ? 'Gecentreerd (0)'
      : dacConfig.balance < 0
      ? `${Math.abs(dacConfig.balance)}% links`
      : `${dacConfig.balance}% rechts`;

  return (
    <div className="space-y-6">
      {/* Master Volume */}
      <Card padding={28}>
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <Volume2 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>
                HiFi volumeregeling & ALSA hardware demping
              </h2>
            </div>
            <p className="mt-1" style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
              Logaritmische volumecurve met directe ALSA mixer koppeling voor bit-perfecte DAC-overdracht.
            </p>
          </div>

          <div className="flex items-center gap-5 px-5 py-3" style={panelStyle}>
            <SpecStat label="Demping" value={isMuted ? '-∞ dB' : `${dacConfig.volumeDb} dB`} tone="accent" />
            <div style={{ width: 1, height: 28, background: 'var(--border-subtle)' }} />
            <SpecStat label="Level" value={isMuted ? '0%' : `${volume}%`} />
          </div>
        </div>

        <div className="py-8 space-y-6">
          {/* Master fader */}
          <div>
            <Slider
              value={isMuted ? 0 : volume}
              min={0}
              max={maxVolumeLimit}
              onChange={onVolumeChange}
              label="Master volume"
              valueLabel={isMuted ? '-∞ dB' : `${dacConfig.volumeDb} dB · ${volume}%`}
            />
            <div className="flex justify-between mt-2" style={labelMuted}>
              <span>-60 dB (stil)</span>
              <span>-30 dB (achtergrond)</span>
              <span>-12 dB (dynamisch)</span>
              <span style={{ color: 'var(--accent)' }}>0 dB (bit-perfect)</span>
            </div>
          </div>

          {/* Mute + presets */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant={isMuted ? 'danger' : 'secondary'}
              size="sm"
              icon={isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume1 className="w-3.5 h-3.5" />}
              onClick={onToggleMute}
            >
              {isMuted ? 'Gedempt (mute)' : 'Dempen'}
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              {volumePresets.map((preset) => (
                <Button
                  key={preset.val}
                  size="sm"
                  variant={volume === preset.val && !isMuted ? 'primary' : 'secondary'}
                  disabled={preset.val > maxVolumeLimit}
                  onClick={() => onVolumeChange(preset.val)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Max volume safety limit */}
          <div className="p-4 space-y-3" style={panelStyle}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span
                style={{
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Maximaal volume
              </span>
            </div>
            <Slider
              value={maxVolumeLimit}
              min={10}
              max={100}
              onChange={onUpdateMaxVolumeLimit}
              valueLabel={maxVolumeLimit === 100 ? 'Geen limiet' : `${maxVolumeLimit}%`}
            />
            <p style={labelMuted}>
              Begrenst hoe hard het ooit kan — via het volumewiel hierboven, de GPIO-encoder of de API.
              Voorkomt ongewenst harde pieken.
            </p>
          </div>

          {/* Stereo balance */}
          <div className="p-4 space-y-3" style={panelStyle}>
            <Slider
              value={dacConfig.balance}
              min={-50}
              max={50}
              onChange={onBalanceChange}
              label="Stereo balans links / rechts"
              valueLabel={balanceLabel}
            />
            <div className="flex items-center justify-between">
              <span style={labelMuted}>L</span>
              <Button size="sm" variant="ghost" onClick={() => onBalanceChange(0)}>
                Reset
              </Button>
              <span style={labelMuted}>R</span>
            </div>
          </div>
        </div>
      </Card>

      {/* DAC hardware output selector */}
      <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>
                Audio-output & HiFi DAC HAT-selectie
              </h2>
            </div>
            <p className="mt-1" style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
              Selecteer je I2S DAC HAT of USB-audiokaart op de Raspberry Pi (3B+, 4B of 5).
            </p>
          </div>

          <button
            id="btn-test-audio-sweep"
            disabled={isTesting}
            onClick={handleTestSweep}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-body-strong)',
              cursor: isTesting ? 'not-allowed' : 'pointer',
              background: isTesting ? 'rgba(245,158,11,0.14)' : 'var(--accent)',
              color: isTesting ? 'var(--status-warning)' : 'var(--on-accent)',
              border: isTesting ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              transition: 'background var(--duration-fast) var(--ease-standard)',
            }}
          >
            <Zap className="w-4 h-4" />
            <span>{isTesting ? 'Testtoon wordt afgespeeld…' : 'Test audio sweep (1kHz)'}</span>
          </button>
        </div>

        {testToneStatus && (
          <div
            className="flex items-center gap-2 p-3"
            style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-md)' }}
          >
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>{testToneStatus}</span>
          </div>
        )}

        {/* Device cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {audioDevices.map((device) => {
            const isSelected = device.id === dacConfig.activeDeviceId;
            return (
              <div
                key={device.id}
                id={`card-dac-${device.id}`}
                onClick={() => onSwitchAudioDevice(device.id)}
                className="relative flex flex-col justify-between cursor-pointer"
                style={{
                  padding: 20,
                  borderRadius: 'var(--radius-xl)',
                  background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border-subtle)'),
                  boxShadow: 'var(--shadow-card)',
                  transition: 'background var(--duration-base) var(--ease-standard), border-color var(--duration-base)',
                }}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isSelected ? 'var(--accent)' : 'var(--border-strong)',
                          flexShrink: 0,
                        }}
                      />
                      <h3 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>{device.name}</h3>
                    </div>
                    {isSelected && (
                      <div style={{ flexShrink: 0 }}>
                        <Badge variant="accent" mono={false}>
                          Actief
                        </Badge>
                      </div>
                    )}
                  </div>

                  <p className="line-clamp-2 mb-3" style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
                    {device.description}
                  </p>

                  <div className="space-y-1.5 p-3" style={panelStyle}>
                    <div className="flex justify-between" style={{ font: 'var(--text-mono-sm)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Chipset</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{device.chipset}</span>
                    </div>
                    <div className="flex justify-between" style={{ font: 'var(--text-mono-sm)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>ALSA string</span>
                      <span style={{ color: 'var(--accent)' }}>{device.alsaCard}</span>
                    </div>
                    <div className="flex justify-between" style={{ font: 'var(--text-mono-sm)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Max resolutie</span>
                      <span style={{ color: 'var(--status-success)' }}>
                        {device.maxBitDepth}-bit / {Math.max(...device.sampleRates) / 1000} kHz
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="mt-4 pt-3 flex items-center justify-between"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  <span style={labelMuted}>
                    {device.type === 'i2s_dac' ? 'I2S GPIO direct' : device.type === 'usb_dac' ? 'USB UAC2 async' : 'ALSA output'}
                  </span>
                  <Badge variant={isSelected ? 'accent' : 'neutral'} mono={false}>
                    {isSelected ? 'Geselecteerd' : 'Activeer DAC'}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>

        {/* Active driver / clock status */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4" style={panelStyle}>
          <div className="flex items-center gap-2" style={{ font: 'var(--text-mono)', color: 'var(--text-secondary)' }}>
            <Cpu className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span>
              Actieve driver: <strong style={{ color: 'var(--accent)' }}>{activeDevice.dtoverlay}</strong>
            </span>
          </div>

          <div className="flex items-center gap-4" style={{ font: 'var(--text-mono)', color: 'var(--text-secondary)' }}>
            <div className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-success)' }} />
              <span>
                I2S master clock: <strong style={{ color: 'var(--status-success)' }}>vergrendeld (ultra-low jitter)</strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: dacConfig.bitPerfect ? 'var(--accent)' : 'var(--text-muted)',
                }}
              />
              <span>
                Bit-perfect:{' '}
                <strong style={{ color: dacConfig.bitPerfect ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {dacConfig.bitPerfect ? 'ingeschakeld' : 'uit'}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
