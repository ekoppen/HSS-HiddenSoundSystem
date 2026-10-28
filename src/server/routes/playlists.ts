// Playlist CRUD and playlist playback.
import express from 'express';
import { DEFAULT_ADVANCED_AUDIO_SETTINGS } from '../../services/mockPiData.ts';
import { Playlist } from '../../types.ts';
import { deleteDbImportedPlaylist, getDbImportedPlaylists, saveDbImportedPlaylist } from '../../../db.ts';
import {
  advancedAudio,
  broadcastWebSocket,
  dacConfig,
  eqPresets,
  maybeAutoCast,
  playbackState,
  playSpotifyUri,
  requireAudioPermission,
  setAdvancedAudio,
  startLocalAudio,
} from '../state.ts';

const router = express.Router();

router.get('/api/playlists', (req, res) => {
  const dbPlaylists = getDbImportedPlaylists();
  res.json({ playlists: dbPlaylists, queue: playbackState.queue });
});

router.post('/api/playlists', requireAudioPermission('audio:control'), (req, res) => {
  const { name, description, coverUrl, tracks, audioProfile } = req.body;
  const newPlaylist: Playlist = {
    id: 'pl-' + Date.now(),
    name: name || 'Nieuwe HiFi Afspeellijst',
    description: description || 'Aangemaakt via HSS Web Interface',
    coverUrl:
      coverUrl ||
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    trackCount: tracks ? tracks.length : 0,
    tracks: tracks || [],
    createdAt: new Date().toISOString().split('T')[0],
    audioProfile: audioProfile || { ...DEFAULT_ADVANCED_AUDIO_SETTINGS, profileScope: 'playlist_specific' },
  };
  saveDbImportedPlaylist(newPlaylist);
  broadcastWebSocket({ event: 'playlist_created', timestamp: Date.now(), data: { playlist: newPlaylist } });
  res.json({ success: true, playlist: newPlaylist });
});

router.get('/api/playlists/:id', (req, res) => {
  const dbPlaylists = getDbImportedPlaylists();
  const playlist = dbPlaylists.find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }
  res.json({ playlist });
});

router.post('/api/playlists/:id/play', requireAudioPermission('audio:control'), async (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist || playlist.tracks.length === 0) {
    res.status(404).json({ error: 'Playlist not found or empty' });
    return;
  }

  // Spotify playlists play for real via the Web API on the librespot Connect
  // device — this app's own playback engine (startLocalAudio) only handles
  // NAS/local files, so those go through the exact same path as "play folder".
  if (playlist.isSpotify) {
    const result = await playSpotifyUri(playlist.uri || `spotify:playlist:${playlist.id}`);
    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }
    playbackState.currentPlaylistId = playlist.id;
    playbackState.activeProfileName = `${playlist.name} (Playlist Profiel)`;
    res.json({ success: true, activeProfileName: playbackState.activeProfileName });
    return;
  }

  playbackState.currentPlaylistId = playlist.id;
  playbackState.currentTrack = playlist.tracks[0];
  playbackState.positionMs = 0;
  playbackState.durationMs = playlist.tracks[0].durationMs;
  playbackState.queue = playlist.tracks.slice(1);
  playbackState.isPlaying = true;
  maybeAutoCast();

  // Apply playlist-specific DSP Audio Profile (if any) BEFORE starting
  // playback, so the track starts with the right EQ from note one instead
  // of an audible hot-swap a moment later.
  if ((playlist as any).audioProfile) {
    setAdvancedAudio({ ...(playlist as any).audioProfile, associatedPlaylistId: playlist.id });
    dacConfig.advancedAudio = { ...advancedAudio };
    const matchedEq = eqPresets.find((p) => p.id === (playlist as any).audioProfile?.eqPresetId);
    if (matchedEq) {
      dacConfig.dspEqualizer.bands = [...matchedEq.bands];
      dacConfig.dspEqualizer.activePresetId = matchedEq.id;
    }
    playbackState.activeProfileName = `${playlist.name} (Playlist Profiel)`;
  } else {
    playbackState.activeProfileName = 'Globaal Audio Profiel';
  }

  startLocalAudio(playlist.tracks[0]);

  broadcastWebSocket({
    event: 'track_change',
    timestamp: Date.now(),
    data: {
      track: playbackState.currentTrack,
      playlistId: playlist.id,
      queue: playbackState.queue,
      audioProfile: (playlist as any).audioProfile || advancedAudio,
      activeProfileName: playbackState.activeProfileName,
    },
  });
  res.json({
    success: true,
    currentTrack: playbackState.currentTrack,
    queue: playbackState.queue,
    activeProfileName: playbackState.activeProfileName,
  });
});

router.post('/api/playlists/:id/tracks', requireAudioPermission('audio:control'), (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }
  const { track } = req.body;
  if (!track || !track.title) {
    res.status(400).json({ error: 'Invalid track data' });
    return;
  }
  playlist.tracks.push(track);
  playlist.trackCount = playlist.tracks.length;
  saveDbImportedPlaylist(playlist);
  res.json({ success: true, playlist });
});

router.delete('/api/playlists/:id/tracks/:trackId', requireAudioPermission('audio:control'), (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: 'Playlist not found' });
    return;
  }
  playlist.tracks = playlist.tracks.filter((t) => t.id !== req.params.trackId);
  playlist.trackCount = playlist.tracks.length;
  saveDbImportedPlaylist(playlist);
  res.json({ success: true, playlist });
});

router.post('/api/playlists/:id/tracks/reorder', requireAudioPermission('audio:control'), (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  const { trackId, toIndex } = req.body || {};
  const fromIndex = typeof trackId === 'string' ? playlist.tracks.findIndex((t: any) => t.id === trackId) : -1;
  if (fromIndex === -1 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= playlist.tracks.length) {
    return res.status(400).json({ error: 'track niet gevonden of doelindex buiten bereik' });
  }
  const [moved] = playlist.tracks.splice(fromIndex, 1);
  playlist.tracks.splice(toIndex, 0, moved);
  saveDbImportedPlaylist(playlist);
  res.json({ success: true, playlist });
});

router.delete('/api/playlists/:id', requireAudioPermission('audio:control'), (req, res) => {
  deleteDbImportedPlaylist(req.params.id);
  res.json({ success: true });
});

export default router;
