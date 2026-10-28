# GPIO-hardwarekoppeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een rotary-encoder-met-druktoets aan GPIO-pinnen koppelen aan instelbare afspeelacties (volume/play-pause), via een algemeen instelbaar systeem dat later andere apparaattypes kan opnemen zonder herontwerp.

**Architecture:** Een nieuwe `gpioService.ts` gebruikt `libgpiod`'s `gpiomon` CLI-tool (geen native Node-binding) om GPIO-edge-events te lezen, decodeert die naar encoder-stappen via een pure, hardware-onafhankelijke quadrature-state-machine, en roept daarna dezelfde interne afspeel-/volumefuncties aan die de bestaande REST-routes al gebruiken (geëxtraheerd in Task 1, geen nieuwe afspeellogica). De watcher draait als kind-proces van de hoofdserver zelf — geen apart systemd-unit, geen geautomatiseerde package-installatie.

**Tech Stack:** Node/TypeScript backend (`child_process.spawn`, `libgpiod`'s `gpiomon`), Express routes, React/TypeScript frontend. Nieuw systeempakket op de Pi: `gpiod` (README-vereiste, geen app-geautomatiseerde installatie).

**Spec:** `docs/superpowers/specs/2026-08-24-gpio-hardware-mapping-design.md`

## Global Constraints

- Eén apparaattype in v1: `rotary_encoder_button` (3 signalen: pinA, pinB, druktoets).
- Drie acties in v1: `volume_up`, `volume_down`, `play_pause`. Vaste stapgrootte 2% per klik.
- Alle pinnummers zijn **BCM GPIO-nummers**, nooit fysieke header-posities.
- Gereserveerde pinnen (altijd geblokkeerd zodra de actieve DAC `type === 'i2s_dac'` is): `[18, 19, 20, 21, 2, 3]`.
- Geen apart systemd-unit — de watcher is een kind-proces van de hoofdserver, gestart/gestopt via de API, en automatisch herstart bij serverstart als hij laatst aanstond.
- `gpiod` is een README `apt-get`-vereiste, geen door de app geautomatiseerde installatieroute (in tegenstelling tot het HDMI-scherm — `gpiod` is een klein, licht pakket, geen aparte provisioning-flow nodig).
- Alle GPIO-mutatieroutes vereisen `requireAudioPermission('admin:all')`.
- `POST /api/gpio/config` is een plain replace/upsert van de ene `GpioDeviceConfig` — geen lijst-/id-semantiek.
- Geen nieuwe afspeellogica: de encoder/druktoets roept dezelfde interne functies aan die de bestaande `/api/volume`/`/api/playback/toggle`-routes al gebruiken.

---

### Task 1: Extract reusable playback-toggle & volume-change functions

**Files:**
- Modify: `src/server/state.ts` (add 2 new exported functions)
- Modify: `src/server/routes/playback.ts:90-122` (thin wrapper around the extracted function)
- Modify: `src/server/routes/audio.ts:207-241` (thin wrapper around the extracted function)
- Test: `tests/playback-actions.test.ts` (new)

**Interfaces:**
- Produces:
  - `export function applyVolumeChange(update: { volume?: number; isMuted?: boolean; balance?: number }): void` — mutates `playbackState`/`dacConfig`, calls `piHardware.setHardwareVolume`, broadcasts `volume_change`.
  - `export async function togglePlayback(): Promise<{ success: boolean; isPlaying?: boolean; error?: string }>` — mutates `playbackState.isPlaying`, broadcasts `playback_state`.
- These are consumed by Task 2's `gpioService.ts` (calls both directly, no HTTP round-trip).

This is a behavior-preserving refactor of two already-shipped, actively-used routes — read the exact current code below before touching anything, since the new functions must produce byte-for-byte the same behavior as what they replace.

Current `POST /api/volume` in `src/server/routes/audio.ts:207-241`:
```ts
router.post('/api/volume', (req, res) => {
  const { volume, isMuted, balance } = req.body;
  if (typeof volume === 'number') {
    playbackState.volume = Math.max(0, Math.min(100, Math.round(volume)));
    dacConfig.volumeDb = calculateVolumeDb(playbackState.volume);
  }
  if (typeof isMuted === 'boolean') {
    playbackState.isMuted = isMuted;
  }
  if (typeof balance === 'number') {
    dacConfig.balance = Math.max(-50, Math.min(50, Math.round(balance)));
    applyLiveAudioFilters();
  }

  // Execute real ALSA mixer volume on Raspberry Pi
  piHardware.setHardwareVolume(playbackState.volume, playbackState.isMuted);

  broadcastWebSocket({
    event: 'volume_change',
    timestamp: Date.now(),
    data: {
      volume: playbackState.volume,
      isMuted: playbackState.isMuted,
      volumeDb: dacConfig.volumeDb,
      balance: dacConfig.balance,
    },
  });
  res.json({
    success: true,
    volume: playbackState.volume,
    isMuted: playbackState.isMuted,
    volumeDb: dacConfig.volumeDb,
    balance: dacConfig.balance,
  });
});
```

Current `POST /api/playback/toggle` in `src/server/routes/playback.ts:90-122`:
```ts
router.post('/api/playback/toggle', async (req, res) => {
  const wasPlaying = playbackState.isPlaying;
  const willPlay = !wasPlaying;
  if (isLocalPlayerActive()) {
    if (willPlay) resumeLocal();
    else pauseLocal();
  } else {
    const result = await sendSpotifyPlayerCommand(willPlay ? 'resume' : 'pause');
    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }
  }
  playbackState.isPlaying = willPlay;
  if (!willPlay) {
    playbackState.spectrum = Array(16).fill(0);
    scheduleAutoStopCast();
  } else if (!wasPlaying) {
    maybeAutoCast();
    stopExternalListening();
  }
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: playbackState.isPlaying, positionMs: playbackState.positionMs },
  });
  res.json({ success: true, isPlaying: playbackState.isPlaying });
});
```

`isLocalPlayerActive`, `resumeLocal`, `pauseLocal`, `sendSpotifyPlayerCommand`, `maybeAutoCast`, `stopExternalListening`, `scheduleAutoStopCast`, `playbackState`, `dacConfig`, `calculateVolumeDb`, `applyLiveAudioFilters`, `broadcastWebSocket` are all already defined/exported directly inside `src/server/state.ts` itself (verify each with a quick `grep -n "export.*<name>" src/server/state.ts` before starting — they should all be there since this whole task is just relocating code that already only depends on other state.ts exports). `piHardware` is already imported at the top of `state.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/playback-actions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackState, applyVolumeChange, togglePlayback } from '../src/server/state.ts';

test('applyVolumeChange clamps volume to 0-100', () => {
  applyVolumeChange({ volume: 150 });
  assert.equal(playbackState.volume, 100);
  applyVolumeChange({ volume: -10 });
  assert.equal(playbackState.volume, 0);
  applyVolumeChange({ volume: 42 });
  assert.equal(playbackState.volume, 42);
});

test('applyVolumeChange updates isMuted independently of volume', () => {
  applyVolumeChange({ volume: 50 });
  applyVolumeChange({ isMuted: true });
  assert.equal(playbackState.isMuted, true);
  assert.equal(playbackState.volume, 50);
  applyVolumeChange({ isMuted: false });
  assert.equal(playbackState.isMuted, false);
});

test('applyVolumeChange ignores fields that are not provided', () => {
  applyVolumeChange({ volume: 33 });
  const before = { volume: playbackState.volume, isMuted: playbackState.isMuted };
  applyVolumeChange({});
  assert.deepEqual({ volume: playbackState.volume, isMuted: playbackState.isMuted }, before);
});

test('togglePlayback resolves with a success boolean without throwing', async () => {
  // No real Spotify session exists in a fresh test process and no local
  // file is playing, so this exercises the "no active source" path — the
  // point of this test is that the extracted function is callable and
  // well-formed, not to validate real Spotify/local-player behavior
  // (which the existing project already doesn't unit-test elsewhere for
  // the same reason: it requires either real hardware or a real Spotify
  // session neither of which exist in this environment).
  const result = await togglePlayback();
  assert.equal(typeof result.success, 'boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/playback-actions.test.ts`
Expected: FAIL — `applyVolumeChange`/`togglePlayback` are not exported from `state.ts` yet.

- [ ] **Step 3: Add the two functions to `src/server/state.ts`**

Add near `calculateVolumeDb` (both are playback/volume-adjacent):

```ts
export function applyVolumeChange(update: { volume?: number; isMuted?: boolean; balance?: number }): void {
  if (typeof update.volume === 'number') {
    playbackState.volume = Math.max(0, Math.min(100, Math.round(update.volume)));
    dacConfig.volumeDb = calculateVolumeDb(playbackState.volume);
  }
  if (typeof update.isMuted === 'boolean') {
    playbackState.isMuted = update.isMuted;
  }
  if (typeof update.balance === 'number') {
    dacConfig.balance = Math.max(-50, Math.min(50, Math.round(update.balance)));
    applyLiveAudioFilters();
  }

  piHardware.setHardwareVolume(playbackState.volume, playbackState.isMuted);

  broadcastWebSocket({
    event: 'volume_change',
    timestamp: Date.now(),
    data: {
      volume: playbackState.volume,
      isMuted: playbackState.isMuted,
      volumeDb: dacConfig.volumeDb,
      balance: dacConfig.balance,
    },
  });
}
```

Add near `maybeAutoCast` (uses the same set of playback-transport helpers):

```ts
export async function togglePlayback(): Promise<{ success: boolean; isPlaying?: boolean; error?: string }> {
  const wasPlaying = playbackState.isPlaying;
  const willPlay = !wasPlaying;
  if (isLocalPlayerActive()) {
    if (willPlay) resumeLocal();
    else pauseLocal();
  } else {
    const result = await sendSpotifyPlayerCommand(willPlay ? 'resume' : 'pause');
    if (!result.success) {
      return { success: false, error: result.error };
    }
  }
  playbackState.isPlaying = willPlay;
  if (!willPlay) {
    playbackState.spectrum = Array(16).fill(0);
    scheduleAutoStopCast();
  } else if (!wasPlaying) {
    maybeAutoCast();
    stopExternalListening();
  }
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: playbackState.isPlaying, positionMs: playbackState.positionMs },
  });
  return { success: true, isPlaying: playbackState.isPlaying };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/playback-actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Replace the route bodies with thin wrappers**

In `src/server/routes/audio.ts`, replace the `POST /api/volume` handler (lines 207-241 in the current file — re-locate by searching for `router.post('/api/volume'` since line numbers may have shifted) with:

```ts
router.post('/api/volume', (req, res) => {
  const { volume, isMuted, balance } = req.body;
  applyVolumeChange({ volume, isMuted, balance });
  res.json({
    success: true,
    volume: playbackState.volume,
    isMuted: playbackState.isMuted,
    volumeDb: dacConfig.volumeDb,
    balance: dacConfig.balance,
  });
});
```

Add `applyVolumeChange` to `audio.ts`'s existing import block from `../state.ts`. Then check whether `calculateVolumeDb` and `applyLiveAudioFilters` are still used anywhere else in `audio.ts` (`grep -n "calculateVolumeDb\|applyLiveAudioFilters" src/server/routes/audio.ts`) — if not, remove them from the import list; if they're still used elsewhere in the file, leave them.

In `src/server/routes/playback.ts`, replace the `POST /api/playback/toggle` handler (search for `router.post('/api/playback/toggle'`) with:

```ts
router.post('/api/playback/toggle', async (req, res) => {
  const result = await togglePlayback();
  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ success: true, isPlaying: result.isPlaying });
});
```

Add `togglePlayback` to `playback.ts`'s existing import block from `../state.ts`. Then check whether `isLocalPlayerActive`, `resumeLocal`, `pauseLocal`, `maybeAutoCast`, `scheduleAutoStopCast` are still used anywhere else in `playback.ts` — several almost certainly are (e.g. `/api/playback/play`/`/api/playback/pause` use the same helpers directly, per the existing code around them) — only remove an import if `grep` confirms zero remaining uses in the file.

- [ ] **Step 6: Typecheck and full test suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build && npm test`
Expected: full suite passes (60 existing + 4 new = 64).

- [ ] **Step 7: Commit**

```bash
git add src/server/state.ts src/server/routes/audio.ts src/server/routes/playback.ts tests/playback-actions.test.ts
git commit -m "refactor: extract applyVolumeChange/togglePlayback for reuse by GPIO input"
```

---

### Task 2: `gpioService.ts` — pure logic (types, quadrature decode, reserved pins)

**Files:**
- Create: `src/services/gpioService.ts`
- Test: `tests/gpio-service.test.ts` (new)

**Interfaces:**
- Produces:
  - `export type GpioAction = 'volume_up' | 'volume_down' | 'play_pause';`
  - `export interface GpioDeviceConfig { id: string; deviceType: 'rotary_encoder_button'; pinA: number; pinB: number; pinButton: number; actionRotateCw: GpioAction; actionRotateCcw: GpioAction; actionButtonPress: GpioAction; enabled: boolean; }`
  - `export interface GpioStatus { gpiodInstalled: boolean; watcherRunning: boolean; reservedPins: number[]; }`
  - `export const VOLUME_STEP_PCT = 2;`
  - `export function getReservedGpioPins(activeDacType: string | undefined): number[]`
  - `export function decodeQuadratureStep(prev: { a: 0 | 1; b: 0 | 1 }, next: { a: 0 | 1; b: 0 | 1 }): -1 | 0 | 1`
  - `export function validateGpioConfigInput(input: { pinA: unknown; pinB: unknown; pinButton: unknown; actionRotateCw: unknown; actionRotateCcw: unknown; actionButtonPress: unknown }, reservedPins: number[]): { valid: true } | { valid: false; error: string }`
- Consumed by: Task 3 (subprocess management, added to this same file; the route's `POST /api/gpio/config` handler calls `validateGpioConfigInput` instead of re-implementing the checks inline) and Task 4 (routes import `GpioDeviceConfig`/`GpioStatus`/`GpioAction` types and `getReservedGpioPins`).

- [ ] **Step 1: Write the failing tests**

Create `tests/gpio-service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeQuadratureStep, getReservedGpioPins, validateGpioConfigInput } from '../src/services/gpioService.ts';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/gpio-service.test.ts`
Expected: FAIL — `src/services/gpioService.ts` does not exist yet.

- [ ] **Step 3: Create `src/services/gpioService.ts` with the pure logic**

```ts
// GPIO input handling for HSS — see docs/superpowers/specs/2026-08-24-gpio-hardware-mapping-design.md.
// Uses libgpiod's CLI tools (gpiomon) rather than a native Node GPIO
// addon, matching this codebase's existing convention of shelling out to
// established Linux tools (catt, amixer, mount) instead of native
// bindings that risk ARM compilation/prebuilt-binary issues.

export type GpioAction = 'volume_up' | 'volume_down' | 'play_pause';

export interface GpioDeviceConfig {
  id: string;
  deviceType: 'rotary_encoder_button';
  pinA: number;
  pinB: number;
  pinButton: number;
  actionRotateCw: GpioAction;
  actionRotateCcw: GpioAction;
  actionButtonPress: GpioAction;
  enabled: boolean;
}

export interface GpioStatus {
  gpiodInstalled: boolean;
  watcherRunning: boolean;
  reservedPins: number[];
}

// Fixed 2%-per-detent step — a module constant rather than a per-config
// field in v1 (see the spec's "Niet in scope" section); trivial to turn
// into a user-configurable field later without touching the rest of this
// file.
export const VOLUME_STEP_PCT = 2;

// A standard I2S DAC HAT always occupies these same BCM pins regardless
// of which specific model is attached (a fixed 40-pin-header convention,
// not something AVAILABLE_AUDIO_DEVICES tracks per-device) — see the
// spec's "Botsing met DAC-pinnen" section.
const RESERVED_GPIO_PINS = {
  i2s: [18, 19, 20, 21],
  i2c: [2, 3],
};

export function getReservedGpioPins(activeDacType: string | undefined): number[] {
  if (activeDacType !== 'i2s_dac') return [];
  return [...RESERVED_GPIO_PINS.i2s, ...RESERVED_GPIO_PINS.i2c];
}

// Standard quadrature state-transition table. A rotary encoder's A/B
// pins step through 4 Gray-code states per detent in a fixed order —
// this implementation's CW/CCW sequence choice doesn't need to match a
// specific real encoder's physical wiring convention (that varies by
// model, and can't be verified without real hardware in this
// environment): the *decoding logic* is what's under test here, and a
// wrong absolute direction on real hardware is trivially fixed later by
// swapping which action the UI assigns to actionRotateCw vs
// actionRotateCcw — no code change needed.
const CW_SEQUENCE = [0b00, 0b01, 0b11, 0b10];
const CCW_SEQUENCE = [0b00, 0b10, 0b11, 0b01];

export function decodeQuadratureStep(
  prev: { a: 0 | 1; b: 0 | 1 },
  next: { a: 0 | 1; b: 0 | 1 },
): -1 | 0 | 1 {
  const prevState = (prev.a << 1) | prev.b;
  const nextState = (next.a << 1) | next.b;
  if (prevState === nextState) return 0;

  const prevCwIdx = CW_SEQUENCE.indexOf(prevState);
  const nextCwIdx = CW_SEQUENCE.indexOf(nextState);
  if (prevCwIdx !== -1 && nextCwIdx === (prevCwIdx + 1) % 4) return 1;

  const prevCcwIdx = CCW_SEQUENCE.indexOf(prevState);
  const nextCcwIdx = CCW_SEQUENCE.indexOf(nextState);
  if (prevCcwIdx !== -1 && nextCcwIdx === (prevCcwIdx + 1) % 4) return -1;

  // Both-bits-changed-at-once or any other non-adjacent transition — a
  // missed sample or electrical noise, not a real single detent. Ignore
  // rather than guess.
  return 0;
}

const VALID_GPIO_ACTIONS: GpioAction[] = ['volume_up', 'volume_down', 'play_pause'];

// Pure validation, shared by POST /api/gpio/config (Task 3) and directly
// unit-tested here — the route handler calls this instead of
// re-implementing the same checks inline, so the validation logic is
// testable without needing an authenticated request.
export function validateGpioConfigInput(
  input: {
    pinA: unknown;
    pinB: unknown;
    pinButton: unknown;
    actionRotateCw: unknown;
    actionRotateCcw: unknown;
    actionButtonPress: unknown;
  },
  reservedPins: number[],
): { valid: true } | { valid: false; error: string } {
  const pins = [input.pinA, input.pinB, input.pinButton];
  if (pins.some((p) => typeof p !== 'number' || !Number.isInteger(p) || p < 0)) {
    return { valid: false, error: 'Ongeldige pin-configuratie' };
  }
  const numericPins = pins as number[];
  if (new Set(numericPins).size !== 3) {
    return { valid: false, error: 'Elke pin moet uniek zijn' };
  }
  if (numericPins.some((p) => reservedPins.includes(p))) {
    return { valid: false, error: `Deze pin is gereserveerd voor de actieve DAC: ${reservedPins.join(', ')}` };
  }
  const actions = [input.actionRotateCw, input.actionRotateCcw, input.actionButtonPress];
  if (!actions.every((a) => VALID_GPIO_ACTIONS.includes(a as GpioAction))) {
    return { valid: false, error: 'Ongeldige actie' };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsx --test tests/gpio-service.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/gpioService.ts tests/gpio-service.test.ts
git commit -m "feat: pure GPIO quadrature-decode logic and reserved-pin lookup"
```

---

### Task 3: GPIO watcher subprocess + status detection + backend routes

**Files:**
- Modify: `src/services/gpioService.ts` (add subprocess management + status detection)
- Modify: `src/server/state.ts` (add `gpioConfig` persistence + boot-time auto-start)
- Create: `src/server/routes/gpio.ts`
- Modify: `server.ts` (register the new router)
- Modify: `tests/smoke.test.ts` (auth regression tests)
- Modify: `README.md` (new `apt-get` prerequisite)

**Interfaces:**
- Consumes: `GpioDeviceConfig`, `GpioStatus`, `GpioAction`, `getReservedGpioPins`, `decodeQuadratureStep`, `validateGpioConfigInput`, `VOLUME_STEP_PCT` (Task 2); `applyVolumeChange`, `togglePlayback`, `playbackState` (Task 1); `requireAudioPermission`, `broadcastWebSocket`, `setDbConfig`/`getDbConfig` (existing `state.ts`/`db.ts`); `dacConfig`, `audioDevices` (existing `state.ts`, to determine the active DAC's `type` for `getReservedGpioPins`).
- Produces: `detectGpioStatus(activeDacType)`, `startGpioWatcher(config, onAction)`, `stopGpioWatcher()` (added to `gpioService.ts`); `GET /api/gpio/status`, `POST /api/gpio/config`, `POST /api/gpio/enable`, `POST /api/gpio/disable` — consumed by Task 4's frontend.

**Known unverifiable detail — flag, don't fake certainty:** `gpiomon`'s exact CLI flags and stdout line format vary between libgpiod v1 and v2, and this cannot be confirmed without running it on the actual target Pi. The code below uses the libgpiod v2 CLI shape (`gpiomon <chip> <line>...`, output containing `offset` and edge-direction keywords) as the best-available assumption — mirrors the spec's own explicitly-flagged "Resterend risico, te verifiëren op echte hardware" for the HDMI-display feature. If the real installed `gpiomon --version`/`--help` output differs once tested on hardware, adjust `startGpioWatcher`'s spawn args and `parseGpioLine`'s parsing accordingly — the rest of this task (config persistence, routes, status detection) does not depend on getting this exactly right on the first try.

- [ ] **Step 1: Add subprocess management to `src/services/gpioService.ts`**

Append to the end of the file (after `decodeQuadratureStep`):

```ts
import { execSync, spawn, ChildProcess } from 'child_process';

let watcherProcess: ChildProcess | null = null;
let lastEncoderState: { a: 0 | 1; b: 0 | 1 } | null = null;

export function detectGpioStatus(activeDacType: string | undefined): GpioStatus {
  let gpiodInstalled = false;
  try {
    execSync('which gpiomon', { stdio: 'ignore' });
    gpiodInstalled = true;
  } catch {}
  return {
    gpiodInstalled,
    watcherRunning: watcherProcess !== null,
    reservedPins: getReservedGpioPins(activeDacType),
  };
}

// Parses one line of gpiomon's edge-event output. Best-effort against the
// libgpiod v2 CLI shape (see this task's "Known unverifiable detail" note
// in the plan) — looks for the line's GPIO offset and whether it's a
// rising or falling edge, tolerating unknown/differently-formatted lines
// by returning null rather than throwing.
function parseGpioLine(line: string): { pin: number; rising: boolean } | null {
  const offsetMatch = line.match(/offset[:\s]+(\d+)/i);
  if (!offsetMatch) return null;
  const pin = Number(offsetMatch[1]);
  const rising = /rising/i.test(line);
  const falling = /falling/i.test(line);
  if (!rising && !falling) return null;
  return { pin, rising };
}

export function startGpioWatcher(config: GpioDeviceConfig, onAction: (action: GpioAction) => void): void {
  if (watcherProcess) return; // already running — idempotent
  lastEncoderState = { a: 0, b: 0 };

  watcherProcess = spawn('gpiomon', ['gpiochip0', String(config.pinA), String(config.pinB), String(config.pinButton)]);

  watcherProcess.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      const parsed = parseGpioLine(line);
      if (!parsed) continue;

      if (parsed.pin === config.pinButton) {
        if (parsed.rising) onAction(config.actionButtonPress);
        continue;
      }

      if (!lastEncoderState) continue;
      const next = { ...lastEncoderState };
      if (parsed.pin === config.pinA) next.a = parsed.rising ? 1 : 0;
      else if (parsed.pin === config.pinB) next.b = parsed.rising ? 1 : 0;
      else continue;

      const step = decodeQuadratureStep(lastEncoderState, next);
      lastEncoderState = next;
      if (step === 1) onAction(config.actionRotateCw);
      else if (step === -1) onAction(config.actionRotateCcw);
    }
  });

  watcherProcess.on('exit', () => {
    watcherProcess = null;
  });
}

export function stopGpioWatcher(): void {
  watcherProcess?.kill();
  watcherProcess = null;
}
```

- [ ] **Step 2: Add `gpioConfig` persistence to `src/server/state.ts`**

Add near the other persisted-settings state (alongside `castSettingsState`). `applyVolumeChange`/`togglePlayback`/`playbackState` need no import — they're already defined directly inside this same file from Task 1:

```ts
import { GpioDeviceConfig, GpioAction, VOLUME_STEP_PCT, startGpioWatcher, stopGpioWatcher } from '../services/gpioService.ts';

export let gpioConfig: GpioDeviceConfig | null = null;

export function setGpioConfig(next: GpioDeviceConfig | null): void {
  gpioConfig = next;
  setDbConfig('gpio_config_v1', JSON.stringify(gpioConfig));
}

function triggerGpioAction(action: GpioAction): void {
  if (action === 'volume_up') applyVolumeChange({ volume: playbackState.volume + VOLUME_STEP_PCT });
  else if (action === 'volume_down') applyVolumeChange({ volume: playbackState.volume - VOLUME_STEP_PCT });
  else if (action === 'play_pause') void togglePlayback();
}

export function enableGpioWatcher(): void {
  if (!gpioConfig) return;
  startGpioWatcher(gpioConfig, triggerGpioAction);
}

export function disableGpioWatcher(): void {
  stopGpioWatcher();
}
```

Then find `loadDiskConfig()` in `state.ts` (the existing function that restores persisted settings at server startup — same place `cast_session_v1`/`cast_settings_v1` get restored) and add, following that exact existing restore pattern:

```ts
const savedGpioConfig = getDbConfig('gpio_config_v1');
if (savedGpioConfig) {
  gpioConfig = JSON.parse(savedGpioConfig);
  if (gpioConfig?.enabled) enableGpioWatcher();
}
```

- [ ] **Step 3: Create `src/server/routes/gpio.ts`**

```ts
// GPIO hardware-mapping — see gpioService.ts and
// docs/superpowers/specs/2026-08-24-gpio-hardware-mapping-design.md.
import express from 'express';
import { GpioDeviceConfig, detectGpioStatus, getReservedGpioPins, validateGpioConfigInput } from '../../services/gpioService.ts';
import {
  audioDevices,
  broadcastWebSocket,
  dacConfig,
  disableGpioWatcher,
  enableGpioWatcher,
  gpioConfig,
  requireAudioPermission,
  setGpioConfig,
} from '../state.ts';

const router = express.Router();

function activeDacType(): string | undefined {
  return audioDevices.find((d) => d.id === dacConfig.activeDeviceId)?.type;
}

router.get('/api/gpio/status', (req, res) => {
  res.json({ success: true, status: detectGpioStatus(activeDacType()), config: gpioConfig });
});

// admin:all — configures physical GPIO pin wiring, not a task for a
// scoped integration key.
router.post('/api/gpio/config', requireAudioPermission('admin:all'), (req, res) => {
  const { pinA, pinB, pinButton, actionRotateCw, actionRotateCcw, actionButtonPress } = req.body || {};
  const reserved = getReservedGpioPins(activeDacType());
  const validation = validateGpioConfigInput({ pinA, pinB, pinButton, actionRotateCw, actionRotateCcw, actionButtonPress }, reserved);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const wasEnabled = gpioConfig?.enabled;
  const next: GpioDeviceConfig = {
    id: gpioConfig?.id || 'gpio-' + Date.now(),
    deviceType: 'rotary_encoder_button',
    pinA,
    pinB,
    pinButton,
    actionRotateCw,
    actionRotateCcw,
    actionButtonPress,
    enabled: wasEnabled || false,
  };
  setGpioConfig(next);
  broadcastWebSocket({ event: 'notification', timestamp: Date.now(), data: { message: 'GPIO-configuratie opgeslagen' } });
  res.json({ success: true, config: next, status: detectGpioStatus(activeDacType()) });
});

router.post('/api/gpio/enable', requireAudioPermission('admin:all'), (req, res) => {
  if (!gpioConfig) {
    res.status(400).json({ error: 'Nog geen apparaat geconfigureerd' });
    return;
  }
  setGpioConfig({ ...gpioConfig, enabled: true });
  enableGpioWatcher();
  broadcastWebSocket({ event: 'notification', timestamp: Date.now(), data: { message: 'GPIO-invoer ingeschakeld' } });
  res.json({ success: true, status: detectGpioStatus(activeDacType()) });
});

router.post('/api/gpio/disable', requireAudioPermission('admin:all'), (req, res) => {
  disableGpioWatcher();
  if (gpioConfig) setGpioConfig({ ...gpioConfig, enabled: false });
  broadcastWebSocket({ event: 'notification', timestamp: Date.now(), data: { message: 'GPIO-invoer uitgeschakeld' } });
  res.json({ success: true, status: detectGpioStatus(activeDacType()) });
});

export default router;
```

- [ ] **Step 4: Register the router in `server.ts`**

Find the block of `app.use(...Router)` calls in `server.ts` (search for `app.use(systemRouter);`, the last one in the list) and add immediately after it:

```ts
import gpioRouter from './src/server/routes/gpio.ts';
```

(add this import near the other route imports at the top of the file, alongside `import systemRouter from './src/server/routes/system.ts';`), and:

```ts
app.use(gpioRouter);
```

immediately after `app.use(systemRouter);`.

- [ ] **Step 5: Write the failing smoke tests**

In `tests/smoke.test.ts`, add after the existing kiosk-display auth tests:

```ts
test('an unauthenticated request to save GPIO config is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/config`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('an unauthenticated request to enable GPIO input is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/enable`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('GET /api/gpio/status is reachable without authentication (read-only status)', async () => {
  const res = await fetch(`${BASE_URL}/api/gpio/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.status.gpiodInstalled, 'boolean');
});
```

- [ ] **Step 6: Add the README prerequisite**

In `README.md`, find this exact line:
```
sudo apt-get install -y nodejs npm alsa-utils nfs-common cifs-utils git curl jq mpv
```
Replace it with:
```
sudo apt-get install -y nodejs npm alsa-utils nfs-common cifs-utils git curl jq mpv gpiod
```

- [ ] **Step 7: Typecheck, build, full test suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build && npm test`
Expected: full suite passes (76 existing + 3 new = 79).

- [ ] **Step 8: Commit**

```bash
git add src/services/gpioService.ts src/server/state.ts src/server/routes/gpio.ts server.ts tests/smoke.test.ts README.md
git commit -m "feat: GPIO watcher subprocess, config persistence, and /api/gpio/* routes"
```

---

### Task 4: Frontend — `AuthTabGpio` settings card

**Files:**
- Create: `src/components/AuthTabGpio.tsx`
- Modify: `src/components/AuthAndApiKeysView.tsx`

**Interfaces:**
- Consumes: `GET /api/gpio/status`, `POST /api/gpio/config`, `POST /api/gpio/enable`, `POST /api/gpio/disable` (Task 3), response shapes `{ success, status: { gpiodInstalled, watcherRunning, reservedPins }, config }`.
- Produces: `export const AuthTabGpio: React.FC` — zero-prop, self-contained (matches the existing `AuthTabSystemTime.tsx` pattern in this same directory — read that file first for the exact conventions to mirror: `labelStyle`/`inputStyle`/`cardHeaderStyle` from `./AuthViewShared.tsx`, `Card`/`Badge`/`Button`/`Toggle` from `./ui`).

- [ ] **Step 1: Create `src/components/AuthTabGpio.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { Cpu, Save } from 'lucide-react';
import { Badge, Button, Card, Toggle } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

type GpioAction = 'volume_up' | 'volume_down' | 'play_pause';

interface GpioDeviceConfig {
  id: string;
  deviceType: 'rotary_encoder_button';
  pinA: number;
  pinB: number;
  pinButton: number;
  actionRotateCw: GpioAction;
  actionRotateCcw: GpioAction;
  actionButtonPress: GpioAction;
  enabled: boolean;
}

interface GpioStatus {
  gpiodInstalled: boolean;
  watcherRunning: boolean;
  reservedPins: number[];
}

const ACTION_LABELS: Record<GpioAction, string> = {
  volume_up: 'Volume omhoog',
  volume_down: 'Volume omlaag',
  play_pause: 'Afspelen/pauzeren',
};

// GPIO hardwarekoppeling — rotary-encoder-met-druktoets naar afspeelacties.
// Zie docs/superpowers/specs/2026-08-24-gpio-hardware-mapping-design.md.
export const AuthTabGpio: React.FC = () => {
  const [status, setStatus] = useState<GpioStatus | null>(null);
  const [config, setConfig] = useState<GpioDeviceConfig | null>(null);
  const [pinA, setPinA] = useState('17');
  const [pinB, setPinB] = useState('27');
  const [pinButton, setPinButton] = useState('22');
  const [actionRotateCw, setActionRotateCw] = useState<GpioAction>('volume_up');
  const [actionRotateCcw, setActionRotateCcw] = useState<GpioAction>('volume_down');
  const [actionButtonPress, setActionButtonPress] = useState<GpioAction>('play_pause');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/gpio/status').then((r) => r.json());
      if (res.status) setStatus(res.status);
      if (res.config) {
        setConfig(res.config);
        setPinA(String(res.config.pinA));
        setPinB(String(res.config.pinB));
        setPinButton(String(res.config.pinButton));
        setActionRotateCw(res.config.actionRotateCw);
        setActionRotateCcw(res.config.actionRotateCcw);
        setActionButtonPress(res.config.actionButtonPress);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/gpio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinA: Number(pinA),
          pinB: Number(pinB),
          pinButton: Number(pinButton),
          actionRotateCw,
          actionRotateCcw,
          actionButtonPress,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Opslaan mislukt');
        return;
      }
      setConfig(data.config);
      if (data.status) setStatus(data.status);
      showFeedback('GPIO-configuratie opgeslagen');
    } catch (err: any) {
      showFeedback(err.message || 'Opslaan mislukt');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!config) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/gpio/${config.enabled ? 'disable' : 'enable'}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Actie mislukt');
        return;
      }
      if (data.status) setStatus(data.status);
      setConfig((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev));
    } catch (err: any) {
      showFeedback(err.message || 'Actie mislukt');
    } finally {
      setToggling(false);
    }
  };

  const badge = !status ? null : !status.gpiodInstalled ? (
    <Badge variant="neutral">gpiod niet geïnstalleerd</Badge>
  ) : status.watcherRunning ? (
    <Badge variant="success">Actief</Badge>
  ) : (
    <Badge variant="neutral">Uitgeschakeld</Badge>
  );

  return (
    <Card padding={0}>
      <form onSubmit={handleSave} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>GPIO-hardwarekoppeling</h3>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Koppel een rotary encoder met druktoets aan GPIO-pinnen — draaien en drukken sturen dezelfde
              acties aan die de webinterface ook gebruikt.
            </p>
          </div>
          {badge}
        </div>

        {!status?.gpiodInstalled && status && (
          <div style={{ padding: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>
            Installeer eerst <code>gpiod</code> op de Pi: <code>sudo apt-get install -y gpiod</code>
          </div>
        )}

        {feedback && (
          <div style={{ padding: 10, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-success)' }}>
            {feedback}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Pin A (BCM)</label>
            <input type="number" min={0} value={pinA} onChange={(e) => setPinA(e.target.value)} style={inputStyle} required />
            {status && status.reservedPins.includes(Number(pinA)) && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--status-danger)', marginTop: 4 }}>Gereserveerd voor de actieve DAC</p>
            )}
          </div>
          <div>
            <label style={labelStyle}>Pin B (BCM)</label>
            <input type="number" min={0} value={pinB} onChange={(e) => setPinB(e.target.value)} style={inputStyle} required />
            {status && status.reservedPins.includes(Number(pinB)) && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--status-danger)', marginTop: 4 }}>Gereserveerd voor de actieve DAC</p>
            )}
          </div>
          <div>
            <label style={labelStyle}>Druktoets (BCM)</label>
            <input type="number" min={0} value={pinButton} onChange={(e) => setPinButton(e.target.value)} style={inputStyle} required />
            {status && status.reservedPins.includes(Number(pinButton)) && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--status-danger)', marginTop: 4 }}>Gereserveerd voor de actieve DAC</p>
            )}
          </div>
        </div>

        {status && status.reservedPins.length > 0 && (
          <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
            Gereserveerd door de actieve DAC (I2S/I2C): {status.reservedPins.join(', ')}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Draaien met de klok mee</label>
            <select value={actionRotateCw} onChange={(e) => setActionRotateCw(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Draaien tegen de klok in</label>
            <select value={actionRotateCcw} onChange={(e) => setActionRotateCcw(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Druktoets</label>
            <select value={actionButtonPress} onChange={(e) => setActionButtonPress(e.target.value as GpioAction)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
          Draait de knop de verkeerde kant op? Wissel gewoon welke actie hierboven aan "met de klok mee"
          versus "tegen de klok in" hangt — geen herbedrading nodig.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button disabled={saving} icon={<Save size={15} />}>{saving ? 'Bezig...' : 'Configuratie opslaan'}</Button>
          {config && (
            <Toggle checked={config.enabled} onChange={handleToggleEnabled} disabled={toggling} label={config.enabled ? 'Ingeschakeld' : 'Uitgeschakeld'} />
          )}
        </div>
      </form>
    </Card>
  );
};
```

Before finalizing this step, read `src/components/ui/index.ts` (or wherever `Toggle` is exported from) to confirm its exact prop names — this plan assumes `checked`/`onChange`/`disabled`/`label` based on its usage elsewhere in this codebase (e.g. `src/components/AuthTabNas.tsx`'s `Toggle` usage); adjust if the real prop signature differs.

- [ ] **Step 2: Wire it into `AuthAndApiKeysView.tsx`**

In `src/components/AuthAndApiKeysView.tsx`, add the import after the existing `import { AuthTabSystemTime } from './AuthTabSystemTime';` line:

```tsx
import { AuthTabGpio } from './AuthTabGpio';
```

Extend the `activeSubTab` union type (currently `'spotify_daemon' | 'nas' | 'catalogic' | 'recognition' | 'system_time' | 'keys' | 'auth' | 'api_tester'`) to add `| 'gpio'`.

Add a new item to the `Tabs items={[...]}` array, after the `system_time` entry:
```tsx
{ id: 'gpio', label: 'GPIO-hardware', icon: <Cpu size={15} /> },
```
(add `Cpu` to the existing `lucide-react` import at the top of the file).

Add the render line after `{activeSubTab === 'system_time' && <AuthTabSystemTime />}`:
```tsx
{activeSubTab === 'gpio' && <AuthTabGpio />}
```

- [ ] **Step 3: Typecheck and build**

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npx tsc --noEmit`
Expected: no errors.

Run: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH" && npm run build`
Expected: succeeds, no new warnings beyond the pre-existing chunk-size warning.

- [ ] **Step 4: Manual browser verification**

Frontend-only change, no unit-test convention in this codebase for React components (matches every prior frontend feature this session — verified via browser). Start the dev server (`npm run dev`), open Instellingen, confirm:
- A new "GPIO-hardware" sub-tab appears, after "Datum, tijd & tijdzone".
- The card renders with pin inputs (defaults 17/27/22), 3 action dropdowns, a status badge.
- Since the dev machine has no `gpiod` installed, the badge should show "gpiod niet geïnstalleerd" and the install-instruction banner should appear.
- Clicking "Configuratie opslaan" with the default values succeeds (no DAC is active in a fresh dev database, so no pins are reserved) and shows the "GPIO-configuratie opgeslagen" feedback message.

- [ ] **Step 5: Commit**

```bash
git add src/components/AuthTabGpio.tsx src/components/AuthAndApiKeysView.tsx
git commit -m "feat: GPIO hardware mapping settings card"
```

---

## Final Verification (whole plan)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds.
- [ ] `npm test` — all tests pass (60 baseline + 4 Task 1 + 12 Task 2 + 3 Task 3 = 79).
- [ ] Manual browser check per Task 4 Step 4.
- [ ] Update `docs/API.md`'s section 7 ("Systeem, Auth & Config") with the 4 new `/api/gpio/*` endpoints, matching the existing terse-bullet style used for the sibling `/api/setup/*`/`/api/gpio/kiosk-display*` entries.

**Explicitly out of scope for this plan** (per the spec's "Niet in scope" section): analog input (potentiometer + ADC), multiple simultaneous GPIO devices, device types other than rotary-encoder-with-button, configurable volume step size, long-press as a separate signal.

**Known unverifiable pieces, to validate on the user's real hardware** (named explicitly rather than asserted with false confidence): `gpiomon`'s exact CLI invocation and output-line format (Task 3's `parseGpioLine`/spawn args); whether the CW/CCW sequence assignment in `decodeQuadratureStep` matches this specific physical encoder's wiring (self-correctable via the UI's action dropdowns, per Task 4's own on-page hint — no code change needed either way).
