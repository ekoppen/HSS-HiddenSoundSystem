// Minimal smoke layer, not full coverage — the two riskiest paths this
// project has actually broken on: an unauthenticated request slipping past
// the mutation gate, and the server failing to come up healthy at all.
// Spawns the real built server as a subprocess (same as production) rather
// than importing anything from server.ts directly — the whole file calls
// startServer() unconditionally at module scope, so importing it for a
// single function boots a full server as a side effect anyway.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;

async function waitForHealthy(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/status`);
      if (res.ok) {
        const body = await res.json();
        if (body.status === 'ok') return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

before(async () => {
  serverProcess = spawn('node', ['dist/server.cjs'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealthy();
});

after(() => {
  serverProcess?.kill();
});

test('GET /api/status is reachable without authentication and reports ok', async () => {
  const res = await fetch(`${BASE_URL}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('an unauthenticated playback mutation is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/playback/play`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated cast-settings write is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/cast/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artDisplayMode: 'flat' }),
  });
  assert.equal(res.status, 401);
});

test('an unauthenticated user-registration attempt for the admin role is rejected', async () => {
  // Regression guard for the privilege-escalation bug fixed earlier this
  // project: registering with role "admin" (or any role — registration
  // itself requires an existing authenticated caller) without a credential
  // must never succeed. Verified against the live server: this is a 401 from
  // the global mutation gate, not a 403 from the route's own role check —
  // an anonymous caller never gets far enough to reach that second check.
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Test Intruder',
      email: `smoke-test-${Date.now()}@example.invalid`,
      password: 'irrelevant-but-long-enough',
      role: 'admin',
    }),
  });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to enable the local kiosk display is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display/enable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to disable the local kiosk display is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display/disable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('GET /api/setup/kiosk-display is reachable without authentication (read-only status)', async () => {
  const res = await fetch(`${BASE_URL}/api/setup/kiosk-display`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.status.packagesInstalled, 'boolean');
});

test('liking a song is rejected without authentication, reading the list is not', async () => {
  // The heart is reachable from the kiosk screen with its scoped
  // audio:control key — but never from an unauthenticated caller.
  const write = await fetch(`${BASE_URL}/api/likes`, { method: 'POST' });
  assert.equal(write.status, 401);

  const read = await fetch(`${BASE_URL}/api/likes`);
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(Array.isArray(body.likes), true);
});

test('clearing the radio log is rejected without authentication, reading it is not', async () => {
  const write = await fetch(`${BASE_URL}/api/radio/log`, { method: 'DELETE' });
  assert.equal(write.status, 401);

  const read = await fetch(`${BASE_URL}/api/radio/log`);
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(Array.isArray(body.entries), true);
});

test('an unauthenticated request to save GPIO config is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/config`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to enable GPIO input is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/enable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to disable GPIO input is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/disable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('GET /api/gpio/status is reachable without authentication (read-only status)', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.status.gpiodInstalled, 'boolean');
});

test('GET /api/nas/browse rejects a path outside every configured NAS share with 400', async () => {
  // Regression guard for the arbitrary-directory-listing bug fixed
  // alongside the music-library feature: this route used to pass
  // req.query.path straight to fs.readdirSync with no validation, so an
  // unauthenticated caller could list any directory on the Pi (e.g. /etc).
  // "/etc" is never a real NAS share mount point, so this must 400
  // regardless of what shares happen to be configured in this environment.
  const res = await fetch(`${BASE_URL}/api/nas/browse?path=/etc`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('POST /api/spotify/event from the Hub itself (loopback) still succeeds', async () => {
  // Regression guard for the loopback-only restriction added to this
  // endpoint (it needs no credential, since the real caller is a local
  // systemd librespot hook — see server.ts's PUBLIC_MUTATION_PATHS comment).
  // fetch() from this test process is itself a loopback connection, so this
  // proves the new check doesn't also lock out its own legitimate caller.
  const res = await fetch(`${BASE_URL}/api/spotify/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'stopped' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});

test('POST /api/catalogic/webhook without a valid signature is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/catalogic/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'song.created' }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/spotify/auth/login without a configured Client ID fails on the ID alone, not a missing secret (Authorization Code + PKCE — no client_secret in this flow)', async () => {
  const res = await fetch(`${BASE_URL}/api/spotify/auth/login`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Client ID/);
  assert.doesNotMatch(body.error, /Secret/i);
});
