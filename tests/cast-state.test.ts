import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  castSessionState,
  castSettingsState,
  setCastSettingsState,
  cancelPendingAutoStopCast,
  enterCastStandby,
  exitCastStandby,
  scheduleAutoStopCast,
  maybeAutoCast,
  setLocalKioskDisplayActive,
} from '../src/server/state.ts';

// castSessionState/castSettingsState are persisted, process-wide singletons —
// loaded at import time from whatever this machine's shared DB last had
// saved (see the "silently forgot a cast was active" comments in state.ts).
// Every test below explicitly sets every field it depends on rather than
// assuming a starting state, since all tests in this file share that same
// singleton. startCast/stopCast spawn a real `catt` child process — that's
// fine here (fails harmlessly with ENOENT off a real Pi, exactly like the
// existing smoke tests already tolerate spawning real subprocesses), the
// state mutation these tests assert on happens synchronously before that
// callback could ever fire.

function resetSession(overrides: Partial<typeof castSessionState> = {}) {
  Object.assign(castSessionState, {
    isCasting: false,
    isStandby: false,
    activeDeviceId: null,
    activeLayout: 'kiosk_touch',
    startedAt: null,
    castUrl: '',
    ...overrides,
  });
}

function resetSettings(overrides: Record<string, unknown> = {}) {
  setCastSettingsState({
    ...castSettingsState,
    targetDeviceId: '',
    targetDeviceIp: '',
    targetDeviceName: '',
    autoCastOnPlay: false,
    autoStopOnPause: false,
    autoStopDelaySec: 0,
    autoStopReleasesDevice: false,
    ...overrides,
  });
}

beforeEach(() => {
  cancelPendingAutoStopCast();
  resetSession();
  resetSettings();
  // Module-level cache, detected once at import time (false off a real Pi).
  // Pinned here so a test machine that happens to run the kiosk service
  // can't change what these assert.
  setLocalKioskDisplayActive(false);
});

test('enterCastStandby does nothing with neither a cast nor a local kiosk screen', () => {
  resetSession({ isCasting: false });
  enterCastStandby();
  assert.equal(castSessionState.isStandby, false);
});

// The Pi in the tuinhuis drives its own HDMI screen and never casts to
// anything: isCasting is false forever there, so gating standby on it left
// that screen stuck on the last played track. Standby follows "is something
// showing the kiosk page", not "is a cast running".
test('enterCastStandby works on a local kiosk screen with no cast at all', () => {
  resetSession({ isCasting: false });
  setLocalKioskDisplayActive(true);
  enterCastStandby();
  assert.equal(castSessionState.isStandby, true);
});

test('scheduleAutoStopCast enters standby on a local kiosk screen with no cast', () => {
  resetSession({ isCasting: false });
  setLocalKioskDisplayActive(true);
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0 });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, true);
});

test('a local kiosk screen gets standby even with autoStopReleasesDevice on (nothing to release)', () => {
  resetSession({ isCasting: false });
  setLocalKioskDisplayActive(true);
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0, autoStopReleasesDevice: true });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, true);
});

test('scheduleAutoStopCast stays a no-op when nothing is displaying the kiosk page', () => {
  resetSession({ isCasting: false });
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0 });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, false);
});

test('enterCastStandby sets isStandby when actively casting', () => {
  resetSession({ isCasting: true, isStandby: false });
  enterCastStandby();
  assert.equal(castSessionState.isStandby, true);
});

test('enterCastStandby is a no-op when already in standby', () => {
  resetSession({ isCasting: true, isStandby: true });
  enterCastStandby();
  assert.equal(castSessionState.isStandby, true);
});

test('exitCastStandby clears isStandby', () => {
  resetSession({ isCasting: true, isStandby: true });
  exitCastStandby();
  assert.equal(castSessionState.isStandby, false);
});

test('exitCastStandby does nothing when not in standby', () => {
  resetSession({ isCasting: true, isStandby: false });
  exitCastStandby();
  assert.equal(castSessionState.isStandby, false);
});

test('scheduleAutoStopCast does nothing when not currently casting', () => {
  resetSession({ isCasting: false });
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0 });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, false);
});

test('scheduleAutoStopCast does nothing when autoStopOnPause is disabled', () => {
  resetSession({ isCasting: true });
  resetSettings({ autoStopOnPause: false });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, false);
});

test('scheduleAutoStopCast enters standby immediately when the delay is 0', () => {
  resetSession({ isCasting: true, isStandby: false });
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0 });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, true);
});

test('scheduleAutoStopCast waits for the configured delay before entering standby', async () => {
  resetSession({ isCasting: true, isStandby: false });
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0.05 });
  scheduleAutoStopCast();
  assert.equal(castSessionState.isStandby, false, 'must not standby before the delay elapses');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(castSessionState.isStandby, true, 'must standby once the delay has elapsed');
});

test('resuming within the delay window (maybeAutoCast) cancels the pending auto-stop', async () => {
  resetSession({ isCasting: true, isStandby: false });
  resetSettings({ autoStopOnPause: true, autoStopDelaySec: 0.05, autoCastOnPlay: false });
  scheduleAutoStopCast();
  maybeAutoCast(); // simulates resuming playback before the delay elapses
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(castSessionState.isStandby, false, 'the resume must have cancelled the pending standby timer');
});

test('maybeAutoCast exits an existing standby even when autoCastOnPlay is off', () => {
  resetSession({ isCasting: true, isStandby: true });
  resetSettings({ autoCastOnPlay: false });
  maybeAutoCast();
  assert.equal(castSessionState.isStandby, false);
});

test('maybeAutoCast does not start a new cast when autoCastOnPlay is off', () => {
  resetSession({ isCasting: false });
  resetSettings({ autoCastOnPlay: false, targetDeviceId: 'test-device' });
  maybeAutoCast();
  assert.equal(castSessionState.isCasting, false);
});

test('maybeAutoCast does not start a new cast when no target device is configured', () => {
  resetSession({ isCasting: false });
  resetSettings({ autoCastOnPlay: true });
  maybeAutoCast();
  assert.equal(castSessionState.isCasting, false);
});

test('maybeAutoCast starts a new cast when autoCastOnPlay is on and a target is configured', () => {
  resetSession({ isCasting: false });
  resetSettings({ autoCastOnPlay: true, targetDeviceId: 'test-device', layout: 'kiosk_touch', themeId: 'obsidian' });
  maybeAutoCast();
  assert.equal(castSessionState.isCasting, true);
  assert.equal(castSessionState.activeDeviceId, 'test-device');
});
