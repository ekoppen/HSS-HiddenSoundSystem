// The watchdog's whole reason for existing is one live failure: librespot
// crashed on every Spotify track for two days, systemd restarted it every 5
// seconds, and nothing said a word — because at almost any moment you looked,
// the service was "active". These cases pin the difference between that and
// the ordinary restart a deploy causes. Pure function, no systemd involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateServices, isRestartableUnit, parseSystemdTimestamp, ServiceStatus } from '../src/services/serviceWatchdog.ts';

const svc = (over: Partial<ServiceStatus> = {}): ServiceStatus => ({
  unit: 'librespot-hss',
  label: 'Spotify Connect (librespot)',
  active: true,
  state: 'active (running)',
  restarts: 0,
  startedAt: Date.now(),
  restartable: true,
  ...over,
});

test('a healthy service reports nothing and clears any earlier warning', () => {
  const v = evaluateServices([svc({ restarts: 4 })], [svc({ restarts: 4 })]);
  assert.deepEqual(v.report, []);
  assert.deepEqual(v.clear, ['service-librespot-hss']);
});

test('the very first sample never cries crash loop, however high the restart count', () => {
  // NRestarts is cumulative and never resets on its own, so a fresh server
  // start seeing 16 restarts is looking at history that may be long over.
  const v = evaluateServices(null, [svc({ restarts: 16 })]);
  assert.deepEqual(v.report, []);
});

test('a single restart between ticks is a deploy, not a fault', () => {
  const v = evaluateServices([svc({ restarts: 3 })], [svc({ restarts: 4 })]);
  assert.deepEqual(v.report, []);
  assert.deepEqual(v.clear, ['service-librespot-hss']);
});

test('repeated restarts between ticks are reported as an error, even though the service reads as active (the exact way librespot hid for two days)', () => {
  const v = evaluateServices([svc({ restarts: 10 })], [svc({ restarts: 16, active: true })]);
  assert.equal(v.report.length, 1);
  assert.equal(v.report[0].id, 'service-librespot-hss');
  assert.equal(v.report[0].severity, 'error');
  assert.match(v.report[0].message, /6x sinds de vorige controle/);
  assert.match(v.report[0].message, /journalctl -u librespot-hss/);
  assert.deepEqual(v.clear, []);
});

test('a stopped service is reported even when nothing is restarting it', () => {
  const v = evaluateServices([svc()], [svc({ active: false, state: 'inactive (dead)' })]);
  assert.equal(v.report.length, 1);
  assert.equal(v.report[0].severity, 'error');
  assert.match(v.report[0].message, /draait niet \(inactive \(dead\)\)/);
});

test('a service that disappeared between ticks clears instead of warning forever', () => {
  const v = evaluateServices([svc({ unit: 'hss-kiosk-display' })], []);
  assert.deepEqual(v.report, []);
  assert.deepEqual(v.clear, ['service-hss-kiosk-display']);
});

test('hss itself is never restartable — restarting it would kill the request doing the restarting', () => {
  assert.equal(isRestartableUnit('hss'), false);
  assert.equal(isRestartableUnit('librespot-hss'), true);
  assert.equal(isRestartableUnit('hss-kiosk-display'), true);
});

test('the restart whitelist rejects anything not on the list, including shell tricks', () => {
  assert.equal(isRestartableUnit('sshd'), false);
  assert.equal(isRestartableUnit('librespot-hss; rm -rf /'), false);
  assert.equal(isRestartableUnit('$(reboot)'), false);
  assert.equal(isRestartableUnit(''), false);
});

// --- parseSystemdTimestamp ---------------------------------------------

test('parseSystemdTimestamp reads systemd\'s human format, which Date.parse() cannot (regression: every "sinds ..." in the UI would have stayed silently empty)', () => {
  assert.equal(Date.parse('Sun 2026-09-06 20:13:00 CEST'), NaN); // the trap itself
  const parsed = parseSystemdTimestamp('Sun 2026-09-06 20:13:00 CEST');
  assert.ok(parsed, 'should parse');
  const d = new Date(parsed!);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8); // september
  assert.equal(d.getDate(), 6);
  assert.equal(d.getHours(), 20);
  assert.equal(d.getMinutes(), 13);
});

test('parseSystemdTimestamp reads the @unix form that systemd >= 250 emits', () => {
  assert.equal(parseSystemdTimestamp('@1788718380'), 1788718380000);
});

test('parseSystemdTimestamp returns null for a service that never started', () => {
  // systemd's literal output for a unit that has not been active yet.
  assert.equal(parseSystemdTimestamp('n/a'), null);
  assert.equal(parseSystemdTimestamp(''), null);
  assert.equal(parseSystemdTimestamp('rommel zonder datum'), null);
});
