// Pure password hashing — no other dependencies, so this can be imported
// by scripts/reset-password.ts without dragging in state.ts's module-load-
// time side effects (hardware detection, unclearable setInterval timers —
// see ARCHITECTURE.md's "module-load-time gotcha"). scrypt (Node stdlib,
// no extra dependency) with a random salt per password; "salt:hex(hash)"
// per entry, verifyPassword does the constant-time comparison.
import crypto from 'crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
