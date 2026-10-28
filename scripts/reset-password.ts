// Password recovery — run directly on the Pi, as root (needs access to
// /etc/hss/hss.db, same as hss.service itself):
//
//   sudo npx tsx scripts/reset-password.ts <email> <nieuw-wachtwoord>
//
// Rewrites the stored hash directly in the same auth_state_v1 blob
// state.ts persists to/loads from — there's no other copy of it anywhere
// to go out of sync. Restarts hss.service afterward: the running process
// only ever reads this at boot (see state.ts's loadAuthState/module-load
// comment), so a DB edit alone wouldn't take effect until the next
// restart regardless — a "forgot my password" tool that still requires a
// separate manual restart step isn't really a finished recovery path.
import { execSync } from 'child_process';
import { getDbConfig, setDbConfig } from '../db.ts';
import { hashPassword } from '../src/services/authCrypto.ts';

const AUTH_STATE_KEY = 'auth_state_v1';

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error('Gebruik: sudo npx tsx scripts/reset-password.ts <email> <nieuw-wachtwoord>');
  process.exit(1);
}
if (newPassword.length < 8) {
  // Same minimum as PUT /api/auth/password — a reset shouldn't be able to
  // set something the normal change-password flow would reject outright.
  console.error('Nieuw wachtwoord moet minstens 8 tekens zijn.');
  process.exit(1);
}
if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  console.error('Dit script vereist root — start met: sudo npx tsx scripts/reset-password.ts ...');
  process.exit(1);
}

const raw = getDbConfig(AUTH_STATE_KEY, '');
if (!raw) {
  console.error('Geen auth-status gevonden in de database — is de app hier ooit opgestart?');
  process.exit(1);
}

const state = JSON.parse(raw);
const user = (state.users || []).find((u: any) => u.email.toLowerCase() === email.toLowerCase().trim());
if (!user) {
  const known = (state.users || []).map((u: any) => u.email).join(', ') || '(geen gebruikers gevonden)';
  console.error(`Geen gebruiker met e-mailadres '${email}' gevonden. Bekende accounts: ${known}`);
  process.exit(1);
}

// Keyed by the user's own stored email (not the input) — same convention
// state.ts/auth.ts already use, so a login afterward finds this entry.
state.userPasswords = state.userPasswords || {};
state.userPasswords[user.email] = hashPassword(newPassword);
setDbConfig(AUTH_STATE_KEY, JSON.stringify(state));

console.log(`Wachtwoord bijgewerkt voor ${user.email}.`);

try {
  execSync('systemctl restart hss.service', { stdio: 'inherit' });
  console.log('hss.service herstart — het nieuwe wachtwoord is nu actief.');
} catch (e: any) {
  console.warn('Kon hss.service niet automatisch herstarten:', e.message);
  console.warn('Herstart handmatig zodat het nieuwe wachtwoord actief wordt: sudo systemctl restart hss.service');
}
