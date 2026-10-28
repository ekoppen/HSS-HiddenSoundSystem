// Core playback transport, status, and queue endpoints.
import express from 'express';
import { INITIAL_TRACKS } from '../../services/mockPiData.ts';
import { piHardware } from '../../services/piHardware.ts';
import {
  advancedAudio,
  advanceLocalQueue,
  audioDevices,
  broadcastWebSocket,
  dacConfig,
  hasLocalSource,
  hubConfig,
  isLocalPlayerActive,
  maybeAutoCast,
  pauseOrResumeLocal,
  playbackState,
  playQueuedTrack,
  requireAudioPermission,
  scheduleAutoStopCast,
  seekLocal,
  sendSpotifyPlayerCommand,
  stopExternalListening,
  togglePlayback,
  updateCheckState,
} from '../state.ts';

const router = express.Router();

// 1. Full Status Endpoint
router.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    playback: playbackState,
    activeDac: audioDevices.find((d) => d.id === dacConfig.activeDeviceId) || audioDevices[0],
    hubConfig: {
      spotifyDeviceName: hubConfig.spotifyDeviceName,
      spotifyBitrate: hubConfig.spotifyBitrate,
      soloistEnabled: hubConfig.soloistEnabled,
      broadcastSpectrum: hubConfig.broadcastSpectrum,
      // Needed by any screen that draws a volume bar — the kiosk display
      // loads its whole world from this endpoint and has no other way to
      // learn the ceiling.
      maxVolumeLimit: hubConfig.maxVolumeLimit,
      // Login/Connect only need a Client ID (PKCE, no secret) — this drives
      // whether the SourcePicker shows a Spotify tab at all, so gating it
      // on the secret too (a pre-PKCE leftover) hid Spotify entirely for
      // anyone who only entered a Client ID, even while fully logged in.
      // The separate app-level search feature still checks its own full
      // credentials independently and fails gracefully without them.
      hasSpotifyCredentials: Boolean(hubConfig.spotifyClientId),
    },
    advancedAudio,
    activeProfileName: playbackState.activeProfileName,
    updateAvailable: updateCheckState.updateAvailable,
    updateMessage: updateCheckState.latestMessage,
  });
});

// 2. Playback Control Endpoints
router.post('/api/playback/play', async (req, res) => {
  const wasPlaying = playbackState.isPlaying;
  if (hasLocalSource()) {
    // mpv's IPC socket can still be (re)connecting for a few seconds —
    // unlike togglePlayback(), this endpoint used to ignore that and always
    // report success, which is what let the UI/animation flip to "playing"
    // while mpv never actually got the resume command.
    const sent = await pauseOrResumeLocal(true);
    if (!sent) {
      res.status(409).json({ error: 'Lokale speler (mpv) is nog niet verbonden — probeer het over een paar seconden opnieuw.' });
      return;
    }
  } else {
    const result = await sendSpotifyPlayerCommand('resume');
    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }
  }
  playbackState.isPlaying = true;
  if (!wasPlaying) maybeAutoCast();
  stopExternalListening(); // resuming the app's own source takes back the input
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: true, positionMs: playbackState.positionMs },
  });
  res.json({ success: true, isPlaying: true });
});

router.post('/api/playback/pause', async (req, res) => {
  if (hasLocalSource()) {
    await pauseOrResumeLocal(false);
  } else {
    const result = await sendSpotifyPlayerCommand('pause');
    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }
  }
  playbackState.isPlaying = false;
  playbackState.spectrum = Array(16).fill(0);
  scheduleAutoStopCast();
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: false, positionMs: playbackState.positionMs },
  });
  res.json({ success: true, isPlaying: false });
});

router.post('/api/playback/toggle', async (req, res) => {
  const result = await togglePlayback();
  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ success: true, isPlaying: result.isPlaying });
});

router.post('/api/playback/seek', (req, res) => {
  const { positionMs } = req.body;
  if (typeof positionMs === 'number') {
    playbackState.positionMs = Math.max(0, Math.min(positionMs, playbackState.durationMs));
    if (isLocalPlayerActive()) seekLocal(playbackState.positionMs);
    broadcastWebSocket({
      event: 'playback_state',
      timestamp: Date.now(),
      data: { positionMs: playbackState.positionMs },
    });
    res.json({ success: true, positionMs: playbackState.positionMs });
  } else {
    res.status(400).json({ error: 'Invalid positionMs parameter' });
  }
});

router.post('/api/playback/next', async (req, res) => {
  stopExternalListening(); // skipping implies the app's own source is the input again
  if (isLocalPlayerActive()) {
    advanceLocalQueue();
    return res.json({ success: true, currentTrack: playbackState.currentTrack });
  }
  const result = await sendSpotifyPlayerCommand('next');
  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }
  if (playbackState.queue.length > 0) {
    const nextTrack = playbackState.queue.shift()!;
    playbackState.currentTrack = nextTrack;
    playbackState.positionMs = 0;
    playbackState.durationMs = nextTrack.durationMs;
    playbackState.isPlaying = true;
    broadcastWebSocket({
      event: 'track_change',
      timestamp: Date.now(),
      data: { track: playbackState.currentTrack, queue: playbackState.queue },
    });
  }
  // Otherwise Spotify Connect owns "next" via the playerctl command above.
  res.json({ success: true, currentTrack: playbackState.currentTrack });
});

router.post('/api/playback/previous', async (req, res) => {
  stopExternalListening(); // same as next — reclaims the input
  if (isLocalPlayerActive()) {
    // No play-history is kept for local queues — "previous" restarts the
    // current track, same as most players do once you're not near the start.
    playbackState.positionMs = 0;
    seekLocal(0);
    broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { positionMs: 0 } });
    return res.json({ success: true, currentTrack: playbackState.currentTrack });
  }
  const result = await sendSpotifyPlayerCommand('previous');
  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }
  if (playbackState.positionMs > 5000 || playbackState.activeProfileName?.includes('Spotify') || piHardware.getSpotifyActive()) {
    playbackState.positionMs = 0;
    broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { positionMs: 0 } });
  }
  res.json({ success: true, currentTrack: playbackState.currentTrack });
});

router.post('/api/playback/shuffle', (req, res) => {
  playbackState.shuffle = !playbackState.shuffle;
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { shuffle: playbackState.shuffle },
  });
  res.json({ success: true, shuffle: playbackState.shuffle });
});

router.post('/api/playback/repeat', (req, res) => {
  const modes: ('off' | 'track' | 'context')[] = ['off', 'track', 'context'];
  const nextIdx = (modes.indexOf(playbackState.repeat) + 1) % modes.length;
  playbackState.repeat = modes[nextIdx];
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { repeat: playbackState.repeat },
  });
  res.json({ success: true, repeat: playbackState.repeat });
});

// Track search
router.get('/api/search', (req, res) => {
  const query = ((req.query.q as string) || '').toLowerCase();
  const results = INITIAL_TRACKS.filter(
    (t) =>
      t.title.toLowerCase().includes(query) ||
      t.artist.toLowerCase().includes(query) ||
      t.album.toLowerCase().includes(query)
  );
  res.json({ results: results.length > 0 ? results : INITIAL_TRACKS });
});

// Queue actions
router.post('/api/queue/add', requireAudioPermission('audio:control'), (req, res) => {
  const { track, tracks, label } = req.body;
  if (Array.isArray(tracks) && tracks.length > 0) {
    // One user action (e.g. "play this whole album") adding many tracks at
    // once — a single broadcast with a count, not one 'add' event per track,
    // so the UI shows one toast instead of spamming one per song.
    playbackState.queue.push(...tracks);
    broadcastWebSocket({
      event: 'queue_update',
      timestamp: Date.now(),
      data: { queue: playbackState.queue, action: 'add-many', count: tracks.length, label },
    });
    res.json({ success: true, queue: playbackState.queue });
  } else if (track) {
    playbackState.queue.push(track);
    broadcastWebSocket({
      event: 'queue_update',
      timestamp: Date.now(),
      data: { queue: playbackState.queue, action: 'add', track },
    });
    res.json({ success: true, queue: playbackState.queue });
  } else {
    res.status(400).json({ error: 'No track provided' });
  }
});

// Jumps straight to a specific queued track — works no matter what mix of
// NAS/radio/Spotify tracks are sitting in the queue (see playQueuedTrack).
router.post('/api/queue/play', requireAudioPermission('audio:control'), async (req, res) => {
  const { trackId } = req.body || {};
  const idx = playbackState.queue.findIndex((t) => t.id === trackId);
  if (idx === -1) {
    res.status(404).json({ error: 'Track niet in wachtrij gevonden' });
    return;
  }
  const [track] = playbackState.queue.splice(idx, 1);
  const result = await playQueuedTrack(track);
  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ success: true, currentTrack: track, queue: playbackState.queue });
});

router.post('/api/queue/reorder', requireAudioPermission('audio:control'), (req, res) => {
  const { trackId, toIndex } = req.body || {};
  if (typeof trackId !== 'string' || !Number.isInteger(toIndex)) {
    return res.status(400).json({ error: 'trackId (string) en toIndex (getal) zijn verplicht' });
  }
  const queue = playbackState.queue;
  const fromIndex = queue.findIndex((t) => t.id === trackId);
  if (fromIndex === -1 || toIndex < 0 || toIndex >= queue.length) {
    return res.status(400).json({ error: 'track niet gevonden of doelindex buiten bereik' });
  }
  const [moved] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, moved);
  broadcastWebSocket({ event: 'queue_update', timestamp: Date.now(), data: { queue, action: 'reorder' } });
  res.json({ success: true, queue });
});

router.post('/api/queue/remove', requireAudioPermission('audio:control'), (req, res) => {
  const { trackId } = req.body || {};
  const idx = typeof trackId === 'string' ? playbackState.queue.findIndex((t) => t.id === trackId) : -1;
  if (idx === -1) {
    return res.status(400).json({ error: 'track niet gevonden in wachtrij' });
  }
  playbackState.queue.splice(idx, 1);
  broadcastWebSocket({ event: 'queue_update', timestamp: Date.now(), data: { queue: playbackState.queue, action: 'remove' } });
  res.json({ success: true, queue: playbackState.queue });
});

router.delete('/api/queue/clear', requireAudioPermission('audio:control'), (req, res) => {
  playbackState.queue = [];
  broadcastWebSocket({
    event: 'queue_update',
    timestamp: Date.now(),
    data: { queue: [], action: 'clear' },
  });
  res.json({ success: true });
});

export default router;
