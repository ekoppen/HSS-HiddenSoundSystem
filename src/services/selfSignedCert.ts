import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// Unlike db.ts's DB_DIR, this has no /tmp fallback: that's fine for app
// data that needs to persist somewhere even in a degraded dev environment,
// but not for a private key — on a genuinely multi-user host /tmp is far
// less protected than /etc/hss, and ensureSelfSignedCert() already
// degrades gracefully to "no HTTPS listener" on any failure here, so
// failing closed costs nothing.
function certDir(): string | null {
  try {
    fs.mkdirSync('/etc/hss', { recursive: true });
    return '/etc/hss';
  } catch {
    return null;
  }
}

export interface SelfSignedCert {
  key: string;
  cert: string;
}

// Spotify's OAuth authorize/token endpoints reject any redirect_uri that
// isn't https:// (the only exception is the literal address 127.0.0.1,
// which isn't reachable from another device on the LAN) — a hard platform
// requirement this self-hosted app has no way around on a plain-HTTP LAN
// device. Spotify's server never itself connects to the redirect_uri (only
// the user's browser does, via a client-side redirect), so it never
// validates the actual certificate — a self-signed one is sufficient; the
// browser's one-time "not secure" warning during login is the only
// user-visible cost.
export function ensureSelfSignedCert(): SelfSignedCert | null {
  const dir = certDir();
  if (!dir) return null;
  const keyPath = path.join(dir, 'tls-key.pem');
  const certPath = path.join(dir, 'tls-cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
      // Belt and suspenders alongside the 0600 set right after generation
      // below — re-assert it on every read too, in case the file predates
      // this check or something else touched it.
      fs.chmodSync(keyPath, 0o600);
      return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
    } catch {}
  }

  try {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '3650', '-subj', '/CN=hss.local'],
      { stdio: 'ignore' }
    );
    // openssl writes the key using the process umask, which on a
    // Restart=always root-run service can't be relied on to already be
    // restrictive — lock it down explicitly rather than trust that.
    fs.chmodSync(keyPath, 0o600);
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  } catch (e: any) {
    console.warn('[HTTPS] Kon geen zelf-ondertekend certificaat genereren (is openssl geïnstalleerd?):', e.message);
    return null;
  }
}
