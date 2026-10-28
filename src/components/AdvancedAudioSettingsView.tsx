import React, { useState, useEffect } from 'react';
import {
  Check,
  Disc,
  ListMusic,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Waves,
} from 'lucide-react';
import {
  AdvancedAudioSettings,
  DacConfig,
  EqBand,
  EqPreset,
  PlaybackState,
  Playlist,
} from '../types';
import { Badge, Button, Card, Modal, ProgressBar, SpecStat, Slider, Toggle } from './ui';

interface AdvancedAudioSettingsViewProps {
  playback: PlaybackState;
  playlists: Playlist[];
  onApplyPreset: (presetId: string) => Promise<void>;
  onCreatePreset: (preset: Omit<EqPreset, 'id' | 'isCustom'>) => Promise<void>;
  onDeletePreset: (presetId: string) => Promise<void>;
  onUpdateEqualizerBands: (bands: EqBand[], presetId?: string) => Promise<void>;
  onSaveAdvancedSettings: (settings: Partial<AdvancedAudioSettings>) => Promise<void>;
  onSavePlaylistProfile: (playlistId: string, profile: AdvancedAudioSettings) => Promise<void>;
  onClearPlaylistProfile: (playlistId: string) => Promise<void>;
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
};

const labelMuted: React.CSSProperties = {
  font: 'var(--text-mono-sm)',
  color: 'var(--text-muted)',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  font: 'var(--text-body)',
};

const focusField = (e: React.FocusEvent<HTMLElement>) => {
  (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
};
const blurField = (e: React.FocusEvent<HTMLElement>) => {
  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
};

function selectableCardStyle(isSelected: boolean): React.CSSProperties {
  return {
    padding: 20,
    borderRadius: 'var(--radius-xl)',
    background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
    border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border-subtle)'),
    boxShadow: 'var(--shadow-card)',
    cursor: 'pointer',
    transition: 'background var(--duration-base) var(--ease-standard), border-color var(--duration-base)',
  };
}

/** Wraps a control so it visually + functionally disables without touching the shared Slider component. */
const DisableWrap: React.FC<{ disabled: boolean; children: React.ReactNode }> = ({ disabled, children }) => (
  <div style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>{children}</div>
);

export const AdvancedAudioSettingsView: React.FC<AdvancedAudioSettingsViewProps> = ({
  playback,
  playlists,
  onApplyPreset,
  onCreatePreset,
  onDeletePreset,
  onUpdateEqualizerBands,
  onSaveAdvancedSettings,
  onSavePlaylistProfile,
  onClearPlaylistProfile,
}) => {
  const { dacConfig, systemStats } = playback;
  const eq = dacConfig.dspEqualizer;
  const currentAdvanced = dacConfig.advancedAudio || {
    eqPresetId: 'audiophile_direct',
    crossfadeEnabled: true,
    crossfadeDurationSec: 4,
    crossfadeCurve: 's_curve',
    gaplessPlayback: true,
    gaplessBufferPreloadMs: 500,
    resamplingQuality: 'disabled',
    ditherMode: 'tpdf',
    profileScope: 'global',
    targetSampleRate: 44100,
  };

  const [presets, setPresets] = useState<EqPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>(
    eq.activePresetId || currentAdvanced.eqPresetId || 'audiophile_direct'
  );
  const [bands, setBands] = useState<EqBand[]>(eq.bands);
  const [crossfadeEnabled, setCrossfadeEnabled] = useState<boolean>(currentAdvanced.crossfadeEnabled);
  const [crossfadeDuration, setCrossfadeDuration] = useState<number>(currentAdvanced.crossfadeDurationSec);
  const [crossfadeCurve, setCrossfadeCurve] = useState<'linear' | 'equal_power' | 's_curve'>(
    currentAdvanced.crossfadeCurve
  );
  const [gaplessPlayback, setGaplessPlayback] = useState<boolean>(currentAdvanced.gaplessPlayback);
  const [gaplessBufferMs, setGaplessBufferMs] = useState<number>(currentAdvanced.gaplessBufferPreloadMs);
  const [resamplingQuality, setResamplingQuality] = useState<string>(currentAdvanced.resamplingQuality);
  const [ditherMode, setDitherMode] = useState<'none' | 'tpdf' | 'shaped'>(currentAdvanced.ditherMode);
  const [profileScope, setProfileScope] = useState<'global' | 'playlist_specific'>(
    currentAdvanced.profileScope || 'global'
  );
  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(
    currentAdvanced.associatedPlaylistId || playback.currentPlaylistId || (playlists[0]?.id || '')
  );

  // New preset modal state
  const [isNewPresetModalOpen, setIsNewPresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetCategory, setNewPresetCategory] = useState<'Audiophile' | 'Genre' | 'Akoestiek' | 'Custom'>('Audiophile');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Fetch all EQ presets from REST API
  useEffect(() => {
    fetch('/api/audio/eq-presets')
      .then((r) => r.json())
      .then((data) => {
        if (data.presets) {
          setPresets(data.presets);
          if (data.activePresetId) {
            setActivePresetId(data.activePresetId);
          }
        }
      })
      .catch((err) => console.warn('Could not load EQ presets:', err));
  }, []);

  // Sync state with incoming props
  useEffect(() => {
    if (eq.bands) {
      setBands(eq.bands);
    }
    if (eq.activePresetId) {
      setActivePresetId(eq.activePresetId);
    }
  }, [eq]);

  const handlePresetSelect = async (preset: EqPreset) => {
    setActivePresetId(preset.id);
    setBands([...preset.bands]);
    await onApplyPreset(preset.id);
    setSaveSuccessMsg(`Preset '${preset.name}' direct toegepast op DAC DSP`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleBandSlider = (idx: number, gain: number) => {
    const updated = bands.map((b, i) => (i === idx ? { ...b, gain } : b));
    setBands(updated);
    onUpdateEqualizerBands(updated, activePresetId);
  };

  const handleResetFlat = () => {
    const flatBands = bands.map((b) => ({ ...b, gain: 0 }));
    setBands(flatBands);
    onUpdateEqualizerBands(flatBands, 'flat_custom');
  };

  const handleSaveNewPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    await onCreatePreset({
      name: newPresetName.trim(),
      category: newPresetCategory,
      description: newPresetDesc.trim() || 'Aangepaste equalizer instelling',
      bands: [...bands],
    });

    // Refresh presets list
    const updatedRes = await fetch('/api/audio/eq-presets').then((r) => r.json());
    if (updatedRes.presets) {
      setPresets(updatedRes.presets);
      const created = updatedRes.presets[updatedRes.presets.length - 1];
      if (created) {
        setActivePresetId(created.id);
      }
    }

    setNewPresetName('');
    setNewPresetDesc('');
    setIsNewPresetModalOpen(false);
    setSaveSuccessMsg('Nieuwe EQ preset succesvol opgeslagen');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleDeletePreset = async (id: string, name: string) => {
    if (confirm(`Weet je zeker dat je preset '${name}' wilt verwijderen?`)) {
      await onDeletePreset(id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
      if (activePresetId === id) {
        setActivePresetId('audiophile_direct');
      }
      setSaveSuccessMsg(`Preset '${name}' verwijderd`);
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleSaveAudioConfiguration = async () => {
    const newSettings: AdvancedAudioSettings = {
      eqPresetId: activePresetId,
      crossfadeEnabled,
      crossfadeDurationSec: crossfadeDuration,
      crossfadeCurve,
      gaplessPlayback,
      gaplessBufferPreloadMs: gaplessBufferMs,
      resamplingQuality: resamplingQuality as any,
      ditherMode,
      profileScope,
      associatedPlaylistId: profileScope === 'playlist_specific' ? targetPlaylistId : undefined,
      targetSampleRate: 44100,
    };

    if (profileScope === 'playlist_specific' && targetPlaylistId) {
      await onSavePlaylistProfile(targetPlaylistId, newSettings);
      const pl = playlists.find((p) => p.id === targetPlaylistId);
      setSaveSuccessMsg(`Audio profiel succesvol opgeslagen voor afspeellijst '${pl?.name || targetPlaylistId}'`);
    } else {
      await onSaveAdvancedSettings(newSettings);
      setSaveSuccessMsg('Globale audio-instellingen succesvol opgeslagen op Raspberry Pi DAC');
    }

    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0];

  const curveOptions: { id: 'linear' | 'equal_power' | 's_curve'; name: string; desc: string }[] = [
    { id: 's_curve', name: 'S-curve', desc: 'Natuurlijk & gebalanceerd' },
    { id: 'equal_power', name: 'Equal power (-3dB)', desc: 'Constant waargenomen volume' },
    { id: 'linear', name: 'Lineair', desc: 'Gelijkmatige demping' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>
                Equalizer
              </h2>
            </div>
            <p className="mt-1" style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
              Configureer de 10-bands equalizer presets, crossfade-overgangen, gapless buffering en koppel
              audio-profielen per afspeellijst.
            </p>
          </div>

          <Button size="sm" icon={<Save className="w-3.5 h-3.5" />} onClick={handleSaveAudioConfiguration}>
            Instellingen toepassen & opslaan
          </Button>
        </div>

        {saveSuccessMsg && (
          <div
            className="flex items-center gap-2 p-3.5"
            style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 'var(--radius-md)' }}
          >
            <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--status-success)' }} />
            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--status-success)' }}>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Status pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3" style={panelStyle}>
            <SpecStat
              label="Actief profiel"
              value={playback.activeProfileName || (profileScope === 'global' ? 'Globaal profiel' : 'Playlist specifiek')}
              tone="accent"
            />
          </div>
          <div className="p-3" style={panelStyle}>
            <SpecStat label="Equalizer preset" value={activePreset?.name || 'Audiophile reference direct'} />
          </div>
          <div className="p-3" style={panelStyle}>
            <SpecStat
              label="Crossfade overgang"
              value={crossfadeEnabled ? `${crossfadeDuration}s (${crossfadeCurve})` : 'Uitgeschakeld'}
              tone="status-success"
            />
          </div>
          <div className="p-3" style={panelStyle}>
            <SpecStat
              label="Gapless playback"
              value={gaplessPlayback ? `0ms naadloos (${gaplessBufferMs}ms buffer)` : 'Uitgeschakeld'}
              tone="accent"
            />
          </div>
        </div>
      </Card>

      {/* SECTION 1: 10-band DSP equalizer */}
      <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>
                10-bands hardware DSP equalizer & presets
              </h3>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
                Directe 64-bit I2S PCM toonregeling zonder kwaliteitsverlies
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={handleResetFlat}>
              Reset lineair (0dB)
            </Button>
            <Button
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setIsNewPresetModalOpen(true)}
            >
              Opslaan als preset
            </Button>
          </div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <label style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Selecteer EQ preset voor I2S DAC
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {presets.map((preset) => {
              const isSelected = preset.id === activePresetId;
              return (
                <div
                  key={preset.id}
                  id={`preset-card-${preset.id}`}
                  onClick={() => handlePresetSelect(preset)}
                  className="flex flex-col justify-between"
                  style={selectableCardStyle(isSelected)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <Badge variant="neutral" mono={false}>
                      {preset.category || 'Preset'}
                    </Badge>
                    {preset.isCustom && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePreset(preset.id, preset.name);
                        }}
                        title="Verwijder custom preset"
                        style={{ color: 'var(--text-muted)', padding: 4, transition: 'color var(--duration-fast)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--status-danger)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="my-2">
                    <h4 style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>{preset.name}</h4>
                    <p className="line-clamp-2 mt-0.5" style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
                      {preset.description}
                    </p>
                  </div>

                  <div
                    className="flex items-center justify-between pt-1"
                    style={{ ...labelMuted, borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <span>10 banden</span>
                    {isSelected && <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>● actief</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Vertical EQ sliders */}
        <div className="p-6 space-y-4" style={{ ...panelStyle, borderRadius: 'var(--radius-xl)' }}>
          <div className="flex justify-between items-center" style={labelMuted}>
            <span>Frequentierespons curve (+12 dB tot -12 dB)</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Hardware DAC-filters: actief</span>
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 sm:gap-4 h-64 items-center">
            {bands.map((band, idx) => {
              const freqLabel = band.freq >= 1000 ? `${band.freq / 1000}k` : `${band.freq}`;
              const gainColor = band.gain > 0 ? 'var(--accent)' : band.gain < 0 ? 'var(--status-warning)' : 'var(--text-muted)';
              return (
                <div key={band.freq} className="flex flex-col items-center justify-between h-full">
                  <span style={{ font: 'var(--text-mono-sm)', fontWeight: 600, color: gainColor }}>
                    {band.gain > 0 ? `+${band.gain}` : `${band.gain}`} dB
                  </span>

                  <div className="relative h-40 flex items-center justify-center my-2">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={band.gain}
                      onChange={(e) => handleBandSlider(idx, Number(e.target.value))}
                      style={{
                        height: 144,
                        width: 4,
                        appearance: 'none',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-full)',
                        cursor: 'pointer',
                        accentColor: 'var(--accent)',
                        writingMode: 'vertical-lr' as any,
                        WebkitAppearance: 'slider-vertical' as any,
                      }}
                    />
                  </div>

                  <div className="text-center">
                    <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', display: 'block' }}>
                      {freqLabel}
                    </span>
                    <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Hz</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* SECTION 2: crossfade & gapless */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Crossfade */}
        <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="flex items-center justify-between pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2.5">
              <Waves className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <div>
                <h3 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Crossfade tussen nummers</h3>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>Vloeiende overgang tussen opeenvolgende tracks</p>
              </div>
            </div>
            <Toggle checked={crossfadeEnabled} onChange={setCrossfadeEnabled} />
          </div>

          <div className="space-y-4">
            <DisableWrap disabled={!crossfadeEnabled}>
              <Slider
                value={crossfadeDuration}
                min={1}
                max={12}
                onChange={setCrossfadeDuration}
                label="Overgangsduur"
                valueLabel={`${crossfadeDuration} seconden`}
              />
              <div className="flex justify-between mt-2" style={labelMuted}>
                <span>1s (snel)</span>
                <span>4s (standaard HiFi)</span>
                <span>8s (lounge)</span>
                <span>12s (max DJ)</span>
              </div>
            </DisableWrap>

            <div className="space-y-2">
              <label style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Fading curve karakteristiek
              </label>
              <div className="grid grid-cols-2 gap-2">
                {curveOptions.map((c) => {
                  const isActive = crossfadeCurve === c.id;
                  return (
                    <button
                      key={c.id}
                      disabled={!crossfadeEnabled}
                      onClick={() => setCrossfadeCurve(c.id)}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        borderRadius: 'var(--radius-md)',
                        background: isActive ? 'var(--accent-soft)' : 'var(--bg-inset)',
                        border: '1px solid ' + (isActive ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: crossfadeEnabled ? 'pointer' : 'not-allowed',
                        opacity: crossfadeEnabled ? 1 : 0.4,
                        transition: 'all var(--duration-fast) var(--ease-standard)',
                      }}
                    >
                      <span style={{ font: 'var(--text-body-strong)', display: 'block', color: isActive ? 'var(--accent)' : 'var(--text-primary)' }}>
                        {c.name}
                      </span>
                      <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{c.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {systemStats.crossfadeActive && (
              <div className="p-3 space-y-1.5" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-md)' }}>
                <ProgressBar pct={systemStats.crossfadeProgressPct} label="Crossfade nu actief" />
              </div>
            )}
          </div>
        </Card>

        {/* Gapless */}
        <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="flex items-center justify-between pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2.5">
              <Disc className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <div>
                <h3 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Gapless playback (naadloze weergave)</h3>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>Verwijdert pauzes tussen opeenvolgende albumtracks</p>
              </div>
            </div>
            <Toggle checked={gaplessPlayback} onChange={setGaplessPlayback} />
          </div>

          <div className="space-y-4">
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Gapless playback preload de audio-bitstream van het volgende nummer in een ringbuffer op de Raspberry
              Pi. Hierdoor vloeien live albums, klassieke composities en opera&rsquo;s zonder ALSA
              herinitialisatie-klikken of buffer-underruns in elkaar over.
            </p>

            <DisableWrap disabled={!gaplessPlayback}>
              <Slider
                value={gaplessBufferMs}
                min={100}
                max={1500}
                onChange={setGaplessBufferMs}
                label="Buffer preload duur"
                valueLabel={`${gaplessBufferMs} ms`}
              />
              <div className="flex justify-between mt-2" style={labelMuted}>
                <span>100ms (direct)</span>
                <span>500ms (aanbevolen)</span>
                <span>1500ms (high pre-fetch)</span>
              </div>
            </DisableWrap>

            <div className="space-y-2 pt-2">
              <label style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                ALSA dither & quantization mode
              </label>
              <select
                value={ditherMode}
                onChange={(e) => setDitherMode(e.target.value as any)}
                onFocus={focusField}
                onBlur={blurField}
                style={{ ...fieldStyle, font: 'var(--text-mono-sm)' }}
              >
                <option value="tpdf">TPDF (triangular probability density — audiophile standaard)</option>
                <option value="shaped">Noise shaping (psychoakoestisch gemaskeerd ruisspectrum)</option>
                <option value="none">Geen dither (directe truncatie)</option>
              </select>
            </div>
          </div>
        </Card>
      </div>

      {/* SECTION 3: profile scope */}
      <Card padding={28} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Audio-profiel opslag & toewijzing</h3>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
                Kies of deze EQ- en overgangsinstellingen globaal gelden of automatisch laden bij een specifieke
                afspeellijst
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            onClick={() => setProfileScope('global')}
            className="space-y-3"
            style={selectableCardStyle(profileScope === 'global')}
          >
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2" style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>
                <Radio className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                Globaal systeemprofiel
              </h4>
              {profileScope === 'global' && <Check className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
            </div>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Deze EQ-curve, crossfade-tijd en bufferwaarden gelden standaard voor alle Spotify-tracks, externe
              streams en wachtrij-nummers.
            </p>
          </div>

          <div
            onClick={() => setProfileScope('playlist_specific')}
            className="space-y-3"
            style={selectableCardStyle(profileScope === 'playlist_specific')}
          >
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2" style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>
                <ListMusic className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                Opslaan per afspeellijst
              </h4>
              {profileScope === 'playlist_specific' && <Check className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
            </div>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Koppel dit audio-profiel aan een geselecteerde afspeellijst. Zodra je die afspeellijst start, schakelt
              de I2S DAC direct over naar deze instellingen.
            </p>

            {profileScope === 'playlist_specific' && (
              <div className="pt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                <label style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--accent)' }}>
                  Selecteer doel-afspeellijst
                </label>
                <select
                  value={targetPlaylistId}
                  onChange={(e) => setTargetPlaylistId(e.target.value)}
                  onFocus={focusField}
                  onBlur={blurField}
                  style={{ ...fieldStyle, font: 'var(--text-mono-sm)', background: 'var(--bg-card)' }}
                >
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({pl.trackCount} nummers)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Modal: save custom EQ preset */}
      <Modal
        open={isNewPresetModalOpen}
        onClose={() => setIsNewPresetModalOpen(false)}
        icon={<Plus className="w-5 h-5" />}
        title="Nieuwe EQ preset maken"
        subtitle="Sla de huidige 10-bands equalizer curve op als een herbruikbare preset voor de HiFi DAC."
      >
        <form onSubmit={handleSaveNewPreset} className="space-y-4">
          <div>
            <label className="block mb-1" style={labelMuted}>Preset naam *</label>
            <input
              type="text"
              required
              placeholder="bijv. Jazz Lounge & Vinyl Warmth"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onFocus={focusField}
              onBlur={blurField}
              style={fieldStyle}
            />
          </div>

          <div>
            <label className="block mb-1" style={labelMuted}>Categorie</label>
            <select
              value={newPresetCategory}
              onChange={(e) => setNewPresetCategory(e.target.value as 'Audiophile' | 'Genre' | 'Akoestiek' | 'Custom')}
              onFocus={focusField}
              onBlur={blurField}
              style={{ ...fieldStyle, font: 'var(--text-mono-sm)' }}
            >
              <option value="Audiophile">Audiophile</option>
              <option value="Akoestiek">Akoestiek & ruimte</option>
              <option value="Genre">Muziekgenre</option>
              <option value="Custom">Custom / persoonlijk</option>
            </select>
          </div>

          <div>
            <label className="block mb-1" style={labelMuted}>Beschrijving</label>
            <textarea
              placeholder="Beschrijf de klankkleur..."
              value={newPresetDesc}
              onChange={(e) => setNewPresetDesc(e.target.value)}
              onFocus={focusField}
              onBlur={blurField}
              style={{ ...fieldStyle, height: 80, resize: 'none' }}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsNewPresetModalOpen(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 12px',
                font: 'var(--text-label)',
                letterSpacing: 'var(--letter-label)',
                textTransform: 'uppercase',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid transparent',
              }}
            >
              Annuleren
            </button>
            <Button size="sm">Preset opslaan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
