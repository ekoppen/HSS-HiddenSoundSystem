import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKioskDisplayUnit, resolveChromiumBinary } from '../src/services/piSetup.ts';
import { piSetup } from '../src/services/piSetup.ts';

test('buildKioskDisplayUnit includes the given port in the kiosk URL', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /http:\/\/localhost:3000\/\?kiosk=1/);
});

test('buildKioskDisplayUnit falls back to port 3000 for an invalid port', () => {
  const unit = buildKioskDisplayUnit(-1);
  assert.match(unit, /http:\/\/localhost:3000\/\?kiosk=1/);
});

test('buildKioskDisplayUnit targets multi-user.target, never graphical.target', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /WantedBy=multi-user\.target/);
  assert.doesNotMatch(unit, /graphical\.target/);
});

test('buildKioskDisplayUnit runs chromium with --no-sandbox (required when running as root)', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /User=root/);
  assert.match(unit, /--no-sandbox/);
});

test('buildKioskDisplayUnit orders itself after hss.service so it never races the web server at boot', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /After=network\.target sound\.target hss\.service/);
  assert.match(unit, /Wants=hss\.service/);
});

test('buildKioskDisplayUnit provisions XDG_RUNTIME_DIR for cage (real-hardware regression: cage exits with "XDG_RUNTIME_DIR is not set" when launched directly by systemd/PID1, since no login session ever sets it)', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /RuntimeDirectory=cage/);
  assert.match(unit, /Environment=XDG_RUNTIME_DIR=\/run\/cage/);
});

test('buildKioskDisplayUnit uses the resolved chromium binary path (real-hardware regression: chromium-browser is now only a transitional dummy package on current Debian/Raspberry Pi OS — /usr/bin/chromium-browser does not exist, so cage failed with "Failed to spawn client: No such file or directory")', () => {
  const unit = buildKioskDisplayUnit(3000, '/usr/bin/chromium');
  assert.match(unit, /ExecStart=\/usr\/bin\/cage -- \/usr\/bin\/chromium /);
});

test('buildKioskDisplayUnit falls back to /usr/bin/chromium-browser when no binary path is given', () => {
  const unit = buildKioskDisplayUnit(3000);
  assert.match(unit, /ExecStart=\/usr\/bin\/cage -- \/usr\/bin\/chromium-browser /);
});

test('resolveChromiumBinary never throws and always returns a usable path, even with neither binary installed', () => {
  const path = resolveChromiumBinary();
  assert.equal(typeof path, 'string');
  assert.ok(path.length > 0);
});

test('detectKioskDisplayStatus returns all-false without throwing on a non-Linux dev machine', () => {
  const status = piSetup.detectKioskDisplayStatus();
  assert.equal(status.packagesInstalled, false);
  assert.equal(status.serviceEnabled, false);
  assert.equal(status.serviceActive, false);
});

// enableLocalKioskDisplay/disableLocalKioskDisplay only take the safe,
// emulated branch when `!isLinux` — true on a real dev Mac, but also false
// on a plain `ubuntu-latest` CI runner, which IS Linux yet has none of the
// real kiosk stack (or root) either. Forcing the private flag exercises the
// emulated path deterministically regardless of what OS the test actually
// runs on, instead of silently switching branches on CI vs. a Mac.
test('enableLocalKioskDisplay succeeds via the emulated path on a non-Linux dev machine', async () => {
  (piSetup as any).isLinux = false;
  const result = await piSetup.enableLocalKioskDisplay(3000);
  assert.equal(result.success, true);
  assert.ok(result.logs.length > 0);
  assert.ok(result.logs.some((l) => l.step === 'Omgeving'));
});

test('disableLocalKioskDisplay succeeds via the emulated path on a non-Linux dev machine', async () => {
  (piSetup as any).isLinux = false;
  const result = await piSetup.disableLocalKioskDisplay();
  assert.equal(result.success, true);
  assert.ok(result.logs.length > 0);
});
