// Watches the systemd units this app depends on and turns their failures
// into something visible in the UI. Born from a real one: librespot crashed
// on every single Spotify track for two days straight, systemd dutifully
// restarted it every 5 seconds, and nothing anywhere said a word — Spotify
// just "did nothing". An auto-restarting service is exactly the kind of
// failure that hides itself, because from the outside it always looks alive.
//
// Reports through healthLog.ts, so problems land in the same
// "Systeemwaarschuwingen" card (and sidebar dot) as every other
// previously-silent failure.
import { execSync } from 'child_process';
import { clearHealthIssue, reportHealthIssue } from './healthLog.ts';

export interface ServiceStatus {
  unit: string;
  label: string;
  /** ActiveState is 'active' — the service is up right now. */
  active: boolean;
  /** systemd's ActiveState/SubState, e.g. "active (running)". */
  state: string;
  /** NRestarts: how often systemd restarted it since the last reset-failed. */
  restarts: number;
  startedAt: number | null;
  /** Whether the UI may offer a restart button — see WATCHED_SERVICES. */
  restartable: boolean;
}

/** `hss` itself is deliberately absent as a restart target: restarting it
 * from a request it is currently serving kills that request, and a stop
 * that fails to come back leaves no way in except SSH. Its own restart path
 * is the update/reboot flow, which is built to survive that. */
const WATCHED_SERVICES: { unit: string; label: string; restartable: boolean }[] = [
  { unit: 'hss', label: 'HSS webserver', restartable: false },
  { unit: 'librespot-hss', label: 'Spotify Connect (librespot)', restartable: true },
  { unit: 'hss-kiosk-display', label: 'Kioskscherm (HDMI)', restartable: true },
];

export function isRestartableUnit(unit: string): boolean {
  return WATCHED_SERVICES.some((s) => s.unit === unit && s.restartable);
}

/** systemd prints "Sun 2026-09-06 20:13:00 CEST", which Date.parse() reads as
 * NaN (verified in node) — trusting it would have left every "sinds ..." in
 * the UI silently empty. Handles the `@1788718380` form too, which systemd
 * >= 250 emits under --timestamp=unix. The human form carries the Pi's own
 * zone abbreviation, which is the zone this process runs in, so reading the
 * parts as local time is correct. */
export function parseSystemdTimestamp(raw: string): number | null {
  const value = (raw || '').trim();
  if (!value || value === 'n/a') return null;

  const unix = value.match(/^@(\d+)/);
  if (unix) return Number(unix[1]) * 1000;

  const m = value.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const time = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6])
  ).getTime();
  return Number.isNaN(time) ? null : time;
}

/** One `systemctl show` per unit. Units that aren't installed on this Pi are
 * left out entirely rather than reported as broken — librespot is absent
 * when the raspotify repo was unreachable during setup, and the kiosk
 * display only exists on the Pi that drives an HDMI screen. Reporting
 * "not installed" as a fault would mean one permanent false alarm on every
 * install that simply doesn't have that piece. */
export function readServiceStatuses(): ServiceStatus[] {
  if (process.platform !== 'linux') return [];
  const statuses: ServiceStatus[] = [];

  for (const { unit, label, restartable } of WATCHED_SERVICES) {
    try {
      const out = execSync(
        `systemctl show ${unit} -p LoadState -p ActiveState -p SubState -p NRestarts -p ActiveEnterTimestamp --no-pager 2>/dev/null || true`,
        { encoding: 'utf8', timeout: 5000 }
      );
      const props = new Map<string, string>();
      for (const line of out.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) props.set(line.slice(0, eq), line.slice(eq + 1).trim());
      }
      if (props.get('LoadState') !== 'loaded') continue;

      const activeState = props.get('ActiveState') || 'unknown';
      const subState = props.get('SubState') || '';

      statuses.push({
        unit,
        label,
        active: activeState === 'active',
        state: subState ? `${activeState} (${subState})` : activeState,
        restarts: Number(props.get('NRestarts') || 0) || 0,
        startedAt: parseSystemdTimestamp(props.get('ActiveEnterTimestamp') || ''),
        restartable,
      });
    } catch (e: any) {
      // systemctl itself failed (not on systemd, or it timed out) — that is
      // about our ability to look, not about the service, so don't dress it
      // up as a service fault.
      console.error(`[ServiceWatchdog] kon status van ${unit} niet lezen:`, e?.message || e);
    }
  }
  return statuses;
}

/** How many restarts within one polling interval read as "stuck in a loop"
 * rather than "someone just deployed". A deploy bumps NRestarts by exactly
 * one; librespot's crash loop managed roughly six per 30 seconds. */
const CRASH_LOOP_RESTARTS = 2;

export interface WatchdogVerdict {
  report: { id: string; severity: 'warning' | 'error'; message: string }[];
  clear: string[];
}

/** Pure decision step, kept separate from both systemd and healthLog so the
 * thresholds can be tested without either. `previous` is the sample from the
 * last tick, or null on the very first one — a first tick never reports a
 * crash loop, because a single sample says nothing about a trend (a high
 * NRestarts may be days-old history that is already over). */
export function evaluateServices(
  previous: ServiceStatus[] | null,
  current: ServiceStatus[]
): WatchdogVerdict {
  const verdict: WatchdogVerdict = { report: [], clear: [] };

  for (const svc of current) {
    const id = `service-${svc.unit}`;
    const before = previous?.find((p) => p.unit === svc.unit);
    const restartedSince = before ? svc.restarts - before.restarts : 0;

    if (restartedSince >= CRASH_LOOP_RESTARTS) {
      // Deliberately ranked above "not active": a service that keeps dying
      // and being revived reads as "active" at most moments you look at it,
      // which is exactly how this stayed invisible for two days.
      verdict.report.push({
        id,
        severity: 'error',
        message: `${svc.label} start steeds opnieuw op (${restartedSince}x sinds de vorige controle, ${svc.restarts}x in totaal) — hij crasht waarschijnlijk telkens meteen. Kijk met: sudo journalctl -u ${svc.unit} -n 50`,
      });
    } else if (!svc.active) {
      verdict.report.push({
        id,
        severity: 'error',
        message: `${svc.label} draait niet (${svc.state}).`,
      });
    } else {
      verdict.clear.push(id);
    }
  }

  // A unit that disappeared between ticks (uninstalled) shouldn't leave a
  // warning behind that nothing can ever clear.
  for (const before of previous || []) {
    if (!current.some((c) => c.unit === before.unit)) verdict.clear.push(`service-${before.unit}`);
  }

  return verdict;
}

let previousSample: ServiceStatus[] | null = null;

export function checkServices(): ServiceStatus[] {
  const current = readServiceStatuses();
  if (current.length === 0) return current; // not on a Pi, or systemd unreadable

  const verdict = evaluateServices(previousSample, current);
  for (const r of verdict.report) reportHealthIssue(r.id, 'systemd', r.severity, r.message);
  for (const id of verdict.clear) clearHealthIssue(id);

  previousSample = current;
  return current;
}

/** Restarts one unit. Whitelisted by WATCHED_SERVICES.restartable so a bad
 * request can never turn this into "run any systemctl command you like". */
export function restartService(unit: string): { success: boolean; error?: string } {
  if (!isRestartableUnit(unit)) return { success: false, error: `Dienst ${unit} mag niet herstart worden` };
  if (process.platform !== 'linux') return { success: false, error: 'Alleen op de Pi beschikbaar' };
  try {
    // reset-failed first: a unit that hit systemd's start-limit is refused a
    // plain restart ("start request repeated too quickly"), which is exactly
    // the state a crash loop leaves behind — i.e. precisely when someone
    // presses this button.
    execSync(`systemctl reset-failed ${unit} 2>/dev/null || true`, { timeout: 10000 });
    execSync(`systemctl restart ${unit}`, { timeout: 30000 });
    previousSample = null; // the restart we just caused isn't a crash loop
    return { success: true };
  } catch (e: any) {
    const message = e?.stderr?.toString?.().trim() || e?.message || 'onbekende fout';
    console.error(`[ServiceWatchdog] herstart van ${unit} mislukt:`, message);
    return { success: false, error: message };
  }
}

const CHECK_INTERVAL_MS = 30 * 1000;
let timer: NodeJS.Timeout | null = null;

/** Started explicitly from server.ts rather than on import, so importing this
 * module in a test doesn't leave a timer running (see ARCHITECTURE.md on
 * unclausured setInterval calls hanging the test process). */
export function startServiceWatchdog(): void {
  if (timer) return;
  checkServices();
  timer = setInterval(checkServices, CHECK_INTERVAL_MS);
}
