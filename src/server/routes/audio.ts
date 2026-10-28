// Advanced audio & EQ presets, DAC/volume control — see state.ts for the
// shared dacConfig/advancedAudio/audioDevices state this operates on.
import express from 'express';
import { DEFAULT_ADVANCED_AUDIO_SETTINGS } from '../../services/mockPiData.ts';
import { EqPreset } from '../../types.ts';
import { getDbImportedPlaylists, saveDbImportedPlaylist } from '../../../db.ts';
import {
  advancedAudio,
  applyLiveAudioFilters,
  applyVolumeChange,
  audioDevices,
  broadcastWebSocket,
  dacConfig,
  eqPresets,
  playbackState,
  requireAudioPermission,
  setAdvancedAudio,
  setAudioDevices,
  setDacConfig,
} from '../state.ts';

const router = express.Router();

// 1. Get all EQ presets
router.get('/api/audio/eq-presets', (req, res) => {
  res.json({
    presets: eqPresets,
    activePresetId: dacConfig.dspEqualizer.activePresetId || 'audiophile_direct',
    currentBands: dacConfig.dspEqualizer.bands,
  });
});

// 2. Create custom EQ preset
router.post('/api/audio/eq-presets', (req, res) => {
  const { name, bands, description, category } = req.body;
  if (!name || !Array.isArray(bands)) {
    res.status(400).json({ error: 'Naam en 10-band data zijn verplicht' });
    return;
  }

  const newPreset: EqPreset = {
    id: 'custom-' + Date.now(),
    name: name.trim(),
    category: category || 'Custom',
    description: description || 'Aangepaste equalizer curve door gebruiker',
    isCustom: true,
    bands,
  };

  eqPresets.push(newPreset);
  res.status(201).json({ success: true, preset: newPreset, presets: eqPresets });
});

// 3. Delete custom EQ preset
router.delete('/api/audio/eq-presets/:id', (req, res) => {
  const presetIndex = eqPresets.findIndex((p) => p.id === req.params.id);
  if (presetIndex === -1) {
    res.status(404).json({ error: 'Preset niet gevonden' });
    return;
  }
  if (!eqPresets[presetIndex].isCustom) {
    res.status(400).json({ error: 'Ingebouwde fabriekspresets kunnen niet worden verwijderd' });
    return;
  }
  const removed = eqPresets.splice(presetIndex, 1)[0];
  res.json({ success: true, message: `Preset '${removed.name}' verwijderd`, presets: eqPresets });
});

// 4. Apply EQ preset to DAC output directly
router.post('/api/audio/eq-presets/:id/apply', (req, res) => {
  const preset = eqPresets.find((p) => p.id === req.params.id);
  if (!preset) {
    res.status(404).json({ error: 'EQ Preset niet gevonden' });
    return;
  }

  dacConfig.dspEqualizer.enabled = true;
  dacConfig.dspEqualizer.activePresetId = preset.id;
  dacConfig.dspEqualizer.bands = [...preset.bands];
  advancedAudio.eqPresetId = preset.id;
  dacConfig.advancedAudio = { ...advancedAudio };
  applyLiveAudioFilters();

  broadcastWebSocket({
    event: 'dac_update',
    timestamp: Date.now(),
    data: { dspEqualizer: dacConfig.dspEqualizer, advancedAudio: dacConfig.advancedAudio },
  });

  res.json({
    success: true,
    message: `EQ Preset '${preset.name}' direct toegepast op I2S DAC hardware`,
    dspEqualizer: dacConfig.dspEqualizer,
  });
});

// 5. Get Advanced Audio Settings
router.get('/api/audio/advanced', (req, res) => {
  res.json({
    advancedAudio,
    currentPlaylistProfile: playbackState.currentPlaylistId
      ? getDbImportedPlaylists().find((p) => p.id === playbackState.currentPlaylistId)?.audioProfile || null
      : null,
  });
});

// 6. Update Advanced Audio Settings (Crossfade, Gapless, Global vs Playlist)
router.post('/api/audio/advanced', (req, res) => {
  const updates = req.body;
  setAdvancedAudio({ ...advancedAudio, ...updates });
  dacConfig.advancedAudio = { ...advancedAudio };

  // Apply EQ preset change if requested
  if (updates.eqPresetId) {
    const matched = eqPresets.find((p) => p.id === updates.eqPresetId);
    if (matched) {
      dacConfig.dspEqualizer.bands = [...matched.bands];
      dacConfig.dspEqualizer.activePresetId = matched.id;
    }
  }

  // Check if applied to current playlist
  if (updates.profileScope === 'playlist_specific' && updates.associatedPlaylistId) {
    const pl = getDbImportedPlaylists().find((p) => p.id === updates.associatedPlaylistId);
    if (pl) {
      (pl as any).audioProfile = { ...advancedAudio, associatedPlaylistId: pl.id };
      saveDbImportedPlaylist(pl);
      playbackState.activeProfileName = `${pl.name} (Playlist Profiel)`;
    }
  } else if (updates.profileScope === 'global') {
    playbackState.activeProfileName = 'Globaal Audio Profiel';
  }

  playbackState.dacConfig = { ...dacConfig };
  applyLiveAudioFilters();

  broadcastWebSocket({
    event: 'audio_settings_update',
    timestamp: Date.now(),
    data: {
      advancedAudio,
      dacConfig,
      activeProfileName: playbackState.activeProfileName,
    },
  });

  res.json({
    success: true,
    advancedAudio,
    dacConfig,
    activeProfileName: playbackState.activeProfileName,
  });
});

// 7. Save / Clear Audio Profile per Playlist
router.post('/api/playlists/:id/audio-profile', (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: 'Afspeellijst niet gevonden' });
    return;
  }

  const { audioProfile, clear } = req.body;
  if (clear) {
    delete (playlist as any).audioProfile;
    saveDbImportedPlaylist(playlist);
    res.json({ success: true, message: 'Afspeellijst gebruikt nu globale instellingen', playlist });
    return;
  }

  if (audioProfile) {
    (playlist as any).audioProfile = {
      ...DEFAULT_ADVANCED_AUDIO_SETTINGS,
      ...audioProfile,
      profileScope: 'playlist_specific',
      associatedPlaylistId: playlist.id,
    };
    saveDbImportedPlaylist(playlist);

    // If currently playing this playlist, immediately switch DAC
    if (playbackState.currentPlaylistId === playlist.id) {
      setAdvancedAudio({ ...(playlist as any).audioProfile });
      dacConfig.advancedAudio = { ...advancedAudio };
      const matchedEq = eqPresets.find((p) => p.id === (playlist as any).audioProfile?.eqPresetId);
      if (matchedEq) {
        dacConfig.dspEqualizer.bands = [...matchedEq.bands];
        dacConfig.dspEqualizer.activePresetId = matchedEq.id;
      }
      playbackState.activeProfileName = `${playlist.name} (Playlist Profiel)`;
      applyLiveAudioFilters();
    }

    broadcastWebSocket({
      event: 'audio_settings_update',
      timestamp: Date.now(),
      data: { playlistId: playlist.id, audioProfile: (playlist as any).audioProfile },
    });

    res.json({ success: true, playlist, audioProfile: (playlist as any).audioProfile });
  } else {
    res.status(400).json({ error: 'Geen geldig audio profiel opgegeven' });
  }
});

// 3. Volume & DAC Attenuation Control
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

// 4. Audio Devices & DAC Configuration
router.get('/api/audio/devices', (req, res) => {
  res.json({
    devices: audioDevices,
    activeDeviceId: dacConfig.activeDeviceId,
    dacConfig,
  });
});

router.post('/api/audio/output', requireAudioPermission('dac:configure'), (req, res) => {
  const { deviceId } = req.body;
  const selected = audioDevices.find((d) => d.id === deviceId);
  if (!selected) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  setAudioDevices(
    audioDevices.map((d) => ({
      ...d,
      isCurrent: d.id === deviceId,
    })),
  );
  dacConfig.activeDeviceId = deviceId;
  dacConfig.dtoverlay = selected.dtoverlay;
  broadcastWebSocket({
    event: 'dac_update',
    timestamp: Date.now(),
    data: { activeDeviceId: deviceId, device: selected, dacConfig },
  });
  res.json({ success: true, activeDevice: selected, dacConfig });
});

router.post('/api/audio/dac-config', requireAudioPermission('dac:configure'), (req, res) => {
  const newConfig = req.body;
  setDacConfig({ ...dacConfig, ...newConfig });
  playbackState.dacConfig = dacConfig;
  broadcastWebSocket({
    event: 'dac_update',
    timestamp: Date.now(),
    data: { dacConfig },
  });
  res.json({ success: true, dacConfig });
});

router.post('/api/audio/equalizer', requireAudioPermission('audio:control'), (req, res) => {
  const { enabled, bands, activePresetId } = req.body;
  if (typeof enabled === 'boolean') {
    dacConfig.dspEqualizer.enabled = enabled;
  }
  if (Array.isArray(bands)) {
    dacConfig.dspEqualizer.bands = bands;
  }
  if (activePresetId) {
    dacConfig.dspEqualizer.activePresetId = activePresetId;
  }
  applyLiveAudioFilters();
  broadcastWebSocket({
    event: 'dac_update',
    timestamp: Date.now(),
    data: { dspEqualizer: dacConfig.dspEqualizer },
  });
  res.json({ success: true, dspEqualizer: dacConfig.dspEqualizer });
});

export default router;
