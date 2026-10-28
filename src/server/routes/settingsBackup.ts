// Portable settings backup/restore — a JSON export of everything a user
// configured (cast design, GPIO wiring, radio stations, network shares,
// favorites, playlists, non-secret hub config), as opposed to
// /api/system/backup's raw hss.db file dump (which drags along caches like
// the NAS library index and, unlike this, has no restore path at all).
//
// Deliberately excludes every credential (Spotify tokens/client secret,
// Catalogic/AcoustID/AudD/Listener API keys, network share passwords,
// the kiosk API key) — see the HubConfig allowlist below and the explicit
// `password` strip on network shares. A restore leaves those untouched;
// re-entering them is a one-time manual step after restoring onto a new Pi.
import express from 'express';
import {
  addDbKnownHub,
  addDbWebRadioStation,
  getDbImportedPlaylists,
  getDbKnownHubs,
  getDbNetworkShares,
  getDbWebRadioStations,
  getLikedTracks,
  saveDbImportedPlaylist,
  saveDbNetworkShare,
  saveLikedTrack,
  updateDbWebRadioStation,
} from '../../../db.ts';
import { isSafeAlsaDevice } from '../../services/audioRecognition.ts';
import { GpioDeviceConfig, getReservedGpioPins, validateGpioConfigInput } from '../../services/gpioService.ts';
import {
  audioDevices,
  castDesignPresets,
  castSettingsState,
  dacConfig,
  disableGpioWatcher,
  enableGpioWatcher,
  gpioConfig,
  hubConfig,
  requireAudioPermission,
  saveDiskConfig,
  setCastDesignPresets,
  setCastSettingsState,
  setGpioConfig,
} from '../state.ts';
import { assertSafeExternalUrl } from './config.ts';

const router = express.Router();

const BACKUP_VERSION = 1;

function activeDacType(): string | undefined {
  return audioDevices.find((d) => d.id === dacConfig.activeDeviceId)?.type;
}

// Exported (not just inlined in the route) so a test can assert directly on
// its output — the one property that matters most here is negative (no
// secret field ever appears), which is easy to assert on a plain object and
// easy to silently break by copy-pasting one field too many from hubConfig.
export function buildSettingsBackup() {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    hubConfig: {
      spotifyClientId: hubConfig.spotifyClientId,
      spotifyDeviceName: hubConfig.spotifyDeviceName,
      spotifyBitrate: hubConfig.spotifyBitrate,
      spotifyNormalisation: hubConfig.spotifyNormalisation,
      soloistEnabled: hubConfig.soloistEnabled,
      autostartService: hubConfig.autostartService,
      broadcastSpectrum: hubConfig.broadcastSpectrum,
      enableAlsaDirectHw: hubConfig.enableAlsaDirectHw,
      maxVolumeLimit: hubConfig.maxVolumeLimit,
      catalogicEnabled: hubConfig.catalogicEnabled,
      catalogicUrl: hubConfig.catalogicUrl,
      catalogicScanLookupEnabled: hubConfig.catalogicScanLookupEnabled,
      recognitionMicDevice: hubConfig.recognitionMicDevice,
      recognitionSilenceThreshold: hubConfig.recognitionSilenceThreshold,
      recognitionLongSilenceSec: hubConfig.recognitionLongSilenceSec,
      publicUrl: hubConfig.publicUrl,
      listenerPushLikes: hubConfig.listenerPushLikes,
      listenerUrl: hubConfig.listenerUrl,
      radioLogEnabled: hubConfig.radioLogEnabled,
      listenerPushRadioLog: hubConfig.listenerPushRadioLog,
    },
    castSettings: castSettingsState,
    castDesignPresets,
    gpioConfig,
    radioStations: getDbWebRadioStations(),
    knownHubs: getDbKnownHubs(),
    // password deliberately dropped — see the file-level comment.
    networkShares: getDbNetworkShares().map(({ password, ...rest }) => rest),
    likedTracks: getLikedTracks(),
    playlists: getDbImportedPlaylists(),
  };
}

router.get('/api/system/settings-backup', requireAudioPermission('admin:all'), (req, res) => {
  const backup = buildSettingsBackup();
  const filename = `hss-instellingen-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(backup);
});

router.post('/api/system/settings-restore', requireAudioPermission('admin:all'), async (req, res) => {
  const backup = req.body;
  if (!backup || typeof backup !== 'object' || backup.version !== BACKUP_VERSION) {
    res.status(400).json({ error: 'Onbekend of ongeldig back-upbestand' });
    return;
  }

  const summary: Record<string, number> = {};

  // Hub config — same field-level validation as POST /api/config for the
  // two inputs that reach a shell command or an outbound fetch; every other
  // field here is a plain typed value with nothing further to check.
  if (backup.hubConfig && typeof backup.hubConfig === 'object') {
    const cfg = backup.hubConfig;
    if (typeof cfg.spotifyClientId === 'string' && cfg.spotifyClientId.trim()) hubConfig.spotifyClientId = cfg.spotifyClientId.trim();
    if (typeof cfg.spotifyDeviceName === 'string' && cfg.spotifyDeviceName) hubConfig.spotifyDeviceName = cfg.spotifyDeviceName;
    if (typeof cfg.spotifyBitrate === 'string' && cfg.spotifyBitrate) hubConfig.spotifyBitrate = cfg.spotifyBitrate;
    if (typeof cfg.spotifyNormalisation === 'boolean') hubConfig.spotifyNormalisation = cfg.spotifyNormalisation;
    if (typeof cfg.soloistEnabled === 'boolean') hubConfig.soloistEnabled = cfg.soloistEnabled;
    if (typeof cfg.autostartService === 'boolean') hubConfig.autostartService = cfg.autostartService;
    if (typeof cfg.broadcastSpectrum === 'boolean') hubConfig.broadcastSpectrum = cfg.broadcastSpectrum;
    if (typeof cfg.enableAlsaDirectHw === 'boolean') hubConfig.enableAlsaDirectHw = cfg.enableAlsaDirectHw;
    if (typeof cfg.maxVolumeLimit === 'number') hubConfig.maxVolumeLimit = Math.max(0, Math.min(100, Math.round(cfg.maxVolumeLimit)));
    if (typeof cfg.catalogicEnabled === 'boolean') hubConfig.catalogicEnabled = cfg.catalogicEnabled;
    if (typeof cfg.catalogicScanLookupEnabled === 'boolean') hubConfig.catalogicScanLookupEnabled = cfg.catalogicScanLookupEnabled;
    if (typeof cfg.recognitionSilenceThreshold === 'number') hubConfig.recognitionSilenceThreshold = Math.max(10, Math.min(10000, Math.round(cfg.recognitionSilenceThreshold)));
    if (typeof cfg.recognitionLongSilenceSec === 'number') hubConfig.recognitionLongSilenceSec = Math.max(5, Math.min(3600, Math.round(cfg.recognitionLongSilenceSec)));
    if (typeof cfg.listenerPushLikes === 'boolean') hubConfig.listenerPushLikes = cfg.listenerPushLikes;
    if (typeof cfg.radioLogEnabled === 'boolean') hubConfig.radioLogEnabled = cfg.radioLogEnabled;
    if (typeof cfg.listenerPushRadioLog === 'boolean') hubConfig.listenerPushRadioLog = cfg.listenerPushRadioLog;

    if (typeof cfg.recognitionMicDevice === 'string' && (cfg.recognitionMicDevice === '' || isSafeAlsaDevice(cfg.recognitionMicDevice))) {
      hubConfig.recognitionMicDevice = cfg.recognitionMicDevice;
    }
    if (typeof cfg.catalogicUrl === 'string' && cfg.catalogicUrl.trim() && cfg.catalogicUrl.trim() !== hubConfig.catalogicUrl) {
      try {
        await assertSafeExternalUrl(cfg.catalogicUrl.trim());
        hubConfig.catalogicUrl = cfg.catalogicUrl.trim();
      } catch {}
    }
    if (typeof cfg.publicUrl === 'string') hubConfig.publicUrl = cfg.publicUrl.trim();
    if (typeof cfg.listenerUrl === 'string') {
      const trimmed = cfg.listenerUrl.trim();
      if (trimmed === '' || trimmed === hubConfig.listenerUrl) {
        hubConfig.listenerUrl = trimmed;
      } else {
        try {
          await assertSafeExternalUrl(trimmed);
          hubConfig.listenerUrl = trimmed;
        } catch {}
      }
    }
    saveDiskConfig();
    summary.hubConfig = 1;
  }

  if (backup.castSettings && typeof backup.castSettings === 'object') {
    setCastSettingsState({ ...castSettingsState, ...backup.castSettings });
    summary.castSettings = 1;
  }

  if (Array.isArray(backup.castDesignPresets)) {
    setCastDesignPresets(backup.castDesignPresets);
    summary.castDesignPresets = backup.castDesignPresets.length;
  }

  if (backup.gpioConfig && typeof backup.gpioConfig === 'object') {
    const g = backup.gpioConfig;
    const reserved = getReservedGpioPins(activeDacType());
    const validation = validateGpioConfigInput(
      { pinA: g.pinA, pinB: g.pinB, pinButton: g.pinButton, actionRotateCw: g.actionRotateCw, actionRotateCcw: g.actionRotateCcw, actionButtonPress: g.actionButtonPress },
      reserved,
    );
    if (validation.valid !== false) {
      const wasEnabled = gpioConfig?.enabled;
      const next: GpioDeviceConfig = {
        id: gpioConfig?.id || 'gpio-' + Date.now(),
        deviceType: 'rotary_encoder_button',
        pinA: g.pinA,
        pinB: g.pinB,
        pinButton: g.pinButton,
        actionRotateCw: g.actionRotateCw,
        actionRotateCcw: g.actionRotateCcw,
        actionButtonPress: g.actionButtonPress,
        enabled: !!g.enabled,
      };
      setGpioConfig(next);
      if (wasEnabled || next.enabled) {
        disableGpioWatcher(() => { if (next.enabled) enableGpioWatcher(); });
      }
      summary.gpioConfig = 1;
    }
  }

  if (Array.isArray(backup.radioStations)) {
    for (const station of backup.radioStations) {
      if (!station?.id || !station.name || !station.url) continue;
      const updated = updateDbWebRadioStation(station.id, station);
      if (!updated) addDbWebRadioStation(station);
    }
    summary.radioStations = backup.radioStations.length;
  }

  if (Array.isArray(backup.knownHubs)) {
    // Not upserted by id (addDbKnownHub always mints a fresh one) — restoring
    // the same backup twice duplicates entries here. Low-stakes list (other
    // HSS hubs on the LAN), so left as-is rather than reworked for this.
    for (const hub of backup.knownHubs) {
      if (hub?.name && hub?.url) addDbKnownHub(hub);
    }
    summary.knownHubs = backup.knownHubs.length;
  }

  if (Array.isArray(backup.networkShares)) {
    for (const share of backup.networkShares) {
      if (share?.id && share.name && share.host && share.sharePath) saveDbNetworkShare(share);
    }
    summary.networkShares = backup.networkShares.length;
  }

  if (Array.isArray(backup.likedTracks)) {
    for (const track of backup.likedTracks) {
      if (track?.likeKey) saveLikedTrack(track);
    }
    summary.likedTracks = backup.likedTracks.length;
  }

  if (Array.isArray(backup.playlists)) {
    for (const playlist of backup.playlists) {
      if (playlist?.id) saveDbImportedPlaylist(playlist);
    }
    summary.playlists = backup.playlists.length;
  }

  res.json({ success: true, summary });
});

export default router;
