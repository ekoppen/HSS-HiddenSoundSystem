import React from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  Cpu,
  Radio,
  Sliders,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Zap,
} from 'lucide-react';
import { DacConfig, PlaybackState } from '../types';

interface DacHardwareManagerProps {
  playback: PlaybackState;
  onUpdateDacConfig: (config: Partial<DacConfig>) => void;
  onUpdateEqualizer: (enabled: boolean, bands: { freq: number; gain: number }[]) => void;
}

export const DacHardwareManager: React.FC<DacHardwareManagerProps> = ({
  playback,
  onUpdateDacConfig,
  onUpdateEqualizer,
}) => {
  const { dacConfig } = playback;
  const eq = dacConfig.dspEqualizer;

  const presets = [
    { name: 'Flat (Studio Direct)', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Audiophile Warmth', gains: [2, 3, 2, 1, 0, 0, 1, 2, 2, 1] },
    { name: 'Acoustic & Classical', gains: [1, 1, 0, 0, 1, 2, 2, 3, 2, 1] },
    { name: 'Deep Sub-Bass', gains: [5, 4, 3, 1, 0, -1, -1, 0, 1, 1] },
    { name: 'Vocal Clarity', gains: [-1, -1, 0, 1, 3, 3, 2, 1, 1, 0] },
  ];

  const handleBandChange = (index: number, newGain: number) => {
    const updatedBands = eq.bands.map((b, i) => (i === index ? { ...b, gain: newGain } : b));
    onUpdateEqualizer(eq.enabled, updatedBands);
  };

  const handlePresetApply = (gains: number[]) => {
    const updatedBands = eq.bands.map((b, i) => ({ ...b, gain: gains[i] || 0 }));
    onUpdateEqualizer(true, updatedBands);
  };

  return (
    <div className="space-y-6">
      {/* 10-Band HiFi DSP Equalizer */}
      <div className="bg-[#0a0a0f] border border-white/5 rounded-3xl p-6 lg:p-8 shadow-2xl backdrop-blur-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                10-Band DSP Parametrische HiFi Equalizer
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Realtime 64-bit floating point hardware audio correctie voor I2S DACs & luidsprekerakoestiek
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="btn-toggle-eq"
              onClick={() => onUpdateEqualizer(!eq.enabled, eq.bands)}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all ${
                eq.enabled
                  ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.35)]'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              {eq.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
              <span>{eq.enabled ? 'EQUALIZER AAN' : 'EQUALIZER UIT'}</span>
            </button>
          </div>
        </div>

        {/* EQ Presets Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-slate-400 mr-2">Presets:</span>
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => handlePresetApply(preset.gains)}
              className="px-3 py-1.5 rounded-xl text-xs font-mono bg-white/[0.02] hover:bg-white/[0.06] text-slate-300 border border-white/5 hover:border-white/15 transition-all"
            >
              {preset.name}
            </button>
          ))}
        </div>

        {/* Vertical Equalizer Sliders Strip */}
        <div className="p-6 bg-white/[0.02] rounded-3xl border border-white/5">
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-3 sm:gap-4 h-64 items-center">
            {eq.bands.map((band, idx) => {
              const freqLabel = band.freq >= 1000 ? `${band.freq / 1000}k` : `${band.freq}`;
              return (
                <div key={band.freq} className="flex flex-col items-center justify-between h-full group">
                  <span className="text-[11px] font-mono font-bold text-indigo-400">
                    {band.gain > 0 ? `+${band.gain}` : `${band.gain}`} dB
                  </span>

                  {/* Vertical Slider */}
                  <div className="relative h-40 flex items-center justify-center my-2">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={band.gain}
                      disabled={!eq.enabled}
                      onChange={(e) => handleBandChange(idx, Number(e.target.value))}
                      className="h-36 w-2 appearance-none bg-white/10 rounded-lg cursor-pointer accent-indigo-500 [writing-mode:bt-lr] [-webkit-appearance:slider-vertical]"
                    />
                  </div>

                  <div className="text-center">
                    <span className="text-xs font-mono font-semibold text-slate-300 block">
                      {freqLabel}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Hz</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Audiophile DAC Streaming & Timing Settings */}
      <div className="bg-[#0a0a0f] border border-white/5 rounded-3xl p-6 lg:p-8 shadow-2xl backdrop-blur-2xl space-y-6">
        <div className="pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl font-bold text-white tracking-tight">
              I2S Klok, Buffering & Bit-Perfect ALSA Parameters
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fijnafstelling van de audiopijplijn op Raspberry Pi OS voor zero-jitter streaming
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Bit-Perfect Direct Stream Toggle */}
          <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white font-mono">Bit-Perfect Direct Output</h4>
              <button
                onClick={() => onUpdateDacConfig({ bitPerfect: !dacConfig.bitPerfect })}
                className={`p-1 rounded-lg transition-colors ${
                  dacConfig.bitPerfect ? 'text-indigo-400' : 'text-slate-600'
                }`}
              >
                {dacConfig.bitPerfect ? (
                  <ToggleRight className="w-7 h-7" />
                ) : (
                  <ToggleLeft className="w-7 h-7" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Omzeilt PulseAudio/PipeWire software resampling. De audio streams gaan rechtstreeks in 16/24-bit PCM naar de I2S DAC registers via ALSA DMA.
            </p>
          </div>

          {/* I2S Master Clock Mode */}
          <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
            <h4 className="text-sm font-bold text-white font-mono">I2S Clock Sync Modus</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onUpdateDacConfig({ clockSyncMode: 'ultra_low_jitter' })}
                className={`px-3 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
                  dacConfig.clockSyncMode === 'ultra_low_jitter'
                    ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.35)]'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                }`}
              >
                Dual Ultra-Low Jitter Clocks
              </button>
              <button
                onClick={() => onUpdateDacConfig({ clockSyncMode: 'slave' })}
                className={`px-3 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
                  dacConfig.clockSyncMode === 'slave'
                    ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.35)]'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                }`}
              >
                Pi PLL Slave Mode
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              {dacConfig.clockSyncMode === 'ultra_low_jitter'
                ? 'Gebruikt de kristallen oscillators op de DAC HAT voor exacte 44.1kHz en 48kHz klokvermenigvuldiging.'
                : 'Gebruikt de Raspberry Pi SoC klokgenerator (kan lichte jitter introduceren).'}
            </p>
          </div>

          {/* ALSA Buffer Size */}
          <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-bold text-white font-mono">ALSA Buffer Duur (ms)</h4>
              <span className="text-xs font-mono font-bold text-indigo-400">
                {dacConfig.bufferTimeMs} ms
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="500"
              step="25"
              value={dacConfig.bufferTimeMs}
              onChange={(e) => onUpdateDacConfig({ bufferTimeMs: Number(e.target.value) })}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>50ms (Ultra Low Latency)</span>
              <span>150ms (Optimaal)</span>
              <span>500ms (Max stabiliteit)</span>
            </div>
          </div>

          {/* Resampling Quality */}
          <div className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
            <h4 className="text-sm font-bold text-white font-mono">libsoxr Resampler Kwaliteit</h4>
            <select
              value={dacConfig.resamplingQuality}
              onChange={(e) => onUpdateDacConfig({ resamplingQuality: e.target.value as any })}
              className="w-full px-3.5 py-2.5 bg-white/[0.02] border border-white/10 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="disabled">Uitgeschakeld (Native Stream Sample Rate)</option>
              <option value="soxr_high">SoX Resampler High Quality (HQ)</option>
              <option value="soxr_veryhigh">SoX Resampler Very High Quality (VHQ)</option>
            </select>
            <p className="text-[11px] text-slate-400">
              Indien ingeschakeld, worden alle Spotify 44.1kHz streams geüpsampled met lineaire fasefilters.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
