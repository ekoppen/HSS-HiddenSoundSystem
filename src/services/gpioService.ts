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

import { execSync, spawn, ChildProcess } from 'child_process';

let watcherProcess: ChildProcess | null = null;
let lastEncoderState: { a: 0 | 1; b: 0 | 1 } | null = null;

// One physical detent = 4 quadrature transitions (see decodeQuadratureStep's
// doc comment) — accumulated across stdout handler calls and only flushed to
// onAction once a full detent's worth has arrived. Carries over/under by 4
// rather than resetting to 0, so a fast turn doesn't lose fractional progress
// between detents.
let quadratureAccumulator = 0;

// Debounce state for the button pin — see startGpioWatcher's stdout handler.
let lastButtonEdgeAt = 0;
const BUTTON_DEBOUNCE_MS = 250;

// Processes stopGpioWatcher killed on purpose land here, so the exit/error
// handlers below can tell "we did this" apart from "it crashed" — only the
// latter should invoke onCrash. Keyed on the specific ChildProcess (not a
// single module-level boolean) so an old process's still-pending exit event
// can never be mistaken for the new process's.
const intentionallyStopped = new WeakSet<ChildProcess>();

// The watcher we've told to die but that hasn't actually exited yet — see
// startGpioWatcher, which waits for it rather than fighting it for the lines.
let dyingProcess: ChildProcess | null = null;

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

// Parses one line of gpiomon's edge-event output. Verified against the
// real installed CLI (gpiomon (libgpiod) v2.2.1, Raspberry Pi OS Bookworm) —
// `gpiomon --chip <chip> --format '%o %E' <line>...` prints exactly
// "<offset> rising" / "<offset> falling" per event, a stable explicit
// contract rather than parsing the default human-readable banner text
// (which is not part of libgpiod's CLI stability guarantee). Still
// tolerates any unexpected line by returning null rather than throwing.
function parseGpioLine(line: string): { pin: number; rising: boolean } | null {
  const match = line.trim().match(/^(\d+)\s+(rising|falling)$/i);
  if (!match) return null;
  return { pin: Number(match[1]), rising: match[2].toLowerCase() === 'rising' };
}

// onCrash fires when this specific watcher process dies WITHOUT having gone
// through stopGpioWatcher first (e.g. lost permission on /dev/gpiochip0,
// gpiomon killed out-of-band) — never on a deliberate stop/restart.
export function startGpioWatcher(
  config: GpioDeviceConfig,
  onAction: (action: GpioAction) => void,
  onCrash?: () => void,
): void {
  if (watcherProcess) return; // already running — idempotent

  // A killed gpiomon doesn't release its GPIO lines the moment kill()
  // returns — SIGTERM delivery takes a beat. Anything that stops and
  // immediately starts again (the settings toggle flicked off and straight
  // back on) would otherwise spawn a second gpiomon onto lines the first
  // still holds: it exits 1 with "unable to request lines on chip
  // /dev/gpiochip0: Device or resource busy", which reads as a crash, and a
  // crash persists enabled:false — a dead volume knob from one double-click.
  // Wait for the previous process's real exit instead of racing it.
  if (dyingProcess) {
    dyingProcess.once('exit', () => startGpioWatcher(config, onAction, onCrash));
    return;
  }
  lastEncoderState = { a: 0, b: 0 };
  quadratureAccumulator = 0;
  lastButtonEdgeAt = 0;

  // Captured in a local const — `watcherProcess` is a shared module
  // variable that a config-edit restart can reassign to a newer process
  // while this one's own exit/error event is still in flight. Every
  // handler below guards with `watcherProcess === proc` so only the
  // CURRENT watcher's own handlers may ever clear the shared reference.
  const proc = spawn('gpiomon', [
    '--chip', 'gpiochip0',
    '--format', '%o %E',
    String(config.pinA),
    String(config.pinB),
    String(config.pinButton),
  ]);
  watcherProcess = proc;

  // gpiomon reports its real failure reason on stderr and then just exits
  // ("unable to request lines on chip /dev/gpiochip0: Device or resource
  // busy", a wrong chip, no permission) — that path emits 'exit', never
  // 'error', so nothing here was ever logged: the watcher vanished, the
  // crash handler quietly persisted enabled:false, and the volume knob was
  // dead with not a single line in the journal to explain it. Kept as the
  // last line only, to feed the exit log below.
  let lastStderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    lastStderr = chunk.toString().trim();
    console.error('[gpio] gpiomon:', lastStderr);
  });

  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      const parsed = parseGpioLine(line);
      if (!parsed) continue;

      if (parsed.pin === config.pinButton) {
        // Fire on ANY edge — active-high vs. active-low wiring no longer
        // matters — debounced against mechanical contact bounce (several
        // edges within a few ms of one physical press).
        const now = Date.now();
        if (now - lastButtonEdgeAt >= BUTTON_DEBOUNCE_MS) {
          lastButtonEdgeAt = now;
          onAction(config.actionButtonPress);
        }
        continue;
      }

      if (!lastEncoderState) continue;
      const next = { ...lastEncoderState };
      if (parsed.pin === config.pinA) next.a = parsed.rising ? 1 : 0;
      else if (parsed.pin === config.pinB) next.b = parsed.rising ? 1 : 0;
      else continue;

      const step = decodeQuadratureStep(lastEncoderState, next);
      lastEncoderState = next;
      if (step === 0) continue;

      quadratureAccumulator += step;
      if (quadratureAccumulator >= 4) {
        quadratureAccumulator -= 4;
        onAction(config.actionRotateCw);
      } else if (quadratureAccumulator <= -4) {
        quadratureAccumulator += 4;
        onAction(config.actionRotateCcw);
      }
    }
  });

  // Shared by 'exit' and 'error' since a spawn failure can raise either or
  // both — guarded so a crash is ever reported at most once.
  let goneHandled = false;
  const handleProcessGone = (code?: number | null) => {
    if (goneHandled) return;
    goneHandled = true;
    if (watcherProcess === proc) watcherProcess = null;
    if (intentionallyStopped.delete(proc)) return; // deliberate stop — not a crash
    console.error(
      `[gpio] gpiomon stopped unexpectedly (exit ${code ?? '?'}) — GPIO input disabled` +
        (lastStderr ? `: ${lastStderr}` : ''),
    );
    onCrash?.();
  };

  proc.on('exit', handleProcessGone);

  // Without this, a spawn failure (missing gpiomon binary, gpiod not
  // installed, no permission on /dev/gpiochip0) emits an unhandled
  // 'error' event that crashes the whole process — not just GPIO. This
  // handler turns that into a soft "watcher not running" state instead.
  proc.on('error', (err) => {
    console.error('[gpio] gpiomon subprocess failed to start:', err.message);
    handleProcessGone(null);
  });
}

// onStopped, if given, fires once the process has actually exited — use it
// to sequence a respawn (e.g. a config-edit restart) instead of starting the
// new gpiomon immediately, which would otherwise race the old one for
// exclusive ownership of the same GPIO lines before SIGTERM has been fully
// delivered.
export function stopGpioWatcher(onStopped?: () => void): void {
  const proc = watcherProcess;
  if (!proc) {
    onStopped?.();
    return;
  }
  intentionallyStopped.add(proc);
  dyingProcess = proc;
  // Registered before any onStopped below, so a caller that restarts from
  // that callback sees the coast already clear.
  proc.once('exit', () => {
    if (dyingProcess === proc) dyingProcess = null;
  });
  // Clear the shared reference now, not when 'exit' eventually fires — a
  // caller that immediately starts a new watcher right after this call
  // (rather than waiting for onStopped) must see "no watcher" and be free
  // to spawn one, not be blocked by this dying-but-not-yet-dead process.
  // This process's own exit/error handler (registered in startGpioWatcher)
  // is guarded by identity, so it no-ops once this reference has moved on
  // to a newer process instead of nulling it out.
  watcherProcess = null;
  if (onStopped) proc.once('exit', onStopped);
  proc.kill();
}
