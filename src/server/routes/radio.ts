// Web radio / internet stream search, station CRUD, and playback.
import express from 'express';
import { addDbWebRadioStation, deleteDbWebRadioStation, getDbWebRadioStations, updateDbWebRadioStation } from '../../../db.ts';
import { broadcastWebSocket, maybeAutoCast, playbackState, startLocalAudio } from '../state.ts';

const router = express.Router();

// Live Radio-Browser API Station Search (40,000+ free global radio stations)
router.get('/api/radio/search', async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) return res.json({ success: true, stations: [] });

  try {
    const radioRes = await fetch(`https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(q)}&limit=24&hidebroken=true`);
    if (!radioRes.ok) {
      return res.json({ success: true, stations: [] });
    }
    const data = await radioRes.json();
    const stations = (data || []).map((s: any) => ({
      id: 'radio-search-' + (s.stationuuid || Math.random().toString(36).substring(7)),
      name: s.name ? s.name.trim() : 'Web Radio',
      genre: s.tags ? s.tags.split(',').slice(0, 3).join(', ') : (s.country || 'Global Radio'),
      url: s.url_resolved || s.url,
      bitrate: s.bitrate || 128,
      logoUrl: s.favicon || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80',
      codec: s.codec || 'MP3',
      country: s.country || '',
    }));
    res.json({ success: true, stations });
  } catch (e: any) {
    res.json({ success: true, stations: [] });
  }
});

router.get('/api/radio/stations', (req, res) => {
  const stations = getDbWebRadioStations();
  res.json({ success: true, stations });
});

router.post('/api/radio/stations', (req, res) => {
  const { name, genre, url, bitrate, logoUrl } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: 'Naam en URL zijn verplicht' });
  }
  const id = addDbWebRadioStation({ name, genre: genre || 'Web Radio', url, bitrate: bitrate || 320, logoUrl });
  res.json({ success: true, id, stations: getDbWebRadioStations() });
});

router.put('/api/radio/stations/:id', (req, res) => {
  const { name, genre, url, bitrate, logoUrl } = req.body || {};
  const ok = updateDbWebRadioStation(req.params.id, { name, genre, url, bitrate, logoUrl });
  if (!ok) return res.status(404).json({ error: 'Zender niet gevonden' });
  res.json({ success: true, stations: getDbWebRadioStations() });
});

router.delete('/api/radio/stations/:id', (req, res) => {
  deleteDbWebRadioStation(req.params.id);
  res.json({ success: true, stations: getDbWebRadioStations() });
});

router.post('/api/radio/play', async (req, res) => {
  const { stationId, url, name, genre, logoUrl } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Radio URL is verplicht' });

  playbackState.isPlaying = true;
  maybeAutoCast();
  playbackState.activeProfileName = `Web Radio: ${name || 'Live Stream'}`;
  playbackState.currentTrack = {
    id: stationId || 'radio-' + Date.now(),
    title: name || 'Live Web Radio',
    artist: genre || 'Internet Radio Stream',
    // The station's own name — once a stream's ICY tag replaces title/artist
    // with the actual song info (see the ticker in state.ts), this is the
    // only place left saying which station is playing.
    album: name || 'HSS HiFi Web Radio',
    coverUrl: logoUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    highResCoverUrl: logoUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&auto=format&fit=crop&q=90',
    durationMs: 0,
    uri: url,
    bitrate: 320,
    sampleRate: 44100,
    bitDepth: 24,
    dominantColor: '#4f46e5',
  };
  playbackState.positionMs = 0;
  playbackState.durationMs = 0;
  playbackState.queue = [];
  startLocalAudio(playbackState.currentTrack);

  broadcastWebSocket({
    event: 'track_change',
    timestamp: Date.now(),
    data: { track: playbackState.currentTrack, isLiveSpotify: false, queue: playbackState.queue },
  });
  broadcastWebSocket({
    event: 'playback_state',
    timestamp: Date.now(),
    data: { isPlaying: true, positionMs: 0 },
  });

  res.json({ success: true, message: `Web Radio ${name || ''} gestart`, track: playbackState.currentTrack });
});

export default router;
