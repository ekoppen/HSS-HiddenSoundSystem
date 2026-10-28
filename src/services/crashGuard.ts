// Last line of defense against an unhandled runtime error taking down the
// whole hss.service process silently. systemd's Restart=always (setup.sh)
// already brings the process back within a few seconds, and repeated
// crashes are already caught by serviceWatchdog.ts's crash-loop detection —
// but a single, one-off crash is otherwise invisible in the app itself:
// serviceWatchdog explicitly treats exactly one restart between ticks as
// "a deploy, silent". This closes that gap the same way state.ts already
// does for a rolled-back update (see UPDATE_RESULT_MARKER): write what went
// wrong to a marker file the crash itself survives, exit deliberately, and
// let the next boot read + report it once via healthLog.ts.
//
// No dependency on db.ts/state.ts — same "standalone leaf module" reasoning
// as healthLog.ts, so this can be installed as early as possible in
// server.ts, before anything else has a chance to start.
import fs from 'fs';
import { reportHealthIssue } from './healthLog.ts';

const CRASH_MARKER_PATH = '/etc/hss/.crash-marker';

export type CrashKind = 'uncaughtException' | 'unhandledRejection';

export interface CrashRecord {
  kind: CrashKind;
  message: string;
  stack: string | null;
  timestamp: number;
}

/** Pure: turns whatever a crash handler receives (an Error, or — for
 * unhandledRejection — any rejection reason at all) into a plain record.
 * No fs/process here, so this is the part that's actually unit-testable. */
export function buildCrashRecord(kind: CrashKind, error: unknown): CrashRecord {
  const isError = error instanceof Error;
  return {
    kind,
    message: isError ? error.message : String(error),
    stack: isError ? error.stack || null : null,
    timestamp: Date.now(),
  };
}

function writeCrashMarker(record: CrashRecord): void {
  try {
    if (!fs.existsSync('/etc/hss')) fs.mkdirSync('/etc/hss', { recursive: true });
    fs.writeFileSync(CRASH_MARKER_PATH, JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // A handler that itself fails to write must never throw again — that
    // would just trigger a second uncaughtException mid-handler.
  }
}

function handleFatal(kind: CrashKind, error: unknown): void {
  // journalctl already keeps this via stderr regardless of the marker file.
  console.error(`[crashGuard] ${kind}:`, error);
  writeCrashMarker(buildCrashRecord(kind, error));
  // Deliberate, synchronous exit — Node's own guidance after an uncaught
  // exception is to do only synchronous cleanup and shut down, since
  // internal state past this point is unreliable. systemd restarts us.
  process.exit(1);
}

export function installCrashGuard(): void {
  process.on('uncaughtException', (error) => handleFatal('uncaughtException', error));
  process.on('unhandledRejection', (reason) => handleFatal('unhandledRejection', reason));
}

/** Called once at boot (state.ts, next to UPDATE_RESULT_MARKER) — reports
 * the previous run's crash, if any, then clears the marker so it's only
 * ever reported once. */
export function reportPreviousCrashIfAny(): void {
  try {
    if (!fs.existsSync(CRASH_MARKER_PATH)) return;
    const record: CrashRecord = JSON.parse(fs.readFileSync(CRASH_MARKER_PATH, 'utf8'));
    const when = new Date(record.timestamp).toLocaleString('nl-NL');
    reportHealthIssue(
      'unexpected-crash',
      'process',
      'error',
      `De service crashte onverwacht (${record.kind}) op ${when} en is automatisch herstart: ${record.message}`,
    );
    fs.unlinkSync(CRASH_MARKER_PATH);
  } catch (e) {
    console.warn('[crashGuard] Kon crash-marker niet lezen:', e);
  }
}
