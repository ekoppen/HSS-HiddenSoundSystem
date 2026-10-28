// Shared server state and engine functions — the domain logic that used to
// live inline in server.ts, now split out so the route files under
// src/server/routes/*.ts have one place to import shared state and behavior
// from instead of closing over server.ts's internals directly.
//
// Anything reassigned wholesale (not just mutated via `.prop = x`) from
// outside this file gets an explicit setter (e.g. setDacConfig) — a plain
// `import { dacConfig }` only gives a live READ binding; only this module can
// reassign its own `let` exports.
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { AVAILABLE_AUDIO_DEVICES, DEFAULT_ADVANCED_AUDIO_SETTINGS, INITIAL_EQ_PRESETS, INITIAL_USERS } from '../services/mockPiData.ts';
import {
  getLocalIcyTitle,
  getLocalPositionMs,
  isLocalPlayerActive,
  parseIcyTitle,
  looksLikeStationJingle,
  pauseLocal,
  playLocal,
  resumeLocal,
  seekLocal,
  stopLocal,
} from '../services/localPlayer.ts';
import { hashPassword, verifyPassword } from '../services/authCrypto.ts';
import { DEFAULT_LONG_SILENCE_SEC, DEFAULT_SILENCE_RMS_THRESHOLD, listenForExternalSource } from '../services/audioRecognition.ts';
import { configureCatalogic, ensureCatalogicWebhookRegistered, lookupCatalogicSong, submitCatalogicBacklog } from '../services/catalogicClient.ts';
import { clearHealthIssue, getHealthIssues, onHealthIssue, reportHealthIssue } from '../services/healthLog.ts';
import { reportPreviousCrashIfAny } from '../services/crashGuard.ts';
import { calculateVolumeDb, piHardware } from '../services/piHardware.ts';
import { piSetup } from '../services/piSetup.ts';
import {
  AdvancedAudioSettings,
  AudioDevice,
  AuthUser,
  CastDesignPreset,
  CastLayout,
  DacConfig,
  EqPreset,
  ExternalSourceState,
  HubConfig,
  PlaybackState,
  SystemStats,
  Track,
  UserApiKey,
  WebSocketEventPayload,
} from '../types.ts';
import {
  getDbConfig,
  setDbConfig,
  getDbSpotifyAccount,
  setDbSpotifyAccount,
  logRadioPlay,
  getRadioLogEntriesWithoutArtwork,
  setRadioLogArtworkForSong,
} from '../../db.ts';
import { isLikeable, likeKey } from '../services/likedTracks.ts';
import { pushLikeToListener } from '../services/listenerClient.ts';
import { GpioDeviceConfig, GpioAction, VOLUME_STEP_PCT, startGpioWatcher, stopGpioWatcher } from '../services/gpioService.ts';

// Configurable so the smoke-test suite can spawn a real server instance on a
// different port without colliding with a real one already running on 3000
// (e.g. a local `npm run dev`). Everything else that assumes 3000
// (buildKioskUrl, docs) is a separate, pre-existing simplification.
export const PORT = Number(process.env.PORT) || 3000;

// ==========================================
// Core state
// ==========================================

export let audioDevices: AudioDevice[] = piHardware.getConnectedAudioCards(AVAILABLE_AUDIO_DEVICES);
export function setAudioDevices(next: AudioDevice[]): void {
  audioDevices = next;
}

export let eqPresets: EqPreset[] = [...INITIAL_EQ_PRESETS];

export let users: AuthUser[] = [...INITIAL_USERS];
export function setUsers(next: AuthUser[]): void {
  users = next;
}

// hashPassword/verifyPassword: defined in authCrypto.ts, not here — that
// module has zero other dependencies, so scripts/reset-password.ts can
// import just the hashing without also pulling in this whole file's
// module-load-time side effects (hardware detection, unclearable
// setInterval timers). Re-exported so existing
// `import { hashPassword } from '../state.ts'` call sites (auth.ts) don't
// need to change.
export { hashPassword, verifyPassword };

export const userPasswords: Record<string, string> = {};
export const userTokens: Map<string, string> = new Map(); // token -> userId

// Cryptographically random — the previous session/API-key generators used
// Math.random() (not CSPRNG) or base64(email+timestamp) (readable and
// guessable from public info), both of which are forgeable credentials.
export function generateSessionToken(): string {
  return 'hss_sess_' + crypto.randomBytes(32).toString('hex');
}
export function generateApiKey(): string {
  return 'pi_hss_live_' + crypto.randomBytes(16).toString('hex');
}

// Users, password hashes and session tokens all lived in memory only —
// every deploy/restart wiped every logged-in session (forcing a re-login)
// and reset the user list back to the hardcoded INITIAL_USERS seed. This
// persists the whole lot as one JSON blob in the existing config
// key-value store, so it survives restarts like everything else in
// hubConfig already does.
const AUTH_STATE_KEY = 'auth_state_v1';

export function saveAuthState(): void {
  setDbConfig(AUTH_STATE_KEY, JSON.stringify({ users, userPasswords, tokens: Array.from(userTokens.entries()) }));
}

export function loadAuthState(): boolean {
  const raw = getDbConfig(AUTH_STATE_KEY, '');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    users = parsed.users;
    Object.assign(userPasswords, parsed.userPasswords);
    userTokens.clear();
    for (const [token, userId] of parsed.tokens || []) userTokens.set(token, userId);
    return true;
  } catch {
    return false;
  }
}

// setup.sh's interactive prompt writes the real admin email/name/password
// here for exactly one read — deleted immediately after so the plaintext
// password doesn't sit on disk. No credential of any kind lives in source
// (mockPiData.ts's INITIAL_USERS is a placeholder identity only); this
// replaces a previous design where a real name/email/password were
// hardcoded directly in source and public in this repo's git history —
// change your password via Instellingen regardless of which path seeded it,
// that old exposure doesn't un-happen.
const ADMIN_SEED_PATH = '/etc/hss/admin-seed.json';

function seedAdminCredentials(): void {
  const admin = users.find((u) => u.id === 'user-admin');
  let email = admin?.email || 'admin@localhost';
  let name = admin?.name;
  let password: string | undefined;

  try {
    if (fs.existsSync(ADMIN_SEED_PATH)) {
      const seed = JSON.parse(fs.readFileSync(ADMIN_SEED_PATH, 'utf8'));
      if (seed.email) email = seed.email;
      if (seed.name) name = seed.name;
      if (seed.password) password = seed.password;
      fs.unlinkSync(ADMIN_SEED_PATH);
    }
  } catch (e) {
    console.warn(`[Auth] Kon ${ADMIN_SEED_PATH} niet lezen, val terug op een willekeurig wachtwoord:`, e);
  }

  if (!password) {
    // No seed file (bare dev checkout, or the setup.sh prompt was left
    // empty) — generate one rather than ever falling back to anything
    // predictable. Logged once, here, so it's still recoverable; the
    // alternative (scripts/reset-password.ts) works regardless either way.
    password = crypto.randomBytes(9).toString('hex');
    console.log(`[Auth] Geen ${ADMIN_SEED_PATH} gevonden — willekeurig wachtwoord gegenereerd voor ${email}: ${password}`);
    console.log('[Auth] Wijzig dit via Instellingen, of reset het met: sudo npx tsx scripts/reset-password.ts <email> <nieuw-wachtwoord>');
  }

  if (admin) {
    admin.email = email;
    if (name) admin.name = name;
  }
  userPasswords[email] = hashPassword(password);
}

if (!loadAuthState()) {
  // Genuinely first-ever boot against this database.
  seedAdminCredentials();
  const admin = users.find((u) => u.id === 'user-admin');
  if (admin && admin.apiKeys.length === 0) {
    admin.apiKeys.push({
      id: 'key-' + crypto.randomBytes(6).toString('hex'),
      name: 'Primary Pi HSS System Key',
      key: generateApiKey(),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      lastUsedAt: null,
      permissions: ['audio:read', 'audio:control', 'dac:configure', 'admin:all'],
      status: 'active',
    });
  }
  saveAuthState();
}

export let hubConfig: HubConfig = {
  spotifyClientId: getDbConfig('spotify_client_id', process.env.SPOTIFY_CLIENT_ID || ''),
  spotifyClientSecret: getDbConfig('spotify_client_secret', process.env.SPOTIFY_CLIENT_SECRET || ''),
  spotifyDeviceName: getDbConfig('spotify_device_name', 'HSSwoonkamer'),
  spotifyBitrate: getDbConfig('spotify_bitrate', '320') as '96' | '160' | '320',
  spotifyNormalisation: true,
  soloistEnabled: true,
  autostartService: true,
  apiKey: users.find((u) => u.id === 'user-admin')?.apiKeys[0]?.key || '',
  broadcastSpectrum: true,
  enableAlsaDirectHw: true,
  maxVolumeLimit: 100,
  catalogicEnabled: getDbConfig('catalogic_enabled', '') === 'true',
  catalogicUrl: getDbConfig('catalogic_url', process.env.CATALOGIC_URL || 'https://catalogic.doorkoppen.nl'),
  catalogicApiKey: getDbConfig('catalogic_api_key', ''),
  catalogicScanLookupEnabled: getDbConfig('catalogic_scan_lookup_enabled', '') === 'true',
  acoustidApiKey: getDbConfig('acoustid_api_key', ''),
  auddApiToken: getDbConfig('audd_api_token', ''),
  recognitionMicDevice: getDbConfig('recognition_mic_device', ''),
  recognitionSilenceThreshold: Number(getDbConfig('recognition_silence_threshold', String(DEFAULT_SILENCE_RMS_THRESHOLD))) || DEFAULT_SILENCE_RMS_THRESHOLD,
  recognitionLongSilenceSec: Number(getDbConfig('recognition_long_silence_sec', String(DEFAULT_LONG_SILENCE_SEC))) || DEFAULT_LONG_SILENCE_SEC,
  publicUrl: getDbConfig('public_url', ''),
  listenerPushLikes: getDbConfig('listener_push_likes', '') === 'true',
  listenerUrl: getDbConfig('listener_url', ''),
  listenerIntegrationKey: getDbConfig('listener_integration_key', ''),
  radioLogEnabled: getDbConfig('radio_log_enabled', '') === 'true',
  listenerPushRadioLog: getDbConfig('listener_push_radio_log', '') === 'true',
};

// A dedicated, scoped credential for the cast kiosk — a passive touchscreen
// appliance with no keyboard, so it can never go through the login screen.
// It rides along in the kiosk URL (see buildKioskUrl) so its own touch
// controls can still make authenticated requests, which means that URL
// carries a live credential. Deliberately NOT the real admin API key: no
// admin:all, so even if the URL leaks (browser history, `catt`/systemd
// logs, a shared screenshot) it can only ever drive playback/DAC output,
// never touch config, NAS credentials, user management, or Spotify account
// linking. Persisted in DB config so it survives restarts instead of
// silently invalidating every previously-cast kiosk on every reboot.
export function getOrCreateKioskApiKey(): string {
  const admin = users.find((u) => u.id === 'user-admin') || users[0];
  const kioskPermissions: UserApiKey['permissions'] = ['audio:read', 'audio:control', 'dac:configure'];

  let key = getDbConfig('kiosk_api_key', '');
  if (!key) {
    key = generateApiKey();
    setDbConfig('kiosk_api_key', key);
  }

  if (admin && !admin.apiKeys.some((k) => k.key === key)) {
    admin.apiKeys.push({
      id: 'key-kiosk',
      name: 'Cast Kiosk Display (auto-generated, scoped)',
      key,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      lastUsedAt: null,
      permissions: kioskPermissions,
      status: 'active',
    });
    // Without this, the key string above is persisted (kiosk_api_key config
    // entry) but this registration that actually makes it a valid credential
    // only lived in memory — the very next restart silently invalidated
    // every already-deployed kiosk/cast URL, even though the token in the
    // URL itself never changed.
    saveAuthState();
  }
  return key;
}

const DISK_CONFIG_PATH = '/tmp/hss-config.json';
const SYSTEM_CONFIG_PATH = '/etc/hss/config.json';

export function loadDiskConfig() {
  try {
    const target = fs.existsSync(SYSTEM_CONFIG_PATH) ? SYSTEM_CONFIG_PATH : (fs.existsSync(DISK_CONFIG_PATH) ? DISK_CONFIG_PATH : null);
    if (target) {
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed) {
        if (parsed.spotifyClientId) hubConfig.spotifyClientId = parsed.spotifyClientId;
        if (parsed.spotifyClientSecret) hubConfig.spotifyClientSecret = parsed.spotifyClientSecret;
        if (parsed.spotifyDeviceName) hubConfig.spotifyDeviceName = parsed.spotifyDeviceName;
        if (parsed.spotifyBitrate) hubConfig.spotifyBitrate = parsed.spotifyBitrate;
        if (parsed.catalogicEnabled !== undefined) hubConfig.catalogicEnabled = parsed.catalogicEnabled;
        if (parsed.catalogicUrl) hubConfig.catalogicUrl = parsed.catalogicUrl;
        if (parsed.catalogicApiKey) hubConfig.catalogicApiKey = parsed.catalogicApiKey;
        if (parsed.catalogicScanLookupEnabled !== undefined) hubConfig.catalogicScanLookupEnabled = parsed.catalogicScanLookupEnabled;
        if (parsed.acoustidApiKey) hubConfig.acoustidApiKey = parsed.acoustidApiKey;
        if (parsed.auddApiToken) hubConfig.auddApiToken = parsed.auddApiToken;
        if (parsed.recognitionMicDevice) hubConfig.recognitionMicDevice = parsed.recognitionMicDevice;
        if (typeof parsed.recognitionSilenceThreshold === 'number') hubConfig.recognitionSilenceThreshold = parsed.recognitionSilenceThreshold;
        if (typeof parsed.recognitionLongSilenceSec === 'number') hubConfig.recognitionLongSilenceSec = parsed.recognitionLongSilenceSec;
        if (parsed.publicUrl) hubConfig.publicUrl = parsed.publicUrl;
        if (typeof parsed.maxVolumeLimit === 'number') hubConfig.maxVolumeLimit = parsed.maxVolumeLimit;
      }
    }
  } catch (e) {}

  const dbClientId = getDbConfig('spotify_client_id', '');
  if (dbClientId) hubConfig.spotifyClientId = dbClientId;

  const dbClientSecret = getDbConfig('spotify_client_secret', '');
  if (dbClientSecret) hubConfig.spotifyClientSecret = dbClientSecret;
}

export function saveDiskConfig() {
  try {
    const data = JSON.stringify(hubConfig, null, 2);
    try {
      if (!fs.existsSync('/etc/hss')) fs.mkdirSync('/etc/hss', { recursive: true });
      fs.writeFileSync(SYSTEM_CONFIG_PATH, data, 'utf8');
    } catch (e) {}
    fs.writeFileSync(DISK_CONFIG_PATH, data, 'utf8');

    // Save to SQLite DB as well
    if (hubConfig.spotifyClientId) setDbConfig('spotify_client_id', hubConfig.spotifyClientId);
    if (hubConfig.spotifyClientSecret) setDbConfig('spotify_client_secret', hubConfig.spotifyClientSecret);
    if (hubConfig.spotifyDeviceName) setDbConfig('spotify_device_name', hubConfig.spotifyDeviceName);
    if (hubConfig.spotifyBitrate) setDbConfig('spotify_bitrate', hubConfig.spotifyBitrate);
    setDbConfig('catalogic_enabled', String(hubConfig.catalogicEnabled));
    if (hubConfig.catalogicUrl) setDbConfig('catalogic_url', hubConfig.catalogicUrl);
    if (hubConfig.catalogicApiKey) setDbConfig('catalogic_api_key', hubConfig.catalogicApiKey);
    setDbConfig('catalogic_scan_lookup_enabled', String(hubConfig.catalogicScanLookupEnabled));
    if (hubConfig.acoustidApiKey) setDbConfig('acoustid_api_key', hubConfig.acoustidApiKey);
    if (hubConfig.auddApiToken) setDbConfig('audd_api_token', hubConfig.auddApiToken);
    if (hubConfig.recognitionMicDevice) setDbConfig('recognition_mic_device', hubConfig.recognitionMicDevice);
    if (hubConfig.recognitionSilenceThreshold) setDbConfig('recognition_silence_threshold', String(hubConfig.recognitionSilenceThreshold));
    if (hubConfig.recognitionLongSilenceSec) setDbConfig('recognition_long_silence_sec', String(hubConfig.recognitionLongSilenceSec));
    if (hubConfig.publicUrl) setDbConfig('public_url', hubConfig.publicUrl);
    setDbConfig('listener_push_likes', String(!!hubConfig.listenerPushLikes));
    if (hubConfig.listenerUrl) setDbConfig('listener_url', hubConfig.listenerUrl);
    if (hubConfig.listenerIntegrationKey) setDbConfig('listener_integration_key', hubConfig.listenerIntegrationKey);
    setDbConfig('radio_log_enabled', String(!!hubConfig.radioLogEnabled));
    setDbConfig('listener_push_radio_log', String(!!hubConfig.listenerPushRadioLog));
  } catch (e) {}
}

loadDiskConfig();

// Catalogic-client meteen op de hoogte brengen van de geladen instellingen —
// zonder deze aanroep bleef `catalogicClient.ts`'s eigen config op de
// ingebouwde default (enabled: false) staan tot de eerste keer dat iemand
// Instellingen opsloeg. Fire-and-forget: best-effort, blokkeert de boot niet.
configureCatalogic({ enabled: hubConfig.catalogicEnabled, url: hubConfig.catalogicUrl, apiKey: hubConfig.catalogicApiKey });
void ensureCatalogicWebhookRegistered(hubConfig.publicUrl);

export let advancedAudio: AdvancedAudioSettings = { ...DEFAULT_ADVANCED_AUDIO_SETTINGS };
export function setAdvancedAudio(next: AdvancedAudioSettings): void {
  advancedAudio = next;
}

export let dacConfig: DacConfig = {
  activeDeviceId: 'hifiberry-dacplus',
  dtoverlay: 'dtoverlay=hifiberry-dacplus',
  bitPerfect: true,
  clockSyncMode: 'ultra_low_jitter',
  resamplingQuality: 'disabled',
  targetSampleRate: 44100,
  bufferTimeMs: 150,
  periodTimeMs: 35,
  volumeDb: -6.0,
  balance: 0,
  hardwareMixerControl: 'Digital',
  dspEqualizer: {
    enabled: true,
    activePresetId: 'audiophile_direct',
    bands: [
      { freq: 31, gain: 0 },
      { freq: 62, gain: 0 },
      { freq: 125, gain: 0 },
      { freq: 250, gain: 0 },
      { freq: 500, gain: 0 },
      { freq: 1000, gain: 0 },
      { freq: 2000, gain: 0 },
      { freq: 4000, gain: 0 },
      { freq: 8000, gain: 0 },
      { freq: 16000, gain: 0 },
    ],
  },
  advancedAudio: { ...advancedAudio },
};
export function setDacConfig(next: DacConfig): void {
  dacConfig = next;
}

export let systemStats: SystemStats = {
  piModel: 'Raspberry Pi 4 Model B (4GB) & 3B+ Compatible',
  osVersion: 'Raspberry Pi OS 64-bit (Linux 6.6-v8+ ALSA 1.2.9)',
  cpuTempC: 44.8,
  cpuUsagePct: 12.4,
  ramUsagePct: 24.1,
  ramUsedMb: 968,
  ramTotalMb: 3906,
  uptimeSeconds: 148200,
  alsaUnderruns: 0,
  dacClockLocked: true,
  streamBitrate: 320,
  streamSampleRate: 44100,
  streamBitDepth: 24,
  connectedClients: 0,
  soloistDaemonStatus: 'active',
  crossfadeActive: false,
  crossfadeProgressPct: 0,
};

export let playbackState: PlaybackState = {
  isPlaying: false,
  currentTrack: null as any,
  positionMs: 0,
  durationMs: 0,
  volume: 78,
  isMuted: false,
  shuffle: false,
  repeat: 'off',
  queue: [],
  currentPlaylistId: 'pl-audiophile',
  dacConfig,
  systemStats,
  spectrum: new Array(16).fill(0),
  activeProfileName: 'Spotify Connect Direct (Gereed)',
  spotifyConnected: false,
};

// State for a physical/external source (turntable, CD player) this app
// doesn't play or control — see src/services/audioRecognition.ts.
export let externalSourceState: ExternalSourceState = {
  active: false,
  sourceType: null,
  sourceLabel: '',
  track: null,
  listening: false,
  lastRecognizedAt: null,
  status: 'idle',
  trackStartedAt: null,
};
export function setExternalSourceState(next: ExternalSourceState): void {
  externalSourceState = next;
}

// Manual "scan now" fallback (see the button in SourcePicker's Extern tab)
// for when the automatic silence-detection loop misses a transition — a
// single flag rather than a queue, since repeated presses before the loop
// gets to check it should just mean "still want one rescan", not "want N".
let externalRescanRequested = false;
export function requestExternalRescan(): void {
  externalRescanRequested = true;
}
function consumeExternalRescanRequest(): boolean {
  if (!externalRescanRequested) return false;
  externalRescanRequested = false;
  return true;
}

// Closing/backgrounding Spotify on a phone usually leaves the Connect session
// merely "paused" — librespot never sends a further 'stopped'/'session_disconnected'
// event, so the paused track would otherwise stay on screen forever. If nothing
// resumes it within this window, fall back to standby like a receiver's display
// going blank once the source has clearly gone quiet.
export const SPOTIFY_PAUSED_IDLE_MS = 10 * 60 * 1000;

// Restore last active Spotify Connect track metadata from /tmp cache if present
try {
  const lastTrackPath = '/tmp/spotify-last-track.json';
  if (fs.existsSync(lastTrackPath)) {
    const raw = fs.readFileSync(lastTrackPath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached && (cached.track_id || cached.track_name)) {
      const cleanId = (cached.track_id || '').trim();
      playbackState.currentTrack = {
        id: cleanId || 'spotify-restored-' + Date.now(),
        title: cached.track_name || 'Spotify Live Track',
        artist: cached.artist_name || 'Spotify Artist',
        album: cached.album_name || 'Spotify Connect',
        coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
        highResCoverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&auto=format&fit=crop&q=90',
        durationMs: Number(cached.duration_ms) || 210000,
        uri: cached.uri || `spotify:track:${cleanId}`,
        bitrate: 320,
        sampleRate: 44100,
        bitDepth: 24,
        dominantColor: '#10b981',
      };
      playbackState.positionMs = cached.position_ms || 0;
      playbackState.isPlaying = false; // Stopped by default until play command or event
      playbackState.activeProfileName = 'Spotify Connect Direct (Gereed)';
    }
  }
} catch (e) {}

// ==========================================
// WebSocket broadcasting
// ==========================================

export let wss: WebSocketServer | undefined;
export function setWss(next: WebSocketServer): void {
  wss = next;
}

export function broadcastWebSocket(payload: WebSocketEventPayload) {
  if (!wss) return;
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('Error broadcasting to client:', err);
      }
    }
  });
}

// Bridges healthLog's plain callback API to a real-time broadcast — only on
// a genuinely NEW issue (not every repeated occurrence of the same one, see
// healthLog.ts's dedup-by-id), so a mixer failing on every volume tick reads
// as one notification, not a flood.
onHealthIssue((issue, isNew) => {
  if (isNew) {
    broadcastWebSocket({ event: 'health_issue', timestamp: Date.now(), data: { issue } });
  }
});

// scripts/deploy.sh writes this marker only when an update actually rolled
// back (or failed to) — see its own comment. Checked once per server
// startup: a rollback always ends in a restart, so "the marker exists" and
// "the service just (re)started" happen together. Without this, a rollback
// would recover the app but leave the user with zero indication it ever
// happened — a new silent failure of exactly the kind healthLog.ts exists
// to eliminate.
const UPDATE_RESULT_MARKER = '/etc/hss/.update-result';
try {
  if (fs.existsSync(UPDATE_RESULT_MARKER)) {
    const result = JSON.parse(fs.readFileSync(UPDATE_RESULT_MARKER, 'utf8'));
    if (result.status === 'rolled_back') {
      reportHealthIssue(
        'last-update-rolled-back',
        'update',
        'error',
        `De laatste update (commit ${result.failedCommit}) startte niet gezond op en is automatisch teruggedraaid naar ${result.restoredCommit}.`,
      );
    } else if (result.status === 'failed') {
      reportHealthIssue(
        'last-update-failed',
        'update',
        'error',
        `De laatste update (commit ${result.failedCommit}) mislukte, en de terugval ook — de service draait mogelijk nog op de kapotte versie. Controleer handmatig.`,
      );
    }
    fs.unlinkSync(UPDATE_RESULT_MARKER);
  }
} catch (e) {
  console.warn('[state] Kon update-resultaat niet lezen:', e);
}

// Zelfde soort markerbestand, maar voor een onverwachte crash i.p.v. een
// mislukte update — geschreven door crashGuard.ts vlak voor het gedwongen
// process.exit(). Zonder dit was een losse, eenmalige crash volledig
// onzichtbaar: serviceWatchdog.ts rekent precies één herstart tussen twee
// metingen bewust als "een deploy, stil", niet als storing.
reportPreviousCrashIfAny();

export function applyVolumeChange(update: { volume?: number; isMuted?: boolean; balance?: number }): void {
  if (typeof update.volume === 'number') {
    // Clamped to hubConfig.maxVolumeLimit here — the single chokepoint every
    // volume-changing path (HTTP route, GPIO encoder) already routes
    // through — so the cap holds regardless of source, not just the UI.
    playbackState.volume = Math.max(0, Math.min(100, hubConfig.maxVolumeLimit, Math.round(update.volume)));
    dacConfig.volumeDb = calculateVolumeDb(playbackState.volume);
  }
  if (typeof update.isMuted === 'boolean') {
    playbackState.isMuted = update.isMuted;
  }
  if (typeof update.balance === 'number') {
    dacConfig.balance = Math.max(-50, Math.min(50, Math.round(update.balance)));
  }

  // Applied at the ALSA mixer, not per-process — the only place balance
  // reaches Spotify Connect audio too (librespot writes straight to the
  // hardware device, same as the EQ/af filter chain below never could).
  piHardware.setHardwareVolume(playbackState.volume, playbackState.isMuted, dacConfig.balance);

  broadcastWebSocket({
    event: 'volume_change',
    timestamp: Date.now(),
    data: {
      volume: playbackState.volume,
      isMuted: playbackState.isMuted,
      volumeDb: dacConfig.volumeDb,
      balance: dacConfig.balance,
      // The ceiling travels with the level, because a bare number says
      // nothing on its own: 40 means "half" under a limit of 80 and "full"
      // under 40. Screens that draw a bar need both, and the kiosk display
      // had no way at all to learn the limit before this.
      maxVolumeLimit: hubConfig.maxVolumeLimit,
    },
  });
}

// ponytail: simulated spectrum — there's no real FFT tap into the audio path
// (that needs an ALSA loopback device + something like `cava` reading actual
// levels), so bars are noise around a per-band baseline. Smoothed with VU-meter
// style attack/decay against the previous frame so it flows between ticks
// instead of jumping to an unrelated random value every 150ms, which is what
// read as "jerky, not live". Upgrade path: snd-aloop + cava raw output → feed
// real per-band levels in here instead of the jitter target.
function generateSpectrumData(isPlaying: boolean, previous: number[]): number[] {
  if (!isPlaying) {
    return Array(16).fill(0);
  }
  const baseFreqs = [50, 75, 90, 85, 70, 65, 80, 88, 72, 60, 50, 42, 35, 28, 20, 15];
  return baseFreqs.map((val, i) => {
    const jitter = (Math.random() - 0.5) * 40;
    const target = Math.min(100, Math.max(8, val + jitter));
    const prev = previous[i] ?? target;
    // Rise fast (attack), fall slower (decay) — real VU meters behave the same way.
    const rate = target > prev ? 0.55 : 0.25;
    return Math.round(prev + (target - prev) * rate);
  });
}

// Optionele Catalogic-lookup voor radio, geactiveerd vanuit de radio-log
// (hubConfig.radioLogEnabled) — alleen-lezen zoals de NAS-scan al doet, nooit
// een nieuw nummer via Spotify aanmaken vanuit de achtergrond (zie de
// ontwerpregel bij lookupOrCreateCatalogicSong in catalogicClient.ts). Een
// nummer dat Catalogic nog niet kent gaat de bestaande backlog-wachtrij in;
// reconcileRadioLogBacklog hieronder vult de log later alsnog in zodra
// Catalogic 'm via die weg heeft opgelost.
async function lookupRadioSongArtwork(track: Track, title: string, artist: string): Promise<void> {
  if (!hubConfig.catalogicEnabled) return;
  const match = await lookupCatalogicSong(title, artist);
  if (match?.artworkUrl) {
    setRadioLogArtworkForSong(title, artist, match.artworkUrl);
    // De lookup kan een paar seconden duren — alleen het scherm bijwerken als
    // de radio ondertussen niet al naar het volgende nummer is doorgeschoven.
    if (playbackState.currentTrack === track && track.title === title && track.artist === artist) {
      track.coverUrl = match.artworkUrl;
      track.highResCoverUrl = match.artworkUrl;
      broadcastWebSocket({
        event: 'track_change',
        timestamp: Date.now(),
        data: { track: playbackState.currentTrack, isLiveSpotify: false, queue: playbackState.queue },
      });
    }
  } else {
    void submitCatalogicBacklog([{ externalId: `radio:${likeKey(artist, title)}`, title, artist }]);
  }
}

let reconcilingRadioLog = false;

// Na een Catalogic-webhook-poke (song.created) opnieuw proberen voor
// radio-logregels zonder albumart — zelfde patroon als reconcileNasBacklog
// in nasLibraryScan.ts, zie de POST /api/catalogic/webhook-handler.
export async function reconcileRadioLogBacklog(): Promise<{ checked: number; matched: number }> {
  if (!hubConfig.catalogicEnabled || reconcilingRadioLog) return { checked: 0, matched: 0 };
  reconcilingRadioLog = true;
  try {
    // Dezelfde song komt op de radio vaak meerdere keren voor — dedupliceren
    // op likeKey voorkomt N identieke Catalogic-lookups voor N herhalingen
    // (setRadioLogArtworkForSong vult zelf alle bijbehorende rijen in).
    const seen = new Map<string, { title: string; artist: string }>();
    for (const entry of getRadioLogEntriesWithoutArtwork()) {
      seen.set(likeKey(entry.artist, entry.title), { title: entry.title, artist: entry.artist });
    }
    let matched = 0;
    for (const { title, artist } of seen.values()) {
      const match = await lookupCatalogicSong(title, artist);
      if (match?.artworkUrl) {
        setRadioLogArtworkForSong(title, artist, match.artworkUrl);
        matched++;
      }
    }
    return { checked: seen.size, matched };
  } finally {
    reconcilingRadioLog = false;
  }
}

// Last-seen raw ICY "StreamTitle" tag, so the ticker below only broadcasts
// a track_change when the web radio station's now-playing info actually
// changes, not every second it happens to still say the same thing.
let lastIcyTitleRaw: string | null = null;

// Het station-logo van de huidige radio-track. lookupRadioSongArtwork
// overschrijft coverUrl op hetzelfde track-object met de Catalogic-hoes; bij
// de volgende tagwissel moet die weer terug naar het logo, anders blijft de
// hoes van het vorige nummer staan. Vastgelegd bij de eerste tagwissel, vóór
// er ooit een hoes is overschreven.
const radioStationCover = new WeakMap<Track, { coverUrl: string; highResCoverUrl?: string }>();

// Background ticker for real-time progress and telemetry
setInterval(async () => {
  if (playbackState.isPlaying && playbackState.currentTrack) {
    if (isLocalPlayerActive()) {
      // mpv is the source of truth for NAS/radio — ask it instead of guessing
      // from wall-clock time, so the seek bar never drifts from real audio.
      const realPos = await getLocalPositionMs();
      if (realPos !== null) playbackState.positionMs = realPos;

      // Most live streams (icecast/shoutcast) embed the actual song's
      // artist/title in the stream itself as an ICY "StreamTitle" tag —
      // mpv surfaces it live. Station-provided branding (name/genre, set
      // in routes/radio.ts) is all we have until this arrives.
      if (isRadioTrack(playbackState.currentTrack)) {
        const icyTitle = await getLocalIcyTitle();
        if (icyTitle && icyTitle !== lastIcyTitleRaw) {
          lastIcyTitleRaw = icyTitle;
          const parsed = parseIcyTitle(icyTitle);
          // Een sweep/jingle-ID (bv. "PINGUIN_CLASSICS_SWEEP_06") negeren we
          // helemaal — niet alleen niet loggen, ook niet op het scherm zetten.
          // Het vorige echte nummer blijft dan gewoon staan tot de volgende
          // echte tagwissel, in plaats van kort te vervangen door ruis.
          const isJingle = looksLikeStationJingle(parsed.title) || (!!parsed.artist && looksLikeStationJingle(parsed.artist));
          if (!isJingle) {
            const current = playbackState.currentTrack;
            if (!radioStationCover.has(current)) {
              radioStationCover.set(current, { coverUrl: current.coverUrl, highResCoverUrl: current.highResCoverUrl });
            }
            const station = radioStationCover.get(current)!;
            current.coverUrl = station.coverUrl;
            current.highResCoverUrl = station.highResCoverUrl;
            playbackState.currentTrack.title = parsed.title;
            if (parsed.artist) playbackState.currentTrack.artist = parsed.artist;
            // Optionele luistergeschiedenis (hubConfig.radioLogEnabled) — alleen
            // een echt herkend nummer loggen, geen stationsbranding (zelfde
            // filter als een like, zie isLikeable).
            if (hubConfig.radioLogEnabled && isLikeable(playbackState.currentTrack)) {
              const track = playbackState.currentTrack;
              logRadioPlay(track.album || 'Radio', track.title, track.artist);
              void lookupRadioSongArtwork(track, track.title, track.artist);
              // Auto-modus: hetzelfde nummer ook naar Listener sturen, net als
              // een handmatige like al doet (zie routes/likes.ts). Best-effort
              // en nooit blokkerend — zie pushLikeToListener.
              if (hubConfig.listenerPushRadioLog) {
                void pushLikeToListener(
                  { url: hubConfig.listenerUrl, integrationKey: hubConfig.listenerIntegrationKey },
                  { title: track.title, artist: track.artist },
                );
              }
            }
            broadcastWebSocket({
              event: 'track_change',
              timestamp: Date.now(),
              data: { track: playbackState.currentTrack, isLiveSpotify: false, queue: playbackState.queue },
            });
          }
        }
      }
    } else {
      playbackState.positionMs += 1000;
      if (playbackState.durationMs > 0 && playbackState.positionMs > playbackState.durationMs) {
        playbackState.positionMs = playbackState.durationMs;
      }
    }

    // Crossfade calculation
    const crossfadeMs = (advancedAudio.crossfadeEnabled ? advancedAudio.crossfadeDurationSec : 0) * 1000;
    const remainingMs = Math.max(0, playbackState.durationMs - playbackState.positionMs);

    if (crossfadeMs > 0 && remainingMs <= crossfadeMs && remainingMs > 0) {
      systemStats.crossfadeActive = true;
      systemStats.crossfadeProgressPct = Math.min(
        100,
        Math.max(0, Math.round(((crossfadeMs - remainingMs) / crossfadeMs) * 100))
      );
      broadcastWebSocket({
        event: 'crossfade_event',
        timestamp: Date.now(),
        data: {
          active: true,
          progressPct: systemStats.crossfadeProgressPct,
          remainingSec: (remainingMs / 1000).toFixed(1),
          nextTrack: playbackState.queue[0] || null,
        },
      });
    } else {
      systemStats.crossfadeActive = false;
      systemStats.crossfadeProgressPct = 0;
    }

    // durationMs === 0 means an unbounded/live source (web radio) — it never "ends",
    // so only treat position reaching duration as a real track-end for finite sources.
    // Local player (NAS) advances via mpv's real end-of-file event instead (see
    // advanceLocalQueue) — this simulated branch is only for the (non-mpv) demo path.
    if (!isLocalPlayerActive() && playbackState.durationMs > 0 && playbackState.positionMs >= playbackState.durationMs && !piHardware.getSpotifyActive()) {
      systemStats.crossfadeActive = false;
      systemStats.crossfadeProgressPct = 0;

      if (playbackState.repeat === 'track') {
        playbackState.positionMs = 0;
      } else if (playbackState.queue.length > 0) {
        const nextTrack = playbackState.queue.shift()!;
        playbackState.currentTrack = nextTrack;
        playbackState.positionMs = 0;
        playbackState.durationMs = nextTrack.durationMs;
        broadcastWebSocket({
          event: 'track_change',
          timestamp: Date.now(),
          data: {
            track: nextTrack,
            queue: playbackState.queue,
            gaplessApplied: advancedAudio.gaplessPlayback,
          },
        });
      } else {
        playbackState.isPlaying = false;
        playbackState.positionMs = 0;
        broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: false, positionMs: 0 } });
      }
    }
  } else {
    systemStats.crossfadeActive = false;
    systemStats.crossfadeProgressPct = 0;
  }

  // Update real Pi hardware telemetry (or emulated fallback)
  systemStats = piHardware.readRealTelemetry(systemStats);
  systemStats.connectedClients = wss ? wss.clients.size : 0;

  // These three used to be permanently frozen at their initial values
  // (320kbps/44100Hz/24-bit) — never once updated regardless of what was
  // actually playing, so a 128kbps radio station or a 16-bit NAS file
  // still reported "320kbps" everywhere this shows up (the sidebar
  // footer, the cast debug panel). currentTrack already carries the real
  // per-source values (routes/radio.ts uses the station's own bitrate,
  // NAS reads real file tags, Spotify uses the configured setting) — keep
  // whatever was last real rather than resetting to a fake number when
  // nothing's playing.
  if (playbackState.currentTrack) {
    if (playbackState.currentTrack.bitrate) systemStats.streamBitrate = playbackState.currentTrack.bitrate;
    if (playbackState.currentTrack.sampleRate) systemStats.streamSampleRate = playbackState.currentTrack.sampleRate;
    if (playbackState.currentTrack.bitDepth) systemStats.streamBitDepth = playbackState.currentTrack.bitDepth;
  }

  playbackState.systemStats = { ...systemStats };
  playbackState.dacConfig = { ...dacConfig };

  // Broadcast periodic progress tick and spectrum to all real-time listeners
  broadcastWebSocket({
    event: 'progress_tick',
    timestamp: Date.now(),
    data: {
      positionMs: playbackState.positionMs,
      durationMs: playbackState.durationMs,
      isPlaying: playbackState.isPlaying,
      spectrum: playbackState.spectrum,
      systemStats: playbackState.systemStats,
    },
  });

  // Idle-standby safety net: the explicit scheduleAutoStopCast() call sites
  // (pause routes, Spotify Connect pause hook) only fire on a genuine
  // "was playing, now paused" transition. They miss two real cases — a cast
  // started while nothing is playing yet, and a queue that runs out on its
  // own (last track ends, nothing next). Both just leave isPlaying false
  // with no pause event to hang a timer off. This tick catches those too;
  // it's a no-op whenever a timer is already pending, standby is already
  // active, or nothing is casting, so it never fights the explicit calls.
  // Also requires hasPlayedSinceCastStart — otherwise a cast that just
  // started with nothing chosen yet gets auto-stopped/standby'd before the
  // user can pick anything.
  // externalSourceState.active is the other "actually playing" — a turntable
  // or CD feeds the amp directly, so playbackState.isPlaying stays false the
  // whole time it plays. Without this the ticker standby'd the cast in the
  // middle of an LP (any time something had played earlier in the session),
  // which is exactly what the display is there for. The listen loop's own
  // onLongSilence below is what hands an external source to auto-stop.
  // hasPlayedSinceCastStart only guards the cast case (see its declaration):
  // a local HDMI kiosk screen is not something the user just started and is
  // about to pick a track on, it's always-on furniture — so after a reboot
  // with nothing playing it should show the standby clock, not an empty
  // now-playing view.
  const idleGuardSatisfied = hasPlayedSinceCastStart || localKioskDisplayActive;
  if (!playbackState.isPlaying && !externalSourceState.active && hasKioskDisplay() && !castSessionState.isStandby && !pendingAutoStopTimer && idleGuardSatisfied) {
    scheduleAutoStopCast();
  }
}, 1000);

// Faster, dedicated ticker just for the spectrum meter — decoupled from the 1s
// position/telemetry tick so the visualizer animates smoothly instead of jumping
// once per second.
setInterval(() => {
  if (!playbackState.isPlaying) return;
  playbackState.spectrum = generateSpectrumData(true, playbackState.spectrum);
  broadcastWebSocket({
    event: 'spectrum',
    timestamp: Date.now(),
    data: { spectrum: playbackState.spectrum },
  });
}, 150);

// ==========================================
// Auth
// ==========================================

// Resolves a raw token/API-key string to a user, or null if it doesn't match
// anything active. Shared by the HTTP auth check below and the WebSocket
// connection handler, so there's exactly one place that knows what a valid
// credential looks like.
export function resolveCredential(token: string | null | undefined): { user: AuthUser | null; apiKey: UserApiKey | null } {
  if (!token) return { user: null, apiKey: null };

  // pi_soloist_ is the old prefix (pre-rename) — still accepted so API keys
  // issued before this deploy don't silently stop working.
  if (token.startsWith('pi_hss_') || token.startsWith('pi_soloist_')) {
    for (const u of users) {
      const foundKey = u.apiKeys.find((k) => k.key === token && k.status === 'active');
      if (foundKey) {
        foundKey.lastUsedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
        return { user: u, apiKey: foundKey };
      }
    }
    return { user: null, apiKey: null };
  }

  const userId = userTokens.get(token);
  if (userId) {
    const u = users.find((usr) => usr.id === userId);
    if (u) return { user: u, apiKey: null };
  }
  return { user: null, apiKey: null };
}

// Extracts and validates the caller's credential (session token or API key,
// via header or query param). No fallback: a request with no credential, or
// an invalid one, resolves to `user: null` — callers decide whether that's
// acceptable (GET reads, see the global gate below) or a hard 401.
export function getAuthenticatedUser(req: express.Request): { user: AuthUser | null; apiKey: UserApiKey | null; error?: string } {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = (req.headers['x-api-key'] as string) || (req.query.api_key as string);

  if (apiKeyHeader) {
    const result = resolveCredential(apiKeyHeader);
    if (result.user) return result;
    return { user: null, apiKey: null, error: 'Ongeldige of ingetrokken API-sleutel (Invalid API Key)' };
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const result = resolveCredential(authHeader.substring(7).trim());
    if (result.user) return result;
  }

  return { user: null, apiKey: null, error: 'Niet geauthenticeerd — log in of gebruik een geldige API-sleutel' };
}

export type ApiKeyPermission = 'audio:read' | 'audio:control' | 'dac:configure' | 'admin:all';
const VALID_API_KEY_PERMISSIONS: ApiKeyPermission[] = ['audio:read', 'audio:control', 'dac:configure', 'admin:all'];

// A caller can only ever grant a new API key permissions it already holds
// itself — otherwise any authenticated caller, including a deliberately
// scoped kiosk/integration key, could just request ['admin:all'] and mint
// itself a full-admin credential. Same guard as /api/auth/register's
// admin-role check. Pure so it's cheaply unit-testable without a live server.
export function computeGrantableKeyPermissions(requestedPermissions: unknown, callerPermissions: Set<string>): ApiKeyPermission[] {
  const callerIsAdmin = callerPermissions.has('admin:all');
  const requested = Array.isArray(requestedPermissions)
    ? requestedPermissions.filter((p): p is ApiKeyPermission => VALID_API_KEY_PERMISSIONS.includes(p))
    : [];
  return callerIsAdmin ? requested : requested.filter((p) => callerPermissions.has(p));
}

// Auth Middleware for protected control endpoints
export const requireAudioPermission = (permission: 'audio:read' | 'audio:control' | 'dac:configure' | 'admin:all') => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = getAuthenticatedUser(req);
    if (auth.error) {
      res.status(401).json({ error: auth.error });
      return;
    }
    if (auth.apiKey) {
      const hasPerm = auth.apiKey.permissions.includes('admin:all') || auth.apiKey.permissions.includes(permission);
      if (!hasPerm) {
        res.status(403).json({
          error: `Onvoldoende rechten. Vereist: '${permission}', sleutel heeft: [${auth.apiKey.permissions.join(', ')}]`,
        });
        return;
      }
    }
    (req as any).authUser = auth.user;
    (req as any).authApiKey = auth.apiKey;
    next();
  };
};

// ==========================================
// External audio source recognition (turntable/CD via USB mic)
// ==========================================
// This app never plays or controls this audio — the source feeds an amp
// directly. It's purely a "what's playing" display, built by fingerprinting
// periodic mic captures. See src/services/audioRecognition.ts.

export function broadcastExternalSource() {
  broadcastWebSocket({
    event: 'external_source_update',
    timestamp: Date.now(),
    data: externalSourceState,
  });
}

// Starts the transition-aware listen loop (see listenForExternalSource in
// audioRecognition.ts): cheap level probes drive it instead of a fixed
// interval, so a track change is caught within a couple of seconds and a
// full recognition never runs mid-song for no reason.
export function startExternalListenLoop() {
  const device = hubConfig.recognitionMicDevice;
  if (!device) {
    externalSourceState.status = 'error';
    externalSourceState.errorMessage = 'Geen microfoon geselecteerd in Instellingen';
    broadcastExternalSource();
    return;
  }
  consumeExternalRescanRequest(); // drop any stale request left over from a previous session
  listenForExternalSource(
    device,
    hubConfig.acoustidApiKey || '',
    hubConfig.auddApiToken || '',
    externalSourceState.sourceType!,
    hubConfig.recognitionSilenceThreshold || DEFAULT_SILENCE_RMS_THRESHOLD,
    (hubConfig.recognitionLongSilenceSec || DEFAULT_LONG_SILENCE_SEC) * 1000,
    () => externalSourceState.active,
    consumeExternalRescanRequest,
    {
      onTransitionDetected: () => {
        if (!externalSourceState.active) return;
        // Sound is back (needle dropped again, next track started) — undo
        // whatever a previous long silence handed to the auto-stop path, so
        // the display comes out of standby instead of showing the ready
        // screen over a playing record.
        cancelPendingAutoStopCast();
        exitCastStandby();
        // A song just ended — show nothing rather than the previous
        // track's now-stale info until the new one is identified. Sound
        // just resumed right now, so this is also the best estimate of
        // when the new track started — recognition itself won't finish for
        // another ~12+ seconds (capture + lookup), too late to anchor a
        // progress bar against.
        externalSourceState.track = null;
        externalSourceState.status = 'recognizing';
        externalSourceState.trackStartedAt = Date.now();
        broadcastExternalSource();
      },
      onQuietStarted: () => {
        if (!externalSourceState.active) return;
        // The source just went quiet — could be a between-tracks gap or a
        // genuine stop, not yet known which. Clear the (now possibly stale)
        // track and its progress bar immediately rather than leaving them
        // frozen on screen until either sound resumes or onLongSilence fires.
        externalSourceState.track = null;
        externalSourceState.status = 'recognizing';
        externalSourceState.trackStartedAt = null;
        broadcastExternalSource();
      },
      onResult: (result) => {
        if (!externalSourceState.active) return;
        if (result) {
          externalSourceState.track = result.track;
          externalSourceState.status = 'listening';
          externalSourceState.lastRecognizedAt = Date.now();
          externalSourceState.errorMessage = undefined;
        } else {
          externalSourceState.track = null;
          externalSourceState.status = 'no_match';
          externalSourceState.trackStartedAt = null; // nothing to show progress for
        }
        broadcastExternalSource();
      },
      onLongSilence: () => {
        // The source has gone quiet for longer than a between-tracks gap.
        // That is NOT proof the evening is over — a side flip, a long
        // lead-out or a pause to talk all look identical from here — so
        // listening keeps running and sound coming back is picked up on the
        // next probe (see onTransitionDetected above). All this does is
        // blank the now-stale display and hand the cast to the ordinary
        // auto-stop path, which honours autoStopDelaySec and the
        // standby-vs-release setting. It used to call stopCast() directly:
        // an unconditional hard `catt stop` that tore the Nest Hub back to
        // Google's idle screen the moment a record had a quiet minute,
        // ignoring both of those settings.
        if (!externalSourceState.active) return;
        externalSourceState.track = null;
        externalSourceState.status = 'idle';
        externalSourceState.trackStartedAt = null;
        broadcastExternalSource();
        scheduleAutoStopCast();
      },
    }
  ).catch((e: any) => {
    if (!externalSourceState.active) return;
    externalSourceState.status = 'error';
    externalSourceState.errorMessage = e.message;
    broadcastExternalSource();
  });
}

// Shared by the explicit POST /stop endpoint and by every place this app
// starts driving its own playback (startLocalAudio, playSpotifyUri) — the
// external source is only ever "the chosen input" while nothing else is
// playing through the app, mirroring a receiver's physical input selector.
// A no-op when nothing's listening, so it's safe to call unconditionally.
// Setting active: false is also what makes listenForExternalSource's loop
// exit on its own (isActive() below), no separate cancellation needed.
export function stopExternalListening() {
  if (!externalSourceState.active) return;
  externalSourceState = {
    active: false,
    sourceType: null,
    sourceLabel: '',
    track: null,
    listening: false,
    lastRecognizedAt: null,
    status: 'idle',
    trackStartedAt: null,
  };
  broadcastExternalSource();
}

// ==========================================
// Local/queue playback engine
// ==========================================

// Starts real audio output (via localPlayer/mpv) for a NAS track and syncs
// playbackState/WebSocket to match. `onQueueEnd` decides what happens when
// mpv reports the file finished — advance the queue, or just stop.
// True while this app's own queue is what's driving playback (including a
// Spotify track started via playQueuedTrack) — as opposed to someone having
// picked this device from their own Spotify app, which is a session this
// app doesn't control. Used by the /api/spotify/event webhook to tell those
// two situations apart: only an externally-initiated session should wipe
// the queue or stop on "session ended"; a queue-driven Spotify track ending
// should instead continue into whatever's queued next (NAS, radio, or
// another Spotify track), which is what makes a mixed-source queue work.
export let queueControlsPlayback = false;
export function setQueueControlsPlayback(next: boolean): void {
  queueControlsPlayback = next;
}

// Shared by the 'stopped'/'kicked'/'closed'/'session_cleared' webhook branch
// and by the paused-idle-timeout fallback below — both mean the same thing:
// Spotify is no longer actually showing, go back to standby.
export function clearSpotifyToStandby() {
  queueControlsPlayback = false;
  playbackState.isPlaying = false;
  playbackState.positionMs = 0;
  playbackState.currentTrack = null as any;
  playbackState.activeProfileName = 'Geen actieve stream (Gereed)';
  broadcastWebSocket({
    event: 'track_change',
    timestamp: Date.now(),
    data: { track: null, isLiveSpotify: false, queue: [], spotifyConnected: false },
  });
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: false, positionMs: 0, spotifyConnected: false },
  });
}

export function startLocalAudio(track: Track | null) {
  if (!track) return;
  const filePath = decodeURIComponent(track.uri.replace(/^file:\/\//, ''));
  // A local file starting up always wins the ALSA device — pause Spotify
  // Connect (best-effort; no-ops if it wasn't playing) so they don't overlap.
  sendSpotifyPlayerCommand('pause').catch(() => {});
  // The app has now chosen its own library as input — the external
  // turntable/CD source stops being "what's showing", same as walking up
  // to a receiver and turning the input knob.
  stopExternalListening();
  playLocal(filePath, () => advanceLocalQueue());
}

// Pushes the current EQ settings live — called from every place
// dacConfig.dspEqualizer changes. Applied at the ALSA plugin layer (see
// PiHardwareService.setHardwareEqualizer), so unlike the old mpv-only `af`
// filter approach this reaches Spotify Connect too, not just NAS/radio —
// no need to gate on isLocalPlayerActive() any more either.
export function applyLiveAudioFilters() {
  piHardware.setHardwareEqualizer(dacConfig.dspEqualizer.enabled, dacConfig.dspEqualizer.bands);
}

// Starts an arbitrary queued track regardless of source — file:// and
// http(s):// (NAS/radio) go through the local mpv player as before,
// spotify: URIs go through the Web API on the librespot Connect device
// instead. Without this dispatch, a Spotify track queued behind a NAS
// track would reach startLocalAudio() and just fail isSafeTarget()
// silently — this is what makes a mixed-source queue actually play through.
export async function playQueuedTrack(track: Track): Promise<{ success: boolean; error?: string }> {
  queueControlsPlayback = true;
  playbackState.currentTrack = track;
  playbackState.positionMs = 0;
  playbackState.durationMs = track.durationMs;

  if (track.uri?.startsWith('spotify:')) {
    stopLocal(); // release the ALSA device so librespot can take it
    const result = await playSpotifyUri(track.uri);
    if (!result.success) return result;
  } else {
    startLocalAudio(track);
  }

  playbackState.isPlaying = true;
  broadcastWebSocket({ event: 'track_change', timestamp: Date.now(), data: { track, queue: playbackState.queue } });
  broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: true, positionMs: 0 } });
  return { success: true };
}

/** Called when mpv reports the current NAS file ended — plays the next queued track, or stops. */
export async function advanceLocalQueue() {
  const next = playbackState.queue.shift();
  if (!next) {
    queueControlsPlayback = false;
    playbackState.isPlaying = false;
    playbackState.positionMs = 0;
    broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: false, positionMs: 0 } });
    return;
  }
  const result = await playQueuedTrack(next);
  if (!result.success) {
    console.warn('[Queue] Kon volgend nummer niet starten, sla over:', result.error);
    advanceLocalQueue();
  }
}

export { isLocalPlayerActive, pauseLocal, playLocal, resumeLocal, seekLocal, stopLocal, getLocalPositionMs, getHealthIssues };

// ==========================================
// Spotify credentials & Connect transport
// ==========================================

export function getSpotifyAppCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = hubConfig.spotifyClientId || getDbConfig('spotify_client_id', '');
  let clientSecret = hubConfig.spotifyClientSecret;
  if (!clientSecret || clientSecret.includes('••••')) {
    clientSecret = getDbConfig('spotify_client_secret', '');
  }
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// The user-login flow (Authorization Code + PKCE) only ever needs the
// Client ID — a client_secret is for confidential (server-only) clients,
// and this app runs on whatever Pi a user owns, not a server Eelko
// controls, so PKCE is the correct flow here (same reason Volumio and
// other self-hosted/native apps use it). Only the separate app-level
// search feature (client_credentials, no PKCE equivalent exists for that
// grant type) still needs the full getSpotifyAppCredentials() pair above.
export function getSpotifyClientId(): string | null {
  return hubConfig.spotifyClientId || getDbConfig('spotify_client_id', '') || null;
}

// Helper to obtain Spotify Client Credentials Access Token — no user context,
// only good enough for public catalog reads (search, embed playlists).
export async function getSpotifyApiAccessToken(): Promise<string | null> {
  const creds = getSpotifyAppCredentials();
  if (!creds) return null;

  try {
    const authHeader = 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
      body: 'grant_type=client_credentials',
    });
    if (res.ok) {
      const data = await res.json();
      return data.access_token || null;
    }
  } catch (e) {}
  return null;
}

// Returns a live user access token, transparently refreshing it via the stored
// refresh_token when it's expired (or about to). Null when never logged in.
export async function getSpotifyUserAccessToken(): Promise<string | null> {
  const account = getDbSpotifyAccount();
  if (!account.refreshToken) return null;
  if (account.accessToken && account.expiresAt && Date.now() < account.expiresAt - 60000) {
    return account.accessToken;
  }

  const clientId = getSpotifyClientId();
  if (!clientId) return null;

  try {
    // PKCE-obtained tokens refresh with just client_id in the body — no
    // client_secret, and no Authorization header (this is a public client).
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: clientId }).toString(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setDbSpotifyAccount({
      isConnected: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    return data.access_token;
  } catch (e) {
    return null;
  }
}

export async function findSpotifyConnectDeviceId(userToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const devices: any[] = data.devices || [];
    // Only ever the Pi's own named device — never any other device in the
    // account (a phone, a laptop, someone else's speaker). A "just falls
    // back to devices[0]" default silently sent playback to whatever
    // Spotify happened to list first — reproduced live: tapping a playlist
    // on this app's own kiosk started audio on a Mac Mini instead of the
    // Pi, because librespot hadn't finished registering itself with
    // Spotify yet (a race right after a reboot) and its named device
    // wasn't in the list for that one request.
    const named = devices.find((d) => d.name === hubConfig.spotifyDeviceName);
    return named?.id || null;
  } catch {
    return null;
  }
}

// Starts real Spotify playback on the Pi's own librespot Connect device via the
// Web API — the one way this app can make a track/album/playlist chosen from
// search or "Mijn playlists" actually play, as opposed to the mock playbackState
// updates used for NAS/radio. Requires the user to be logged in AND for
// librespot to currently be visible as a Connect device (i.e. running).
export async function playSpotifyUri(uri: string): Promise<{ success: boolean; error?: string }> {
  const userToken = await getSpotifyUserAccessToken();
  if (!userToken) {
    return { success: false, error: 'Niet ingelogd bij Spotify. Gebruik "Inloggen bij Spotify" in Instellingen.' };
  }
  const deviceId = await findSpotifyConnectDeviceId(userToken);
  if (!deviceId) {
    return { success: false, error: 'Geen actief Spotify Connect apparaat gevonden. Controleer of de librespot daemon draait.' };
  }

  const isTrack = uri.startsWith('spotify:track:');
  const body = isTrack ? { uris: [uri] } : { context_uri: uri };

  try {
    const playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (playRes.ok || playRes.status === 204) {
      piHardware.setSpotifyPlaybackState(true);
      // Only once Spotify actually confirmed it's playing — an attempt that
      // fails (not logged in, no device) shouldn't tear down a listening
      // session for nothing.
      stopExternalListening();
      return { success: true };
    }
    if (playRes.status === 403) {
      return { success: false, error: 'Spotify Premium is vereist om hier direct af te spelen.' };
    }
    const errBody = await playRes.text();
    return { success: false, error: `Spotify afspeelfout (${playRes.status}): ${errBody}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Transport control (pause/resume/next/previous) for an active Spotify
// Connect session, via the Web API instead of piHardware.sendMediaCommand's
// playerctl/MPRIS approach — playerctl isn't installed on the Pi, and
// stock librespot doesn't expose an MPRIS interface for it to control even
// if it were, so every "next"/"pause" while Spotify was the active source
// silently did nothing. This works the same way playSpotifyUri does: real
// API call against the librespot Connect device, not a local process signal.
export async function sendSpotifyPlayerCommand(action: 'pause' | 'resume' | 'next' | 'previous'): Promise<{ success: boolean; error?: string }> {
  const userToken = await getSpotifyUserAccessToken();
  if (!userToken) {
    return { success: false, error: 'Niet ingelogd bij Spotify. Gebruik "Inloggen bij Spotify" in Instellingen.' };
  }
  const deviceId = await findSpotifyConnectDeviceId(userToken);
  if (!deviceId) {
    return { success: false, error: 'Geen actief Spotify Connect apparaat gevonden. Controleer of de librespot daemon draait.' };
  }

  const endpoint = action === 'pause' ? 'pause' : action === 'resume' ? 'play' : action === 'next' ? 'next' : 'previous';
  const method = action === 'next' || action === 'previous' ? 'POST' : 'PUT';

  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}?device_id=${encodeURIComponent(deviceId)}`, {
      method,
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok || res.status === 204) return { success: true };
    if (res.status === 403) return { success: false, error: 'Spotify Premium is vereist voor bediening.' };
    if (res.status === 404) return { success: false, error: 'Geen actieve afspeelsessie op dit apparaat.' };
    const errBody = await res.text();
    return { success: false, error: `Spotify bedieningsfout (${res.status}): ${errBody}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// A server restart (deploy, crash) never interrupts librespot — it's a
// separate systemd service and keeps actually playing audio right through
// it. But this process's own playbackState resets, and until now the only
// way it got the real track back was passively waiting for librespot's next
// webhook event (see the /api/spotify/event route) — which might not fire
// again for a long time if the same track just keeps playing. Called once
// on startup to actively ask Spotify what's really happening instead of
// waiting, so the display doesn't sit stuck/empty through a deploy while
// music keeps playing.
// Every early-return logs its reason — this used to fail completely silent,
// which made a real occurrence of it (a restart landing while Spotify was
// genuinely playing, resync not applying) impossible to diagnose after the
// fact from the journal.
async function attemptSyncLiveSpotifyState(): Promise<boolean> {
  const userToken = await getSpotifyUserAccessToken();
  if (!userToken) {
    console.log('[Spotify] Startup resync: geen opgeslagen login, overgeslagen.');
    return false;
  }

  const res = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (res.status === 204) {
    console.log('[Spotify] Startup resync: Spotify meldt niets actiefs op dit account.');
    return false;
  }
  if (!res.ok) {
    console.warn(`[Spotify] Startup resync: /v1/me/player gaf ${res.status}.`);
    return false;
  }
  const data = await res.json();
  if (!data?.item) {
    console.log('[Spotify] Startup resync: geen actief nummer in de respons.');
    return false;
  }
  if (!data.is_playing) {
    console.log(`[Spotify] Startup resync: '${data.item.name}' staat gepauzeerd, niet hersteld.`);
    return false;
  }
  // Only trust this as "us" if it's genuinely playing on our own Connect
  // device — otherwise this could be a phone or another device entirely.
  if (hubConfig.spotifyDeviceName && data.device?.name !== hubConfig.spotifyDeviceName) {
    console.log(
      `[Spotify] Startup resync: actief op ander apparaat ('${data.device?.name}', verwacht '${hubConfig.spotifyDeviceName}'), overgeslagen.`
    );
    return false;
  }

  const item = data.item;
  const coverUrl = item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || '';
  const track: Track = {
    id: item.id,
    title: item.name,
    artist: (item.artists || []).map((a: any) => a.name).join(', '),
    album: item.album?.name || 'Spotify Connect',
    coverUrl,
    highResCoverUrl: coverUrl,
    durationMs: item.duration_ms || 210000,
    uri: item.uri,
    bitrate: Number(hubConfig.spotifyBitrate) || 320,
    sampleRate: 44100,
    bitDepth: 24,
    dominantColor: '#10b981',
  };

  playbackState.currentTrack = track;
  playbackState.positionMs = data.progress_ms || 0;
  playbackState.durationMs = track.durationMs;
  playbackState.isPlaying = true;
  playbackState.spotifyConnected = true;
  playbackState.activeProfileName = 'Spotify Connect (Bit-Perfect Direct)';
  piHardware.setSpotifyPlaybackState(true, track);

  broadcastWebSocket({
    event: 'track_change',
    timestamp: Date.now(),
    data: { track, isLiveSpotify: true, queue: [], spotifyConnected: true },
  });
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: true, positionMs: playbackState.positionMs, spotifyConnected: true },
  });
  console.log(`[Spotify] Live status hersteld na herstart: '${track.title}' (speelt)`);
  return true;
}

export async function syncLiveSpotifyState(): Promise<void> {
  try {
    if (await attemptSyncLiveSpotifyState()) return;
    // A restart can briefly race Spotify's own view of "what's playing"
    // (token refresh + API round-trip right at boot) — one retry after a
    // short delay before giving up. If it still doesn't apply, the next
    // real librespot webhook event corrects it regardless.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await attemptSyncLiveSpotifyState();
  } catch (e: any) {
    console.warn('[Spotify] Startup resync mislukt:', e.message);
  }
}

// ==========================================
// Update checker
// ==========================================
// Periodically compares the local commit against origin/main (a fetch,
// never a pull/merge — this only ever reports, the actual update stays a
// deliberate action via /api/system/update) and surfaces it both as a
// WebSocket push (for whoever's looking right now) and in /api/status (for
// whoever loads/refreshes the page later).
export let updateCheckState: { checked: boolean; updateAvailable: boolean; latestMessage: string } = {
  checked: false,
  updateAvailable: false,
  latestMessage: '',
};

// Notify once per newly-discovered commit, not on every hourly re-check
// while the same update is still sitting there unapplied.
let lastNotifiedUpdateCommit: string | null = null;

// The repo remote is an SSH URL (git@github.com:...), and hss.service runs
// as root — which has no SSH setup of its own at all (confirmed live: no
// known_hosts entry for github.com, no key). The deploying user (found by
// asking who actually owns the repo directory, not hardcoded — this app
// runs under different accounts across the two real Pis) already has both
// a working key and a trusted known_hosts from the original clone; root
// can already read that file unconditionally (it's root), so this crosses
// no new privilege boundary, just points git at credentials that already
// exist for this exact purpose. Returns [] (no override) if anything about
// that lookup doesn't hold, so a fetch/pull just fails the same way it
// would have without this rather than erroring on a bad path.
function buildGitSshArgs(repoDir: string): string[] {
  try {
    const owner = execFileSync('stat', ['-c', '%U', repoDir], { encoding: 'utf8' }).trim();
    if (!owner || owner === 'root') return [];
    const keyPath = `/home/${owner}/.ssh/id_ed25519`;
    const knownHosts = `/home/${owner}/.ssh/known_hosts`;
    if (!fs.existsSync(keyPath)) return [];
    return ['-c', `core.sshCommand=ssh -i ${keyPath} -o UserKnownHostsFile=${knownHosts} -o IdentitiesOnly=yes`];
  } catch {
    return [];
  }
}

async function checkForAppUpdate(): Promise<void> {
  if (process.platform !== 'linux') return; // dev/emulation — no git-deployed instance to check
  try {
    // hss.service runs as root (User=root), but the repo directory is
    // owned by the deploying user (e.g. eelko) — git's "dubious ownership"
    // protection (post-CVE-2022-24765) then refuses every single one of
    // these commands outright. Confirmed live: this silently failed on
    // both Pis, every hourly tick, the entire time this checker has
    // existed — no update dot ever showed up despite real commits sitting
    // unpulled. `-c safe.directory=<dir>` scopes the trust to just this
    // invocation, no persistent `git config --global` needed on the host.
    const repoDir = process.cwd();
    const safeDir = `safe.directory=${repoDir}`;
    await execFileAsync('git', ['-c', safeDir, ...buildGitSshArgs(repoDir), 'fetch', 'origin', 'main', '--quiet']);
    const { stdout: head } = await execFileAsync('git', ['-c', safeDir, 'rev-parse', 'HEAD']);
    const { stdout: remoteHead } = await execFileAsync('git', ['-c', safeDir, 'rev-parse', 'origin/main']);
    const headTrimmed = head.trim();
    const remoteHeadTrimmed = remoteHead.trim();
    const updateAvailable = headTrimmed !== remoteHeadTrimmed;
    let latestMessage = '';
    if (updateAvailable) {
      const { stdout: msg } = await execFileAsync('git', ['-c', safeDir, 'log', '-1', '--format=%s', 'origin/main']);
      latestMessage = msg.trim();
    }
    updateCheckState = { checked: true, updateAvailable, latestMessage };
    clearHealthIssue('update-check-failed');
    if (updateAvailable && remoteHeadTrimmed !== lastNotifiedUpdateCommit) {
      lastNotifiedUpdateCommit = remoteHeadTrimmed;
      broadcastWebSocket({
        event: 'update_available',
        timestamp: Date.now(),
        data: { message: latestMessage || 'Nieuwe versie beschikbaar' },
      });
    }
  } catch (e: any) {
    // Used to be silent on the theory that "no network / no git / no
    // origin/main tracking branch" were the only realistic causes and not
    // worth logging hourly. The dubious-ownership failure above proved
    // that wrong — a real, permanent misconfiguration hid behind this
    // exact reasoning for as long as this checker has existed. Reported
    // (not logged raw) so a genuinely transient blip doesn't read as
    // urgent: healthLog dedups by id, so this is one ongoing issue with a
    // rising count, not a flood.
    reportHealthIssue('update-check-failed', 'update', 'warning', `Kon niet controleren op updates: ${e.message}`);
  }
}

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly — a version check has no real urgency
setInterval(checkForAppUpdate, UPDATE_CHECK_INTERVAL_MS);
checkForAppUpdate();

// ==========================================
// Google Cast & Nest Hub engine
// ==========================================

export let castSessionState: any = {
  isCasting: false,
  isStandby: false,
  activeDeviceId: null,
  activeLayout: 'kiosk_touch' as CastLayout,
  startedAt: null,
  castUrl: '',
};

// Like castSettingsState below, this lived in memory only — every deploy/restart
// silently forgot a cast was active (isCasting reset to false) even though the
// Nest Hub was still physically showing it. That broke "automatisch stoppen bij
// pauze" (its gating check reads castSessionState.isCasting) and made the Cast
// page show STANDBY for a session that was still live. Persisted the same way.
const savedCastSession = getDbConfig('cast_session_v1', '');
if (savedCastSession) {
  try {
    castSessionState = { ...castSessionState, ...JSON.parse(savedCastSession) };
  } catch {}
}

export let castSettingsState: any = {
  targetDeviceId: '',
  targetDeviceIp: '',
  targetDeviceName: '',
  layout: 'kiosk_touch',
  themeId: 'obsidian',
  accentMode: 'theme',
  customAccentColor: '#6366f1',
  showControls: true,
  showLike: true,
  showSpectrum: true,
  showQueue: true,
  showSourceSwitcher: true,
  showClock: true,
  autoReCast: true,
  autoCastOnPlay: true,
  autoStopOnPause: true,
  autoStopDelaySec: 0,
  bgStyle: 'solid',
  bgOpacity: 60,
  bgColor: '#08090c',
  bgGlowColor: '#6366f1',
  bgGlowIntensity: 35,
  bgGradientColors: ['#08090c', '#000000'],
  bgGradientAngle: 160,
  artRadius: 10,
  artShadow: true,
  artDisplayMode: 'flat',
  discSpin: true,
  transitionAnimation: false,
  artZIndex: 1,
  flatArtSize: 76,
  vinylArtSize: 220,
  cdArtSize: 180,
  flatArtAnchorH: 'left',
  flatArtAnchorV: 'center',
  flatArtOffsetX: 0,
  flatArtOffsetY: 0,
  vinylArtAnchorH: 'left',
  vinylArtAnchorV: 'center',
  vinylArtOffsetX: 0,
  vinylArtOffsetY: 0,
  cdArtAnchorH: 'left',
  cdArtAnchorV: 'center',
  cdArtOffsetX: 0,
  cdArtOffsetY: 0,
  vinylFillPct: 40,
  cdFillPct: 92,
  vinylHoleSizePct: 10,
  cdHoleSizePct: 6,
  align: 'left',
  fontFamily: 'sans',
  customFonts: [],
  textAnchorH: 'left',
  textAnchorV: 'center',
  textOffsetX: 130,
  textOffsetY: 0,
  textZIndex: 1,
  textWidth: 700,
  titleSize: 20,
  titleColor: '#ffffff',
  titleLetterSpacing: -1,
  titleLineHeight: 110,
  artistSize: 16,
  artistColor: '#cbd5e1',
  artistLetterSpacing: 0,
  artistLineHeight: 120,
  textShadow: false,
  glow: false,
  clockStyle: 'small',
  clockAnchorH: 'right',
  clockAnchorV: 'top',
  clockOffsetX: 0,
  clockOffsetY: 0,
  clockZIndex: 1,
  clockSize: 26,
  clockColor: '#ffffff',
  clockLetterSpacing: -1,
  clockShadow: false,
  spectrumAnchorH: 'left',
  spectrumAnchorV: 'center',
  spectrumOffsetX: 130,
  spectrumOffsetY: 90,
  spectrumZIndex: 1,
  spectrumHeight: 40,
  spectrumWidth: 220,
  spectrumOpacity: 100,
  spectrumStyle: 'bars',
  controlsAnchorH: 'left',
  controlsAnchorV: 'center',
  controlsOffsetX: 130,
  controlsOffsetY: 150,
  controlsZIndex: 1,
  controlsSize: 20,
  sourcePickerScale: 100,
  showProgress: true,
  progressAnchorH: 'left',
  progressAnchorV: 'bottom',
  progressOffsetX: 0,
  progressOffsetY: 0,
  progressZIndex: 1,
  progressWidth: 300,
  progressHeight: 6,
  auraEnabled: true,
  auraIntensity: 55,
  // ponytail: this object is missing most other standby* fields too (a
  // pre-existing gap, not introduced here) — harmless in practice since a
  // real save always round-trips the full client-side object into
  // cast_settings_v1, which is merged over this at module load below. Only
  // added here for consistency with the two client-side default objects.
  standbyBgColor: '#08090c',
  standbyBgGlowColor: '#f59e0b',
  standbyBgGlowIntensity: 20,
  standbyBgGradientColors: ['#08090c', '#000000'],
  standbyBgGradientAngle: 160,
  standbyShowTime: true,
  standbyTimeSize: 96,
  standbyTimeLetterSpacing: -2,
  standbyTimeEffect: 'none',
  standbyTimeAuroraColors: ['#4f46e5', '#6366f1', '#38bdf8'],
  standbyTimeReflectDistance: 0,
  standbyTimeReflectOpacity: 20,
  standbyTimeSlicedGap: 2,
  standbyTimeSlicedVerticalGap: 10,
  standbyTimeSlicedColor: '#f59e0b',
  standbyTimeFoldedSkew: 8,
  standbyTimeFoldedRotation: -8,
  standbyTimeFoldedCreaseSkew: 13,
  standbyTimeFoldedOffset: 0,
  standbyTimeFoldedBaseColor: '#c88c7c',
  standbyTimeFoldedTopColor: '#f7f5f0',
  standbyTimeFoldedBottomColor: '#d4cec2',
  standbyTimeColor: '#ffffff',
  standbyTimeAnchorH: 'center',
  standbyTimeAnchorV: 'center',
  standbyTimeOffsetX: 0,
  standbyTimeOffsetY: -50,
  standbyShowDate: true,
  standbyDateSize: 16,
  standbyDateColor: '#cbd5e1',
  standbyDateLetterSpacing: 2,
  standbyDateAnchorH: 'center',
  standbyDateAnchorV: 'center',
  standbyDateOffsetX: 0,
  standbyDateOffsetY: 25,
};
// Persists and broadcasts together with the reassignment — previously the
// one caller (cast.ts's POST /api/cast/settings) had to remember to do both
// itself after calling this, which is exactly the kind of per-call-site
// discipline that already caused a real bug once (see ARCHITECTURE.md).
// Not called at module load (the disk-restore below assigns
// castSettingsState directly), so this never fires before the WebSocket
// server exists.
export function setCastSettingsState(next: any): void {
  castSettingsState = next;
  setDbConfig('cast_settings_v1', JSON.stringify(castSettingsState));
  broadcastWebSocket({ event: 'cast_design_updated', timestamp: Date.now(), data: { settings: castSettingsState } });
}

// castSettingsState lived in memory only — every deploy/restart silently
// reset it back to these hardcoded defaults, which looked to the user like
// their cast design vanishing "on refresh" (the browser refresh just
// happened to land after a restart, not because of the refresh itself).
// Persisted in the same config store as everything else in hubConfig.
const savedCastSettings = getDbConfig('cast_settings_v1', '');
if (savedCastSettings) {
  try {
    castSettingsState = { ...castSettingsState, ...JSON.parse(savedCastSettings) };
  } catch {}
}

// Named snapshots of the custom_design visual settings ("looks") a user can save
// and switch back to without re-tuning from scratch — persisted the same way as
// castSettingsState above, for the same reason (in-memory-only silently forgets
// everything on the next deploy/restart).
export let castDesignPresets: CastDesignPreset[] = [];
const savedCastDesignPresets = getDbConfig('cast_design_presets_v1', '');
if (savedCastDesignPresets) {
  try {
    castDesignPresets = JSON.parse(savedCastDesignPresets);
  } catch {}
}
export function setCastDesignPresets(next: CastDesignPreset[]): void {
  castDesignPresets = next;
  setDbConfig('cast_design_presets_v1', JSON.stringify(castDesignPresets));
}

export let gpioConfig: GpioDeviceConfig | null = null;

export function setGpioConfig(next: GpioDeviceConfig | null): void {
  gpioConfig = next;
  setDbConfig('gpio_config_v1', JSON.stringify(gpioConfig));
}

function triggerGpioAction(action: GpioAction): void {
  // Broadcast the raw detected action first — lets the settings UI show a
  // live test feed ("did my wiring actually trigger the right thing?")
  // independent of whatever applyVolumeChange/togglePlayback then do.
  broadcastWebSocket({ event: 'gpio_action', timestamp: Date.now(), data: { action } });
  if (action === 'volume_up') applyVolumeChange({ volume: playbackState.volume + VOLUME_STEP_PCT });
  else if (action === 'volume_down') applyVolumeChange({ volume: playbackState.volume - VOLUME_STEP_PCT });
  else if (action === 'play_pause') void togglePlayback();
}

export function enableGpioWatcher(): void {
  if (!gpioConfig) return;
  startGpioWatcher(gpioConfig, triggerGpioAction, () => {
    // The watcher died without us stopping it (lost permission on
    // /dev/gpiochip0, gpiomon killed out-of-band, etc). Flip the persisted
    // config back to disabled instead of leaving it silently claiming
    // "enabled" while nothing is actually watching, and broadcast so a
    // connected frontend doesn't have to poll to find out.
    if (gpioConfig) setGpioConfig({ ...gpioConfig, enabled: false });
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: 'GPIO-invoer uitgeschakeld — onverwacht gestopt' },
    });
  });
}

export function disableGpioWatcher(onStopped?: () => void): void {
  stopGpioWatcher(onStopped);
}

// Like castSettingsState above, this lived in memory only — every deploy/restart
// silently forgot the GPIO device mapping and left the watcher stopped.
// Persisted the same way; auto-restarts the watcher on boot if it was enabled.
const savedGpioConfig = getDbConfig('gpio_config_v1', '');
if (savedGpioConfig) {
  try {
    gpioConfig = JSON.parse(savedGpioConfig);
    if (gpioConfig?.enabled) enableGpioWatcher();
  } catch {}
}

function buildKioskUrl(layout?: string, themeId?: string): string {
  const myIp = '192.168.178.191';
  // The kiosk is a passive touchscreen appliance with no keyboard — it can
  // never go through the login screen the rest of the app now requires.
  // Its transport/volume/source-switch controls still need to make
  // authenticated mutating requests though, so a scoped credential
  // (audio:read/control/dac:configure — never admin:all, see
  // getOrCreateKioskApiKey) rides along; App.tsx picks it up once on load.
  // It's in the URL *fragment*, not a query param — fragments are never
  // sent in the HTTP request line, so even if this URL is later fronted
  // by a reverse proxy or otherwise logged server-side, the token itself
  // never appears in that log. (It's still visible to `catt`'s own argv
  // and to browser history on the kiosk device itself — inherent to
  // handing a fresh, keyboardless device a working credential at all;
  // the scoping above is what limits the actual blast radius of that.)
  return `http://${myIp}:3000/?kiosk=1&layout=${encodeURIComponent(layout || 'kiosk_touch')}&theme=${encodeURIComponent(themeId || 'obsidian')}#token=${encodeURIComponent(getOrCreateKioskApiKey())}`;
}

// Resolves what to cast to from explicit overrides (a request body), falling back to
// the saved Cast settings for anything omitted — so callers (the UI, or an external
// trigger like Home Assistant) don't have to know the device/layout/theme every time.
// `catt -d` accepts a friendly device name directly, so deviceName needs no avahi lookup.
export function resolveCastTarget(overrides: { deviceId?: string; deviceIp?: string; deviceName?: string; layout?: string; themeId?: string }) {
  const target =
    overrides.deviceName ||
    overrides.deviceIp ||
    overrides.deviceId ||
    castSettingsState.targetDeviceName ||
    castSettingsState.targetDeviceIp ||
    castSettingsState.targetDeviceId;
  // Same class of guard as nas.ts's mount host/path check — target ends up
  // as catt's `-d <target>` argv (execFile, no shell, so no injection risk),
  // but a leading "-" could still be parsed by catt itself as a flag rather
  // than a device name.
  if (!target || target.startsWith('-')) return null;
  return {
    target,
    layout: overrides.layout || castSettingsState.layout,
    themeId: overrides.themeId || castSettingsState.themeId,
  };
}

// Single gateway for every castSessionState write — reassigns, persists,
// and broadcasts together so no future call site can update the session
// and forget one of the other two (this is exactly how the session
// previously "forgot" it was active across a restart: the in-memory
// mutation happened but the setDbConfig call was missing from that one
// spot). Not exported — nothing outside this file writes castSessionState
// directly; route handlers only ever call startCast/stopCast/
// enterCastStandby/exitCastStandby below.
function updateCastSession(next: typeof castSessionState): void {
  castSessionState = next;
  setDbConfig('cast_session_v1', JSON.stringify(castSessionState));
  broadcastWebSocket({ event: 'cast_state_changed', timestamp: Date.now(), data: { session: castSessionState } });
}

export function startCast(resolved: { target: string; layout?: string; themeId?: string }) {
  const kioskUrl = buildKioskUrl(resolved.layout, resolved.themeId);
  console.log(`[Cast] Starting cast to '${resolved.target}' via catt...`);
  execFile('catt', ['-d', resolved.target, 'cast_site', kioskUrl], (err: any) => {
    if (err) console.warn('[CATT Error] start failed:', err.message);
  });
  updateCastSession({
    isCasting: true,
    isStandby: false,
    activeDeviceId: resolved.target,
    activeLayout: resolved.layout || 'kiosk_touch',
    startedAt: Date.now(),
    // Never stored/broadcast with the #token= fragment attached — this
    // state is readable via an unauthenticated GET and goes out over the
    // WebSocket to every connected client, neither of which is subject to
    // "fragments aren't sent over HTTP" (that only protects the kiosk
    // device's own initial page load). Nothing reads castUrl back to
    // re-cast, so redacting it here is free.
    castUrl: kioskUrl.split('#')[0],
  });
  hasPlayedSinceCastStart = false;
}

// autoStopOnPause only ever fired from one call site (external-source long
// silence) — pausing app-driven playback (NAS/Spotify/web radio, all of
// which share /api/playback/pause + /toggle, plus the separate Spotify
// Connect event-hook pause path in routes/spotify.ts) never triggered it at
// all, and castSettingsState.autoStopDelaySec (a real, saved UI setting)
// was never read anywhere. scheduleAutoStopCast is the single place both
// now apply. It used to hard-disconnect the cast (catt stop) once the delay
// elapsed, which tore down the Nest Hub's whole receiver page back to
// Google's own idle screen for a routine pause — now it enters standby
// instead: the session and page stay alive, showing a branded ready screen.
// cancelPendingAutoStopCast + exitCastStandby are both called from
// maybeAutoCast (itself called from every "something started/resumed
// playing" route), so a quick pause/resume within the delay window neither
// stops nor standbys a cast the user already resumed.
let pendingAutoStopTimer: ReturnType<typeof setTimeout> | null = null;

// Guards the idle-standby ticker below (not the explicit pause-triggered
// scheduleAutoStopCast call sites — those only ever fire once something WAS
// playing, so this is already true by then). Without this, a cast session
// that starts with nothing playing yet — the normal case, the user hasn't
// picked anything — got auto-stopped/standby'd out from under them by the
// ticker before they had a chance to start playback at all. Reset on every
// fresh startCast(), flipped true by maybeAutoCast() (fires on every genuine
// "playback started" action).
let hasPlayedSinceCastStart = false;

export function cancelPendingAutoStopCast(): void {
  if (pendingAutoStopTimer) {
    clearTimeout(pendingAutoStopTimer);
    pendingAutoStopTimer = null;
  }
}

// Standby belongs to whatever is actually SHOWING the kiosk page, and a cast
// session is only one of the two ways that happens — the Pi can just as well
// drive a screen on its own HDMI port (see enableLocalKioskDisplay, which
// runs chromium on ?kiosk=1 under systemd). Gating standby on
// castSessionState.isCasting alone meant a Pi with only a local screen and no
// Chromecast at all never entered standby: it sat on the last played track
// forever, which is exactly what the standby clock exists to replace.
// Cached rather than re-detected on every call because hasKioskDisplay() runs
// in the 1s ticker and detectKioskDisplayStatus() shells out to systemctl.
// But caching it ONCE at import time was wrong: hss-kiosk-display.service is
// ordered `After=hss.service`, so at the moment this module loads the kiosk
// unit is by definition not active yet. Every boot therefore cached `false`
// and the tuinhuis screen never entered standby again — until someone opened
// Settings, whose GET /api/setup/kiosk-display poll happens to refresh the
// flag. Same staleness for a service stopped or started from a shell. So:
// re-detect, but at most once per minute.
// ponytail: 60s TTL, cheap enough next to a 1s ticker; make it event-driven
// (systemd subscription) only if that ever shows up in a profile.
const KIOSK_DETECT_TTL_MS = 60_000;
let localKioskDisplayActive = false;
let kioskDisplayDetectedAt = 0;

export function setLocalKioskDisplayActive(active: boolean): void {
  localKioskDisplayActive = active;
  // An explicit set (enable/disable route, or a test) is fresher than
  // anything a re-detect could tell us, so it also restarts the TTL.
  kioskDisplayDetectedAt = Date.now();
}

function hasKioskDisplay(): boolean {
  if (Date.now() - kioskDisplayDetectedAt >= KIOSK_DETECT_TTL_MS) {
    setLocalKioskDisplayActive(piSetup.detectKioskDisplayStatus().serviceActive);
  }
  return castSessionState.isCasting || localKioskDisplayActive;
}

export function enterCastStandby(): void {
  if (!hasKioskDisplay() || castSessionState.isStandby) return;
  updateCastSession({ ...castSessionState, isStandby: true });
}

export function exitCastStandby(): void {
  if (!castSessionState.isStandby) return;
  updateCastSession({ ...castSessionState, isStandby: false });
}

export function scheduleAutoStopCast(): void {
  if (!hasKioskDisplay() || !castSettingsState.autoStopOnPause) return;
  cancelPendingAutoStopCast();
  // "Geef het apparaat terug" only means something when there IS a cast
  // device to hand back to Google's own idle screen. A local HDMI kiosk
  // screen has nothing to return to — stopCast() would just fire a
  // `catt -d '' stop` into the void and leave that screen frozen on the
  // last track — so it always gets standby regardless of this setting.
  const doStop =
    castSettingsState.autoStopReleasesDevice && castSessionState.isCasting ? () => stopCast() : enterCastStandby;
  const delayMs = Math.max(0, (castSettingsState.autoStopDelaySec || 0) * 1000);
  if (delayMs === 0) {
    doStop();
    return;
  }
  pendingAutoStopTimer = setTimeout(() => {
    pendingAutoStopTimer = null;
    doStop();
  }, delayMs);
}

// The real, hard disconnect — closes the Chromecast session entirely (the
// Nest Hub's receiver page unloads, screen returns to Google's own idle
// view). Used for an explicit user action (Settings' "stop casting" button,
// switching cast target), and by the auto-stop-on-pause path too when
// castSettingsState.autoStopReleasesDevice opts into it — see
// scheduleAutoStopCast/enterCastStandby above for the default (standby).
export function stopCast(targetOverride?: string) {
  const targetIp = targetOverride || (castSessionState.activeDeviceId ?? '');
  console.log(`[Cast] Stopping cast to '${targetIp}' via catt...`);
  execFile('catt', ['-d', targetIp, 'stop'], (err: any) => {
    if (err) console.warn('[CATT Error] stop failed:', err.message);
  });
  cancelPendingAutoStopCast();
  updateCastSession({
    isCasting: false,
    isStandby: false,
    activeDeviceId: null,
    activeLayout: 'kiosk_touch',
    startedAt: null,
    castUrl: '',
  });
}

// Fires on every genuine "start playback" action (not on skip/tick continuations)
// and unconditionally re-issues the cast — deliberately ignoring castSessionState.isCasting,
// since the Nest Hub may have dropped the cast on its own side without us finding out.
export function maybeAutoCast(): void {
  cancelPendingAutoStopCast();
  exitCastStandby();
  hasPlayedSinceCastStart = true;
  if (!castSettingsState.autoCastOnPlay) return;
  const resolved = resolveCastTarget({});
  if (!resolved) return;
  startCast(resolved);
}

// Web radio and NAS files both play through mpv, but "pause" doesn't mean
// the same thing for either: a NAS file has a real position to resume from
// (soft mpv pause, process stays alive), while a live stream doesn't — a
// soft pause on a stream just leaves mpv holding the ALSA device
// exclusively for no benefit, which blocks anything else (Spotify Connect
// in particular) from opening that device until the source changes.
// Reproduced live: a paused-not-stopped web radio stream made every
// Spotify Connect playback attempt fail with "Device or resource busy".
// So a stream gets fully stopped on pause and restarted from live on
// resume instead of soft-paused/resumed.
function isRadioTrack(track: Track | null): boolean {
  return !!track?.uri && /^https?:\/\//i.test(track.uri);
}

// True whenever there's a local (NAS or radio) track selected as the
// current source — including a radio stream that's currently fully
// stopped (see isRadioTrack above), which isLocalPlayerActive() alone
// would miss since mpv isn't running for that case. Callers use this
// instead of isLocalPlayerActive() to decide whether play/pause should
// route to the local player or to Spotify Connect.
export function hasLocalSource(): boolean {
  return isLocalPlayerActive() || isRadioTrack(playbackState.currentTrack);
}

export async function pauseOrResumeLocal(willPlay: boolean): Promise<boolean> {
  const track = playbackState.currentTrack;
  if (isRadioTrack(track)) {
    if (willPlay) startLocalAudio(track);
    else stopLocal();
    return true;
  }
  return willPlay ? resumeLocal() : pauseLocal();
}

export async function togglePlayback(): Promise<{ success: boolean; isPlaying?: boolean; error?: string }> {
  const wasPlaying = playbackState.isPlaying;
  const willPlay = !wasPlaying;
  if (hasLocalSource()) {
    // mpv's IPC socket can still be connecting for a few seconds right after
    // playback starts — a command sent in that window is a genuine no-op,
    // not a success, so this must be checked rather than assumed like the
    // Spotify branch below already does.
    const sent = await pauseOrResumeLocal(willPlay);
    if (!sent) {
      return { success: false, error: 'Lokale speler (mpv) is nog niet verbonden — probeer het over een paar seconden opnieuw.' };
    }
  } else {
    // Was piHardware.sendMediaCommand (playerctl/MPRIS) — playerctl isn't
    // installed on the Pi, and stock librespot has no MPRIS interface for
    // it to control anyway, so this silently did nothing for a real
    // Spotify Connect session. The Web API against the Connect device
    // (same mechanism as playSpotifyUri) actually works.
    const result = await sendSpotifyPlayerCommand(willPlay ? 'resume' : 'pause');
    if (!result.success) {
      return { success: false, error: result.error };
    }
  }
  playbackState.isPlaying = willPlay;
  if (!willPlay) {
    playbackState.spectrum = Array(16).fill(0);
    scheduleAutoStopCast();
  } else if (!wasPlaying) {
    maybeAutoCast();
    stopExternalListening(); // resuming the app's own source takes back the input
  }
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: playbackState.isPlaying, positionMs: playbackState.positionMs },
  });
  return { success: true, isPlaying: playbackState.isPlaying };
}

export { execFile };
