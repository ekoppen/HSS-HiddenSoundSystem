// External audio source recognition (turntable/CD via USB mic) — this app
// never plays or controls this audio, it's purely a "what's playing" display.
// See src/services/audioRecognition.ts and state.ts's startExternalListenLoop.
import { execSync } from 'child_process';
import express from 'express';
import {
  broadcastExternalSource,
  broadcastWebSocket,
  externalSourceState,
  hubConfig,
  isLocalPlayerActive,
  playbackState,
  requestExternalRescan,
  requireAudioPermission,
  sendSpotifyPlayerCommand,
  setExternalSourceState,
  startExternalListenLoop,
  stopExternalListening,
  stopLocal,
} from '../state.ts';

const router = express.Router();

router.get('/api/recognize/devices', (req, res) => {
  try {
    const output = execSync('arecord -l', { encoding: 'utf8' });
    const devices: { id: string; label: string }[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^card (\d+): \S+ \[([^\]]+)\], device (\d+): /);
      if (match) {
        const [, cardIdx, cardName, deviceIdx] = match;
        devices.push({ id: `plughw:${cardIdx},${deviceIdx}`, label: `${cardName} (card ${cardIdx})` });
      }
    }
    res.json({ success: true, devices });
  } catch (e) {
    res.json({ success: true, devices: [] });
  }
});

router.post('/api/recognize/listen/start', requireAudioPermission('audio:control'), (req, res) => {
  const { source } = req.body || {};
  if (source !== 'turntable' && source !== 'cd') {
    res.status(400).json({ error: 'source moet "turntable" of "cd" zijn' });
    return;
  }
  if (!hubConfig.recognitionMicDevice) {
    res.status(400).json({ error: 'Stel eerst een microfoon in bij Instellingen' });
    return;
  }
  // Choosing the external source as input takes over from whatever this
  // app was driving itself — same as a receiver's input selector, only one
  // source at a time. Pause rather than fully stop (mirrors startLocalAudio
  // pausing Spotify): resuming the app's own playback later, via
  // /api/playback/play or starting a new track, calls stopExternalListening()
  // right back, so switching between "my library" and "the turntable" round-trips.
  if (isLocalPlayerActive()) stopLocal();
  else sendSpotifyPlayerCommand('pause').catch(() => {});
  playbackState.isPlaying = false;
  broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: false, positionMs: playbackState.positionMs } });

  setExternalSourceState({
    active: true,
    sourceType: source,
    sourceLabel: source === 'turntable' ? 'Platenspeler' : 'CD-speler',
    track: null,
    listening: true,
    lastRecognizedAt: null,
    status: 'recognizing',
    trackStartedAt: null,
  });
  broadcastExternalSource();
  startExternalListenLoop();
  res.json({ success: true, externalSource: externalSourceState });
});

router.post('/api/recognize/listen/stop', requireAudioPermission('audio:control'), (req, res) => {
  stopExternalListening();
  res.json({ success: true });
});

// Manual fallback for when the automatic silence-detection loop misses a
// real track change (e.g. a gapless album with no silence between tracks) —
// forces one fresh recognition attempt on the currently listening loop.
router.post('/api/recognize/rescan', requireAudioPermission('audio:control'), (req, res) => {
  if (!externalSourceState.active) {
    res.status(400).json({ error: 'Er wordt nu niet naar een externe bron geluisterd' });
    return;
  }
  requestExternalRescan();
  res.json({ success: true });
});

router.get('/api/recognize/status', (req, res) => {
  res.json({
    success: true,
    externalSource: externalSourceState,
    hasApiKey: Boolean(hubConfig.acoustidApiKey) || Boolean(hubConfig.auddApiToken),
    hasMicDevice: Boolean(hubConfig.recognitionMicDevice),
  });
});

export default router;
