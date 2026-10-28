import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Key,
  Layers,
  ListMusic,
  Menu,
  Mic,
  Radio,
  Sliders,
  Volume2,
  Wifi,
} from 'lucide-react';
import { AdvancedAudioSettingsView } from './components/AdvancedAudioSettingsView';
import { ApiDocsModal } from './components/ApiDocsModal';
import { AuthAndApiKeysView } from './components/AuthAndApiKeysView';
import { LoginScreen } from './components/LoginScreen';
import { NestHubCastManager } from './components/NestHubCastManager';
import { NestHubCastView } from './components/NestHubCastView';
import { FavoritesView } from './components/FavoritesView';
import { NowPlaying } from './components/NowPlaying';
import { OnboardingWizardModal } from './components/OnboardingWizardModal';
import { PiScriptCenter } from './components/PiScriptCenter';
import { PlaylistManager } from './components/PlaylistManager';
import { Sidebar, TABS } from './components/Sidebar';
import { ThemeCustomizerModal } from './components/ThemeCustomizerModal';
import { HubSwitcherModal } from './components/HubSwitcherModal';
import { Button, ToastContainer, ToastItem } from './components/ui';
import { VolumeDacControl } from './components/VolumeDacControl';
import { WebSocketStreamView } from './components/WebSocketStreamView';
import {
  AVAILABLE_AUDIO_DEVICES,
  DEFAULT_ADVANCED_AUDIO_SETTINGS,
  INITIAL_PLAYLISTS,
  INITIAL_TRACKS,
} from './services/mockPiData';
import { applyTheme, getStoredThemeId } from './services/themeManager';
import {
  AdvancedAudioSettings,
  ApiKeyItem,
  AudioDevice,
  AuthUser,
  CastLayout,
  DacConfig,
  EqBand,
  EqPreset,
  ExternalSourceState,
  LikedTrack,
  HubConfig,
  PlaybackState,
  Playlist,
  ThemeId,
  Track,
  WebSocketEventPayload,
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('player');
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  // Centralized confirmation toasts — triggered off the WebSocket feed
  // itself (track_change/queue_update) rather than from each individual
  // play/queue button, so every current and future play/queue action gets
  // feedback for free instead of needing its own toast call.
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = (message: string) => {
    setToasts((prev) => [...prev, { id: 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), message }]);
  };
  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };
  const [recentEvents, setRecentEvents] = useState<WebSocketEventPayload[]>([]);
  const [isDocsModalOpen, setIsDocsModalOpen] = useState<boolean>(false);
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isKioskCastOpen, setIsKioskCastOpen] = useState<boolean>(false);
  // True when this page load IS the real Cast receiver (opened via ?kiosk=1 on the
  // Nest Hub itself), as opposed to an in-app "Test in browser" preview. A real
  // receiver has no address bar and no way back once it shows the full admin app,
  // so it must never offer an exit button into that view.
  const [isRealCastReceiver, setIsRealCastReceiver] = useState<boolean>(false);
  const [kioskLayout, setKioskLayout] = useState<CastLayout | undefined>(undefined);
  const [kioskThemeId, setKioskThemeId] = useState<ThemeId | undefined>(undefined);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState<boolean>(false);
  const [isHubSwitcherOpen, setIsHubSwitcherOpen] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);
  const [themeId, setThemeId] = useState<ThemeId>(getStoredThemeId());

  // Authentication state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('hss_auth_token'));
  // Distinguishes "still checking whether the stored token is valid" from
  // "confirmed there's no valid session" — without this the login screen
  // would flash for a moment even when the user is actually logged in.
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  // Core App State
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: true,
    currentTrack: INITIAL_TRACKS[0],
    positionMs: 42000,
    durationMs: INITIAL_TRACKS[0].durationMs,
    volume: 78,
    isMuted: false,
    shuffle: false,
    repeat: 'off',
    queue: [INITIAL_TRACKS[1], INITIAL_TRACKS[2], INITIAL_TRACKS[3]],
    currentPlaylistId: 'pl-audiophile',
    activeProfileName: 'Warm Vinyl HiFi',
    spotifyConnected: false,
    dacConfig: {
      activeDeviceId: 'hifiberry-dacplus',
      dtoverlay: 'dtoverlay=hifiberry-dacplus',
      bitPerfect: true,
      clockSyncMode: 'ultra_low_jitter',
      resamplingQuality: 'disabled',
      targetSampleRate: 44100,
      bufferTimeMs: 150,
      periodTimeMs: 35,
      volumeDb: -6.0,
      balance: 0,
      hardwareMixerControl: 'Digital',
      dspEqualizer: {
        enabled: true,
        activePresetId: 'audiophile_flat',
        bands: [
          { freq: 31, gain: 2 },
          { freq: 62, gain: 2 },
          { freq: 125, gain: 1 },
          { freq: 250, gain: 0 },
          { freq: 500, gain: -1 },
          { freq: 1000, gain: 0 },
          { freq: 2000, gain: 1 },
          { freq: 4000, gain: 2 },
          { freq: 8000, gain: 3 },
          { freq: 16000, gain: 2 },
        ],
      },
      advancedAudio: { ...DEFAULT_ADVANCED_AUDIO_SETTINGS },
    },
    systemStats: {
      piModel: 'Raspberry Pi 4 Model B (4GB) & 3B+ Compatible',
      osVersion: 'Raspberry Pi OS 64-bit (Linux 6.6-v8+ ALSA 1.2.9)',
      cpuTempC: 44.8,
      cpuUsagePct: 12.4,
      ramUsagePct: 24.1,
      ramUsedMb: 968,
      ramTotalMb: 3906,
      uptimeSeconds: 148200,
      alsaUnderruns: 0,
      dacClockLocked: true,
      streamBitrate: 320,
      streamSampleRate: 44100,
      streamBitDepth: 24,
      connectedClients: 0,
      soloistDaemonStatus: 'active',
      crossfadeActive: false,
      crossfadeProgressPct: 0,
    },
    spectrum: [45, 60, 85, 90, 75, 65, 80, 95, 70, 60, 55, 45, 35, 30, 25, 20],
  });

  const [externalSource, setExternalSource] = useState<ExternalSourceState | null>(null);
  const [likes, setLikes] = useState<LikedTrack[]>([]);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [hasHealthIssues, setHasHealthIssues] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>(INITIAL_PLAYLISTS);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>(AVAILABLE_AUDIO_DEVICES);
  const [hubConfig, setHubConfig] = useState<HubConfig>({
    spotifyClientId: '',
    spotifyClientSecret: '',
    spotifyDeviceName: 'Pi-HSS-HiFi',
    spotifyBitrate: '320',
    spotifyNormalisation: true,
    soloistEnabled: true,
    autostartService: true,
    apiKey: 'pi_hss_a8f9c1e3',
    broadcastSpectrum: true,
    enableAlsaDirectHw: true,
    maxVolumeLimit: 100,
    catalogicEnabled: false,
    catalogicUrl: '',
    publicUrl: '',
  });

  const wsRef = useRef<WebSocket | null>(null);

  // Detect Google Nest Hub / Chromecast User-Agent or ?kiosk=1 URL parameter
  useEffect(() => {
    const ua = window.navigator.userAgent || '';
    const isNestHubOrCast =
      ua.includes('CrKey') ||
      ua.includes('Fuchsia') ||
      ua.includes('DashCast') ||
      ua.includes('Google-Nest-Hub') ||
      ua.includes('SmartTV') ||
      window.location.search.includes('kiosk');

    if (isNestHubOrCast) {
      setIsKioskCastOpen(true);
      const params = new URLSearchParams(window.location.search);
      // The Cast Designer's live preview embeds this same ?kiosk=1 page in an
      // iframe with &preview=1 tacked on — without this check it was also
      // flagged a "real" receiver, which injects `cursor: none` (below) and
      // makes the preview's click-to-select unusable (no visible cursor to
      // see where the clickable overlay even is).
      setIsRealCastReceiver(params.get('preview') !== '1');
      const layout = params.get('layout') as CastLayout;
      if (layout) setKioskLayout(layout);
      const theme = params.get('theme') as ThemeId;
      if (theme) setKioskThemeId(theme);

      // The kiosk has no login flow (no keyboard, nobody's there to type
      // credentials) — buildKioskUrl() on the server rides a scoped
      // credential along in the URL *fragment* instead (never sent to the
      // server over HTTP, unlike a query param). Only adopt it when there's
      // no session here yet: blindly overwriting localStorage from any URL
      // parameter would let a crafted link (?kiosk=1#token=<attacker's own
      // key>) silently swap out an already-authenticated admin's session —
      // this only ever bootstraps a genuinely fresh device.
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = hashParams.get('token');
      if (token && !localStorage.getItem('hss_auth_token')) {
        localStorage.setItem('hss_auth_token', token);
      }
      // Scrub it from the visible/bookmarkable URL either way, so it doesn't
      // linger in browser history longer than the one load that needed it.
      if (token) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }, []);

  // Initialize Auth status — the fetch wrapper (services/apiClient.ts) attaches
  // the stored token automatically, so this just asks "who am I" with it.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setCurrentUser(data.user);
          }
        } else {
          setCurrentUser(null);
        }
      } catch (e) {
        console.warn('Could not verify current user session');
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, [authToken]);

  // Initialize data from REST API (SQLite Server DB) — also re-run on every
  // WebSocket reconnect (see below), not just on mount. A server restart
  // mid-session (deploy, crash) never sends "state changed" broadcasts for
  // anything that didn't itself change, so without this the dashboard would
  // keep showing whatever was true before the restart until a manual refresh.
  const fetchInitialData = useCallback(async () => {
    try {
      const [statusRes, plRes, devRes, cfgRes, prefRes, recRes, healthRes, likesRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()),
        fetch('/api/playlists').then((r) => r.json()),
        fetch('/api/audio/devices').then((r) => r.json()),
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/user/preferences').then((r) => r.json()),
        fetch('/api/recognize/status').then((r) => r.json()),
        fetch('/api/system/health').then((r) => r.json()),
        fetch('/api/likes').then((r) => r.json()),
      ]);

      if (statusRes.playback) {
        setPlayback(statusRes.playback);
      }
      if (statusRes.updateAvailable) {
        setUpdateAvailable(true);
      }
      if (Array.isArray(healthRes.issues) && healthRes.issues.length > 0) {
        setHasHealthIssues(true);
      }
      setExternalSource(recRes.externalSource || null);
      if (Array.isArray(likesRes.likes)) {
        setLikes(likesRes.likes);
      }
      if (plRes.playlists) {
        setPlaylists(plRes.playlists);
      }
      if (devRes.devices) {
        setAudioDevices(devRes.devices);
      }
      if (cfgRes.config) {
        setHubConfig(cfgRes.config);
      }
      if (prefRes.preferences) {
        if (prefRes.preferences.activeTab) setActiveTab(prefRes.preferences.activeTab);
        if (prefRes.preferences.activeTheme) {
          setThemeId(prefRes.preferences.activeTheme);
          applyTheme(prefRes.preferences.activeTheme);
        }
      }
    } catch (err) {
      console.warn('Could not fetch from REST server directly (fallback to state):', err);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // WebSocket Connection Management
  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: any;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = localStorage.getItem('hss_auth_token');
      const wsUri = `${protocol}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      socket = new WebSocket(wsUri);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        console.log('[App WS] Connected to Raspberry Pi HSS WebSocket');
        fetchInitialData();
      };

      socket.onmessage = (event) => {
        try {
          const payload: WebSocketEventPayload = JSON.parse(event.data);
          // Add to recent events buffer
          setRecentEvents((prev) => [payload, ...prev.slice(0, 49)]);

          // Handle state updates
          if (payload.event === 'progress_tick') {
            setPlayback((prev) => ({
              ...prev,
              positionMs: payload.data.positionMs,
              durationMs: payload.data.durationMs,
              isPlaying: payload.data.isPlaying,
              spectrum: payload.data.spectrum || prev.spectrum,
              systemStats: payload.data.systemStats || prev.systemStats,
              activeProfileName: payload.data.activeProfileName || prev.activeProfileName,
            }));
          } else if (payload.event === 'spectrum') {
            setPlayback((prev) => ({
              ...prev,
              spectrum: payload.data.spectrum || prev.spectrum,
            }));
          } else if (payload.event === 'playback_state') {
            setPlayback((prev) => ({
              ...prev,
              ...payload.data,
            }));
          } else if (payload.event === 'track_change') {
            setPlayback((prev) => ({
              ...prev,
              currentTrack: payload.data.track !== undefined ? payload.data.track : prev.currentTrack,
              queue: payload.data.queue !== undefined ? payload.data.queue : prev.queue,
              positionMs: 0,
              durationMs: payload.data.track?.durationMs || prev.durationMs,
              isPlaying: payload.data.track === null ? false : true,
              spotifyConnected: payload.data.spotifyConnected !== undefined ? payload.data.spotifyConnected : prev.spotifyConnected,
            }));
            if (payload.data.track) {
              pushToast(`Nu speelt: ${payload.data.track.title}${payload.data.track.artist ? ' — ' + payload.data.track.artist : ''}`);
            }
          } else if (payload.event === 'volume_change') {
            setPlayback((prev) => ({
              ...prev,
              volume: payload.data.volume !== undefined ? payload.data.volume : prev.volume,
              isMuted: payload.data.isMuted !== undefined ? payload.data.isMuted : prev.isMuted,
              dacConfig: {
                ...prev.dacConfig,
                volumeDb: payload.data.volumeDb !== undefined ? payload.data.volumeDb : prev.dacConfig.volumeDb,
                balance: payload.data.balance !== undefined ? payload.data.balance : prev.dacConfig.balance,
              },
            }));
          } else if (payload.event === 'dac_update') {
            setPlayback((prev) => ({
              ...prev,
              dacConfig: payload.data.dacConfig ? { ...prev.dacConfig, ...payload.data.dacConfig } : prev.dacConfig,
            }));
            if (payload.data.activeDeviceId) {
              setAudioDevices((prev) =>
                prev.map((d) => ({ ...d, isCurrent: d.id === payload.data.activeDeviceId }))
              );
            }
          } else if (payload.event === 'queue_update') {
            setPlayback((prev) => ({
              ...prev,
              queue: payload.data.queue,
            }));
            if (payload.data.action === 'add' && payload.data.track) {
              pushToast(`Toegevoegd aan wachtrij: ${payload.data.track.title}`);
            } else if (payload.data.action === 'add-many' && payload.data.count) {
              pushToast(payload.data.label ? `Toegevoegd aan wachtrij: ${payload.data.label} (${payload.data.count})` : `${payload.data.count} nummers toegevoegd aan wachtrij`);
            }
          } else if (payload.event === 'playlist_created') {
            if (payload.data.playlist?.name) {
              pushToast(`Playlist aangemaakt: ${payload.data.playlist.name}`);
            }
          } else if (payload.event === 'audio_settings_update') {
            // Gapless/crossfade/dither all live on dacConfig.advancedAudio (the
            // real AdvancedAudioSettings shape the backend broadcasts) — this
            // used to also shove copies into systemStats under field names
            // SystemStats never had, which nothing ever actually read back.
            setPlayback((prev) => ({
              ...prev,
              dacConfig: payload.data.dacConfig || prev.dacConfig,
              activeProfileName: payload.data.activeProfileName || prev.activeProfileName,
            }));
          } else if (payload.event === 'crossfade_event') {
            setPlayback((prev) => ({
              ...prev,
              systemStats: {
                ...prev.systemStats,
                crossfadeActive: payload.data.active,
                crossfadeProgressPct: payload.data.progressPct,
              },
            }));
          } else if (payload.event === 'external_source_update') {
            setExternalSource(payload.data);
          } else if (payload.event === 'likes_updated') {
            setLikes(payload.data.likes || []);
          } else if (payload.event === 'update_available') {
            setUpdateAvailable(true);
          } else if (payload.event === 'health_issue') {
            setHasHealthIssues(true);
          }
        } catch (e) {
          console.error('Error handling WebSocket message:', e);
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      socket.onerror = () => {
        setWsConnected(false);
      };
    };

    connectWs();

    return () => {
      clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, []);

  // Control Actions
  const handleToggle = async () => {
    try {
      const res = await fetch('/api/playback/toggle', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast(data.error || 'Afspelen/pauzeren mislukt');
      }
    } catch (e) {
      setPlayback((p) => ({ ...p, isPlaying: !p.isPlaying }));
    }
  };

  const handleNext = async () => {
    try {
      await fetch('/api/playback/next', { method: 'POST' });
    } catch (e) {
      console.warn('Next failed');
    }
  };

  const handlePrevious = async () => {
    try {
      await fetch('/api/playback/previous', { method: 'POST' });
    } catch (e) {
      console.warn('Previous failed');
    }
  };

  const handleSeek = async (positionMs: number) => {
    setPlayback((p) => ({ ...p, positionMs }));
    try {
      await fetch('/api/playback/seek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionMs }),
      });
    } catch (e) {
      console.warn('Seek failed');
    }
  };

  const handleVolumeChange = async (volume: number) => {
    setPlayback((p) => ({
      ...p,
      volume,
      isMuted: false,
      dacConfig: { ...p.dacConfig, volumeDb: Number((-60 * (1 - volume / 100)).toFixed(1)) },
    }));
    try {
      await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume, isMuted: false }),
      });
    } catch (e) {
      console.warn('Volume set failed');
    }
  };

  const handleToggleMute = async () => {
    const newMute = !playback.isMuted;
    setPlayback((p) => ({ ...p, isMuted: newMute }));
    try {
      await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isMuted: newMute }),
      });
    } catch (e) {
      console.warn('Mute toggle failed');
    }
  };

  const handleBalanceChange = async (balance: number) => {
    setPlayback((p) => ({
      ...p,
      dacConfig: { ...p.dacConfig, balance },
    }));
    try {
      await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance }),
      });
    } catch (e) {
      console.warn('Balance set failed');
    }
  };

  const handleUpdateMaxVolumeLimit = async (maxVolumeLimit: number) => {
    setHubConfig((c) => ({ ...c, maxVolumeLimit }));
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxVolumeLimit }),
      });
      // If the server re-clamped the current volume down, it broadcasts
      // volume_change over WS — already handled by the existing listener.
    } catch (e) {
      console.warn('Max volume limit set failed');
    }
  };

  const handleToggleShuffle = async () => {
    const newShuffle = !playback.shuffle;
    setPlayback((p) => ({ ...p, shuffle: newShuffle }));
    try {
      await fetch('/api/playback/shuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shuffle: newShuffle }),
      });
    } catch (e) {
      console.warn('Shuffle toggle failed');
    }
  };

  const handleToggleRepeat = async () => {
    const nextRepeat: 'off' | 'track' | 'context' =
      playback.repeat === 'off' ? 'context' : playback.repeat === 'context' ? 'track' : 'off';
    setPlayback((p) => ({ ...p, repeat: nextRepeat }));
    try {
      await fetch('/api/playback/repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repeat: nextRepeat }),
      });
    } catch (e) {
      console.warn('Repeat toggle failed');
    }
  };

  const handleSwitchAudioDevice = async (deviceId: string) => {
    try {
      const res = await fetch('/api/audio/output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      }).then((r) => r.json());

      if (res.dacConfig) {
        setPlayback((p) => ({ ...p, dacConfig: res.dacConfig }));
      }
      setAudioDevices((prev) =>
        prev.map((d) => ({ ...d, isCurrent: d.id === deviceId }))
      );
    } catch (e) {
      console.warn('Audio device switch failed');
    }
  };

  const handleUpdateDacConfig = async (dacConfig: Partial<DacConfig>) => {
    try {
      const res = await fetch('/api/audio/dac-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dacConfig),
      }).then((r) => r.json());

      if (res.dacConfig) {
        setPlayback((prev) => ({ ...prev, dacConfig: res.dacConfig }));
      }
    } catch (e) {
      console.warn('DAC config failed');
    }
  };

  const handleApplyPreset = async (presetId: string) => {
    try {
      const res = await fetch(`/api/audio/eq-presets/${presetId}/apply`, { method: 'POST' }).then((r) => r.json());
      if (res.dspEqualizer) {
        setPlayback((prev) => ({
          ...prev,
          dacConfig: { ...prev.dacConfig, dspEqualizer: res.dspEqualizer },
        }));
      }
    } catch (e) {
      console.warn('Apply preset failed');
    }
  };

  // AdvancedAudioSettingsView re-fetches the preset list itself right after
  // this resolves, so there's nothing for App-level state to do here.
  const handleCreatePreset = async (preset: Omit<EqPreset, 'id' | 'isCustom'>) => {
    try {
      await fetch('/api/audio/eq-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      });
    } catch (e) {
      console.warn('Create preset failed');
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    try {
      await fetch(`/api/audio/eq-presets/${presetId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Delete preset failed');
    }
  };

  const handleUpdateEqualizerBands = async (bands: EqBand[], presetId?: string) => {
    setPlayback((prev) => ({
      ...prev,
      dacConfig: {
        ...prev.dacConfig,
        dspEqualizer: { ...prev.dacConfig.dspEqualizer, bands, ...(presetId ? { activePresetId: presetId } : {}) },
      },
    }));
    try {
      await fetch('/api/audio/equalizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bands, ...(presetId ? { activePresetId: presetId } : {}) }),
      });
    } catch (e) {
      console.warn('Update equalizer bands failed');
    }
  };

  const handleSaveAdvancedSettings = async (settings: Partial<AdvancedAudioSettings>) => {
    try {
      const res = await fetch('/api/audio/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).then((r) => r.json());
      if (res.dacConfig) {
        setPlayback((prev) => ({ ...prev, dacConfig: res.dacConfig, activeProfileName: res.activeProfileName ?? prev.activeProfileName }));
      }
    } catch (e) {
      console.warn('Save advanced settings failed');
    }
  };

  const handleSavePlaylistProfile = async (playlistId: string, profile: AdvancedAudioSettings) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/audio-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioProfile: profile }),
      }).then((r) => r.json());
      if (res.playlist) {
        setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? res.playlist : p)));
      }
    } catch (e) {
      console.warn('Save playlist profile failed');
    }
  };

  const handleClearPlaylistProfile = async (playlistId: string) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/audio-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      }).then((r) => r.json());
      if (res.playlist) {
        setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? res.playlist : p)));
      }
    } catch (e) {
      console.warn('Clear playlist profile failed');
    }
  };

  const handlePlayPlaylist = async (playlistId: string) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/play`, { method: 'POST' }).then((r) =>
        r.json()
      );
      if (res.playback) {
        setPlayback(res.playback);
      }
    } catch (e) {
      console.warn('Play playlist failed');
    }
  };

  const handleCreatePlaylist = async (name: string, description: string) => {
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      }).then((r) => r.json());
      if (res.playlists) {
        setPlaylists(res.playlists);
      }
    } catch (e) {
      console.warn('Create playlist failed');
    }
  };

  const handleAddTrackToPlaylist = async (playlistId: string, track: Track) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track }),
      }).then((r) => r.json());
      if (res.playlists) {
        setPlaylists(res.playlists);
      }
    } catch (e) {
      console.warn('Add track to playlist failed');
    }
  };

  const handleRemoveTrackFromPlaylist = async (playlistId: string, trackId: string) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, {
        method: 'DELETE',
      }).then((r) => r.json());
      if (res.playlists) {
        setPlaylists(res.playlists);
      }
    } catch (e) {
      console.warn('Remove track from playlist failed');
    }
  };

  const handleAddToQueue = async (track: Track) => {
    try {
      const res = await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track }),
      }).then((r) => r.json());
      if (res.queue) {
        setPlayback((p) => ({ ...p, queue: res.queue }));
      }
    } catch (e) {
      setPlayback((p) => ({ ...p, queue: [...p.queue, track] }));
    }
  };

  const handleSelectTrackFromQueue = async (track: Track) => {
    try {
      const res = await fetch('/api/queue/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: track.id }),
      }).then((r) => r.json());
      if (res.success) {
        setPlayback((p) => ({ ...p, currentTrack: track, positionMs: 0, durationMs: track.durationMs, isPlaying: true, queue: res.queue }));
      } else if (res.error) {
        alert(res.error);
      }
    } catch (e) {
      console.warn('Select track from queue failed');
    }
  };

  const handleClearQueue = async () => {
    try {
      await fetch('/api/queue/clear', { method: 'DELETE' });
    } catch (e) {
      setPlayback((p) => ({ ...p, queue: [] }));
    }
  };

  const handleSaveConfig = async (updated: Partial<HubConfig>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }).then((r) => r.json());
      if (res.config) {
        setHubConfig(res.config);
      }
    } catch (e) {
      console.warn('Config save failed');
    }
  };

  const handleRegenerateApiKey = async (): Promise<string> => {
    try {
      const res = await fetch('/api/config/regenerate-api-key', { method: 'POST' }).then((r) =>
        r.json()
      );
      if (res.apiKey) {
        setHubConfig((prev) => ({ ...prev, apiKey: res.apiKey }));
        return res.apiKey;
      }
    } catch (e) {
      console.warn('Regenerate API key failed');
    }
    return hubConfig.apiKey;
  };

  const applySession = (user: AuthUser, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    localStorage.setItem('hss_auth_token', token);
  };

  const handleLogin = async (email: string, password?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.token && data.user) {
        applySession(data.user, data.token);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Login failed');
      return false;
    }
  };

  const handleRegister = async (name: string, email: string, password?: string, role?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (res.ok && data.token && data.user) {
        applySession(data.user, data.token);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Registration failed');
      return false;
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('hss_auth_token');
  };

  const handleTestAudioSweep = async () => {
    await fetch('/api/system/test-audio', { method: 'POST' });
  };

  const handleSendWsCommand = (cmd: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    } else {
      alert('WebSocket is niet verbonden met de Raspberry Pi Hub');
    }
  };

  if (isKioskCastOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-black overflow-hidden select-none">
        {isRealCastReceiver && (
          // A plain inline `style={{cursor:'none'}}` only sets the
          // *inherited* value — several buttons inside NestHubCastView set
          // their own explicit `cursor: pointer`, which (being more
          // specific) wins over an inherited value from this wrapper.
          // Inline style objects can't carry `!important` at all, so a real
          // <style> tag is the only way to actually force it everywhere,
          // touch or no touch, on a display with no mouse in the first place.
          <style>{'* { cursor: none !important; }'}</style>
        )}
        <NestHubCastView
          initialLayout={kioskLayout}
          initialThemeId={kioskThemeId}
          onExitCast={isRealCastReceiver ? undefined : () => setIsKioskCastOpen(false)}
        />
      </div>
    );
  }

  // Gate the admin dashboard behind a real login. Only reached for the
  // in-browser admin UI — the kiosk branch above always returns first, so
  // the Nest Hub's passive display (no keyboard, no way to type credentials)
  // never hits this.
  if (!authChecked) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }} />;
  }
  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    fetch('/api/user/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeTab: tabId }),
    }).catch(() => {});
  };

  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label;

  return (
    <div
      className="flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200"
      style={{
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
        height: '100dvh',
        overflow: 'hidden',
        // Home-screen app (viewport-fit=cover in index.html) draws full-bleed
        // under the Dynamic Island / notch and the bottom home-indicator bar
        // unless these are reserved explicitly. Resolves to 0 in a normal
        // browser tab, so always safe to include.
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenThemeModal={() => setIsThemeModalOpen(true)}
          onOpenHubSwitcher={() => setIsHubSwitcherOpen(true)}
          onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
          onOpenApiDocs={() => setIsDocsModalOpen(true)}
          systemStats={playback.systemStats}
          deviceName={hubConfig.spotifyDeviceName}
          updateAvailable={updateAvailable}
          hasHealthIssues={hasHealthIssues}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Content Header */}
          <header
            className="px-4 py-3 md:px-8 md:py-4"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              flexShrink: 0,
            }}
          >
            <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
              {/* Hamburger — mobile only, opens the sidebar as a slide-over
                  drawer (see Sidebar.tsx). Hidden from md: up, where the
                  sidebar is always visible in-flow. */}
              <button
                onClick={() => setMobileNavOpen(true)}
                // display must be a Tailwind utility, not inline style — an
                // inline `display` would beat md:hidden's media query every
                // time regardless of viewport width, since inline styles
                // always win the cascade over class-based rules.
                className="flex md:hidden items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Menu size={16} />
              </button>
              <span className="truncate" style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{activeTabLabel}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {externalSource?.active && (
                // Only rendered while a turntable/CD listen session is
                // actually running (startExternalListenLoop, gated behind
                // explicitly picking that source in Bron kiezen) — the mic
                // never captures outside of that, this is a visible
                // confirmation of it, not a separate on/off switch.
                <div
                  title="De USB-microfoon neemt nu geluid op om te herkennen wat er op je platenspeler/CD-speler speelt."
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(245,158,11,0.1)',
                    border: '1px solid rgba(245,158,11,0.2)',
                    color: 'var(--status-warning)',
                    font: 'var(--text-mono-sm)',
                  }}
                >
                  <Mic size={12} />
                  <span className="hidden sm:inline">Microfoon actief</span>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: wsConnected ? 'rgba(52,211,153,0.1)' : 'rgba(251,113,133,0.1)',
                  border: `1px solid ${wsConnected ? 'rgba(52,211,153,0.2)' : 'rgba(251,113,133,0.2)'}`,
                  color: wsConnected ? 'var(--status-success)' : 'var(--status-danger)',
                  font: 'var(--text-mono-sm)',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: wsConnected ? 'var(--status-success)' : 'var(--status-danger)',
                  }}
                />
                <span className="hidden sm:inline">{wsConnected ? 'Live WebSocket verbonden' : 'Verbinden met hub...'}</span>
              </div>
            </div>
          </header>

          {/* Main Content Area with Dynamic Views */}
          <main className="w-full space-y-6 px-4 py-6 md:px-8 md:py-7 scrollbar-thin" style={{ maxWidth: 1080, paddingBottom: 60, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {activeTab === 'player' && (
          <NowPlaying
            playback={playback}
            externalSource={externalSource}
            likes={likes}
            onPlay={() => {}}
            onPause={() => {}}
            onToggle={handleToggle}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            onToggleShuffle={handleToggleShuffle}
            onToggleRepeat={handleToggleRepeat}
            onSelectTrackFromQueue={handleSelectTrackFromQueue}
            onOpenCast={() => setActiveTab('cast')}
            onBrowseSpotify={() => setActiveTab('playlists')}
          />
        )}

        {activeTab === 'favorites' && (
          <FavoritesView likes={likes} hubConfig={hubConfig} onSaveConfig={handleSaveConfig} />
        )}

        {activeTab === 'cast' && (
          <NestHubCastManager
            playback={playback}
            currentThemeId="obsidian"
            onOpenCastKioskDirect={(layout, themeId) => {
              setKioskLayout(layout);
              setKioskThemeId(themeId);
              setIsKioskCastOpen(true);
            }}
          />
        )}

        {activeTab === 'volume-dac' && (
          <VolumeDacControl
            playback={playback}
            audioDevices={audioDevices}
            maxVolumeLimit={hubConfig.maxVolumeLimit}
            onUpdateMaxVolumeLimit={handleUpdateMaxVolumeLimit}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            onBalanceChange={handleBalanceChange}
            onSwitchAudioDevice={handleSwitchAudioDevice}
            onUpdateDacConfig={handleUpdateDacConfig}
            onTestAudioSweep={handleTestAudioSweep}
          />
        )}

        {activeTab === 'playlists' && (
          <PlaylistManager
            playlists={playlists}
            currentPlaylistId={playback.currentPlaylistId}
            queue={playback.queue}
            onPlayPlaylist={handlePlayPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onAddTrackToPlaylist={handleAddTrackToPlaylist}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onAddToQueue={handleAddToQueue}
            onClearQueue={handleClearQueue}
            onSelectTrackFromQueue={handleSelectTrackFromQueue}
            onConfigureProfile={(plId) => {
              setActiveTab('advanced-audio');
            }}
          />
        )}

        {(activeTab === 'advanced-audio' || activeTab === 'hardware-eq') && (
          <AdvancedAudioSettingsView
            playback={playback}
            playlists={playlists}
            onApplyPreset={handleApplyPreset}
            onCreatePreset={handleCreatePreset}
            onDeletePreset={handleDeletePreset}
            onUpdateEqualizerBands={handleUpdateEqualizerBands}
            onSaveAdvancedSettings={handleSaveAdvancedSettings}
            onSavePlaylistProfile={handleSavePlaylistProfile}
            onClearPlaylistProfile={handleClearPlaylistProfile}
          />
        )}

        {(activeTab === 'auth-api' || activeTab === 'account-api') && (
          <AuthAndApiKeysView
            currentUser={currentUser}
            authToken={authToken}
            onUserUpdated={(user, token) => {
              setCurrentUser(user);
              if (token) {
                setAuthToken(token);
                localStorage.setItem('hss_auth_token', token);
              } else {
                setAuthToken(null);
                localStorage.removeItem('hss_auth_token');
              }
            }}
            onRegister={handleRegister}
            onLogout={handleLogout}
            config={hubConfig}
            hubConfig={hubConfig}
            onSaveConfig={handleSaveConfig}
            onRegenerateApiKey={handleRegenerateApiKey}
          />
        )}

        {activeTab === 'scripts' && <PiScriptCenter />}

        {activeTab === 'websocket-stream' && (
          <WebSocketStreamView
            playback={playback}
            wsConnected={wsConnected}
            onSendWsCommand={handleSendWsCommand}
            recentEvents={recentEvents}
            onClearEvents={() => setRecentEvents([])}
          />
        )}
          </main>
        </div>
      </div>

      {/* API Documentation Modal */}
      <ApiDocsModal
        isOpen={isDocsModalOpen}
        onClose={() => setIsDocsModalOpen(false)}
        apiKey={hubConfig.apiKey}
      />

      {/* Automated Onboarding & Setup Wizard Modal */}
      <OnboardingWizardModal
        isOpen={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        audioDevices={audioDevices}
        hubConfig={hubConfig}
        onSaveConfig={handleSaveConfig}
        onSwitchAudioDevice={handleSwitchAudioDevice}
      />

      {/* Theme Picker Modal */}
      <ThemeCustomizerModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
        currentThemeId={themeId}
        onSelectTheme={(id) => setThemeId(id)}
      />

      {/* Hub Switcher Modal */}
      <HubSwitcherModal isOpen={isHubSwitcherOpen} onClose={() => setIsHubSwitcherOpen(false)} />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
