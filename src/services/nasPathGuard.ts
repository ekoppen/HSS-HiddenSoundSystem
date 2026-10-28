// Shared allowlist guard for any route that turns a caller-supplied path
// into a filesystem access — every NAS route (raw browser and the
// artist/album/song library view) must validate against this before
// touching `fs`, or it's an arbitrary-directory-read/crash vector.
import path from 'path';
import { getDbNetworkShares } from '../../db.ts';

export function getEffectiveNasShares(): string[] {
  const configured = getDbNetworkShares().map((s) => path.resolve(s.mountPoint));
  return configured.length > 0 ? configured : [path.resolve('/mnt/nas')];
}

/**
 * Resolves `candidate` and confirms it falls under one of the configured
 * (or default) NAS shares — returns the original string if valid, `null`
 * otherwise. Guards against non-string input (a crafted `?x[y]=z` query
 * turns `req.query.x` into an object, which `path.resolve` would throw on
 * uncaught — fatal in an async Express 4 handler with nothing to catch it)
 * as well as path traversal and prefix-collision (`/mnt/nas-evil` must not
 * match a configured `/mnt/nas`).
 */
export function validateWithinNasShares(candidate: unknown, shares: string[] = getEffectiveNasShares()): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  const resolved = path.resolve(candidate);
  const withinShare = shares.some((share) => resolved === share || resolved.startsWith(share + path.sep));
  return withinShare ? candidate : null;
}
