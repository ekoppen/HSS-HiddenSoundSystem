// Central point for turning the app's previously-silent failure paths
// (amixer calls swallowed with `2>/dev/null`, a DB write's bare `catch (e)
// {}`, mpv failing to spawn) into something a user can actually see,
// instead of only ever showing up in `journalctl` if someone thinks to
// look. No dependency on db.ts/state.ts — a standalone leaf module so it
// can be imported from anywhere (including db.ts itself) without creating
// an import cycle.
export interface HealthIssue {
  id: string;
  source: string;
  severity: 'warning' | 'error';
  message: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

const issues = new Map<string, HealthIssue>();
type Listener = (issue: HealthIssue, isNew: boolean) => void;
const listeners: Listener[] = [];

export function onHealthIssue(cb: Listener): void {
  listeners.push(cb);
}

/** Reports a problem, identified by a stable `id` so repeated occurrences
 * of the *same* underlying issue update one entry (count/lastSeen) instead
 * of flooding the list — a mixer failing on every volume tick should read
 * as "one ongoing problem," not a thousand log lines. */
export function reportHealthIssue(id: string, source: string, severity: HealthIssue['severity'], message: string): void {
  const now = Date.now();
  const existing = issues.get(id);
  const issue: HealthIssue = existing
    ? { ...existing, lastSeen: now, count: existing.count + 1, message }
    : { id, source, severity, message, firstSeen: now, lastSeen: now, count: 1 };
  issues.set(id, issue);
  listeners.forEach((cb) => cb(issue, !existing));
}

/** Call when whatever `id` reported stops happening — e.g. a DB write that
 * failed once and then succeeds. Keeps the list from accumulating stale,
 * already-resolved issues indefinitely. */
export function clearHealthIssue(id: string): void {
  issues.delete(id);
}

export function getHealthIssues(): HealthIssue[] {
  return Array.from(issues.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}
