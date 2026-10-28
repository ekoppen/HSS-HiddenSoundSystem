// Owns a single `mpv` child process for NAS/local files and web radio streams
// — the two sources that, unlike Spotify Connect (which has its own
// independent `librespot` ALSA daemon), have no player of their own.
// Controlled over mpv's JSON IPC socket so play/pause/seek/next don't require
// killing and respawning the process.
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import { clearHealthIssue, reportHealthIssue } from './healthLog.ts';

// Private, owner-only runtime dir for the mpv control socket — not directly
// under /tmp, since that's world-writable and the socket is an unauthenticated
// control channel (anyone who can connect to it can drive playback).
const RUNTIME_DIR = '/tmp/hss-player';
const IPC_SOCKET = `${RUNTIME_DIR}/mpv-ipc.sock`;
const REQUEST_TIMEOUT_MS = 800;

let mpvProcess: ChildProcess | null = null;
let ipcClient: net.Socket | null = null;
let ipcBuffer = '';
let endedCallback: (() => void) | null = null;
let nextRequestId = 1;
const pending = new Map<number, (result: any) => void>();

/**
 * `target` becomes an argv element passed straight to mpv. Reject anything
 * that could be misread as a flag (argv smuggling) or that isn't a plausible
 * local path / URL — this runs before the `--` end-of-options guard in
 * playLocal() below, as defense in depth rather than the only guard.
 */
function isSafeTarget(target: string): boolean {
  if (!target || target.startsWith('-')) return false;
  return /^\//.test(target) || /^https?:\/\//i.test(target);
}

function ensureRuntimeDir(): void {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // ignore — best-effort, chmod below still runs
  }
  try {
    fs.chmodSync(RUNTIME_DIR, 0o700);
  } catch {
    // fine if it doesn't exist yet somehow
  }
}

function cleanupSocketFile(): void {
  try {
    fs.unlinkSync(IPC_SOCKET);
  } catch {
    // fine if it never existed
  }
}

function handleIpcLine(line: string): void {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.request_id && pending.has(msg.request_id)) {
    pending.get(msg.request_id)!(msg);
    pending.delete(msg.request_id);
  } else if (msg.event === 'end-file' && msg.reason === 'eof') {
    endedCallback?.();
  }
}

function connectIpc(): void {
  if (!mpvProcess) return;
  const socket = net.createConnection(IPC_SOCKET);
  socket.on('connect', () => {
    ipcClient = socket;
    clearHealthIssue('mpv-spawn-failed');
    // Belt and suspenders alongside the 0700 runtime dir: mpv creates this
    // file itself, so lock it down once it exists rather than assuming its
    // default mode is restrictive enough on its own.
    try {
      fs.chmodSync(IPC_SOCKET, 0o600);
    } catch {
      // non-fatal — directory perms are the primary guard
    }
  });
  socket.on('data', (chunk) => {
    ipcBuffer += chunk.toString();
    let idx: number;
    while ((idx = ipcBuffer.indexOf('\n')) !== -1) {
      handleIpcLine(ipcBuffer.slice(0, idx));
      ipcBuffer = ipcBuffer.slice(idx + 1);
    }
  });
  socket.on('error', () => {
    // Used to give up after 20 tries (~3s) — on this app's actual target
    // (a Pi 3B+, seen pegged at load average 4+ with a full chromium kiosk
    // running alongside it), the initial connect can lose that race
    // entirely, permanently stranding playback control for the rest of
    // the track with no further attempt ever made. mpv's own lifecycle is
    // what bounds this now (mpvProcess going null on real exit), not an
    // arbitrary attempt count — retrying is cheap, giving up isn't.
    if (mpvProcess) setTimeout(() => connectIpc(), 150);
  });
  socket.on('close', () => {
    // Every failed connect attempt also fires 'close' right after 'error' —
    // that case is already retried above with a decrementing budget. Only
    // reconnect here for a socket that had actually connected and then
    // later dropped (ipcClient === socket): reconnecting on every close
    // unconditionally double-fired a fresh, unbounded reconnect attempt on
    // top of every already-scheduled retry, a runaway storm that leaked
    // thousands of sockets/fds within minutes (seen live on the tuinhuis
    // Pi — the box went entirely unresponsive while mpv itself, unaffected,
    // kept playing fine).
    const wasActive = ipcClient === socket;
    if (wasActive) {
      ipcClient = null;
      if (mpvProcess) setTimeout(() => connectIpc(), 250);
    }
  });
}

// Returns whether the command was actually sent — callers that report their
// own success back to the user (togglePlayback in particular) need this.
// mpv's IPC socket takes up to ~3s to come up after playLocal() spawns the
// process (connectIpc retries at 150ms intervals): rather than dropping a
// command sent inside that window, poll briefly for the connection so
// pause/resume clicked right after a source switch doesn't dead-end with a
// "try again" error.
async function sendCommand(command: unknown[]): Promise<boolean> {
  // connectIpc() now retries indefinitely in the background (see its own
  // comment) rather than giving up after a fixed budget, so this wait is
  // just how long *this one* command is willing to sit before reporting
  // "not connected yet" — the background retry keeps going regardless and
  // the next click a few seconds later will usually go straight through.
  for (let waited = 0; !ipcClient && mpvProcess && waited < 3500; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ipcClient) return false;
  try {
    ipcClient.write(JSON.stringify({ command }) + '\n');
    return true;
  } catch {
    return false;
  }
}

function sendRequest(command: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    if (!ipcClient) return resolve(null);
    const id = nextRequestId++;
    pending.set(id, resolve);
    try {
      ipcClient.write(JSON.stringify({ command, request_id: id }) + '\n');
    } catch {
      pending.delete(id);
      return resolve(null);
    }
    setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, REQUEST_TIMEOUT_MS);
  });
}

/**
 * Starts playing a local file path or stream URL, replacing anything already
 * playing. Targets ALSA's `eq` device directly — the same EQ/balance chain
 * /etc/asound.conf defines for `default` to route through before the real
 * hardware — rather than the bare "default" alias itself: confirmed live
 * (speaker-test/aplay, including as root via systemd-run, matching how
 * hss.service actually runs) that plain `default` fails to open at all on
 * this box, most likely a stray per-user ~/.asoundrc overriding it, while
 * `eq` — the literal named PCM this app already defines for exactly this —
 * opens and plays every time. Naming it directly sidesteps ALSA's "default"
 * resolution entirely instead of depending on it behaving.
 */
export function playLocal(target: string, onEnded: () => void): void {
  if (!isSafeTarget(target)) {
    console.warn('[LocalPlayer] Geweigerd: onverwacht doel voor afspelen (geen absoluut pad of http(s)-URL):', target);
    stopLocal();
    return;
  }
  stopLocal();
  endedCallback = onEnded;
  ensureRuntimeDir();
  cleanupSocketFile();
  const isStream = /^https?:\/\//i.test(target);
  const child = spawn(
    'mpv',
    [
      '--no-video',
      '--idle=no',
      '--audio-device=alsa/eq',
      `--input-ipc-server=${IPC_SOCKET}`,
      '--really-quiet',
      // Web radio streams run their own broadcast loudness processing — measured
      // live at -10 to -11 LUFS with true peaks as high as -0.16dBTP (vs.
      // Spotify's -14 LUFS/-1dBTP norm), leaving almost no headroom in the
      // shared EQ/volume chain (/etc/asound.conf's `eq` device, used by both
      // mpv and librespot). Audible as bass "kraken" on radio only, gone the
      // instant the bass EQ band is nudged down, confirming it's a headroom
      // problem, not a broken stream. Trimmed here, in mpv itself, so it only
      // ever applies to streams — NAS files and Spotify are untouched.
      ...(isStream ? ['--af=volume=-4dB'] : []),
      // Everything after `--` is treated as a positional filename, never as a
      // flag — the actual guard against argv injection via `target`.
      '--',
      target,
    ],
    { stdio: 'ignore' },
  );
  mpvProcess = child;
  child.on('exit', () => {
    // The old process being killed in the stopLocal() above fires its own
    // (delayed) exit event — only clear shared state if WE are still the
    // current player, so that doesn't clobber a newer process's reference.
    if (mpvProcess === child) {
      mpvProcess = null;
      ipcClient?.destroy();
      ipcClient = null;
    }
  });
  child.on('error', (e) => {
    console.warn('[LocalPlayer] mpv kon niet starten (is het geïnstalleerd? `sudo apt-get install mpv`):', e.message);
    reportHealthIssue('mpv-spawn-failed', 'playback', 'error', `mpv kon niet starten: ${e.message} — is mpv geïnstalleerd?`);
  });
  setTimeout(() => connectIpc(), 250);
}

export function pauseLocal(): Promise<boolean> {
  return sendCommand(['set_property', 'pause', true]);
}

export function resumeLocal(): Promise<boolean> {
  return sendCommand(['set_property', 'pause', false]);
}

export function seekLocal(positionMs: number): void {
  void sendCommand(['seek', positionMs / 1000, 'absolute']);
}

export function stopLocal(): void {
  endedCallback = null;
  if (mpvProcess) {
    try {
      mpvProcess.kill();
    } catch {
      // already gone
    }
    mpvProcess = null;
  }
  ipcClient?.destroy();
  ipcClient = null;
  cleanupSocketFile();
}

export function isLocalPlayerActive(): boolean {
  return mpvProcess !== null;
}

export async function getLocalPositionMs(): Promise<number | null> {
  const res = await sendRequest(['get_property', 'time-pos']);
  return res && typeof res.data === 'number' ? Math.round(res.data * 1000) : null;
}

/** Icecast/Shoutcast "now playing" tag (StreamTitle) for a web radio stream.
 * There's no standalone "icy-title" mpv property (confirmed live: mpv
 * returns "property not found" for it) — it only shows up as a key inside
 * the `metadata` object, alongside icy-name/icy-genre/etc. null when the
 * stream doesn't send one, or between songs on stations that blank it out. */
export async function getLocalIcyTitle(): Promise<string | null> {
  const res = await sendRequest(['get_property', 'metadata']);
  const title = res?.data?.['icy-title'];
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

/**
 * Pure split of a raw ICY StreamTitle into title/artist — no IPC, directly
 * unit-testable. "Artist - Title" is the common StreamTitle convention;
 * with no " - " separator the whole string is treated as the title and
 * artist is left undefined (falls back to whatever's already showing,
 * e.g. the station's own genre).
 */
export function parseIcyTitle(raw: string): { title: string; artist?: string } {
  const sep = raw.indexOf(' - ');
  if (sep <= 0) return { title: raw };
  return { title: raw.slice(sep + 3).trim(), artist: raw.slice(0, sep).trim() };
}

/**
 * A station's own sweep/jingle/ID sometimes surfaces as a StreamTitle too
 * (e.g. "PINGUIN_CLASSICS_SWEEP_06  -", confirmed live on Pinguin Radio) —
 * shouting_snake_case text a real song title never looks like. Catching it
 * here means it's filtered once, at the source, instead of guessing per
 * station — it never overwrites the now-playing screen and never lands in
 * the like/log history.
 */
export function looksLikeStationJingle(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.includes('_') && t === t.toUpperCase() && t !== t.toLowerCase();
}

// Don't leave an orphaned mpv process behind when the server exits/restarts.
process.on('exit', stopLocal);
process.on('SIGTERM', () => {
  stopLocal();
  process.exit(0);
});
