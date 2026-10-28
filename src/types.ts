export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  highResCoverUrl?: string;
  artistCoverUrl?: string;
  durationMs: number;
  uri: string;
  explicit?: boolean;
  bitrate?: number; // kbps, e.g. 320
  sampleRate?: number; // e.g. 44100
  bitDepth?: number; // e.g. 16 or 24
  releaseYear?: string;
  genre?: string;
  recordLabel?: string;
  dominantColor?: string;
  spotifyId?: string;
  format?: string;
}

export interface EqBand {
  freq: number;
  gain: number; // in dB (-12 to +12)
}

export interface EqPreset {
  id: string;
  name: string;
  category: 'Audiophile' | 'Genre' | 'Akoestiek' | 'Custom';
  description?: string;
  isCustom?: boolean;
  bands: EqBand[];
}

export interface AdvancedAudioSettings {
  eqPresetId: string; // e.g. 'audiophile_direct', 'flat', 'custom', etc.
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number; // 0 to 15s
  crossfadeCurve: 'linear' | 's_curve' | 'equal_power';
  gaplessPlayback: boolean;
  gaplessBufferPreloadMs: number; // e.g. 300ms - 1000ms
  resamplingQuality: 'disabled' | 'soxr_high' | 'soxr_veryhigh';
  ditherMode: 'none' | 'tpdf' | 'shaped';
  profileScope: 'global' | 'playlist_specific';
  associatedPlaylistId?: string | null;
  targetSampleRate?: number;
  name?: string;
}

export type AudioProfile = AdvancedAudioSettings;

export interface DspEqualizer {
  enabled: boolean;
  bands: EqBand[];
  activePresetId?: string;
  activePreset?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  tracks: Track[];
  isSpotify?: boolean;
  uri?: string;
  createdAt: string;
  audioProfile?: AdvancedAudioSettings;
}

export interface AudioDevice {
  id: string;
  name: string;
  type: 'i2s_dac' | 'usb_dac' | 'alsa_hw' | 'hdmi' | 'analog';
  chipset: string;
  dtoverlay: string;
  alsaCard: string;
  sampleRates: number[];
  maxBitDepth: number;
  hardwareVolume: boolean;
  isCurrent: boolean;
  description: string;
}

export interface DacConfig {
  activeDeviceId: string;
  dtoverlay: string;
  bitPerfect: boolean;
  clockSyncMode: 'master' | 'slave' | 'ultra_low_jitter';
  resamplingQuality: 'disabled' | 'soxr_high' | 'soxr_veryhigh';
  targetSampleRate: number; // 0 = native (44.1 / 48 / 96 / 192 kHz)
  bufferTimeMs: number; // e.g. 200ms
  periodTimeMs: number; // e.g. 50ms
  volumeDb: number; // -60 to 0 dB
  balance: number; // -50 (L) to +50 (R)
  hardwareMixerControl: string;
  dspEqualizer: {
    enabled: boolean;
    bands: { freq: number; gain: number }[]; // 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz
    activePresetId?: string;
  };
  advancedAudio: AdvancedAudioSettings;
}

export interface SystemStats {
  piModel: string;
  osVersion: string;
  cpuTempC: number;
  cpuUsagePct: number;
  ramUsagePct: number;
  ramUsedMb: number;
  ramTotalMb: number;
  uptimeSeconds: number;
  alsaUnderruns: number;
  dacClockLocked: boolean;
  streamBitrate: number;
  streamSampleRate: number;
  streamBitDepth: number;
  connectedClients: number;
  soloistDaemonStatus: 'active' | 'standby' | 'syncing' | 'error';
  crossfadeActive?: boolean;
  crossfadeProgressPct?: number;
}

export interface UserApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  permissions: ('audio:read' | 'audio:control' | 'dac:configure' | 'admin:all')[];
  status: 'active' | 'revoked';
  expiresAt?: string | null;
}

export type ApiKeyItem = UserApiKey;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'audiophile' | 'operator' | 'guest';
  avatarUrl?: string;
  apiKeys: UserApiKey[];
  createdAt: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
}

/** A song the user liked with the heart button — see
 *  src/services/likedTracks.ts (how a song is identified across sources),
 *  db.ts (liked_tracks) and src/server/routes/likes.ts. */
export interface LikedTrack {
  likeKey: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  source: string;
  sourceDetail: string;
  spotifyId: string | null;
  uri: string | null;
  likedAt: number;
}

/** Eén rij radio-luistergeschiedenis — zie db.ts (radio_log) en de ticker
 *  in src/server/state.ts die 'm vult bij elke ICY-tagwissel. */
export interface RadioLogEntry {
  id: number;
  station: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: number;
}

export interface HubConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyDeviceName: string;
  spotifyBitrate: '96' | '160' | '320';
  spotifyNormalisation: boolean;
  soloistEnabled: boolean;
  autostartService: boolean;
  apiKey: string;
  webhookUrl?: string;
  broadcastSpectrum: boolean;
  enableAlsaDirectHw: boolean;
  // Caps how loud the master volume can ever go (0-100), regardless of the
  // source — UI slider, GPIO encoder, or the REST API. Default 100 = no cap.
  maxVolumeLimit: number;
  // Catalogic (optional) — read-only metadata/artwork lookup for NAS tracks.
  // Reads are public; the API key is only needed for future write access.
  catalogicEnabled: boolean;
  catalogicUrl: string;
  catalogicApiKey?: string;
  // Separate from catalogicEnabled above (which only gates the lazy,
  // per-folder lookup): a whole-library scan can fire thousands of requests,
  // so it asks for its own explicit opt-in. Off by default — without it, a
  // scan only indexes local tags.
  catalogicScanLookupEnabled?: boolean;
  /** Publiek bereikbare basis-URL van deze Hub (bv. via Tailscale of
   *  port-forwarding), gebruikt als Catalogic-webhook target. Leeg = webhook-
   *  registratie wordt overgeslagen (zie ensureCatalogicWebhookRegistered). */
  // Listener (optioneel) — de eigen muzieklijst-app van de gebruiker. Een
  // like hier kan doorgestuurd worden naar zijn catalogus via
  // POST /api/integration/songs (zie src/services/listenerClient.ts).
  listenerPushLikes?: boolean;
  listenerUrl?: string;
  listenerIntegrationKey?: string;
  // Optionele luistergeschiedenis voor radio — uit, tot de gebruiker 'm zelf
  // aanzet (zie RadioLogEntry / db.ts radio_log). Nooit standaard aan: elk
  // radiomoment ongevraagd bijhouden is meer dan gevraagd.
  radioLogEnabled?: boolean;
  // "Auto-modus": elk gelogd radionummer ook meteen naar Listener pushen,
  // net als listenerPushLikes dat al voor het hartje doet. Losse toggle,
  // want de log kan aan staan zonder dat je elk nummer in Listener wilt.
  listenerPushRadioLog?: boolean;
  publicUrl: string;
  // Audio recognition (turntable/CD via USB mic) — see ExternalSourceState.
  // AcoustID matches near-exact fingerprints of clean digital files, which a
  // mic recording of a speaker never produces closely enough — even a
  // massively-fingerprinted song like "Dreams" failed to match. AudD does
  // its own server-side recognition designed for exactly this (mic/ambient
  // capture), so it's the primary lookup now; AcoustID key is kept for
  // anyone who does have a clean line-level capture, where it works well.
  acoustidApiKey?: string;
  auddApiToken?: string;
  recognitionMicDevice?: string; // ALSA capture device, e.g. "plughw:3,0"
  // RMS level (raw 16-bit PCM) below which a probe counts as silence — the
  // default was tuned live against one specific USB mic; a different mic,
  // gain setting, or noisy room may need a different value to reliably tell
  // a between-tracks gap apart from quiet room noise.
  recognitionSilenceThreshold?: number;
  // Seconds of continuous silence before an external source is treated as
  // genuinely stopped (vs. a between-tracks gap or a turntable side-flip) —
  // clears the last-recognized track/progress bar from the display.
  recognitionLongSilenceSec?: number;
}

/**
 * State for a physical/external audio source (turntable, CD player) that this
 * app doesn't play or control at all — the audio goes straight from the
 * source to an amp. This is purely a "what's playing" display, built by
 * fingerprinting a mic capture and looking it up (see audioRecognition.ts).
 */
export interface ExternalSourceState {
  active: boolean;
  sourceType: 'turntable' | 'cd' | null;
  sourceLabel: string;
  track: Track | null;
  listening: boolean;
  lastRecognizedAt: number | null;
  status: 'idle' | 'listening' | 'recognizing' | 'no_match' | 'error';
  errorMessage?: string;
  // Epoch ms estimate of when the current track began — set the instant a
  // gap→sound transition is detected (sound has just resumed), not when
  // recognition finishes seconds later. Drives a synthetic progress bar
  // (elapsed = now - trackStartedAt); this app never sees the real
  // transport position, so a manual pause/seek on the physical source will
  // silently desync the estimate — there's no way to detect that.
  trackStartedAt: number | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTrack: Track | null;
  positionMs: number;
  durationMs: number;
  volume: number; // 0-100
  isMuted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  queue: Track[];
  currentPlaylistId: string | null;
  dacConfig: DacConfig;
  systemStats: SystemStats;
  spectrum: number[]; // 16 frequency amplitude bars for visualizer / websocket stream
  activeProfileName?: string;
  // True only while a real Spotify Connect session is live on this device (set by
  // librespot's onevent hook), independent of isPlaying (stays true while paused).
  // Local/NAS and web radio playback is fully backend-controlled and never needs this.
  spotifyConnected: boolean;
}

export type ThemeId = 'obsidian' | 'slate' | 'emerald' | 'copper' | 'daylight';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  bgMain: string;
  accentColor: string;
  glowColor: string;
  spectrumGradient: [string, string, string];
}

export type CastLayout = 'kiosk_touch' | 'artwork_focus' | 'audiophile_spectrum' | 'ambient_clock' | 'custom_design';

// Rendered by the shared SpectrumBars component (src/components/ui/SpectrumBars.tsx),
// used everywhere the 16-band spectrum shows (all cast layouts + desktop Nu Speelt).
export type SpectrumStyle = 'bars' | 'waveform' | 'led_matrix';

// A user-uploaded webfont for the cast view's typography picker, stored as a
// data URL alongside the rest of the cast design settings (same approach as
// customBgImageUrl below) rather than as a file on disk — no extra storage
// route needed, and the settings blob already round-trips through the DB.
export interface CustomFont {
  id: string;
  name: string; // user-facing label, also the CSS font-family name (CustomFont_<id> is used internally)
  dataUrl: string;
  format: 'woff2' | 'woff' | 'ttf' | 'otf';
}

export interface CastDevice {
  id: string;
  name: string;
  ip: string;
  model: string;
  room: string;
}

export interface CastSessionState {
  isCasting: boolean;
  isStandby: boolean;
  activeDeviceId: string | null;
  activeLayout: CastLayout;
  startedAt: string | null;
  castUrl: string;
}

// Every positionable element in the 'custom_design' cast layout (art, text,
// spectrum, controls, clock) anchors independently to one of 9 points on the
// screen — offsetX/Y is then a fine-tune nudge from that anchor, not from a
// shared flow position. Picking the anchor nearest where you want an element
// gives it room to move freely in that direction (an element already anchored
// at an edge has almost no room to move further past that same edge).
export type AnchorH = 'left' | 'center' | 'right';
export type AnchorV = 'top' | 'center' | 'bottom';

export interface CastSettings {
  targetDeviceId: string;
  targetDeviceIp: string;
  targetDeviceName: string;
  layout: CastLayout;
  themeId: ThemeId;
  // The theme preset's accentColor is the default ('theme'); 'custom' overrides
  // it with a fixed user-picked color, 'auto_albumart' ties it live to the
  // current track's dominantColor (already extracted server-side for the
  // ambient background glow — this just widens where that color is used to
  // the whole theme accent).
  accentMode: 'theme' | 'custom' | 'auto_albumart';
  customAccentColor: string;
  layoutOrder?: CastLayout[]; // swipe-cycle order for the kiosk touch carousel; only the listed layouts are reachable by swiping. Unset/empty falls back to all 5 in the app's default order — see LAYOUTS in NestHubCastView.tsx.
  showControls: boolean;
  // Los van showControls: het hartje hoort ook te verschijnen bij een bron
  // die deze app niet kan bedienen (platenspeler/CD) — juist daar wil je iets
  // kunnen bewaren. Zie NestHubCastView.
  showLike?: boolean;
  showSpectrum: boolean;
  showQueue: boolean;
  showSourceSwitcher: boolean;
  showVolume: boolean;
  volumeSize: number; // px, width of the volume slider track
  volumeAnchorH: AnchorH;
  volumeAnchorV: AnchorV;
  volumeOffsetX: number; // px, nudge from the anchor point
  volumeOffsetY: number; // px
  volumeZIndex: number;
  showClock: boolean;
  autoReCast: boolean;
  autoCastOnPlay: boolean;
  autoStopOnPause: boolean;
  autoStopDelaySec: number;
  // false (default): auto-stop shows this app's own standby clock screen but
  // keeps the Chromecast session open. true: fully disconnects instead (see
  // stopCast() in state.ts) — the Nest Hub's receiver page unloads and its
  // screen returns to Google's own idle view, freeing the device for
  // anything else to cast to.
  autoStopReleasesDevice: boolean;
  // Auto-closes any open kiosk overlay (source picker, DAC/audio-source modal,
  // queue drawer, info modal) after this many seconds of no touch — otherwise
  // one left open (e.g. someone walked away mid-browse) sits there forever.
  // 0 disables the timeout. See the idle-timer effect in NestHubCastView.tsx.
  menuIdleTimeoutSec: number;
  // Cast content/visual editor fields — fully rendered by the 'custom_design' cast
  // layout (see NestHubCastView.tsx), not just previewed in the editor.
  bgStyle: 'solid' | 'glow' | 'gradient' | 'album_art' | 'custom_image';
  bgOpacity: number; // 0-100, alpha of the background layer (album art blur / EQ bars)
  bgBlur: number; // 0-100 px, blur radius for album_art / custom_image backgrounds
  bgOverlayOpacity: number; // 0-100, dark scrim over album_art / custom_image for text legibility
  customBgImageUrl?: string; // data URL of a user-uploaded custom background image
  bgColor: string; // used when bgStyle === 'solid'
  bgGlowColor: string; // used when bgStyle === 'glow'
  bgGlowIntensity: number; // 0-100, used when bgStyle === 'glow'
  bgGradientColors: [string, string]; // used when bgStyle === 'gradient' — a preset button just sets this pair directly, no separate "which preset" field to keep in sync
  bgGradientAngle: number; // 0-360 deg, used when bgStyle === 'gradient'
  // Standby screen (see the isStandby early-return in NestHubCastView.tsx) —
  // shown once casting auto-stops after a pause and autoStopReleasesDevice
  // is off. Background/image/font are fully independent of the normal
  // view's own bgStyle/customBgImageUrl/fontFamily above (own image, own
  // opacity/blur/overlay, own font) rather than shared.
  standbyBgStyle: 'solid' | 'glow' | 'gradient' | 'album_art' | 'custom_image';
  standbyCustomBgImageUrl?: string;
  standbyBgOpacity: number; // 0-100
  standbyBgBlur: number; // 0-100 px
  standbyBgOverlayOpacity: number; // 0-100
  standbyBgColor: string; // used when standbyBgStyle === 'solid'
  standbyBgGlowColor: string; // used when standbyBgStyle === 'glow'
  standbyBgGlowIntensity: number; // 0-100, used when standbyBgStyle === 'glow'
  standbyBgGradientColors: [string, string]; // used when standbyBgStyle === 'gradient'
  standbyBgGradientAngle: number; // 0-360 deg, used when standbyBgStyle === 'gradient'
  standbyFontFamily: string; // same id space as fontFamily/customFonts above
  standbyUseCustomAccent: boolean;
  standbyAccentColor: string;
  standbyShowTrack: boolean; // last-played track's art/title/artist, not just the clock
  standbyShowVolume: boolean; // live volume bar — the only readout there is while nothing plays
  // Position of what's left once time/date (their own independent elements
  // below) are taken out of this group: the "Standby" label and, if enabled,
  // the last-played track card / volume bar.
  standbyClockAnchorH: AnchorH;
  standbyClockAnchorV: AnchorV;
  standbyClockOffsetX: number;
  standbyClockOffsetY: number;
  // Time and date used to be one fixed block sharing clockSize/clockColor
  // (with the date rendered at a hardcoded reduced opacity) and one shared
  // anchor — now each is a fully independent positioned element, the same
  // pattern as every other element on the normal (non-standby) screen.
  standbyShowTime: boolean;
  standbyTimeSize: number;
  standbyTimeLetterSpacing: number; // px — was a fixed "tracking-tight", which crowds the digits at larger sizes
  standbyTimeEffect: 'none' | 'aurora' | 'folded' | 'reflect' | 'sliced'; // decorative text style, see StandbyTimeText in NestHubCastView.tsx
  standbyTimeAuroraColors: [string, string, string]; // used when standbyTimeEffect === 'aurora'
  standbyTimeReflectDistance: number; // px, gap between the text and its reflection — used when standbyTimeEffect === 'reflect'
  standbyTimeReflectOpacity: number; // 0-100, used when standbyTimeEffect === 'reflect'
  standbyTimeSlicedGap: number; // px, horizontal shift of each half in opposite directions — used when standbyTimeEffect === 'sliced'
  standbyTimeSlicedVerticalGap: number; // px, vertical space opened up between the two halves (negative = overlap) — used when standbyTimeEffect === 'sliced'
  standbyTimeSlicedColor: string; // color of the bottom half — used when standbyTimeEffect === 'sliced'
  standbyTimeFoldedSkew: number; // deg, outer tilt of the whole block — used when standbyTimeEffect === 'folded'
  standbyTimeFoldedRotation: number; // deg, outer rotation (paired with the skew above) — used when standbyTimeEffect === 'folded'
  standbyTimeFoldedCreaseSkew: number; // deg, opposing skew applied to each half (this value on the bottom, negated on top) — used when standbyTimeEffect === 'folded'
  standbyTimeFoldedOffset: number; // px, horizontal nudge of the top half relative to the bottom — used when standbyTimeEffect === 'folded'
  standbyTimeFoldedBaseColor: string; // faint base copy behind both halves — used when standbyTimeEffect === 'folded'
  standbyTimeFoldedTopColor: string; // used when standbyTimeEffect === 'folded'
  standbyTimeFoldedBottomColor: string; // used when standbyTimeEffect === 'folded'
  standbyTimeColor: string;
  standbyTimeAnchorH: AnchorH;
  standbyTimeAnchorV: AnchorV;
  standbyTimeOffsetX: number;
  standbyTimeOffsetY: number;
  standbyShowDate: boolean;
  standbyDateSize: number;
  standbyDateLetterSpacing: number; // px — was a fixed "tracking-widest"
  standbyDateColor: string;
  standbyDateAnchorH: AnchorH;
  standbyDateAnchorV: AnchorV;
  standbyDateOffsetX: number;
  standbyDateOffsetY: number;
  artRadius: number;
  artShadow: boolean;
  artDisplayMode: 'flat' | 'vinyl' | 'cd' | 'auto'; // flat tile, spinning vinyl record, spinning CD, or auto-pick from the active source (external turntable/cd, otherwise flat)
  discSpin: boolean; // rotation animation for vinyl/cd modes
  // Only 'custom_design' has independent per-element anchors, so only there does a
  // slide direction mean anything. Slides the art off-screen (toward its own anchor
  // edge) while an external source (turntable/CD) is re-recognizing a track, and
  // back in once the new track is known — see the slideOut param on anchoredStyle
  // in NestHubCastView.tsx.
  transitionAnimation: boolean;
  artZIndex: number; // stacking order vs. the text block — raise/lower so text can fall over the art
  // Size/fill/hole/position are per display-mode rather than one shared value —
  // 'auto' picks vinyl/cd/flat based on the active source (see
  // effectiveArtDisplayMode in NestHubCastView), and each medium looks right at
  // its own placement (a record isn't sized or placed like a CD).
  flatArtSize: number; // px
  vinylArtSize: number; // px
  cdArtSize: number; // px
  flatArtAnchorH: AnchorH;
  flatArtAnchorV: AnchorV;
  flatArtOffsetX: number; // px, nudge from the anchor point
  flatArtOffsetY: number; // px
  vinylArtAnchorH: AnchorH;
  vinylArtAnchorV: AnchorV;
  vinylArtOffsetX: number;
  vinylArtOffsetY: number;
  cdArtAnchorH: AnchorH;
  cdArtAnchorV: AnchorV;
  cdArtOffsetX: number;
  cdArtOffsetY: number;
  vinylFillPct: number; // 0-100, how much of the vinyl face the cover art covers (small label vs. bare grooves)
  cdFillPct: number; // 0-100, how much of the CD face the cover art covers (near full face)
  vinylHoleSizePct: number; // 0-100, center spindle hole size relative to the whole vinyl disc
  cdHoleSizePct: number; // 0-100, center spindle hole size relative to the whole CD
  align: 'left' | 'center'; // text-align of the title/artist block, and internal alignment of the spectrum bars / control buttons row — independent of position now
  // Applies to the whole cast view's typography (label/title/artist) — the clock
  // keeps its own separate styling. sans/mono/system/serif are zero-load (already
  // loaded app-wide, or native stacks); poppins/playfair/bebas are Google Fonts
  // loaded specifically for this picker (see index.css). Any other value is
  // looked up by id in customFonts below.
  fontFamily: string;
  customFonts: CustomFont[];
  textAnchorH: AnchorH;
  textAnchorV: AnchorV;
  textOffsetX: number; // px, nudge from the anchor point
  textOffsetY: number; // px
  textZIndex: number;
  textWidth: number; // px, bounds the title/artist block — controls when text wraps/truncates instead of running off-screen
  titleSize: number;
  titleColor: string; // css color
  titleLetterSpacing: number; // px — was a fixed "tracking-tight"
  titleLineHeight: number; // percent (100 = normal), unitless CSS line-height * 100
  artistSize: number; // px, independent of titleSize now
  artistColor: string; // css color
  artistLetterSpacing: number; // px
  artistLineHeight: number; // percent (100 = normal), unitless CSS line-height * 100
  textShadow: boolean; // applies to the label/title/artist block together
  glow: boolean;
  clockStyle: 'small' | 'large'; // visual template — single inline line vs. stacked big digits + date — independent of clockAnchorH/V now
  clockAnchorH: AnchorH;
  clockAnchorV: AnchorV;
  clockOffsetX: number; // px, nudge from the anchor point
  clockOffsetY: number; // px
  clockZIndex: number;
  clockSize: number; // px, main time text — independent of clockStyle's old fixed sizing
  clockColor: string; // css color, applies to the whole clock block (date renders at reduced opacity of this)
  clockLetterSpacing: number; // px — was a fixed "tracking-tight"
  clockShadow: boolean;
  spectrumAnchorH: AnchorH;
  spectrumAnchorV: AnchorV;
  spectrumOffsetX: number; // px, nudge from the anchor point
  spectrumOffsetY: number; // px
  spectrumZIndex: number;
  spectrumHeight: number; // px, bar area height
  spectrumWidth: number; // px, total row width — bars stretch to fill it evenly
  spectrumOpacity: number; // 0-100, alpha of the bars on top of their own play/pause dimming
  spectrumStyle: SpectrumStyle; // visual style of the visualizer — same field drives all layouts + desktop, colors always come from the active theme (no per-style color fields, see SpectrumBars.tsx)
  controlsAnchorH: AnchorH;
  controlsAnchorV: AnchorV;
  controlsOffsetX: number; // px, nudge from the anchor point
  controlsOffsetY: number; // px
  controlsZIndex: number;
  controlsSize: number; // px, icon size — each button's padding scales proportionally with it
  sourcePickerScale: number; // %, 100 = normal size — CSS zoom on the source-picker popover (icons, text, thumbnails)
  showProgress: boolean;
  progressAnchorH: AnchorH;
  progressAnchorV: AnchorV;
  progressOffsetX: number; // px, nudge from the anchor point
  progressOffsetY: number; // px
  progressZIndex: number;
  progressWidth: number; // px
  progressHeight: number; // px, bar thickness — also sets its own corner radius (fully rounded)
}

// A saved snapshot of the 'custom_design' cast layout's visual settings — everything
// editable in the Cast Content Editor, but deliberately not device targeting
// (targetDeviceId/Ip/Name), layout choice, or automation timers, since a preset is
// about "the look", not which Hub it casts to or when.
export interface CastDesignPreset {
  id: string;
  name: string;
  createdAt: string;
  settings: Partial<CastSettings>;
}

export interface WebSocketEventPayload {
  event:
    | 'playback_state'
    | 'track_change'
    | 'progress_tick'
    | 'volume_change'
    | 'dac_update'
    | 'audio_settings_update'
    | 'crossfade_event'
    | 'queue_update'
    | 'spectrum'
    | 'system_stats'
    | 'client_connected'
    | 'auth_event'
    | 'notification'
    | 'cast_state_changed'
    | 'cast_design_updated'
    | 'external_source_update'
    | 'likes_updated'
    | 'nas_scan_progress'
    | 'nas_backlog_reconciled'
    | 'radio_log_reconciled'
    | 'playlist_created'
    | 'gpio_action'
    | 'update_available'
    | 'health_issue';
  timestamp: number;
  data: any;
}
