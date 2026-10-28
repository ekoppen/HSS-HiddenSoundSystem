import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeQuadratureStep,
  detectGpioStatus,
  getReservedGpioPins,
  startGpioWatcher,
  stopGpioWatcher,
  validateGpioConfigInput,
  GpioAction,
  GpioDeviceConfig,
} from '../src/services/gpioService.ts';

test('decodeQuadratureStep returns 0 for identical states (no edge)', () => {
  assert.equal(decodeQuadratureStep({ a: 0, b: 0 }, { a: 0, b: 0 }), 0);
});

test('decodeQuadratureStep detects a full clockwise rotation sequence', () => {
  const sequence: { a: 0 | 1; b: 0 | 1 }[] = [
    { a: 0, b: 0 },
    { a: 0, b: 1 },
    { a: 1, b: 1 },
    { a: 1, b: 0 },
    { a: 0, b: 0 },
  ];
  const steps: number[] = [];
  for (let i = 1; i < sequence.length; i++) {
    steps.push(decodeQuadratureStep(sequence[i - 1], sequence[i]));
  }
  assert.deepEqual(steps, [1, 1, 1, 1]);
});

test('decodeQuadratureStep detects a full counter-clockwise rotation sequence', () => {
  const sequence: { a: 0 | 1; b: 0 | 1 }[] = [
    { a: 0, b: 0 },
    { a: 1, b: 0 },
    { a: 1, b: 1 },
    { a: 0, b: 1 },
    { a: 0, b: 0 },
  ];
  const steps: number[] = [];
  for (let i = 1; i < sequence.length; i++) {
    steps.push(decodeQuadratureStep(sequence[i - 1], sequence[i]));
  }
  assert.deepEqual(steps, [-1, -1, -1, -1]);
});

test('decodeQuadratureStep ignores an invalid/skipped transition (both bits flip at once)', () => {
  // A real encoder's A/B signals never both change in the same edge event
  // (that's a Gray-code violation, physically only possible from a missed
  // sample or electrical noise) — must not guess a direction from it.
  assert.equal(decodeQuadratureStep({ a: 0, b: 0 }, { a: 1, b: 1 }), 0);
});

test('getReservedGpioPins returns the I2S+I2C pins when an I2S DAC is active', () => {
  assert.deepEqual(getReservedGpioPins('i2s_dac').sort((x, y) => x - y), [2, 3, 18, 19, 20, 21]);
});

test('getReservedGpioPins returns an empty list for a non-I2S DAC (e.g. USB)', () => {
  assert.deepEqual(getReservedGpioPins('usb_dac'), []);
});

test('getReservedGpioPins returns an empty list when no DAC type is known', () => {
  assert.deepEqual(getReservedGpioPins(undefined), []);
});

test('validateGpioConfigInput accepts a well-formed, non-conflicting config', () => {
  const result = validateGpioConfigInput(
    { pinA: 17, pinB: 27, pinButton: 22, actionRotateCw: 'volume_up', actionRotateCcw: 'volume_down', actionButtonPress: 'play_pause' },
    [],
  );
  assert.deepEqual(result, { valid: true });
});

test('validateGpioConfigInput rejects a non-integer or negative pin', () => {
  const result = validateGpioConfigInput(
    { pinA: 17.5, pinB: 27, pinButton: 22, actionRotateCw: 'volume_up', actionRotateCcw: 'volume_down', actionButtonPress: 'play_pause' },
    [],
  );
  assert.equal(result.valid, false);
});

test('validateGpioConfigInput rejects duplicate pins across signals', () => {
  const result = validateGpioConfigInput(
    { pinA: 17, pinB: 17, pinButton: 22, actionRotateCw: 'volume_up', actionRotateCcw: 'volume_down', actionButtonPress: 'play_pause' },
    [],
  );
  assert.equal(result.valid, false);
});

test('validateGpioConfigInput rejects a pin that is in the reserved list', () => {
  const result = validateGpioConfigInput(
    { pinA: 18, pinB: 27, pinButton: 22, actionRotateCw: 'volume_up', actionRotateCcw: 'volume_down', actionButtonPress: 'play_pause' },
    [18, 19, 20, 21, 2, 3],
  );
  assert.equal(result.valid, false);
});

test('validateGpioConfigInput rejects an unrecognized action string', () => {
  const result = validateGpioConfigInput(
    { pinA: 17, pinB: 27, pinButton: 22, actionRotateCw: 'do_a_backflip', actionRotateCcw: 'volume_down', actionButtonPress: 'play_pause' },
    [],
  );
  assert.equal(result.valid, false);
});

// --- startGpioWatcher/stopGpioWatcher process-lifecycle regression tests ---
//
// This dev environment has neither real GPIO hardware nor libgpiod
// installed (production is a Raspberry Pi), so a real `gpiomon` binary
// isn't available. A tiny fake one is put on PATH here instead: it just
// sleeps until killed, which is all that's needed to get REAL, correctly-
// ordered async spawn/'exit' events out of Node's child_process — the exact
// kind of delayed signal the final-review process-identity bug depended on
// — rather than the near-instant ENOENT 'error' spawn('gpiomon', ...) would
// otherwise get. It can also echo canned edge-event lines (via
// GPIO_FAKE_OUTPUT) to exercise the button-debounce and per-detent
// quadrature accumulation fixes against the real stdout parsing path.
const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpio-fake-bin-'));
const fakeGpiomonPath = path.join(fakeBinDir, 'gpiomon');
fs.writeFileSync(
  fakeGpiomonPath,
  '#!/bin/sh\n' +
    'if [ -n "$GPIO_FAKE_OUTPUT" ]; then printf \'%b\' "$GPIO_FAKE_OUTPUT"; fi\n' +
    'if [ -n "$GPIO_FAKE_EXIT_CODE" ]; then exit "$GPIO_FAKE_EXIT_CODE"; fi\n' +
    // GPIO_FAKE_LOCK makes the fake behave like the real chip: exclusive
    // ownership of the "lines" for as long as it runs, and a second instance
    // fails exactly the way gpiomon does (verified on the Pi).
    'if [ -n "$GPIO_FAKE_LOCK" ]; then\n' +
    '  if [ -e "$GPIO_FAKE_LOCK" ]; then\n' +
    '    echo "unable to request lines on chip /dev/gpiochip0: Device or resource busy" >&2\n' +
    '    exit 1\n' +
    '  fi\n' +
    '  touch "$GPIO_FAKE_LOCK"\n' +
    // The lock outlives the kill signal by a beat, like a real chip: the
    // lines belong to the old process until it has actually gone, not from
    // the moment someone asked it to stop.
    '  trap \'sleep 0.3; rm -f "$GPIO_FAKE_LOCK"; kill $! 2>/dev/null; exit 0\' TERM INT\n' +
    '  sleep 100 &\n' +
    '  wait\n' +
    'fi\n' +
    'exec sleep 100\n',
);
fs.chmodSync(fakeGpiomonPath, 0o755);
process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH}`;

// Safety net: stop any watcher left running by a failed assertion above, so
// a sleeping fake-gpiomon child doesn't outlive the test run.
after(() => stopGpioWatcher());

function testConfig(): GpioDeviceConfig {
  return {
    id: 'test-device',
    deviceType: 'rotary_encoder_button',
    pinA: 17,
    pinB: 27,
    pinButton: 22,
    actionRotateCw: 'volume_up',
    actionRotateCcw: 'volume_down',
    actionButtonPress: 'play_pause',
    enabled: true,
  };
}

test('an old watcher process\'s belated exit event never nulls out a newer process reference (Finding 1)', async () => {
  const crashes: string[] = [];
  startGpioWatcher(testConfig(), () => {}, () => crashes.push('A'));

  // The exact pre-fix bug pattern: stop, then immediately start a new one
  // without waiting for the old process to actually exit — the old
  // process's real 'exit' event (SIGTERM delivery takes a beat) is still
  // pending once the new one is already running.
  stopGpioWatcher(); // no callback — deliberately don't sequence
  startGpioWatcher(testConfig(), () => {}, () => crashes.push('B'));

  // Give the OLD process's real, delayed 'exit' event time to fire.
  await new Promise((r) => setTimeout(r, 300));

  assert.equal(
    detectGpioStatus(undefined).watcherRunning,
    true,
    'the newer process must still be tracked as running after the older one belatedly exits',
  );
  assert.deepEqual(crashes, [], 'a deliberate stop must never be reported as a crash, for either process');

  await new Promise<void>((resolve) => stopGpioWatcher(() => resolve()));
});

test('a sequenced config-edit restart (stop -> wait for exit -> start) never races for the GPIO lines (Finding 1)', async () => {
  const crashes: string[] = [];
  startGpioWatcher(testConfig(), () => {}, () => crashes.push('A'));
  assert.equal(detectGpioStatus(undefined).watcherRunning, true);

  await new Promise<void>((resolve) => {
    // Mirrors gpio.ts's config route: disableGpioWatcher(() => enableGpioWatcher())
    stopGpioWatcher(() => {
      startGpioWatcher(testConfig(), () => {}, () => crashes.push('B'));
      resolve();
    });
  });

  assert.equal(detectGpioStatus(undefined).watcherRunning, true, 'the new process must be running once the sequenced restart completes');
  assert.deepEqual(crashes, []);

  await new Promise<void>((resolve) => stopGpioWatcher(() => resolve()));
});

test('an off/on toggle waits for the old gpiomon to release the lines instead of racing it', async () => {
  // The one way a working knob still dies on its own: stopGpioWatcher()
  // returns before SIGTERM has actually landed, so a start right behind it
  // meets a chip the old process still owns. The real gpiomon then exits 1
  // ("Device or resource busy"), which onCrash persists as enabled:false —
  // knob dead until someone re-enables it by hand. Found while debugging
  // exactly that dead knob on the tuinhuis Pi.
  const lockPath = path.join(fakeBinDir, 'lines.lock');
  process.env.GPIO_FAKE_LOCK = lockPath;
  const crashes: string[] = [];

  startGpioWatcher(testConfig(), () => {}, () => crashes.push('A'));
  await new Promise((r) => setTimeout(r, 150)); // let it take the lines

  stopGpioWatcher(); // toggle off — deliberately not sequenced
  startGpioWatcher(testConfig(), () => {}, () => crashes.push('B')); // and straight back on

  await new Promise((r) => setTimeout(r, 900));

  assert.deepEqual(crashes, [], 'the second watcher must wait for the lines, not crash on a busy chip');
  assert.equal(detectGpioStatus(undefined).watcherRunning, true, 'the restarted watcher must end up running');

  await new Promise<void>((resolve) => stopGpioWatcher(() => resolve()));
  delete process.env.GPIO_FAKE_LOCK;
});

test('an unexpected process exit (not via stopGpioWatcher) invokes onCrash (Finding 5)', async () => {
  let crashed = false;
  process.env.GPIO_FAKE_EXIT_CODE = '1';
  startGpioWatcher(testConfig(), () => {}, () => { crashed = true; });

  await new Promise((r) => setTimeout(r, 200));

  assert.equal(crashed, true, 'a process that exits on its own (never stopped via stopGpioWatcher) must invoke onCrash');
  assert.equal(detectGpioStatus(undefined).watcherRunning, false);

  delete process.env.GPIO_FAKE_EXIT_CODE;
});

test('the button action fires on any edge and is debounced against contact bounce (Findings 2+3)', async () => {
  const actions: GpioAction[] = [];
  // Five falling edges on the button pin in one burst (mechanical bounce),
  // one line the fake gpiomon script prints in a single write.
  const lines = Array.from({ length: 5 }, () => '22 falling').join('\\n') + '\\n';
  process.env.GPIO_FAKE_OUTPUT = lines;

  startGpioWatcher(testConfig(), (a) => actions.push(a));
  await new Promise((r) => setTimeout(r, 150));

  assert.deepEqual(actions, ['play_pause'], 'five bounced edges within the debounce window must fire the action exactly once');

  delete process.env.GPIO_FAKE_OUTPUT;
  await new Promise<void>((resolve) => stopGpioWatcher(() => resolve()));
});

test('one full detent (4 quadrature transitions) fires exactly one rotate action, not four (Finding 4)', async () => {
  const actions: GpioAction[] = [];
  // A full CW cycle on pins 17(A)/27(B): 00 -> 01 -> 11 -> 10 -> 00.
  const lines = [
    '27 rising', // b 0->1: 00 -> 01
    '17 rising', // a 0->1: 01 -> 11
    '27 falling', // b 1->0: 11 -> 10
    '17 falling', // a 1->0: 10 -> 00
  ].join('\\n') + '\\n';
  process.env.GPIO_FAKE_OUTPUT = lines;

  startGpioWatcher(testConfig(), (a) => actions.push(a));
  await new Promise((r) => setTimeout(r, 150));

  assert.deepEqual(actions, ['volume_up'], 'a full detent (4 steps) must fire actionRotateCw exactly once, not once per quadrature transition');

  delete process.env.GPIO_FAKE_OUTPUT;
  await new Promise<void>((resolve) => stopGpioWatcher(() => resolve()));
});
