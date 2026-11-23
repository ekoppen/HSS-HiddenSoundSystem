// Multiroom via Snapcast: one hub (the leader) runs snapserver, and its mpv
// and librespot write raw PCM into the snapserver fifo instead of straight
// to ALSA. Every hub in the group — the leader included — runs snapclient,
// which plays that stream in sync into its own local ALSA chain (so EQ and
// the hardware volume stay per room).
//
// All of it is runtime-only: the group lives in memory here, and the systemd
// overrides go in /run, which a reboot wipes. An HSS restart calls
// resetToSolo() at startup to clear leftovers. So a crash or reboot always
// lands back on today's solo behaviour, never in a half-grouped state.
// ponytail: groups don't survive a restart — persist them if that annoys.
//
// Gotchas found live in the phase 0 test (2026-11-23), all reflected below:
// - snapclient runs as root: the EQ state lives in /root/.alsaequal.bin,
//   as its own _snapclient user the EQ silently went flat.
// - `--soundcard eq` substring-matches `eqbase` (FLOAT_LE only) and dies;
//   `default` is the same plug -> eqbase chain and matches exactly.
// - The fifo lives in snapserver's home, not /tmp: fs.protected_fifos
//   blocks root from opening a fifo owned by another user in /tmp.
// - Sampleformat must be 44100:16:2 to match librespot's pipe output.
import { execFileSync } from 'child_process';
import fs from 'fs';
import { clearHealthIssue, reportHealthIssue } from './healthLog.ts';
import { setLocalAudioOutput } from './localPlayer.ts';

export const SNAP_FIFO = '/var/lib/snapserver/snapfifo';
export const SNAP_STREAM_PORT = 1704;
const RUNTIME_DIR = '/run/hss-multiroom';
const SNAPSERVER_CONF = `${RUNTIME_DIR}/snapserver.conf`;
const LIBRESPOT_UNIT = 'librespot-hss';
const LIBRESPOT_UNIT_FILE = `/etc/systemd/system/${LIBRESPOT_UNIT}.service`;
const DROPIN_NAME = 'hss-multiroom.conf';
const HEALTH_ID = 'multiroom';

export type MultiroomRole = 'solo' | 'leader' | 'follower';

export interface MultiroomState {
  role: MultiroomRole;
  /** follower: base URL of the leader's HSS API */
  leaderUrl: string | null;
  /** leader: known_hubs ids currently following */
  memberHubIds: string[];
}

let state: MultiroomState = { role: 'solo', leaderUrl: null, memberHubIds: [] };

export function getMultiroomState(): MultiroomState {
  return { ...state, memberHubIds: [...state.memberHubIds] };
}

export function setMemberHubIds(ids: string[]): void {
  state.memberHubIds = [...ids];
}

// --- pure builders (unit-tested) ------------------------------------------

/** Strips the IPv4-mapped prefix Node puts on remoteAddress. Throws on anything that isn't a plain host/IP. */
export function normalizeHost(raw: string | undefined): string {
  const host = (raw || '').replace(/^::ffff:/, '');
  if (!/^[A-Za-z0-9.:-]{1,253}$/.test(host)) throw new Error(`Ongeldig adres voor leider: '${raw}'`);
  return host;
}

export function snapclientDropIn(host: string): string {
  const safeHost = normalizeHost(host);
  const hostPart = safeHost.includes(':') ? `[${safeHost}]` : safeHost;
  return [
    '[Service]',
    'User=root',
    'Group=root',
    'ExecStart=',
    `ExecStart=/usr/bin/snapclient --logsink=system --player alsa --soundcard default tcp://${hostPart}:${SNAP_STREAM_PORT}`,
    '',
  ].join('\n');
}

export function snapserverConf(): string {
  return [
    '[stream]',
    `source = pipe://${SNAP_FIFO}?name=HSS&sampleformat=44100:16:2`,
    '[http]',
    'doc_root = /usr/share/snapserver/snapweb',
    '',
  ].join('\n');
}

export function snapserverDropIn(): string {
  return [
    '[Service]',
    'ExecStart=',
    `ExecStart=/usr/bin/snapserver --logging.sink=system --server.datadir=/var/lib/snapserver -c ${SNAPSERVER_CONF}`,
    '',
  ].join('\n');
}

/**
 * Derives the librespot drop-in from the unit file actually on disk instead
 * of a template: the two Pi's differ (binary path, --system-cache), and the
 * device name/bitrate must stay whatever provisioning set.
 */
export function librespotPipeDropIn(unitFile: string): string {
  const lines = unitFile.split('\n').filter((l) => /^ExecStart=\S/.test(l.trim()));
  const execStart = lines[lines.length - 1]?.trim();
  if (!execStart) throw new Error('Geen ExecStart in librespot-unit gevonden');
  if (!/--backend\s+\S+/.test(execStart)) throw new Error('librespot ExecStart heeft geen --backend');
  let piped = execStart.replace(/--backend\s+\S+/, '--backend pipe');
  piped = /--device\s+\S+/.test(piped)
    ? piped.replace(/--device\s+\S+/, `--device ${SNAP_FIFO}`)
    : `${piped} --device ${SNAP_FIFO}`;
  return ['[Service]', 'ExecStart=', piped, ''].join('\n');
}

// --- system side (Linux only) ---------------------------------------------

const isLinux = process.platform === 'linux';

function systemctl(...args: string[]): void {
  execFileSync('systemctl', args, { stdio: 'pipe', timeout: 30_000 });
}

function dropInPath(unit: string): string {
  return `/run/systemd/system/${unit}.service.d/${DROPIN_NAME}`;
}

function writeDropIn(unit: string, content: string): void {
  fs.mkdirSync(`/run/systemd/system/${unit}.service.d`, { recursive: true });
  fs.writeFileSync(dropInPath(unit), content, 'utf8');
}

function fail(action: string, e: any): never {
  const msg = `Multiroom: ${action} mislukt — ${e?.stderr?.toString().trim() || e?.message || e}`;
  console.error(`[Multiroom] ${msg}`);
  reportHealthIssue(HEALTH_ID, 'multiroom', 'error', msg);
  throw new Error(msg);
}

/** Leader: snapserver + local snapclient, librespot and mpv into the fifo. */
export async function becomeLeader(): Promise<void> {
  if (state.role === 'leader') return;
  if (!isLinux) {
    console.warn('[Multiroom] Geen Linux — leider-rol alleen gesimuleerd.');
    state = { role: 'leader', leaderUrl: null, memberHubIds: [] };
    return;
  }
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(SNAPSERVER_CONF, snapserverConf(), { mode: 0o644 });
    writeDropIn('snapserver', snapserverDropIn());
    writeDropIn('snapclient', snapclientDropIn('127.0.0.1'));
    writeDropIn(LIBRESPOT_UNIT, librespotPipeDropIn(fs.readFileSync(LIBRESPOT_UNIT_FILE, 'utf8')));
    systemctl('unmask', 'snapserver', 'snapclient');
    systemctl('daemon-reload');
    // Order matters — `eq` has no dmix, one opener at a time:
    // snapserver first (it creates the fifo), then both players move off
    // ALSA into the fifo, and only then may snapclient open the DAC.
    systemctl('restart', 'snapserver');
    systemctl('restart', LIBRESPOT_UNIT);
    await setLocalAudioOutput(SNAP_FIFO);
    await new Promise((r) => setTimeout(r, 300)); // let the old mpv actually exit and release ALSA
    systemctl('restart', 'snapclient');
  } catch (e) {
    await resetToSolo();
    fail('leider worden', e);
  }
  state = { role: 'leader', leaderUrl: null, memberHubIds: [] };
  clearHealthIssue(HEALTH_ID);
  console.log('[Multiroom] Deze hub is nu leider van een groep.');
}

/**
 * Follower: librespot off (else the phone shows this room as a separate
 * Spotify device, and it would fight snapclient for ALSA), snapclient on,
 * pointed at the leader. The caller stops local mpv/app state first.
 */
export async function becomeFollower(leaderHost: string, leaderUrl: string): Promise<void> {
  if (!isLinux) {
    console.warn('[Multiroom] Geen Linux — volger-rol alleen gesimuleerd.');
    state = { role: 'follower', leaderUrl, memberHubIds: [] };
    return;
  }
  try {
    writeDropIn('snapclient', snapclientDropIn(leaderHost));
    systemctl('stop', LIBRESPOT_UNIT);
    systemctl('unmask', 'snapclient');
    systemctl('daemon-reload');
    systemctl('restart', 'snapclient');
  } catch (e) {
    await resetToSolo();
    fail('volger worden', e);
  }
  // mpv was already stopped by the caller; nothing to move.
  state = { role: 'follower', leaderUrl, memberHubIds: [] };
  clearHealthIssue(HEALTH_ID);
  console.log(`[Multiroom] Deze hub speelt nu mee met ${leaderUrl}.`);
}

/**
 * Back to normal: snapcast off and masked again, overrides gone, librespot
 * back on its ALSA unit. Safe to call any time (also at startup); each step
 * is best-effort so one missing piece doesn't leave the rest grouped.
 */
export async function resetToSolo(): Promise<void> {
  const hadOverrides = isLinux && [LIBRESPOT_UNIT, 'snapclient', 'snapserver'].some((u) => fs.existsSync(dropInPath(u)));
  const wasGrouped = state.role !== 'solo';
  state = { role: 'solo', leaderUrl: null, memberHubIds: [] };
  if (!isLinux || (!hadOverrides && !wasGrouped)) {
    await setLocalAudioOutput(null);
    return;
  }

  const step = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      console.error(`[Multiroom] Terugzetten: ${label} mislukt:`, e?.stderr?.toString().trim() || e?.message);
      reportHealthIssue(HEALTH_ID, 'multiroom', 'warning', `Multiroom terugzetten: ${label} mislukt`);
    }
  };
  step('snapcast stoppen', () => systemctl('stop', 'snapclient', 'snapserver'));
  step('snapcast maskeren', () => systemctl('mask', 'snapclient', 'snapserver'));
  for (const unit of [LIBRESPOT_UNIT, 'snapclient', 'snapserver']) {
    step(`override ${unit} verwijderen`, () => fs.rmSync(dropInPath(unit), { force: true }));
  }
  step('daemon-reload', () => systemctl('daemon-reload'));
  // restart, not start: on a former leader librespot is still running with
  // the pipe backend in memory.
  step('librespot herstarten', () => systemctl('restart', LIBRESPOT_UNIT));
  // Only now: snapclient has let go of the DAC, so mpv can reopen `eq`.
  await setLocalAudioOutput(null);
  console.log('[Multiroom] Terug naar solo.');
}
