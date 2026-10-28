// Google Cast & Nest Hub discovery and control. The actual cast engine
// (startCast/stopCast/resolveCastTarget/buildKioskUrl) lives in state.ts
// since maybeAutoCast (called from playback/playlists/radio/spotify) also
// needs it.
import { execSync } from 'child_process';
import express from 'express';
import { CastDesignPreset } from '../../types.ts';
import {
  cancelPendingAutoStopCast,
  castDesignPresets,
  castSessionState,
  castSettingsState,
  exitCastStandby,
  requireAudioPermission,
  resolveCastTarget,
  setCastDesignPresets,
  setCastSettingsState,
  startCast,
  stopCast,
} from '../state.ts';

const router = express.Router();

router.get('/api/cast/devices', (req, res) => {
  try {
    const raw = execSync('avahi-browse -r -t _googlecast._tcp -p -k 2>/dev/null', {
      encoding: 'utf8',
      timeout: 4000,
    });
    const lines = raw.split('\n');
    const devicesMap = new Map<string, any>();

    for (const line of lines) {
      if (!line.startsWith('=')) continue;
      const parts = line.split(';');
      if (parts.length < 10) continue;

      const ip = parts[7];
      const port = parseInt(parts[8], 10) || 8009;
      const txtRecord = parts[9] || '';

      const fnMatch = txtRecord.match(/"fn=([^"]+)"/);
      const mdMatch = txtRecord.match(/"md=([^"]+)"/);
      const idMatch = txtRecord.match(/"id=([^"]+)"/);

      const friendlyName = fnMatch ? fnMatch[1] : parts[3] || 'Cast Device';
      const model = mdMatch ? mdMatch[1] : 'Chromecast / Nest Hub';
      const deviceId = idMatch ? idMatch[1] : ip;

      // Prefer IPv4
      if (ip && !ip.includes(':') && !devicesMap.has(deviceId)) {
        devicesMap.set(deviceId, {
          id: deviceId,
          name: friendlyName,
          model: model,
          ip: ip,
          port: port,
          type: model.toLowerCase().includes('hub') ? 'nest_hub' : 'chromecast',
          isOnline: true,
        });
      }
    }

    for (const line of lines) {
      if (!line.startsWith('=')) continue;
      const parts = line.split(';');
      if (parts.length < 10) continue;
      const ip = parts[7];
      const txtRecord = parts[9] || '';
      const idMatch = txtRecord.match(/"id=([^"]+)"/);
      const deviceId = idMatch ? idMatch[1] : ip;

      if (deviceId && devicesMap.has(deviceId) && ip && !ip.includes(':')) {
        devicesMap.get(deviceId).ip = ip;
      }
    }

    const devices = Array.from(devicesMap.values());
    res.json({ success: true, devices });
  } catch (e: any) {
    console.warn('[Cast Devices Scan Error]:', e.message);
    res.json({ success: true, devices: [] });
  }
});

router.get('/api/cast/session', (req, res) => {
  res.json({ success: true, session: castSessionState });
});

router.get('/api/cast/settings', (req, res) => {
  res.json({ success: true, settings: castSettingsState });
});

router.post('/api/cast/settings', (req, res) => {
  // setCastSettingsState persists and broadcasts internally now — see its
  // doc-comment in state.ts.
  if (req.body) {
    setCastSettingsState({ ...castSettingsState, ...req.body });
  }
  res.json({ success: true, settings: castSettingsState });
});

// Named "looks" — a saved subset of CastSettings (see CastDesignPreset) the
// editor can save the current visual config as, then re-apply later. Device
// targeting and automation timers are deliberately never part of a preset.
router.get('/api/cast/presets', (req, res) => {
  res.json({ success: true, presets: castDesignPresets });
});

router.post('/api/cast/presets', (req, res) => {
  const { name, settings } = req.body || {};
  if (!name || typeof name !== 'string' || !settings || typeof settings !== 'object') {
    res.status(400).json({ error: 'Naam en instellingen zijn verplicht' });
    return;
  }
  const preset: CastDesignPreset = {
    id: 'preset-' + Date.now(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    settings,
  };
  setCastDesignPresets([...castDesignPresets, preset]);
  res.status(201).json({ success: true, preset, presets: castDesignPresets });
});

router.delete('/api/cast/presets/:id', (req, res) => {
  const preset = castDesignPresets.find((p) => p.id === req.params.id);
  if (!preset) {
    res.status(404).json({ error: 'Preset niet gevonden' });
    return;
  }
  setCastDesignPresets(castDesignPresets.filter((p) => p.id !== req.params.id));
  res.json({ success: true, message: `Preset '${preset.name}' verwijderd`, presets: castDesignPresets });
});

// Callable with an empty body once a device is configured in Cast settings — e.g. a Home
// Assistant rest_command that just POSTs here to bring the Hub display on for "turn on music".
router.post('/api/cast/start', requireAudioPermission('audio:control'), (req, res) => {
  const { deviceId, deviceIp, deviceName, layout, themeId } = req.body || {};
  const resolved = resolveCastTarget({ deviceId, deviceIp, deviceName, layout, themeId });
  if (!resolved) {
    res.status(400).json({ error: 'Geen cast-apparaat opgegeven en geen standaardapparaat ingesteld bij Cast-instellingen.' });
    return;
  }
  try {
    startCast(resolved);
    res.json({ success: true, session: castSessionState });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/cast/stop', requireAudioPermission('audio:control'), (req, res) => {
  const { deviceId, deviceIp } = req.body;
  try {
    stopCast(deviceIp || deviceId);
    res.json({ success: true, session: castSessionState });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Tapping the standby screen calls this — leaves standby without needing
// playback to actually start first (the auto-stop ticker won't re-arm
// until something plays, see hasPlayedSinceCastStart in state.ts).
router.post('/api/cast/wake', requireAudioPermission('audio:control'), (req, res) => {
  cancelPendingAutoStopCast();
  exitCastStandby();
  res.json({ success: true, session: castSessionState });
});

export default router;
