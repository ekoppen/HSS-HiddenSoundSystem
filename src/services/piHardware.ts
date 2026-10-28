import fs from 'fs';
import { exec, execFile, execFileSync, execSync } from 'child_process';
import { AudioDevice, PlaybackState, SystemStats, Track } from '../types.ts';
import { clearHealthIssue, reportHealthIssue } from './healthLog.ts';

/**
 * Raspberry Pi Hardware & ALSA Bridge
 * Interacts with physical ALSA soundcards, HiFiBerry DAC mixers, system sensors,
 * and the librespot Spotify Connect daemon.
 */

/** Synthesizes a short two-note ascending chime (C5 → G5) as a 16-bit PCM WAV buffer —
 * no bundled audio asset needed, it's generated on the fly and played on the Pi's own DAC at boot. */
function generateStartupChimeWav(): Buffer {
  const sampleRate = 44100;
  const notes = [
    { freq: 523.25, durationMs: 180 },
    { freq: 783.99, durationMs: 260 },
  ];
  const samples: number[] = [];
  for (const { freq, durationMs } of notes) {
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const fadeSamples = Math.floor(sampleRate * 0.01);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(i / fadeSamples, (numSamples - i) / fadeSamples, 1);
      samples.push(Math.round(Math.sin(2 * Math.PI * freq * t) * envelope * 0.5 * 32767));
    }
  }

  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((s, i) => buffer.writeInt16LE(s, 44 + i * 2));
  return buffer;
}

export interface CardDetectionResult {
  cardIndex: number | null;
  alsaDetectedCards: string[];
  hasHifiberry: boolean;
}

/**
 * Pure parse of `/proc/asound/cards` content — no fs/exec, so this is
 * directly unit-testable without real hardware. Extracted after two real
 * bugs here: hardcoding card 0 broke on a Pi 5 (dual HDMI enumerates as
 * cards 0/1 before a real DAC HAT), and the first fix ("skip HDMI, take
 * the last remaining card") then broke on production because a USB
 * webcam's mic also shows up as a non-HDMI card. Prefers a name matching
 * a known DAC family; only falls back to "first non-HDMI, non-camera
 * card" for an unrecognized/plain USB DAC, where no better signal exists.
 */
export function detectAudioCardIndex(cardsContent: string): CardDetectionResult {
  const lines = cardsContent.split('\n');
  const dacKeywords = ['hifiberry', 'snd_rpi_hifiberry', 'bossdac', 'allo', 'iqaudio', 'justboom'];
  const alsaDetectedCards: string[] = [];
  let hasHifiberry = false;
  let matchedIndex: number | null = null;
  let fallbackIndex: number | null = null;
  for (const line of lines) {
    const indexMatch = line.match(/^\s*(\d+)\s+\[/);
    if (indexMatch) {
      alsaDetectedCards.push(line.trim());
      const lower = line.toLowerCase();
      if (lower.includes('hifiberry') || lower.includes('snd_rpi_hifiberry')) {
        hasHifiberry = true;
      }
      const index = parseInt(indexMatch[1], 10);
      if (dacKeywords.some((k) => lower.includes(k))) {
        matchedIndex = index;
      } else if (fallbackIndex === null && !lower.includes('hdmi') && !lower.includes('camera')) {
        fallbackIndex = index;
      }
    }
  }
  return { cardIndex: matchedIndex ?? fallbackIndex, alsaDetectedCards, hasHifiberry };
}

const MAX_BALANCE_ATTEN_DB = 24;

/**
 * Pure balance math — no exec, unit-testable. Expressed as a dB
 * attenuation on the quiet-side channel, not a raw percentage scale-down:
 * confirmed live (real HiFiBerry DAC+, 'Digital' control) that amixer's
 * percentage isn't remotely amplitude-linear (80% measured -20.5dB, 50%
 * measured -51.5dB, 30% measured -72.5dB — roughly -1dB per percentage
 * point). A percentage-based balance formula was cutting dozens of dB for
 * a modest slider nudge — reported live as one channel going essentially
 * silent immediately. `leftStep`/`rightStep` are amixer's relative
 * per-channel dB syntax (`sset "Digital" 0dB-,6dB-` — verified live, drops
 * only the second channel by exactly 6.00dB).
 */
/** Same -60..0dB curve state.ts's UI display uses, single-sourced here so
 * setHardwareVolume below sends the mixer the exact dB value the "X% · YdB"
 * label promises, instead of a raw percentage. */
export function calculateVolumeDb(volume: number): number {
  if (volume <= 0) return -60;
  return Number((-60 * (1 - volume / 100)).toFixed(1));
}

/** Inverse of calculateVolumeDb: reads the mixer's dB back as the app's own
 * 0-100 scale. Needed because the app never knew what the hardware was
 * actually set to — playbackState.volume simply started at a hardcoded 78
 * on every boot, so after a restart the app claimed a level the amplifier
 * had never been given, and could even claim one above the configured
 * "Maximaal volume". The mixer itself is the durable store here (alsactl
 * restores it across reboots), so reading it beats inventing a number. */
export function volumePctFromDb(volumeDb: number): number {
  if (!Number.isFinite(volumeDb)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 + volumeDb / 60))));
}

/** Pulls the dB value out of `amixer sget` output, e.g. the line
 * "  Front Left: Playback 135 [65%] [-36.00dB] [on]". The bracketed percent
 * on that same line is deliberately NOT used: it is the mixer's own raw,
 * non-linear scale, while this app speaks dB throughout (see
 * calculateVolumeDb) — mixing the two is what made "70%" nearly inaudible
 * once before. */
export function parseMixerDb(amixerOutput: string): number | null {
  const match = amixerOutput.match(/\[(-?\d+(?:\.\d+)?)dB\]/);
  if (!match) return null;
  const db = Number(match[1]);
  return Number.isFinite(db) ? db : null;
}

export function computeBalanceSteps(balancePct: number): { attenDb: number; leftStep: string; rightStep: string } {
  const balance = Math.max(-50, Math.min(50, balancePct));
  const attenDb = Math.round((Math.abs(balance) / 50) * MAX_BALANCE_ATTEN_DB);
  return {
    attenDb,
    leftStep: balance > 0 ? `${attenDb}dB-` : '0dB-',
    rightStep: balance < 0 ? `${attenDb}dB-` : '0dB-',
  };
}

/**
 * Pure EQ band math — no exec, unit-testable. alsaequal exposes each band
 * as a 0-100 INTEGER control with no documented dB curve; 66 is the
 * confirmed-live "flat" default (uniform across all 10 bands on a fresh
 * install), and 2 raw units/dB is a conservative slope so this app's full
 * ±12dB range (-12*2=-24, +12*2=+24) stays inside 0-100 around that
 * anchor without ever clipping.
 */
export function computeEqRawValue(gainDb: number, enabled: boolean): number {
  const effectiveGain = enabled ? gainDb : 0;
  return Math.max(0, Math.min(100, Math.round(66 + effectiveGain * 2)));
}

export interface RealPiStatus {
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

export class PiHardwareService {
  private isLinux: boolean = process.platform === 'linux';
  private detectedMixer: string | null = null;
  private cardIndex: number = 0;
  private lastKnownTrack: Track | null = null;
  private isSpotifyActive: boolean = false;

  constructor() {
    this.detectHardware();
  }

  public detectHardware(): RealPiStatus {
    const isLinux = process.platform === 'linux';
    let model = 'Development Environment (Emulated Pi 4B)';
    let isRaspberryPi = false;
    const alsaDetectedCards: string[] = [];
    let hasHifiberry = false;
    let eqPluginWorking = true;
    let kernel = 'Darwin / Local OS';

    if (isLinux) {
      // 1. Detect Raspberry Pi Model
      try {
        if (fs.existsSync('/proc/device-tree/model')) {
          model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
          isRaspberryPi = true;
        } else if (fs.existsSync('/sys/firmware/devicetree/base/model')) {
          model = fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf8').replace(/\0/g, '').trim();
          isRaspberryPi = true;
        }
      } catch (e) {
        // Not a direct Pi device tree
      }

      // 2. Detect Kernel
      try {
        kernel = execSync('uname -r', { encoding: 'utf8' }).trim();
      } catch (e) {
        kernel = 'Linux (ALSA Generic)';
      }

      // 3. Detect ALSA Soundcards — which card index amixer should
      // address. See detectAudioCardIndex's own comment for why this isn't
      // a simple "card 0" or "skip HDMI" heuristic.
      try {
        if (fs.existsSync('/proc/asound/cards')) {
          const cardsContent = fs.readFileSync('/proc/asound/cards', 'utf8');
          const detected = detectAudioCardIndex(cardsContent);
          alsaDetectedCards.push(...detected.alsaDetectedCards);
          hasHifiberry = detected.hasHifiberry;
          if (detected.cardIndex !== null) {
            this.cardIndex = detected.cardIndex;
          }
        }
      } catch (e) {
        console.warn('[PiHardware] Error reading /proc/asound/cards:', e);
      }

      // 4. Detect Mixer Control for HiFiBerry DAC
      this.detectAlsaMixer();

      // 5. Confirm the alsaequal EQ plugin is actually reachable
      eqPluginWorking = this.checkEqPlugin();
    }

    const librespotRunning = this.checkLibrespotRunning();

    return {
      isLinux,
      isRaspberryPi,
      model,
      kernel,
      alsaDetectedCards,
      hasHifiberry,
      mixerControlFound: this.detectedMixer,
      eqPluginWorking,
      librespotRunning,
    };
  }

  private detectAlsaMixer() {
    if (!this.isLinux) return;
    const potentialMixers = ['Digital', 'Master', 'Playback', 'PCM', 'Analogue', 'Headphone', 'SoloistMaster'];
    for (const mixer of potentialMixers) {
      try {
        // -c this.cardIndex, never the bare/default-resolved form — on a Pi
        // with the DAC on any card other than 0 (see cardIndex's detection
        // above), `amixer sget "<mixer>"` without an explicit card fails
        // outright ("Mixer default load error"), so this would never find
        // a real mixer at all on that hardware.
        const output = execSync(`amixer -c ${this.cardIndex} sget "${mixer}" 2>/dev/null`, { encoding: 'utf8' });
        if (output && output.includes('Limits:')) {
          this.detectedMixer = mixer;
          console.log(`[PiHardware] Found active ALSA hardware mixer: '${mixer}' on card ${this.cardIndex}`);
          clearHealthIssue('alsa-mixer-not-found');
          return;
        }
      } catch (e) {
        // Mixer not present, try next
      }
    }
    // None of the common names matched on this card at all — volume,
    // balance and hardware mute all quietly no-op from here on, with
    // nothing in the UI ever hinting why. Previously this whole outcome
    // was invisible; only ever discoverable in journalctl.
    reportHealthIssue(
      'alsa-mixer-not-found',
      'hardware',
      'error',
      `Geen ALSA hardware-mixer gevonden op kaart ${this.cardIndex} — volume, balans en dempen werken mogelijk niet.`,
    );
  }

  /** Active check — alsaequal's control set only exists if the plugin is
   * both installed (libasound2-plugin-equal) and correctly wired into
   * /etc/asound.conf's `eqbase` device. Neither ever failed loudly before:
   * every `amixer -D eqbase ...` call in setHardwareEqualizer below is
   * fire-and-forget with 2>/dev/null, so a missing/misconfigured plugin
   * meant the EQ sliders moved in the UI while doing precisely nothing. */
  private checkEqPlugin(): boolean {
    if (!this.isLinux) return true;
    try {
      const output = execSync('amixer -D eqbase controls 2>/dev/null', { encoding: 'utf8' });
      const working = output.includes('Hz');
      if (working) {
        clearHealthIssue('eq-plugin-missing');
      } else {
        reportHealthIssue(
          'eq-plugin-missing',
          'hardware',
          'error',
          "Alsaequal-EQ-plugin niet gevonden ('eqbase' geeft geen band-controls terug) — de equalizer heeft geen effect.",
        );
      }
      return working;
    } catch (e) {
      reportHealthIssue(
        'eq-plugin-missing',
        'hardware',
        'error',
        "Alsaequal-EQ-plugin niet bereikbaar (amixer -D eqbase faalt) — controleer libasound2-plugin-equal en /etc/asound.conf.",
      );
      return false;
    }
  }

  public checkLibrespotRunning(): boolean {
    if (!this.isLinux) return false;
    try {
      const pgrep = execSync('pgrep -x librespot || pgrep -x raspotify || true', { encoding: 'utf8' }).trim();
      return pgrep.length > 0;
    } catch {
      return false;
    }
  }

  public readRealTelemetry(currentStats: SystemStats): SystemStats {
    if (!this.isLinux) {
      return {
        ...currentStats,
        soloistDaemonStatus: this.isSpotifyActive ? 'active' : 'standby',
      };
    }

    let cpuTempC = currentStats.cpuTempC;
    let cpuUsagePct = currentStats.cpuUsagePct;
    let ramUsagePct = currentStats.ramUsagePct;
    let ramUsedMb = currentStats.ramUsedMb;
    let ramTotalMb = currentStats.ramTotalMb;
    let uptimeSeconds = currentStats.uptimeSeconds;
    let piModel = currentStats.piModel;

    // 1. Read Real CPU Temp
    try {
      if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
        const rawTemp = parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim(), 10);
        if (!isNaN(rawTemp)) {
          cpuTempC = Number((rawTemp / 1000).toFixed(1));
        }
      }
    } catch (e) {
      // Fallback
    }

    // 2. Read Real RAM Info
    try {
      if (fs.existsSync('/proc/meminfo')) {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
        if (totalMatch && availMatch) {
          const totalKb = parseInt(totalMatch[1], 10);
          const availKb = parseInt(availMatch[1], 10);
          const usedKb = totalKb - availKb;
          ramTotalMb = Math.round(totalKb / 1024);
          ramUsedMb = Math.round(usedKb / 1024);
          ramUsagePct = Number(((usedKb / totalKb) * 100).toFixed(1));
        }
      }
    } catch (e) {
      // Fallback
    }

    // 3. Read Real Load / CPU Usage
    try {
      if (fs.existsSync('/proc/loadavg')) {
        const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
        const oneMinLoad = parseFloat(loadavg[0]);
        if (!isNaN(oneMinLoad)) {
          // Normalize for 4 cores on Pi 4B
          cpuUsagePct = Number(Math.min(100, Math.max(1, (oneMinLoad / 4) * 100)).toFixed(1));
        }
      }
    } catch (e) {
      // Fallback
    }

    // 4. Read Real Uptime
    try {
      if (fs.existsSync('/proc/uptime')) {
        const uptime = fs.readFileSync('/proc/uptime', 'utf8').split(' ');
        uptimeSeconds = Math.floor(parseFloat(uptime[0]));
      }
    } catch (e) {
      // Fallback
    }

    // 5. Read Device Model
    try {
      if (fs.existsSync('/proc/device-tree/model')) {
        piModel = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
      }
    } catch (e) {
      // Fallback
    }

    const librespotRunning = this.checkLibrespotRunning();

    return {
      ...currentStats,
      piModel,
      cpuTempC,
      cpuUsagePct,
      ramUsagePct,
      ramUsedMb,
      ramTotalMb,
      uptimeSeconds,
      soloistDaemonStatus: librespotRunning || this.isSpotifyActive ? 'active' : 'standby',
    };
  }

  /**
   * Applied at the ALSA mixer itself (not per-process), so it's the one place
   * balance actually reaches Spotify Connect audio too — librespot writes
   * straight to the hardware device with no DSP hook this app can reach, the
   * same reason EQ moved to setHardwareEqualizer below instead of mpv's `af`.
   *
   * Balance is expressed as a dB attenuation on the quiet-side channel, not
   * a raw percentage scale-down — confirmed live (real HiFiBerry DAC+,
   * 'Digital' control) that this control's percentage isn't remotely
   * amplitude-linear: 80% measured -20.5dB, 50% measured -51.5dB, 30%
   * measured -72.5dB, roughly -1dB per percentage point. A percentage-based
   * balance formula (multiplying the raw percent by a 0..1 factor) was
   * cutting dozens of dB for a modest slider nudge — reported live as one
   * channel going essentially silent immediately. amixer accepts a relative
   * dB adjustment per channel directly (`sset "Digital" 0dB-,6dB-` — verified
   * live, leaves the first channel untouched and drops the second by exactly
   * 6.00dB) which is what computeBalanceSteps expresses above.
   *
   * The master level below hits the exact same non-linear percent scale
   * (that 80%/50%/30% → -20.5/-51.5/-72.5dB measurement was on this same
   * "Digital" control) — most of the audible range compresses into
   * 70-100%, which is why 70% sounded nearly silent and only the last
   * stretch to 100% felt loud. Sent as an absolute dB value instead, via
   * the same `--`-prefixed dB syntax already proven for balance.
   */
  /** What the amplifier is actually set to right now, on the app's 0-100
   * scale, or null when there is no readable mixer. Same `-c cardIndex`
   * rule as every other amixer call here. */
  public getHardwareVolumePct(): number | null {
    if (!this.isLinux) return null;
    const mixer = this.detectedMixer || 'Digital';
    try {
      const output = execSync(`amixer -c ${this.cardIndex} sget "${mixer}" 2>/dev/null`, { encoding: 'utf8' });
      const db = parseMixerDb(output);
      return db === null ? null : volumePctFromDb(db);
    } catch (e: any) {
      console.warn(`[PiHardware] Kon het volume niet uitlezen van mixer '${mixer}':`, e?.message || e);
      return null;
    }
  }

  public setHardwareVolume(volumePct: number, isMuted: boolean = false, balancePct: number = 0): boolean {
    if (!this.isLinux) {
      console.log(`[PiHardware - Emulation] Volume set to ${volumePct}% (Muted: ${isMuted}, Balance: ${balancePct})`);
      return true;
    }

    try {
      const volumeDb = isMuted ? -60 : calculateVolumeDb(Math.max(0, Math.min(100, Math.round(volumePct))));
      const balance = Math.max(-50, Math.min(50, balancePct));
      // Reset to an absolute baseline first (below), then apply the
      // attenuation as its own separate *relative* step — always computed
      // fresh from the same starting point instead of compounding across
      // repeated calls. Kept as a separate exec() rather than chained with
      // && / || onto the volume command: mixing both into one shell command
      // whose fallback also needs && for the balance step hits ambiguous
      // left-to-right &&/|| precedence (`(A && B) || C` still runs a `&& D`
      // tacked after it even when the A&&B branch already succeeded).
      const { leftStep, rightStep } = computeBalanceSteps(balance);

      // If we found a specific mixer, use it — always addressed by the
      // detected card index, never bare/default-resolved (see cardIndex's
      // detection comment: that form fails outright on hardware where the
      // DAC isn't card 0).
      if (this.detectedMixer) {
        exec(`amixer -q -c ${this.cardIndex} sset "${this.detectedMixer}" -- ${volumeDb}dB 2>/dev/null`, (err) => {
          if (err) {
            console.warn(`[PiHardware] Could not set mixer '${this.detectedMixer}' on card ${this.cardIndex}:`, err.message);
            reportHealthIssue(
              'alsa-volume-write-failed',
              'hardware',
              'warning',
              `Volume instellen op mixer '${this.detectedMixer}' mislukte: ${err.message}`,
            );
          } else {
            clearHealthIssue('alsa-volume-write-failed');
          }
        });
        if (balance) {
          exec(`amixer -q -c ${this.cardIndex} sset "${this.detectedMixer}" ${leftStep},${rightStep} 2>/dev/null`, () => {});
        }
      }

      // Also try standard HiFiBerry ALSA card mixer controls, in case
      // detection above found nothing
      exec(`amixer -q -c ${this.cardIndex} set Digital -- ${volumeDb}dB 2>/dev/null || amixer -q -c ${this.cardIndex} set Master -- ${volumeDb}dB 2>/dev/null`, () => {});
      if (balance) {
        exec(
          `amixer -q -c ${this.cardIndex} set Digital ${leftStep},${rightStep} 2>/dev/null || amixer -q -c ${this.cardIndex} set Master ${leftStep},${rightStep} 2>/dev/null`,
          () => {},
        );
      }
      return true;
    } catch (e) {
      console.warn('[PiHardware] Error executing amixer volume command:', e);
      return false;
    }
  }

  // The libasound2-plugin-equal ("alsaequal") 10-band control set, in the
  // fixed order it always exposes them — matches dspEqualizer.bands' own
  // documented order (31/62/125/250/500/1k/2k/4k/8k/16kHz), so mapping is
  // by array index, not by parsing the label back into a frequency (its
  // "63 Hz" vs. this app's 62Hz is just alsaequal's own rounding).
  private static readonly EQ_BAND_LABELS = [
    '00. 31 Hz', '01. 63 Hz', '02. 125 Hz', '03. 250 Hz', '04. 500 Hz',
    '05. 1 kHz', '06. 2 kHz', '07. 4 kHz', '08. 8 kHz', '09. 16 kHz',
  ];

  /**
   * Same reasoning as setHardwareVolume's balance: applied at the ALSA
   * plugin layer every source shares (see /etc/asound.conf's `eq` device,
   * which `default` — used by both mpv and librespot — routes through) so
   * it reaches Spotify Connect too, not just mpv-played NAS/radio.
   *
   * alsaequal exposes each band as a 0-100 INTEGER control with no
   * documented dB curve (no TLV dB-scale info exported). Verified live on
   * a real Pi: every band defaults to 66 on a fresh install, uniformly —
   * treated here as the confirmed "flat" anchor. 2 raw units/dB is a
   * conservative slope chosen so this app's full ±12dB range (-12*2=-24,
   * +12*2=+24) stays safely inside 0-100 around that anchor without ever
   * clipping; it hasn't been checked against a dB meter, so treat the
   * *feel* of the curve as approximate — this is the calibration knob to
   * revisit if a preset ends up sounding stronger/weaker than its number
   * suggests.
   */
  public setHardwareEqualizer(enabled: boolean, bands: { freq: number; gain: number }[]): void {
    if (!this.isLinux) {
      console.log(`[PiHardware - Emulation] EQ ${enabled ? 'enabled' : 'disabled'}: ${JSON.stringify(bands)}`);
      return;
    }
    PiHardwareService.EQ_BAND_LABELS.forEach((label, i) => {
      const raw = computeEqRawValue(bands[i]?.gain ?? 0, enabled);
      exec(`amixer -D eqbase sset '${label}' ${raw} 2>/dev/null`, () => {});
    });
  }

  public playTestAudioSweep(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isLinux) {
        console.log('[PiHardware - Emulation] Playing 440Hz Sine Audio Test Sweep');
        resolve(true);
        return;
      }

      // Try speaker-test on default ALSA device or HiFiBerry DAC card 0
      exec(
        'speaker-test -D default -c 2 -r 44100 -F S16_LE -t sine -f 440 -l 1 2>/dev/null || speaker-test -c 2 -t sine -f 440 -l 1 2>/dev/null || aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null',
        (err) => {
          if (err) {
            console.warn('[PiHardware] Audio test sweep failed:', err.message);
            resolve(false);
          } else {
            console.log('[PiHardware] Audio test sweep played successfully on DAC');
            resolve(true);
          }
        }
      );
    });
  }

  public playStartupChime(): void {
    if (!this.isLinux) {
      console.log('[PiHardware - Emulation] Playing startup chime');
      return;
    }
    try {
      const chimePath = '/tmp/hss-startup-chime.wav';
      if (!fs.existsSync(chimePath)) {
        fs.writeFileSync(chimePath, generateStartupChimeWav());
      }
      exec(`aplay "${chimePath}" 2>/dev/null`, (err) => {
        if (err) {
          console.warn('[PiHardware] Startup chime playback failed:', err.message);
        }
      });
    } catch (e) {
      console.warn('[PiHardware] Could not generate/play startup chime:', e);
    }
  }

  public getConnectedAudioCards(defaultDevices: AudioDevice[]): AudioDevice[] {
    if (!this.isLinux) return defaultDevices;

    try {
      if (fs.existsSync('/proc/asound/cards')) {
        const cardsContent = fs.readFileSync('/proc/asound/cards', 'utf8');
        // "hifiberry" matches both the plain DAC+ Pro and the Amp2 (an
        // amplifier HAT that's DAC+-compatible at the driver level) —
        // /proc/asound/cards is genuinely identical between them, so this
        // always resolves to hifiberry-dacplus below. A user with an Amp2
        // needs to select it explicitly (Instellingen/Audio) to see
        // accurate specs; there's no software signal to auto-distinguish them.
        const isHifiBerry = cardsContent.toLowerCase().includes('hifiberry') || cardsContent.toLowerCase().includes('snd_rpi_hifiberry');
        const isAllo = cardsContent.toLowerCase().includes('bossdac') || cardsContent.toLowerCase().includes('allo');
        const isIqaudio = cardsContent.toLowerCase().includes('iqaudio');
        const isUsb = cardsContent.toLowerCase().includes('usb');

        return defaultDevices.map((device) => {
          let isDetected = false;
          if (device.id === 'hifiberry-dacplus' && isHifiBerry) isDetected = true;
          if (device.id === 'allo-boss-dac' && isAllo) isDetected = true;
          if (device.id === 'iqaudio-dacplus' && isIqaudio) isDetected = true;
          if (device.id === 'usb-dac-uac2' && isUsb) isDetected = true;

          return {
            ...device,
            isCurrent: isDetected || (isHifiBerry && device.id === 'hifiberry-dacplus'),
          };
        });
      }
    } catch (e) {
      console.warn('[PiHardware] Error parsing /proc/asound/cards:', e);
    }
    return defaultDevices;
  }

  public setSpotifyPlaybackState(isPlaying: boolean, track?: Track | null) {
    this.isSpotifyActive = isPlaying;
    if (track) {
      this.lastKnownTrack = track;
    }
  }

  public getSpotifyActive(): boolean {
    return this.isSpotifyActive;
  }

  public getTimeInfo(): { timezone: string; localTime: string; ntpEnabled: boolean; ntpSynced: boolean } {
    if (!this.isLinux) {
      return {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toString(),
        ntpEnabled: true,
        ntpSynced: false,
      };
    }
    try {
      const [timezone, ntp, ntpSynced] = execSync(
        'timedatectl show --property=Timezone --property=NTP --property=NTPSynchronized --value',
        { encoding: 'utf8' }
      )
        .trim()
        .split('\n');
      return {
        timezone: timezone || 'UTC',
        localTime: new Date().toString(),
        ntpEnabled: ntp === 'yes',
        ntpSynced: ntpSynced === 'yes',
      };
    } catch (e) {
      return { timezone: 'UTC', localTime: new Date().toString(), ntpEnabled: true, ntpSynced: false };
    }
  }

  // The definitive list `timedatectl set-timezone` itself accepts — used as
  // the allowlist below instead of a hand-maintained regex, so a request
  // can only ever set a timezone this exact system already recognizes.
  public listTimezones(): string[] {
    if (!this.isLinux) {
      return ['UTC', 'Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
    }
    try {
      return execSync('timedatectl list-timezones', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch {
      return ['UTC'];
    }
  }

  public setTimezone(timezone: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.listTimezones().includes(timezone)) {
        resolve({ success: false, error: 'Onbekende tijdzone' });
        return;
      }
      if (!this.isLinux) {
        console.log(`[PiHardware - Emulation] Tijdzone zou ingesteld worden op ${timezone}`);
        resolve({ success: true });
        return;
      }
      execFile('sudo', ['timedatectl', 'set-timezone', '--', timezone], (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  }

  public setNtpEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.isLinux) {
        console.log(`[PiHardware - Emulation] NTP zou ${enabled ? 'aan' : 'uit'} gezet worden`);
        resolve({ success: true });
        return;
      }
      execFile('sudo', ['timedatectl', 'set-ntp', enabled ? 'true' : 'false'], (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  }

  // Strict "YYYY-MM-DD HH:MM:SS" — the one format handed to execFile below,
  // so nothing else needs to be trusted to have shaped the string safely
  // before it gets here.
  private static readonly SAFE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  public setManualDateTime(dateTime: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!PiHardwareService.SAFE_DATETIME.test(dateTime)) {
        resolve({ success: false, error: 'Ongeldige datum/tijd-notatie (verwacht: JJJJ-MM-DD UU:MM:SS)' });
        return;
      }
      if (!this.isLinux) {
        console.log(`[PiHardware - Emulation] Systeemtijd zou ingesteld worden op ${dateTime}`);
        resolve({ success: true });
        return;
      }
      // timedatectl refuses this outright while NTP is enabled — that
      // rejection surfaces as a normal error here rather than needing a
      // special case.
      execFile('sudo', ['timedatectl', 'set-time', '--', dateTime], (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  }

  public sendMediaCommand(cmd: 'play' | 'pause' | 'play-pause' | 'next' | 'previous'): boolean {
    if (!this.isLinux) {
      console.log(`[PiHardware - Emulation] Media command executed: ${cmd}`);
      return true;
    }
    try {
      exec(`playerctl -p librespot ${cmd} 2>/dev/null || playerctl ${cmd} 2>/dev/null || true`, (err) => {
        if (err) {
          console.warn(`[PiHardware] playerctl ${cmd} command:`, err.message);
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  // This app's target OS (Raspberry Pi OS Bookworm/Trixie) manages
  // networking via NetworkManager — nmcli is the supported, stable
  // interface to it rather than hand-editing wpa_supplicant.conf (the
  // older, pre-NetworkManager approach that's no longer how a fresh Pi OS
  // install is actually configured).
  public getNetworkStatus(): { name: string; type: 'ethernet' | 'wifi' | 'other'; state: string; ip: string | null; ssid: string | null }[] {
    if (!this.isLinux) {
      return [
        { name: 'eth0', type: 'ethernet', state: 'connected', ip: '192.168.1.50', ssid: null },
        { name: 'wlan0', type: 'wifi', state: 'connected', ip: '192.168.1.51', ssid: 'Emulated-WiFi' },
      ];
    }
    try {
      const raw = execSync('nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status', { encoding: 'utf8' }).trim();
      // The CONNECTION field above is the connection *profile* name (e.g.
      // netplan auto-names it "netplan-wlan0-<hash>"), not necessarily the
      // real SSID — this is the actual network name.
      let activeSsid: string | null = null;
      try {
        const wifiLine = execSync('nmcli -t -f ACTIVE,SSID device wifi list', { encoding: 'utf8' })
          .trim()
          .split('\n')
          .find((l) => l.startsWith('yes:'));
        activeSsid = wifiLine ? wifiLine.slice(4) : null;
      } catch {}
      const interfaces: { name: string; type: 'ethernet' | 'wifi' | 'other'; state: string; ip: string | null; ssid: string | null }[] = [];
      for (const line of raw.split('\n')) {
        const [device, type, state] = line.split(':');
        if (!device || !['ethernet', 'wifi'].includes(type)) continue;
        let ip: string | null = null;
        try {
          // execFileSync with an argv array, not a shell string — device
          // names are OS-reported, not user input, but this is free either way.
          const addr = execFileSync('nmcli', ['-t', '-f', 'IP4.ADDRESS', 'device', 'show', device], { encoding: 'utf8' }).trim();
          ip = addr.split(':')[1]?.split('/')[0] || null;
        } catch {}
        interfaces.push({
          name: device,
          type: type as 'ethernet' | 'wifi',
          state,
          ip,
          ssid: type === 'wifi' && state === 'connected' ? activeSsid : null,
        });
      }
      return interfaces;
    } catch (e: any) {
      console.warn('[PiHardware] Network status check failed:', e.message);
      return [];
    }
  }

  // A rescan can take several seconds and occasionally errors on a device
  // that's mid-connect — best-effort, the list below still returns whatever
  // NetworkManager already has cached even if the rescan itself fails.
  public scanWifiNetworks(): { ssid: string; signal: number; security: string }[] {
    if (!this.isLinux) {
      return [{ ssid: 'Emulated-WiFi', signal: 80, security: 'WPA2' }];
    }
    try {
      execSync('nmcli device wifi rescan', { encoding: 'utf8', timeout: 8000 });
    } catch {}
    try {
      const raw = execSync('nmcli -t -f SSID,SIGNAL,SECURITY device wifi list', { encoding: 'utf8' }).trim();
      const seen = new Set<string>();
      const networks: { ssid: string; signal: number; security: string }[] = [];
      for (const line of raw.split('\n')) {
        const [ssid, signal, security] = line.split(':');
        if (!ssid || seen.has(ssid)) continue;
        seen.add(ssid);
        networks.push({ ssid, signal: Number(signal) || 0, security: security || 'open' });
      }
      return networks.sort((a, b) => b.signal - a.signal);
    } catch (e: any) {
      console.warn('[PiHardware] WiFi scan failed:', e.message);
      return [];
    }
  }

  // execFile with an argv array (never a shell string built from these
  // values) — ssid/password are user-supplied and must never be
  // interpolated into a shell command.
  public connectWifi(ssid: string, password: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // A WiFi SSID is attacker-controllable (anyone in radio range can name
      // their AP anything) — one starting with '-' could be read by nmcli's
      // own argument parser as a flag instead of the positional SSID value
      // (the same argv-smuggling class isSafeTarget() in localPlayer.ts
      // already guards against for mpv targets). Reject rather than try to
      // escape it: nmcli's `device wifi connect` uses its own multi-word
      // command grammar (SSID, then keyword args like `password <p>`), not
      // plain getopt, so a leading `--` end-of-options marker isn't
      // guaranteed to be honored the way it would be for a standard CLI.
      if (ssid.startsWith('-')) {
        resolve({ success: false, error: 'Ongeldige netwerknaam' });
        return;
      }
      if (!this.isLinux) {
        console.log(`[PiHardware - Emulation] WiFi zou verbinden met '${ssid}'`);
        resolve({ success: true });
        return;
      }
      const args = password ? ['nmcli', 'device', 'wifi', 'connect', ssid, 'password', password] : ['nmcli', 'device', 'wifi', 'connect', ssid];
      execFile('sudo', args, { timeout: 30000 }, (err, _stdout, stderr) => {
        if (err) resolve({ success: false, error: (stderr || err.message).trim() });
        else resolve({ success: true });
      });
    });
  }
}

export const piHardware = new PiHardwareService();
