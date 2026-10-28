// Recognizes whatever's playing on a physical/external audio source (turntable,
// CD player) by capturing a few seconds from a USB mic and looking it up —
// first against a local cache of previously-recognized fingerprints (so
// replaying the same LP/CD side never costs a lookup again), then via Shazam
// (free, no API key, and — unlike AcoustID — built to match real mic/ambient
// capture: live-tested against this exact mic and it nailed "Go Your Own
// Way" off a spinning CD on the first try). AudD/AcoustID stay as fallbacks.
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Shazam } from 'node-shazam';
import { getAllRecognizedFingerprints, saveRecognizedAudio } from '../../db.ts';
import { Track } from '../types.ts';

const shazam = new Shazam();

const CAPTURE_DIR = '/tmp/hss-recognition';
const CAPTURE_SECONDS = 12;

// Chromaprint frames are ~0.128s apart. A same-track re-capture (needle
// dropped at a different point, room noise, mic gain) typically lands well
// under 0.25 bit-error-rate at its best alignment; unrelated audio sits near
// 0.5 (random). MAX_OFFSET_FRAMES tolerates the capture starting anywhere
// within roughly a minute of misalignment from a cached capture.
const MATCH_THRESHOLD = 0.32;
const MAX_OFFSET_FRAMES = 400;
const MIN_OVERLAP_FRAMES = 30;

function ensureCaptureDir() {
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
  } catch {}
}

function execFileP(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// execFile passes args as an argv array (no shell), so shell metacharacters
// aren't a risk — but a device string starting with "-" would still be read
// by arecord as a flag rather than the -D value (option/argv injection). The
// value only ever comes from hubConfig.recognitionMicDevice, itself only
// ever set from the exact IDs /api/recognize/devices lists (arecord -l
// output, "plughw:<card>,<device>" or "default"), so this is defense in
// depth against a tampered/hand-edited config rather than routine input.
const SAFE_ALSA_DEVICE = /^[a-zA-Z][a-zA-Z0-9_:,.]*$/;

export function isSafeAlsaDevice(device: string): boolean {
  return SAFE_ALSA_DEVICE.test(device);
}

/** Records a short clip from the given ALSA capture device (e.g. "plughw:3,0"). */
export async function captureAudioClip(alsaDevice: string, seconds = CAPTURE_SECONDS): Promise<string> {
  if (!isSafeAlsaDevice(alsaDevice)) {
    throw new Error(`Ongeldig ALSA capture-apparaat: ${alsaDevice}`);
  }
  ensureCaptureDir();
  const wavPath = path.join(CAPTURE_DIR, `clip-${Date.now()}.wav`);
  await execFileP('arecord', ['-D', alsaDevice, '-f', 'S16_LE', '-r', '44100', '-c', '1', '-d', String(seconds), wavPath]);
  return wavPath;
}

/** RMS level of a 16-bit mono PCM WAV written by captureAudioClip (fixed 44-byte
 * canonical header — arecord with these exact flags never adds extra chunks). */
function computeRms(wavPath: string): number {
  const buf = fs.readFileSync(wavPath);
  let sumSquares = 0;
  let count = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const sample = buf.readInt16LE(i);
    sumSquares += sample * sample;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSquares / count) : 0;
}

interface Fingerprint {
  durationSec: number;
  compressed: string; // for the AcoustID API
  raw: number[]; // for local similarity matching
}

export async function fingerprintClip(wavPath: string): Promise<Fingerprint> {
  const [compressedOut, rawOut] = await Promise.all([
    execFileP('fpcalc', ['-json', wavPath]),
    execFileP('fpcalc', ['-raw', '-json', wavPath]),
  ]);
  const compressedData = JSON.parse(compressedOut);
  const rawData = JSON.parse(rawOut);
  return {
    durationSec: Math.round(compressedData.duration || rawData.duration || 0),
    compressed: compressedData.fingerprint,
    raw: rawData.fingerprint,
  };
}

function popcount32(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

/** Lowest bit-error-rate found across a range of alignment offsets — a cross-
 * correlation search, since the two captures rarely start at the same instant. */
function bestBitErrorRate(a: number[], b: number[]): number {
  let best = 1;
  const minOffset = -Math.min(MAX_OFFSET_FRAMES, b.length - 1);
  const maxOffset = Math.min(MAX_OFFSET_FRAMES, a.length - 1);
  for (let offset = minOffset; offset <= maxOffset; offset++) {
    const start = Math.max(0, -offset);
    const end = Math.min(a.length - offset, b.length);
    const overlap = end - start;
    if (overlap < MIN_OVERLAP_FRAMES) continue;
    let diffBits = 0;
    for (let i = start; i < end; i++) {
      diffBits += popcount32((a[i + offset] ^ b[i]) >>> 0);
    }
    const ber = diffBits / (overlap * 32);
    if (ber < best) best = ber;
  }
  return best;
}

function fingerprintHash(compressed: string): string {
  return createHash('sha1').update(compressed).digest('hex');
}

export interface RecognitionResult {
  track: Track;
  fromCache: boolean;
}

/** Checks the local cache (fuzzy match against every previously-recognized
 * fingerprint) before ever calling out to AcoustID. */
function matchAgainstCache(raw: number[]): ReturnType<typeof getAllRecognizedFingerprints>[number] | null {
  const cached = getAllRecognizedFingerprints();
  let best: { entry: (typeof cached)[number]; ber: number } | null = null;
  for (const entry of cached) {
    const ber = bestBitErrorRate(raw, entry.fingerprint);
    if (ber < MATCH_THRESHOLD && (!best || ber < best.ber)) {
      best = { entry, ber };
    }
  }
  return best?.entry || null;
}

async function lookupAcoustId(apiKey: string, durationSec: number, compressed: string): Promise<{
  title: string;
  artist: string;
  album: string;
  releaseGroupMbid: string | null;
} | null> {
  const url = new URL('https://api.acoustid.org/v2/lookup');
  url.searchParams.set('client', apiKey);
  url.searchParams.set('duration', String(durationSec));
  url.searchParams.set('fingerprint', compressed);
  url.searchParams.set('meta', 'recordings+releasegroups+compress');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`AcoustID gaf ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ok' || !data.results?.length) return null;

  // Highest-confidence result with usable recording metadata wins.
  const best = data.results
    .filter((r: any) => r.recordings?.length)
    .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0];
  if (!best) return null;

  const recording = best.recordings[0];
  const releaseGroup = recording.releasegroups?.[0];
  return {
    title: recording.title || 'Onbekende track',
    artist: (recording.artists || []).map((a: any) => a.name).join(', ') || 'Onbekende artiest',
    album: releaseGroup?.title || '',
    releaseGroupMbid: releaseGroup?.id || null,
  };
}

interface RemoteMatch {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
}

// AudD does its own server-side recognition and is built for exactly what
// AcoustID isn't: identifying audio picked up by a microphone (ambient
// noise, room acoustics, mic coloring). Sent as the raw captured WAV, not a
// Chromaprint fingerprint — AudD fingerprints it themselves.
async function lookupAudD(apiToken: string, wavPath: string): Promise<RemoteMatch | null> {
  const fileBuffer = fs.readFileSync(wavPath);
  const form = new FormData();
  form.set('api_token', apiToken);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([fileBuffer], { type: 'audio/wav' }), path.basename(wavPath));

  const res = await fetch('https://api.audd.io/', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`AudD gaf ${res.status}`);
  const data = await res.json();
  if (data.status !== 'success' || !data.result) return null;

  const r = data.result;
  const coverUrl = r.spotify?.album?.images?.[0]?.url || r.apple_music?.artwork?.url?.replace('{w}x{h}', '600x600') || '';
  return {
    title: r.title || 'Onbekende track',
    artist: r.artist || 'Onbekende artiest',
    album: r.album || '',
    coverUrl,
  };
}

async function coverArtForReleaseGroup(mbid: string): Promise<string | null> {
  try {
    const res = await fetch(`https://coverartarchive.org/release-group/${mbid}/front-250`, { redirect: 'follow' });
    return res.ok ? res.url : null;
  } catch {
    return null;
  }
}

// node-shazam wraps shazamio-core (WASM Shazam signature generation, no
// native build needed) plus the real Shazam lookup API — free, no key.
async function lookupShazam(wavPath: string): Promise<RemoteMatch | null> {
  const result: any = await shazam.recognise(wavPath, 'en-US');
  const track = result?.track;
  if (!track) return null;
  return {
    title: track.title || 'Onbekende track',
    artist: track.subtitle || 'Onbekende artiest',
    album: '',
    coverUrl: track.images?.coverarthq || track.images?.coverart || '',
  };
}

/** Full pipeline: capture → cache lookup → Shazam → AudD/AcoustID → cache write.
 * Shazam (free, no key) is tried first — it's built to match real mic/ambient
 * capture, unlike AcoustID which only matches near-exact fingerprints of
 * clean digital audio. AudD/AcoustID stay as fallbacks for whatever Shazam
 * itself doesn't have. */
export async function recognizeFromMic(
  alsaDevice: string,
  acoustidApiKey: string,
  auddApiToken: string,
  sourceType: 'turntable' | 'cd',
): Promise<RecognitionResult | null> {
  const wavPath = await captureAudioClip(alsaDevice);
  try {
    const fp = await fingerprintClip(wavPath);
    if (!fp.raw?.length) return null;

    const cacheHit = matchAgainstCache(fp.raw);
    if (cacheHit) {
      return {
        fromCache: true,
        track: toTrack(cacheHit, sourceType),
      };
    }

    let match: RemoteMatch | null = null;
    try {
      match = await lookupShazam(wavPath);
    } catch {
      // Unofficial API — network hiccup or rate limit shouldn't block the
      // AudD/AcoustID fallbacks below.
    }
    if (!match && auddApiToken) {
      match = await lookupAudD(auddApiToken, wavPath);
    }
    if (!match && acoustidApiKey) {
      const acoustidMatch = await lookupAcoustId(acoustidApiKey, fp.durationSec, fp.compressed);
      if (acoustidMatch) {
        match = {
          title: acoustidMatch.title,
          artist: acoustidMatch.artist,
          album: acoustidMatch.album,
          coverUrl: acoustidMatch.releaseGroupMbid ? (await coverArtForReleaseGroup(acoustidMatch.releaseGroupMbid)) || '' : '',
        };
      }
    }
    if (!match) return null;

    const entry = {
      fingerprintHash: fingerprintHash(fp.compressed),
      fingerprint: fp.raw,
      durationSec: fp.durationSec,
      title: match.title,
      artist: match.artist,
      album: match.album,
      coverUrl: match.coverUrl,
    };
    saveRecognizedAudio(entry);

    return { fromCache: false, track: toTrack(entry, sourceType) };
  } finally {
    fs.unlink(wavPath, () => {});
  }
}

// Cheap 2s level probes (RMS on raw PCM, no fingerprinting) instead of a fixed
// polling interval — a real recognizeFromMic capture only runs once a probe
// shows sound resuming after a genuine gap, so a track change is caught
// within a couple of seconds instead of up to ~37s (25s wait + 12s capture)
// under the old fixed-interval design, and a full recognition never runs
// mid-song for no reason.
const PROBE_SECONDS = 2;
// Exposed as hubConfig.recognitionSilenceThreshold (Instellingen →
// Muziekherkenning) for a different mic/gain/room that needs a different
// value — this is only the fallback when that setting is unset. Estimated
// from live testing against one specific USB mic (comfortably above its
// self-noise/room hum, comfortably below even quiet music).
export const DEFAULT_SILENCE_RMS_THRESHOLD = 250;
// How long the source must stay quiet before this is treated as "genuinely
// stopped" rather than a between-tracks gap or a turntable side-flip — also
// exposed as hubConfig.recognitionLongSilenceSec, fallback when unset. Was
// 5 minutes originally; the stale track info (and, since the progress bar
// was added, a bar stuck at 100%) lingering that long after a real stop was
// the actual complaint, so the default is now much shorter. A turntable
// side-flip (the slowest legitimate gap this covers) takes nowhere near 60s.
export const DEFAULT_LONG_SILENCE_SEC = 60;

export interface ExternalListenCallbacks {
  /** Fires the instant a real gap→sound transition is detected, before the
   * new track is known — the caller should clear whatever was showing. */
  onTransitionDetected: () => void;
  /** Fires after a recognition attempt completes; null means no match. */
  onResult: (result: RecognitionResult | null) => void;
  /** Fires the instant the source goes quiet after having a track shown —
   * before we know whether this is a between-tracks gap or a genuine stop.
   * The caller should clear the (now possibly stale) track display; unlike
   * onTransitionDetected this does NOT mean a recognition is about to run,
   * since sound may never come back. */
  onQuietStarted: () => void;
  /** Fires once, after `longSilenceMs` of continuous quiet — the source has
   * genuinely stopped (not just a between-tracks gap). Loop exits after this. */
  onLongSilence: () => void;
}

/** A loud probe counts as a new track starting when either no recognition has
 * run yet for this run of sound (the very first probe after starting to
 * listen), or at least one full quiet probe preceded it — that's already
 * ~PROBE_SECONDS of near-silence, a real gap rather than a dip mid-song.
 * Requiring a *second* consecutive quiet probe (as this used to, via
 * `quietMs >= 2500`) demanded ~4s of continuous silence, longer than a typical
 * CD inter-track gap (often ~2s or less), so real track changes went
 * undetected past the first track.
 *
 * The second argument is "a recognition already ran since sound resumed", not
 * "a track is currently shown" — a lookup that came back with no match still
 * counts, otherwise every single probe while an unrecognizable track played
 * kicked off another full 12s capture + lookup, back to back, forever. */
export function isTrackTransition(quietMs: number, alreadyAttempted: boolean): boolean {
  return quietMs > 0 || !alreadyAttempted;
}

/** Runs until `isActive()` returns false or onLongSilence fires.
 * `consumeForceRescan` is an atomic check-and-clear (see state.ts's
 * requestExternalRescan): the manual "scan opnieuw" fallback button, for
 * when the automatic silence-detection above misses a real transition (e.g.
 * a gapless album with no silence between tracks at all). Checked once per
 * loop pass instead of racing a second, concurrent arecord call against the
 * one already in flight — ALSA capture devices only allow one reader. */
export async function listenForExternalSource(
  alsaDevice: string,
  acoustidApiKey: string,
  auddApiToken: string,
  sourceType: 'turntable' | 'cd',
  silenceThreshold: number,
  longSilenceMs: number,
  isActive: () => boolean,
  consumeForceRescan: () => boolean,
  callbacks: ExternalListenCallbacks,
): Promise<void> {
  let quietMs = 0;
  let hasTrack = false;
  let attempted = false; // a recognition has run since sound last resumed
  let longSilenceFired = false;

  const runRecognition = async () => {
    attempted = true;
    callbacks.onTransitionDetected();
    try {
      const result = await recognizeFromMic(alsaDevice, acoustidApiKey, auddApiToken, sourceType);
      if (!isActive()) return;
      hasTrack = Boolean(result);
      callbacks.onResult(result);
    } catch {
      if (!isActive()) return;
      hasTrack = false;
      callbacks.onResult(null);
    }
    quietMs = 0;
  };

  while (isActive()) {
    if (consumeForceRescan()) {
      await runRecognition();
      continue;
    }

    const probePath = await captureAudioClip(alsaDevice, PROBE_SECONDS);
    let rms = 0;
    try {
      rms = computeRms(probePath);
    } finally {
      fs.unlink(probePath, () => {});
    }
    if (!isActive()) return;

    if (rms >= silenceThreshold) {
      const isTransition = isTrackTransition(quietMs, attempted);
      quietMs = 0;
      longSilenceFired = false;
      if (isTransition) await runRecognition();
    } else {
      // quietMs is still 0 here on the very first quiet probe of a new
      // silence run (it's only bumped below) — that's the one moment to
      // clear a currently-shown track, rather than leaving it (and its
      // progress bar) frozen on screen for the entire silence window.
      if (quietMs === 0) {
        attempted = false;
        if (hasTrack) callbacks.onQuietStarted();
      }
      quietMs += PROBE_SECONDS * 1000;
      // Fires once per silence run and then keeps probing, rather than
      // returning and tearing the whole listener down: a side flip, a long
      // lead-out or a coffee break used to end the session for good, so the
      // needle going back down showed nothing until the user manually
      // pressed "listen" again. Now onLongSilence just means "blank the
      // display / hand the cast to auto-stop", and sound coming back is
      // picked up on the very next probe.
      if (quietMs >= longSilenceMs && !longSilenceFired) {
        longSilenceFired = true;
        callbacks.onLongSilence();
      }
    }
  }
}

function toTrack(
  entry: { fingerprintHash: string; title: string; artist: string; album: string; coverUrl: string; durationSec: number },
  sourceType: 'turntable' | 'cd',
): Track {
  const placeholder = 'https://images.unsplash.com/photo-1461360370896-922624d12aa1?w=600&auto=format&fit=crop&q=80';
  return {
    id: `recognized-${entry.fingerprintHash}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.album || (sourceType === 'turntable' ? 'Vinyl' : 'CD'),
    coverUrl: entry.coverUrl || placeholder,
    highResCoverUrl: entry.coverUrl || placeholder,
    durationMs: entry.durationSec * 1000,
    uri: `external:${sourceType}:${entry.fingerprintHash}`,
    format: sourceType === 'turntable' ? 'Analoog (Platenspeler)' : 'Digitaal (CD)',
  };
}
