import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp, assertSafeExternalUrl } from '../src/server/routes/config.ts';
import { computeGrantableKeyPermissions, resolveCastTarget } from '../src/server/state.ts';

test('isPrivateOrReservedIp rejects every private/reserved IPv4 range', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '0.0.0.0', '100.64.0.1']) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected ${ip} to be flagged private/reserved`);
  }
});

test('isPrivateOrReservedIp rejects loopback and link-local IPv6', () => {
  for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected ${ip} to be flagged private/reserved`);
  }
});

test('isPrivateOrReservedIp accepts a public IPv4 address', () => {
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
});

test('assertSafeExternalUrl rejects a non-http(s) scheme before any network lookup', async () => {
  await assert.rejects(() => assertSafeExternalUrl('file:///etc/passwd'), /http\(s\)/);
});

test('assertSafeExternalUrl rejects a hostname that resolves to a private address', async () => {
  // "localhost" reliably resolves to 127.0.0.1/::1 without depending on
  // real network access, unlike testing against a live public hostname.
  await assert.rejects(() => assertSafeExternalUrl('http://localhost:9999'), /privé|intern/);
});

test('computeGrantableKeyPermissions lets an admin caller grant any valid permission', () => {
  const granted = computeGrantableKeyPermissions(['admin:all', 'dac:configure'], new Set(['admin:all']));
  assert.deepEqual(granted.sort(), ['admin:all', 'dac:configure']);
});

test('computeGrantableKeyPermissions blocks a non-admin caller from self-granting admin:all', () => {
  // Regression guard: a scoped audio:read/audio:control key (e.g. the
  // kiosk's, or a freshly-registered non-admin user's) must never be able
  // to mint itself a full-admin key via POST /api/auth/keys.
  const granted = computeGrantableKeyPermissions(['admin:all'], new Set(['audio:read', 'audio:control']));
  assert.deepEqual(granted, []);
});

test('computeGrantableKeyPermissions only grants the overlap with the caller\'s own permissions', () => {
  const granted = computeGrantableKeyPermissions(['audio:control', 'dac:configure', 'admin:all'], new Set(['audio:read', 'audio:control']));
  assert.deepEqual(granted, ['audio:control']);
});

test('computeGrantableKeyPermissions ignores unrecognized permission strings', () => {
  const granted = computeGrantableKeyPermissions(['audio:control', 'not-a-real-permission'], new Set(['admin:all']));
  assert.deepEqual(granted, ['audio:control']);
});

test('resolveCastTarget rejects a target starting with "-" (catt argv/flag guard)', () => {
  const resolved = resolveCastTarget({ deviceName: '--some-flag' });
  assert.equal(resolved, null);
});

test('resolveCastTarget still resolves a normal device name', () => {
  const resolved = resolveCastTarget({ deviceName: 'StereoScherm' });
  assert.equal(resolved?.target, 'StereoScherm');
});
