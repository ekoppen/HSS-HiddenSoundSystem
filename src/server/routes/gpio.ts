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
  if (validation.valid === false) {
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
  // The watcher's stdout handler closes over the config object passed at
  // enableGpioWatcher() time — reassigning gpioConfig doesn't reach it.
  // Restart so an edit while already enabled takes effect immediately.
  // Sequenced through the old process's actual exit (not fired immediately)
  // so the new gpiomon never contends with the old one for the same lines.
  if (wasEnabled) {
    disableGpioWatcher(() => enableGpioWatcher());
  }
  broadcastWebSocket({ event: 'notification', timestamp: Date.now(), data: { message: 'GPIO-configuratie opgeslagen' } });
  res.json({ success: true, config: next, status: detectGpioStatus(activeDacType()) });
});

router.post('/api/gpio/enable', requireAudioPermission('admin:all'), (req, res) => {
  if (!gpioConfig) {
    res.status(400).json({ error: 'Nog geen apparaat geconfigureerd' });
    return;
  }
  // spawn() returns synchronously, so without this check a missing gpiod
  // install would still report success here — the async spawn failure (and
  // the resulting onCrash flip back to disabled) would only surface later.
  if (!detectGpioStatus(activeDacType()).gpiodInstalled) {
    res.status(400).json({ error: 'gpiod is niet geïnstalleerd' });
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
