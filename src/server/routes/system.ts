// System hardware/audio test, and the automated setup/onboarding provisioner.
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupDbTo } from '../../../db.ts';
import { piHardware } from '../../services/piHardware.ts';
import { piSetup } from '../../services/piSetup.ts';
import { checkServices, isRestartableUnit, restartService } from '../../services/serviceWatchdog.ts';
import { audioDevices, broadcastWebSocket, dacConfig, getHealthIssues, getOrCreateKioskApiKey, hubConfig, PORT, requireAudioPermission, setLocalKioskDisplayActive, systemStats } from '../state.ts';

const router = express.Router();

// 8. System Hardware & Audio Test
router.get('/api/system/stats', (req, res) => {
  res.json({ stats: systemStats });
});

// Previously-silent failure points (a mixer never found, a DB write that
// silently discarded a setting, mpv failing to spawn) now report here
// instead of only ever showing up in journalctl — see healthLog.ts.
// No auth: this is diagnostic-only, nothing here lets you change anything.
router.get('/api/system/health', (req, res) => {
  res.json({ issues: getHealthIssues() });
});

// The systemd units this app leans on: is each one up, and how often has it
// been restarted. Same "no auth, diagnostic only" reasoning as /health above
// — this reveals nothing you couldn't see by looking at the device.
// Re-samples on request instead of serving the last 30s tick, so pressing
// restart and looking again tells the truth immediately.
router.get('/api/system/services', (req, res) => {
  res.json({ services: checkServices() });
});

// admin:all — this runs systemctl as root. Which units are even eligible is
// decided in serviceWatchdog.ts (never `hss` itself: restarting the service
// that serves this request kills the request, and a restart that doesn't
// come back leaves no way in but SSH).
router.post('/api/system/services/restart', requireAudioPermission('admin:all'), (req, res) => {
  const unit = String(req.body?.unit || '');
  if (!isRestartableUnit(unit)) {
    res.status(400).json({ success: false, error: `Dienst '${unit}' kan niet via de app herstart worden` });
    return;
  }
  const result = restartService(unit);
  if (result.success) {
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: `Dienst ${unit} opnieuw gestart` },
    });
  }
  res.status(result.success ? 200 : 500).json({ ...result, services: checkServices() });
});

// Date/time/timezone — the Pi's system clock (used for logs, file
// timestamps, and the cast display's clock), not per-browser client time.
router.get('/api/system/time', (req, res) => {
  const info = piHardware.getTimeInfo();
  res.json({ success: true, ...info, timezones: piHardware.listTimezones() });
});

// admin:all — sets the Pi's system clock/timezone via `sudo timedatectl`; a
// scoped key (e.g. one made for a Home Assistant volume integration) has no
// business touching that.
router.post('/api/system/time', requireAudioPermission('admin:all'), async (req, res) => {
  const { timezone, ntpEnabled, dateTime } = req.body || {};

  if (timezone !== undefined) {
    const r = await piHardware.setTimezone(timezone);
    if (!r.success) return res.status(400).json({ error: r.error || 'Kon tijdzone niet instellen' });
  }
  if (ntpEnabled !== undefined) {
    const r = await piHardware.setNtpEnabled(!!ntpEnabled);
    if (!r.success) return res.status(400).json({ error: r.error || 'Kon NTP-status niet wijzigen' });
  }
  if (dateTime !== undefined) {
    const r = await piHardware.setManualDateTime(dateTime);
    if (!r.success) return res.status(400).json({ error: r.error || 'Kon systeemtijd niet instellen' });
  }

  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: { message: 'Datum/tijd-instellingen bijgewerkt' },
  });

  const info = piHardware.getTimeInfo();
  res.json({ success: true, ...info, timezones: piHardware.listTimezones() });
});

// Read-only network status (interfaces, IPs, connected SSID) — no
// permission gate, same as /api/system/stats above: nothing here can
// change anything.
router.get('/api/system/network', (req, res) => {
  res.json({ success: true, interfaces: piHardware.getNetworkStatus() });
});

// admin:all — scans for nearby WiFi networks. Can take a few seconds.
router.get('/api/system/network/wifi-scan', requireAudioPermission('admin:all'), (req, res) => {
  res.json({ success: true, networks: piHardware.scanWifiNetworks() });
});

// admin:all — switches the Pi's WiFi to a different network. A wrong
// password or an out-of-range SSID can leave the Pi unreachable over WiFi
// until someone has physical or ethernet access to fix it — there's no way
// to safely auto-rollback a network change from inside the very server
// that change might disconnect.
router.post('/api/system/network/wifi', requireAudioPermission('admin:all'), async (req, res) => {
  const { ssid, password } = req.body || {};
  if (!ssid || typeof ssid !== 'string') {
    return res.status(400).json({ error: 'SSID is verplicht' });
  }
  const result = await piHardware.connectWifi(ssid, typeof password === 'string' ? password : '');
  if (!result.success) return res.status(400).json({ error: result.error || 'Verbinden mislukt' });
  res.json({ success: true, interfaces: piHardware.getNetworkStatus() });
});

router.get('/api/system/hardware-status', (req, res) => {
  const hwStatus = piHardware.detectHardware();
  res.json({
    success: true,
    hardware: hwStatus,
    stats: systemStats,
    audioDevices,
    activeDac: audioDevices.find((d) => d.id === dacConfig.activeDeviceId) || audioDevices[0],
  });
});

router.post('/api/system/test-audio', async (req, res) => {
  const activeDac = audioDevices.find((d) => d.id === dacConfig.activeDeviceId);
  const executedRealHardware = await piHardware.playTestAudioSweep();

  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: {
      message: `ALSA Test Sine Sweep (440Hz HiFi DAC) verzonden naar ${activeDac?.name || 'DAC'}`,
    },
  });
  res.json({
    success: true,
    executedRealHardware,
    message: `ALSA 440Hz Test Tone uitgevoerd op ${activeDac?.name || 'I2S DAC'}`,
  });
});

// 9. Automated Setup & Onboarding Provisioner
router.get('/api/setup/detect', (req, res) => {
  const detection = piSetup.detectSetupStatus(audioDevices);
  res.json({
    success: true,
    detection,
    audioDevices,
    currentConfig: hubConfig,
  });
});

// admin:all — rewrites root-owned system files (/etc/asound.conf, boot
// config.txt) and the librespot systemd unit.
router.post('/api/setup/provision', requireAudioPermission('admin:all'), async (req, res) => {
  const { dacId, deviceName, bitrate, enableVolumeNormalisation } = req.body;
  const selectedDac = audioDevices.find((d) => d.id === (dacId || dacConfig.activeDeviceId)) || audioDevices[0];

  if (deviceName) hubConfig.spotifyDeviceName = deviceName;
  if (bitrate) hubConfig.spotifyBitrate = bitrate;
  if (enableVolumeNormalisation !== undefined) hubConfig.spotifyNormalisation = enableVolumeNormalisation;

  dacConfig.activeDeviceId = selectedDac.id;
  dacConfig.dtoverlay = selectedDac.dtoverlay;

  const result = await piSetup.autoProvisionSystem(
    {
      dacId: selectedDac.id,
      deviceName: hubConfig.spotifyDeviceName,
      bitrate: hubConfig.spotifyBitrate,
      enableVolumeNormalisation: hubConfig.spotifyNormalisation,
      webPort: PORT,
    },
    selectedDac
  );

  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: {
      message: `Systeem succesvol geconfigureerd voor ${selectedDac.name}!`,
    },
  });

  res.json({
    success: result.success,
    logs: result.logs,
    needsReboot: result.needsReboot,
    selectedDac,
    hubConfig,
  });
});

// admin:all — reboots the physical device.
router.post('/api/setup/reboot', requireAudioPermission('admin:all'), (req, res) => {
  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: {
      message: 'Raspberry Pi wordt nu herstart om I2S DAC overlay te activeren...',
    },
  });
  const triggered = piSetup.triggerReboot();
  res.json({ success: true, triggered, message: 'Raspberry Pi herstart gestart' });
});

// admin:all — powers off the physical device. Getting the Pi running again
// needs someone to physically cut and restore power (or press a case
// button, if it has one) — there's no remote way back from this one.
router.post('/api/setup/shutdown', requireAudioPermission('admin:all'), (req, res) => {
  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: { message: 'Raspberry Pi wordt nu uitgeschakeld...' },
  });
  const triggered = piSetup.triggerShutdown();
  res.json({ success: true, triggered, message: 'Raspberry Pi wordt uitgeschakeld' });
});

// admin:all — git pull + npm install + npm build + service restart, with a
// progress log (see PiSetupService.performUpdate's doc comment for why this
// isn't just scripts/deploy.sh run in-process).
router.post('/api/system/update', requireAudioPermission('admin:all'), async (req, res) => {
  const result = await piSetup.performUpdate();
  res.json(result);
});

// admin:all — an online, consistent SQLite backup (see backupDbTo's doc
// comment), streamed straight to the browser as a download. Written to a
// temp file first since better-sqlite3's backup API needs a real file path,
// not a stream, then piped and cleaned up either way.
router.get('/api/system/backup', requireAudioPermission('admin:all'), async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `hss-backup-${Date.now()}.db`);
  try {
    await backupDbTo(tmpPath);
    const filename = `hss-backup-${new Date().toISOString().slice(0, 10)}.db`;
    res.download(tmpPath, filename, (err) => {
      fs.unlink(tmpPath, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: 'Backup verzenden mislukt' });
    });
  } catch (e: any) {
    fs.unlink(tmpPath, () => {});
    res.status(500).json({ error: `Backup mislukt: ${e.message}` });
  }
});

router.get('/api/setup/kiosk-display', (req, res) => {
  const status = piSetup.detectKioskDisplayStatus();
  // Cheap way to keep the cached flag honest: this route is polled by the
  // settings UI, and the service can also be stopped from a shell.
  setLocalKioskDisplayActive(status.serviceActive);
  res.json({ success: true, status });
});

// admin:all — installs system packages (cage, chromium-browser) and writes
// a root-owned systemd unit; not a task for a scoped integration key.
router.post('/api/setup/kiosk-display/enable', requireAudioPermission('admin:all'), async (req, res) => {
  const result = await piSetup.enableLocalKioskDisplay(PORT, getOrCreateKioskApiKey());
  if (result.success) {
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: 'Lokaal kiosk-scherm ingeschakeld' },
    });
  }
  const kioskStatus = piSetup.detectKioskDisplayStatus();
  setLocalKioskDisplayActive(kioskStatus.serviceActive);
  res.json({ success: result.success, logs: result.logs, status: kioskStatus });
});

router.post('/api/setup/kiosk-display/disable', requireAudioPermission('admin:all'), async (req, res) => {
  const result = await piSetup.disableLocalKioskDisplay();
  if (result.success) {
    broadcastWebSocket({
      event: 'notification',
      timestamp: Date.now(),
      data: { message: 'Lokaal kiosk-scherm uitgeschakeld' },
    });
  }
  const kioskStatus = piSetup.detectKioskDisplayStatus();
  setLocalKioskDisplayActive(kioskStatus.serviceActive);
  res.json({ success: result.success, logs: result.logs, status: kioskStatus });
});

export default router;
