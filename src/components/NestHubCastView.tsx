import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Check,
  Clock,
  Cpu,
  Disc,
  FastForward,
  Flame,
  Info,
  Layers,
  ListMusic,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  Radio,
  Repeat,
  Rewind,
  RotateCcw,
  Search,
  Shuffle,
  Sliders,
  Sun,
  Volume2,
  VolumeX,
  Waves,
  Zap,
} from 'lucide-react';
import { resolveThemeAccent, THEME_PRESETS } from '../services/themeManager';
import { fillPercent } from '../services/volumeScale.ts';
import {
  AudioDevice,
  CastLayout,
  CastSettings,
  DacConfig,
  ExternalSourceState,
  LikedTrack,
  PlaybackState,
  Playlist,
  ThemeId,
  Track,
  WebSocketEventPayload,
} from '../types';
import { LikeButton } from './LikeButton';
import { SourcePicker } from './SourcePicker';
import { SpectrumBars } from './ui/SpectrumBars.tsx';
import { getEnabledLayoutOrder } from '../services/castLayoutOrder.ts';

const DEFAULT_CAST_SETTINGS: CastSettings = {
  targetDeviceId: '',
  targetDeviceIp: '',
  targetDeviceName: '',
  layout: 'kiosk_touch',
  themeId: 'obsidian',
  accentMode: 'theme',
  customAccentColor: '#6366f1',
  showControls: true,
  showLike: true,
  showSpectrum: true,
  showQueue: true,
  showSourceSwitcher: true,
  showVolume: true,
  volumeSize: 120,
  volumeAnchorH: 'right',
  volumeAnchorV: 'bottom',
  volumeOffsetX: -130,
  volumeOffsetY: -80,
  volumeZIndex: 1,
  showClock: true,
  autoReCast: true,
  autoCastOnPlay: true,
  autoStopOnPause: false,
  autoStopDelaySec: 0,
  autoStopReleasesDevice: false,
  menuIdleTimeoutSec: 20,
  bgStyle: 'solid',
  bgOpacity: 60,
  bgBlur: 60,
  bgOverlayOpacity: 50,
  bgColor: '#08090c',
  bgGlowColor: '#6366f1',
  bgGlowIntensity: 35,
  bgGradientColors: ['#08090c', '#000000'],
  bgGradientAngle: 160,
  standbyBgStyle: 'glow',
  standbyBgOpacity: 60,
  standbyBgBlur: 60,
  standbyBgOverlayOpacity: 50,
  standbyBgColor: '#08090c',
  standbyBgGlowColor: '#f59e0b',
  standbyBgGlowIntensity: 20,
  standbyBgGradientColors: ['#08090c', '#000000'],
  standbyBgGradientAngle: 160,
  standbyFontFamily: 'sans',
  standbyUseCustomAccent: false,
  standbyAccentColor: '#f59e0b',
  standbyShowTrack: false,
  standbyShowVolume: true,
  standbyClockAnchorH: 'center',
  standbyClockAnchorV: 'center',
  standbyClockOffsetX: 0,
  standbyClockOffsetY: 110,
  standbyShowTime: true,
  standbyTimeSize: 96,
  standbyTimeLetterSpacing: -2,
  standbyTimeEffect: 'none',
  standbyTimeAuroraColors: ['#4f46e5', '#6366f1', '#38bdf8'],
  standbyTimeReflectDistance: 0,
  standbyTimeReflectOpacity: 20,
  standbyTimeSlicedGap: 2,
  standbyTimeSlicedVerticalGap: 10,
  standbyTimeSlicedColor: '#f59e0b',
  standbyTimeFoldedSkew: 8,
  standbyTimeFoldedRotation: -8,
  standbyTimeFoldedCreaseSkew: 13,
  standbyTimeFoldedOffset: 0,
  standbyTimeFoldedBaseColor: '#c88c7c',
  standbyTimeFoldedTopColor: '#f7f5f0',
  standbyTimeFoldedBottomColor: '#d4cec2',
  standbyTimeColor: '#ffffff',
  standbyTimeAnchorH: 'center',
  standbyTimeAnchorV: 'center',
  standbyTimeOffsetX: 0,
  standbyTimeOffsetY: -50,
  standbyShowDate: true,
  standbyDateSize: 16,
  standbyDateColor: '#cbd5e1',
  standbyDateLetterSpacing: 2,
  standbyDateAnchorH: 'center',
  standbyDateAnchorV: 'center',
  standbyDateOffsetX: 0,
  standbyDateOffsetY: 25,
  artRadius: 20,
  artShadow: true,
  artDisplayMode: 'flat',
  discSpin: true,
  transitionAnimation: false,
  artZIndex: 1,
  flatArtSize: 220,
  vinylArtSize: 220,
  cdArtSize: 180,
  flatArtAnchorH: 'left',
  flatArtAnchorV: 'center',
  flatArtOffsetX: 0,
  flatArtOffsetY: 0,
  vinylArtAnchorH: 'left',
  vinylArtAnchorV: 'center',
  vinylArtOffsetX: 0,
  vinylArtOffsetY: 0,
  cdArtAnchorH: 'left',
  cdArtAnchorV: 'center',
  cdArtOffsetX: 0,
  cdArtOffsetY: 0,
  vinylFillPct: 40,
  cdFillPct: 92,
  vinylHoleSizePct: 10,
  cdHoleSizePct: 6,
  align: 'left',
  fontFamily: 'sans',
  customFonts: [],
  textAnchorH: 'left',
  textAnchorV: 'center',
  textOffsetX: 130,
  textOffsetY: 0,
  textZIndex: 1,
  textWidth: 700,
  titleSize: 32,
  titleColor: '#ffffff',
  titleLetterSpacing: -1,
  titleLineHeight: 110,
  artistSize: 16,
  artistColor: '#cbd5e1',
  artistLetterSpacing: 0,
  artistLineHeight: 120,
  textShadow: false,
  glow: false,
  clockStyle: 'small',
  clockAnchorH: 'right',
  clockAnchorV: 'top',
  clockOffsetX: 0,
  clockOffsetY: 0,
  clockZIndex: 1,
  clockSize: 26,
  clockColor: '#ffffff',
  clockLetterSpacing: -1,
  clockShadow: false,
  spectrumAnchorH: 'left',
  spectrumAnchorV: 'center',
  spectrumOffsetX: 130,
  spectrumOffsetY: 90,
  spectrumZIndex: 1,
  spectrumHeight: 40,
  spectrumWidth: 220,
  spectrumOpacity: 100,
  spectrumStyle: 'bars',
  controlsAnchorH: 'left',
  controlsAnchorV: 'center',
  controlsOffsetX: 130,
  controlsOffsetY: 150,
  controlsZIndex: 1,
  controlsSize: 20,
  sourcePickerScale: 100,
  showProgress: true,
  progressAnchorH: 'left',
  progressAnchorV: 'bottom',
  progressOffsetX: 0,
  progressOffsetY: 0,
  progressZIndex: 1,
  progressWidth: 300,
  progressHeight: 6,
};


const formatUptime = (totalSeconds: number): string => {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}u ${minutes}m`;
  if (hours > 0) return `${hours}u ${minutes}m`;
  return `${minutes}m`;
};

// Every positionable element in the 'custom_design' layout (art, text, spectrum,
// controls, clock) anchors independently to one of 9 points on the frame, with
// offsetX/Y as a fine-tune nudge from there — instead of each element inheriting
// a shared flow position (which meant some elements had almost no room to move
// toward whichever edge they already started near). BASE_INSET keeps an anchored
// edge from sitting flush against the physical screen edge at offset 0.
// Cast view font choice — reuses the two faces the app already loads globally
// (General Sans, Fira Code) plus two zero-load system stacks, rather than
// pulling in a new webfont just for this picker.
const CAST_FONT_STACKS: Record<string, string> = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  poppins: "'Poppins', var(--font-sans)",
  playfair: "'Playfair Display', Georgia, serif",
  bebas: "'Bebas Neue', var(--font-sans)",
};

/** Anything not in the built-in stacks above is looked up in customFonts by id
 * — the matching @font-face (see the customFonts useEffect) registers it under
 * this same 'CustomFont_<id>' name. */
function resolveFontFamily(fontFamily: string, customFonts: { id: string; name: string }[]): string {
  if (CAST_FONT_STACKS[fontFamily]) return CAST_FONT_STACKS[fontFamily];
  const custom = customFonts.find((f) => f.id === fontFamily);
  return custom ? `'CustomFont_${custom.id}', var(--font-sans)` : CAST_FONT_STACKS.sans;
}

const BASE_INSET = 48;
type AnchorH = 'left' | 'center' | 'right';
type AnchorV = 'top' | 'center' | 'bottom';
// `animated`/`slideOut` are only used by the art element's optional transition
// animation (CastSettings.transitionAnimation) — every other call site omits
// them so its transform (and lack of a transition) is unchanged from before,
// which matters because the editor's live preview drags these values in
// real time and a transition would make that feel laggy.
function anchoredStyle(
  anchorH: AnchorH,
  anchorV: AnchorV,
  offsetX: number,
  offsetY: number,
  zIndex: number,
  animated = false,
  slideOut = false,
): React.CSSProperties {
  const style: React.CSSProperties = { position: 'absolute', zIndex };
  if (anchorH === 'left') style.left = BASE_INSET;
  else if (anchorH === 'right') style.right = BASE_INSET;
  else style.left = '50%';
  if (anchorV === 'top') style.top = BASE_INSET;
  else if (anchorV === 'bottom') style.bottom = BASE_INSET;
  else style.top = '50%';
  const centerTx = anchorH === 'center' ? -50 : 0;
  const centerTy = anchorV === 'center' ? -50 : 0;
  // Slide direction follows the element's own anchor edge (left anchor → further
  // left, etc.) so it exits toward the nearest screen edge. A center/center anchor
  // has no edge to head for, so that case just slides down. Distance is in
  // vw/vh (not px) so it clears the screen regardless of viewport size.
  let slideX = 0;
  let slideY = 0;
  if (slideOut) {
    const dx = anchorH === 'left' ? -1 : anchorH === 'right' ? 1 : 0;
    const dy = anchorV === 'top' ? -1 : anchorV === 'bottom' ? 1 : 0;
    slideX = dx;
    slideY = dx === 0 && dy === 0 ? 1 : dy;
  }
  style.transform = `translate(calc(${centerTx}% + ${offsetX}px + ${slideX * 120}vw), calc(${centerTy}% + ${offsetY}px + ${slideY * 120}vh))`;
  if (animated) style.transition = 'transform 0.6s ease';
  return style;
}

/** Decorative text styles for the standby clock (CastSettings.standbyTimeEffect)
 * — all Chromium-only CSS (-webkit-box-reflect, background-clip:text), which is
 * fine here: this app only ever renders on cage+chromium (kiosk) or a Chromecast
 * receiver (also Chromium), never a browser that would need a fallback.
 *
 * `style` always carries anchoredStyle's `position: 'absolute'` plus the
 * anchor/offset — every branch below must keep that intact (an earlier bug
 * had 'sliced' override it with `position: 'relative'`, which broke the
 * anchor entirely instead of just changing how the two halves clip). */
const StandbyTimeText: React.FC<{
  effect: CastSettings['standbyTimeEffect'];
  auroraColors: [string, string, string];
  reflectDistance: number;
  reflectOpacity: number;
  slicedGap: number;
  slicedVerticalGap: number;
  slicedColor: string;
  foldedSkew: number;
  foldedRotation: number;
  foldedCreaseSkew: number;
  foldedOffset: number;
  foldedBaseColor: string;
  foldedTopColor: string;
  foldedBottomColor: string;
  color: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}> = ({
  effect,
  auroraColors,
  reflectDistance,
  reflectOpacity,
  slicedGap,
  slicedVerticalGap,
  slicedColor,
  foldedSkew,
  foldedRotation,
  foldedCreaseSkew,
  foldedOffset,
  foldedBaseColor,
  foldedTopColor,
  foldedBottomColor,
  color,
  style,
  children,
}) => {
  if (effect === 'aurora') {
    return (
      <>
        <style>{`@keyframes hss-aurora-flow { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }`}</style>
        <div
          className="font-extrabold"
          style={{
            ...style,
            // Overrides the caller's default drop-shadow (kept for every other
            // effect) — with a transparent fill it doesn't sit behind solid
            // letterforms like it would on normal text, it shows straight
            // through every open counter (the inside of a 0, 6, 8, 9 — a clock's
            // entire vocabulary), reading as a dark smudge inside each digit.
            textShadow: 'none',
            backgroundImage: `linear-gradient(90deg, ${auroraColors[0]}, ${auroraColors[1]}, ${auroraColors[2]}, ${auroraColors[0]})`,
            backgroundSize: '300% auto',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            animation: 'hss-aurora-flow 8s linear infinite',
          } as React.CSSProperties}
        >
          {children}
        </div>
      </>
    );
  }
  if (effect === 'folded') {
    // Ported from a real "folded paper" CSS-art recipe (the original uses two
    // pseudo-elements with `content: attr(data-heading)` fed by a contenteditable
    // input-event listener — a trick to duplicate text into ::before/::after
    // without JS re-rendering; irrelevant here, React just re-renders {children}
    // in two literal extra spans instead). Two overlapping copies of the same
    // text, each clipped to one half and skewed/scaled in opposite directions
    // (top: skew(-13deg) scale(1,1.2), bottom: skew(13deg) scale(1,0.8)), sit
    // over a faint, blurred base copy — the mismatched skew between the two
    // halves is what reads as a crease, not a gradient or texture.
    // clip-path (resolves against the element's own box) stands in for the
    // original's `overflow:hidden; height:50%` (which needs an ancestor with a
    // resolved, non-auto height to work — ours doesn't have one).
    return (
      <div
        className="font-extrabold"
        style={{
          ...style,
          position: 'absolute',
          transform: `${style.transform || ''} skew(${foldedSkew}deg) rotate(${foldedRotation}deg)`,
          color: foldedBaseColor,
          textShadow: '1px 4px 6px rgba(230,224,214,0.9), 0 0 0 rgba(107,50,38,1), 1px 4px 6px rgba(230,224,214,0.9)',
        }}
      >
        {children}
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            clipPath: 'inset(0 0 50% 0)',
            color: foldedTopColor,
            transform: `translate(${foldedOffset}px, 0) skew(${-foldedCreaseSkew}deg) scale(1, 1.2)`,
            textShadow: '2px -1px 6px rgba(0,0,0,0.2)',
          }}
        >
          {children}
        </span>
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            clipPath: 'inset(50% 0 0 0)',
            color: foldedBottomColor,
            transform: `skew(${foldedCreaseSkew}deg) scale(1, 0.8)`,
            textShadow: '2px -1px 6px rgba(0,0,0,0.3)',
          }}
        >
          {children}
        </span>
      </div>
    );
  }
  if (effect === 'reflect') {
    return (
      <div
        className="font-extrabold"
        style={{
          ...style,
          lineHeight: 1,
          color,
          WebkitBoxReflect: `below ${reflectDistance}px linear-gradient(transparent, transparent 55%, rgba(255,255,255,${reflectOpacity / 100}))`,
        } as React.CSSProperties}
      >
        {children}
      </div>
    );
  }
  if (effect === 'sliced') {
    const half = slicedVerticalGap / 2;
    return (
      <div className="font-extrabold" style={{ ...style, lineHeight: 1, color }}>
        <span style={{ display: 'block', clipPath: 'inset(0 0 50% 0)', transform: `translate(${-slicedGap}px, ${-half}px)` }}>{children}</span>
        <span
          style={{
            display: 'block',
            clipPath: 'inset(50% 0 0 0)',
            transform: `translate(${slicedGap}px, ${half}px)`,
            marginTop: '-1em',
            color: slicedColor,
          }}
        >
          {children}
        </span>
      </div>
    );
  }
  return (
    <div className="font-extrabold" style={{ ...style, color }}>
      {children}
    </div>
  );
};

/** In the Cast Content Editor's live preview (?preview=1), clicking an element
 * jumps the sidebar straight to its settings section — see the postMessage
 * listener in NestHubCastManager.tsx's CastContentEditor. Harmless outside
 * that iframe (window.parent === window, postMessage back to itself is a no-op). */
function selectInEditor(element: string) {
  window.parent.postMessage({ type: 'cast-preview-select', element }, window.location.origin);
}

/** Transparent, always-visible click target overlaid on a positioned element
 * while editing. The real content underneath gets pointer-events:none (see
 * each call site) so clicking to select an element can't also trigger its
 * own control (e.g. skip/pause/mute) at the same time. */
const EditorSelectOverlay: React.FC<{ element: string; accentColor: string }> = ({ element, accentColor }) => (
  <div
    onClick={(e) => {
      e.stopPropagation();
      selectInEditor(element);
    }}
    style={{ position: 'absolute', inset: 0, cursor: 'pointer', border: `2px dashed ${accentColor}88`, borderRadius: 8 }}
  />
);

/** Spinning vinyl record art mode for the "Eigen ontwerp" cast layout. */
const VinylDisc: React.FC<{ track: Track; size: number; spinning: boolean; accentColor: string; fillPct: number; holeSizePct: number }> = ({
  track,
  size,
  spinning,
  accentColor,
  fillPct,
  holeSizePct,
}) => (
  // The blurred contact shadow lives on this static outer wrapper, not the
  // rotating element below — a circle's shadow silhouette doesn't change as
  // it spins anyway, so this is visually identical but far cheaper to
  // composite: the Nest Hub's weak GPU was repainting the shadow every
  // animation frame when it lived on the same element being transformed.
  <div style={{ width: size, height: size, borderRadius: '50%', boxShadow: '0 30px 70px rgba(0,0,0,0.65)', flexShrink: 0 }}>
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #1a1a1e, #060607 70%)',
        border: '2px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        animation: spinning ? 'soloist-vinyl-spin 9s linear infinite' : 'none',
        willChange: spinning ? 'transform' : undefined,
      }}
    >
      {[12, 24, 36, 48].map((inset) => (
        <div key={inset} style={{ position: 'absolute', inset: `${inset}%`, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.05)' }} />
      ))}
      <div
        style={{
          width: `${fillPct}%`,
          height: `${fillPct}%`,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `3px solid ${accentColor}`,
          position: 'relative',
          boxShadow: '0 0 24px rgba(0,0,0,0.5)',
        }}
      >
        <img
          src={track.coverUrl}
          alt={track.title}
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              // holeSizePct is relative to the whole disc; the label itself is
              // only fillPct of the disc, so scale up to stay disc-relative.
              width: `${fillPct > 0 ? Math.min(100, (holeSizePct / fillPct) * 100) : 0}%`,
              height: `${fillPct > 0 ? Math.min(100, (holeSizePct / fillPct) * 100) : 0}%`,
              borderRadius: '50%',
              background: '#060607',
              border: '1px solid rgba(255,255,255,0.35)',
            }}
          />
        </div>
      </div>
      {/* Light sweep — a soft highlight that catches the edge of the record as it turns */}
      {spinning && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.09) 40deg, transparent 90deg)',
            animation: 'soloist-vinyl-spin 9s linear infinite',
            willChange: 'transform',
          }}
        />
      )}
    </div>
  </div>
);

/** Spinning CD art mode — full-face album art with an iridescent rim, unlike vinyl's small center label. */
const CdDisc: React.FC<{ track: Track; size: number; spinning: boolean; accentColor: string; fillPct: number; holeSizePct: number }> = ({
  track,
  size,
  spinning,
  accentColor,
  fillPct,
  holeSizePct,
}) => (
  // See VinylDisc's comment: shadow on a static outer wrapper, not the
  // rotating element, so the Nest Hub's GPU isn't repainting it every frame.
  <div style={{ width: size, height: size, borderRadius: '50%', boxShadow: '0 30px 70px rgba(0,0,0,0.65)', flexShrink: 0 }}>
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        position: 'relative',
        animation: spinning ? 'soloist-vinyl-spin 9s linear infinite' : 'none',
        willChange: spinning ? 'transform' : undefined,
      }}
    >
      {/* Reflective underside — mostly brushed silver, like a real CD, with a
          single narrow iridescent highlight arc rather than a full rainbow. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'conic-gradient(from 0deg, #d4d4d8, #71717a, #d4d4d8, #a1a1aa, #e4e4e7, #71717a, #d4d4d8)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'conic-gradient(from 40deg, transparent 0deg, rgba(167,139,250,0.4) 20deg, rgba(96,165,250,0.35) 35deg, rgba(52,211,153,0.3) 50deg, transparent 75deg, transparent 360deg)',
          mixBlendMode: 'screen',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: `${(100 - fillPct) / 2}%`,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.4)',
        }}
      >
        <img
          src={track.coverUrl}
          alt={track.title}
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      {/* Center spindle hole — much smaller than vinyl's label, true to a real CD */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: `${holeSizePct}%`,
            height: `${holeSizePct}%`,
            borderRadius: '50%',
            background: '#050506',
            border: `2px solid ${accentColor}`,
            boxShadow: '0 0 12px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      {/* Light sweep — prismatic highlight sliding across the rim as it spins */}
      {spinning && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.35) 20deg, transparent 60deg)',
            animation: 'soloist-vinyl-spin 9s linear infinite',
            willChange: 'transform',
          }}
        />
      )}
    </div>
  </div>
);

interface NestHubCastViewProps {
  initialLayout?: CastLayout;
  initialThemeId?: ThemeId;
  onExitCast?: () => void;
}

export const NestHubCastView: React.FC<NestHubCastViewProps> = ({
  initialLayout,
  initialThemeId,
  onExitCast,
}) => {
  const [layout, setLayout] = useState<CastLayout>(initialLayout || 'kiosk_touch');
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId || 'obsidian');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  // Set/cleared by the cast_state_changed WS event — the server enters
  // standby (session stays alive, this stays true) instead of fully
  // stopping the cast when "auto-stop bij pauze" fires, so this page never
  // gets torn down for a routine pause. See src/server/state.ts. Initial
  // value also honors ?standby=1 (the editor's preview toggle) so the
  // Standby-scherm settings can be tuned against an actual live render
  // instead of edited blind — a real cast_state_changed event still wins
  // once one arrives, same as any other preview default. Every other load
  // seeds it from /api/cast/session in fetchState below, so a page that
  // starts up while the server is already in standby shows standby.
  const previewStandby = new URLSearchParams(window.location.search).get('standby') === '1';
  // The cast content editor embeds this page (?preview=1) as its live preview.
  // There, standby is a design surface the editor toggles by hand — the
  // server's real standby state must NOT leak in, or the moment the Pi idles
  // into standby (which a local kiosk screen does whenever nothing plays) the
  // preview locks onto the standby view and the normal layout can no longer
  // be seen or edited at all.
  const previewMode = new URLSearchParams(window.location.search).get('preview') === '1';
  // ?sourcepicker=1 — the editor's "Bron kiezen" preview toggle, same idea as
  // ?standby=1 above: forces the SourcePicker modal open on load so its
  // "Grootte" slider (Cast Designer → Bronnenkiezer) can be judged live
  // instead of guessed, since the popover is normally closed until tapped.
  const previewSourcePicker = new URLSearchParams(window.location.search).get('sourcepicker') === '1';
  const [isStandby, setIsStandby] = useState<boolean>(previewStandby);
  const [showQueueDrawer, setShowQueueDrawer] = useState<boolean>(false);
  const [showDacSourceModal, setShowDacSourceModal] = useState<boolean>(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState<boolean>(previewSourcePicker);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const touchStartXRef = useRef<number | null>(null);

  // Playback & System State
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: true,
    currentTrack: null,
    positionMs: 42000,
    durationMs: 330000,
    volume: 78,
    isMuted: false,
    shuffle: false,
    repeat: 'off',
    queue: [],
    currentPlaylistId: 'pl-audiophile',
    activeProfileName: 'Warm Vinyl HiFi',
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
        activePresetId: 'audiophile_direct',
        bands: [],
      },
      advancedAudio: {} as any,
    },
    systemStats: {
      piModel: 'Raspberry Pi 4B & 3B+ HiFi Hub',
      osVersion: 'Raspberry Pi OS (ALSA Direct)',
      cpuTempC: 44.2,
      cpuUsagePct: 11.8,
      ramUsagePct: 24.1,
      ramUsedMb: 940,
      ramTotalMb: 3906,
      uptimeSeconds: 148200,
      alsaUnderruns: 0,
      dacClockLocked: true,
      streamBitrate: 320,
      streamSampleRate: 44100,
      streamBitDepth: 24,
      connectedClients: 1,
      soloistDaemonStatus: 'active',
      crossfadeActive: false,
      crossfadeProgressPct: 0,
    },
    spectrum: [45, 60, 85, 90, 75, 65, 80, 95, 70, 60, 55, 45, 35, 30, 25, 20],
    spotifyConnected: false,
  });

  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [castDesign, setCastDesign] = useState<CastSettings>(DEFAULT_CAST_SETTINGS);
  const [externalSource, setExternalSource] = useState<ExternalSourceState | null>(null);
  const [likes, setLikes] = useState<LikedTrack[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Editor "Toepassen"-knop: unsaved changes in the Cast Content Editor reach
  // this preview iframe (?preview=1) via postMessage instead of the real
  // cast_design_updated broadcast, which now only fires on Toepassen — see
  // LiveKioskPreview in NestHubCastManager.tsx. Real cast/kiosk screens
  // (previewMode false) ignore this; they only ever see saved settings.
  useEffect(() => {
    if (!previewMode) return;
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'cast-preview-settings') return;
      if (e.data.settings) setCastDesign((prev) => ({ ...prev, ...e.data.settings }));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [previewMode]);

  // Registers each uploaded custom font as a real @font-face so fontFamily can
  // reference it — a single <style> tag kept in sync with customFonts, rather
  // than one <link>/<style> per font, since fonts can be added/removed live.
  useEffect(() => {
    const cssFormat: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
    const css = castDesign.customFonts
      .map((f) => `@font-face { font-family: 'CustomFont_${f.id}'; src: url('${f.dataUrl}') format('${cssFormat[f.format] || 'woff2'}'); font-display: swap; }`)
      .join('\n');
    let styleEl = document.getElementById('hss-custom-fonts') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'hss-custom-fonts';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }, [castDesign.customFonts]);

  // Base theme preset, before the accentMode override below — track isn't
  // resolved yet at this point, so this also serves as the fallback accent for
  // the "nothing playing" placeholder track further down.
  const baseTheme = THEME_PRESETS[themeId] || THEME_PRESETS.obsidian!;

  // Live Clock Updater for Nest Hub
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      setCurrentDate(
        now.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch initial state & devices — also re-run on every WebSocket reconnect
  // (see below). A server restart mid-session (deploy, crash) never sends a
  // "the external source stopped" broadcast — the process just dies — so
  // without this, a frozen "now playing" from before the restart would
  // otherwise stay on screen forever, since nothing else ever refreshes it.
  // The ceiling a volume reading has to be understood against. 100 until the
  // server says otherwise, so a bar drawn before the first fetch is never
  // wrong by more than the default already is.
  const [maxVolumeLimit, setMaxVolumeLimit] = useState(100);


  const fetchState = useCallback(async () => {
    try {
      const [statusRes, devRes, plRes, castRes, recRes, sessionRes, likesRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()),
        fetch('/api/audio/devices').then((r) => r.json()),
        fetch('/api/playlists').then((r) => r.json()),
        fetch('/api/cast/settings').then((r) => r.json()),
        fetch('/api/recognize/status').then((r) => r.json()),
        fetch('/api/cast/session').then((r) => r.json()),
        fetch('/api/likes').then((r) => r.json()),
      ]);
      if (statusRes.playback) setPlayback(statusRes.playback);
      if (typeof statusRes.hubConfig?.maxVolumeLimit === 'number') setMaxVolumeLimit(statusRes.hubConfig.maxVolumeLimit);
      if (devRes.devices) setAudioDevices(devRes.devices);
      if (plRes.playlists) setPlaylists(plRes.playlists);
      if (castRes.settings) {
        setCastDesign((prev) => ({ ...prev, ...castRes.settings }));
        if (!initialLayout && castRes.settings.layout) setLayout(castRes.settings.layout);
        if (!initialThemeId && castRes.settings.themeId) setThemeId(castRes.settings.themeId);
      }
      setExternalSource(recRes.externalSource || null);
      if (Array.isArray(likesRes.likes)) setLikes(likesRes.likes);
      // Standby used to arrive ONLY as a cast_state_changed event, so a page
      // that (re)loaded while the server was already in standby — chromium
      // restarting on the local kiosk screen, a Chromecast reloading the
      // receiver — came up on the normal now-playing view and stayed there:
      // enterCastStandby() is a no-op when the session already says standby,
      // so no further event was ever broadcast to correct it.
      if (!previewMode && typeof sessionRes.session?.isStandby === 'boolean') {
        setIsStandby(sessionRes.session.isStandby);
      }
    } catch (e) {
      console.warn('Cast view state fetch failed:', e);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Standby is driven by "is anything playing", which says nothing about
  // whether somebody is standing at the screen using it. On the local kiosk
  // screen that meant browsing the menu with the music stopped dropped to the
  // standby clock mid-tap — autoStopDelaySec can be as short as a few
  // seconds. Every touch now pushes the countdown back out: /api/cast/wake
  // cancels the pending auto-stop, and the server's idle ticker starts a
  // fresh full delay a second later. Throttled because a scroll or drag fires
  // this a lot, and skipped in the editor preview, which must never cancel a
  // real screen's timer. A tap while already in standby is handled by
  // handleWakeFromStandby instead (it wakes rather than postpones).
  useEffect(() => {
    if (previewMode || isStandby) return;
    let lastPing = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastPing < 3000) return;
      lastPing = now;
      fetch('/api/cast/wake', { method: 'POST' }).catch(() => {});
    };
    window.addEventListener('pointerdown', onActivity);
    return () => window.removeEventListener('pointerdown', onActivity);
  }, [previewMode, isStandby]);

  // WebSocket Live Synced Feed
  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: any;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUri = `${protocol}//${window.location.host}/ws`;

      socket = new WebSocket(wsUri);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        fetchState();
      };

      socket.onmessage = (event) => {
        try {
          const payload: WebSocketEventPayload = JSON.parse(event.data);
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
            setPlayback((prev) => ({ ...prev, ...payload.data }));
          } else if (payload.event === 'track_change') {
            setPlayback((prev) => ({
              ...prev,
              currentTrack: payload.data.track !== undefined ? payload.data.track : prev.currentTrack,
              queue: payload.data.queue || prev.queue,
              positionMs: 0,
              durationMs: payload.data.track?.durationMs || prev.durationMs,
              isPlaying: payload.data.track === null ? false : true,
              spotifyConnected: payload.data.spotifyConnected !== undefined ? payload.data.spotifyConnected : prev.spotifyConnected,
            }));
          } else if (payload.event === 'volume_change') {
            if (typeof payload.data.maxVolumeLimit === 'number') setMaxVolumeLimit(payload.data.maxVolumeLimit);
            setPlayback((prev) => ({
              ...prev,
              volume: payload.data.volume !== undefined ? payload.data.volume : prev.volume,
              isMuted: payload.data.isMuted !== undefined ? payload.data.isMuted : prev.isMuted,
              dacConfig: {
                ...prev.dacConfig,
                volumeDb: payload.data.volumeDb !== undefined ? payload.data.volumeDb : prev.dacConfig.volumeDb,
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
          } else if (payload.event === 'crossfade_event') {
            setPlayback((prev) => ({
              ...prev,
              systemStats: {
                ...prev.systemStats,
                crossfadeActive: payload.data.active,
                crossfadeProgressPct: payload.data.progressPct,
              },
            }));
          } else if (payload.event === 'cast_state_changed') {
            if (!previewMode && typeof payload.data.session?.isStandby === 'boolean') {
              setIsStandby(payload.data.session.isStandby);
            }
          } else if (payload.event === 'cast_design_updated') {
            if (payload.data.settings) {
              setCastDesign((prev) => ({ ...prev, ...payload.data.settings }));
              if (!initialLayout && payload.data.settings.layout) setLayout(payload.data.settings.layout);
              if (!initialThemeId && payload.data.settings.themeId) setThemeId(payload.data.settings.themeId);
            }
          } else if (payload.event === 'external_source_update') {
            setExternalSource(payload.data);
          } else if (payload.event === 'likes_updated') {
            setLikes(payload.data.likes || []);
          }
        } catch (err) {
          console.warn('Cast WS parse error:', err);
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connectWs, 2000);
      };
    };

    connectWs();
    return () => {
      clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, []);

  // Auto-close any open overlay after N seconds of no touch — otherwise one left
  // open (e.g. someone walked away mid-browse in the source picker) sits there
  // forever, since none of these overlays has its own idle timeout.
  useEffect(() => {
    const timeoutSec = castDesign.menuIdleTimeoutSec;
    const anyMenuOpen = isSourcePickerOpen || showDacSourceModal || showQueueDrawer || showInfoModal;
    // previewMode: an overlay forced open by an editor toggle (e.g. "Bron
    // kiezen" — see the ?sourcepicker=1 init above) must stay open for as
    // long as that toggle is on. Slider drags happen in the sidebar, outside
    // this iframe, so no touch/pointer event here would ever reset the timer
    // — it would silently close the very thing being tuned.
    if (!anyMenuOpen || !timeoutSec || previewMode) return;

    const closeAll = () => {
      setIsSourcePickerOpen(false);
      setShowDacSourceModal(false);
      setShowQueueDrawer(false);
      setShowInfoModal(false);
    };

    let timer = setTimeout(closeAll, timeoutSec * 1000);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(closeAll, timeoutSec * 1000);
    };
    window.addEventListener('touchstart', resetTimer);
    window.addEventListener('pointerdown', resetTimer);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('pointerdown', resetTimer);
    };
  }, [isSourcePickerOpen, showDacSourceModal, showQueueDrawer, showInfoModal, castDesign.menuIdleTimeoutSec]);

  const handleWakeFromStandby = async () => {
    setIsStandby(false); // instant feedback — the WS event confirms it a moment later
    try {
      await fetch('/api/cast/wake', { method: 'POST' });
    } catch (e) {
      console.warn('Wake from standby failed');
    }
  };

  // Control Actions
  const handleTogglePlay = async () => {
    try {
      await fetch('/api/playback/toggle', { method: 'POST' });
    } catch {
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
      console.warn('Prev failed');
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
    setPlayback((p) => ({ ...p, volume, isMuted: false }));
    try {
      await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume, isMuted: false }),
      });
    } catch (e) {
      console.warn('Volume failed');
    }
  };

  const handleToggleMute = async () => {
    const nextMute = !playback.isMuted;
    setPlayback((p) => ({ ...p, isMuted: nextMute }));
    try {
      await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isMuted: nextMute }),
      });
    } catch (e) {
      console.warn('Mute failed');
    }
  };

  const handleSwitchAudioDevice = async (deviceId: string) => {
    try {
      await fetch('/api/audio/output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      setShowDacSourceModal(false);
    } catch (e) {
      console.warn('DAC switch failed');
    }
  };

  const handlePlayPlaylist = async (playlistId: string) => {
    try {
      await fetch(`/api/playlists/${playlistId}/play`, { method: 'POST' });
      setShowQueueDrawer(false);
    } catch (e) {
      console.warn('Play playlist failed');
    }
  };

  // Swipe left/right anywhere on the kiosk to cycle through layouts — the header's
  // layout-pill switcher is gone, this is the only way to change views now.
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null) return;
    const deltaX = e.changedTouches[0].clientX - startX;
    const SWIPE_THRESHOLD = 60;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    const order = getEnabledLayoutOrder(castDesign.layoutOrder);
    const currentIndex = order.indexOf(layout);
    // Current layout isn't in the enabled set (just got disabled in the editor) —
    // land on the first enabled one instead of computing a bogus -1-based index.
    if (currentIndex === -1) { setLayout(order[0]); return; }
    const nextIndex = deltaX < 0
      ? (currentIndex + 1) % order.length
      : (currentIndex - 1 + order.length) % order.length;
    setLayout(order[nextIndex]);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // A recognized turntable/CD track takes over the display entirely — this app
  // has no transport control over it at all (the audio never passes through
  // here), so it always wins over whatever playbackState.currentTrack says.
  // Checked on `active` alone (not `active && track`): the backend briefly
  // sets track to null while it's re-recognizing a new track (see state.ts's
  // onTransitionDetected). Falling through to playback.currentTrack during
  // that gap would flash whatever source played before this one was selected.
  const isExternalActive = Boolean(externalSource?.active);

  // The real track or nothing — `track` below falls back to a placeholder
  // ("Geen nummer afspelen"), which the heart must never offer to save.
  const likeTrack = (isExternalActive ? externalSource?.track : playback.currentTrack) || null;

  const track = (isExternalActive ? externalSource!.track : playback.currentTrack) || {
    id: 'placeholder',
    title: isExternalActive ? 'Herkennen…' : 'Geen nummer afspelen',
    artist: isExternalActive ? externalSource?.sourceLabel || 'Externe bron' : 'HSS HiFi Hub',
    album: 'Audiophile Standby',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    highResCoverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&auto=format&fit=crop&q=90',
    durationMs: 330000,
    uri: 'spotify:track:demo',
    dominantColor: baseTheme.accentColor,
    format: '24-bit PCM Master',
    releaseYear: '2026',
  };

  // Applies the accent override (see CastSettings.accentMode) now that the
  // real track — and its dominantColor for 'auto_albumart' mode — is known.
  const activeTheme = resolveThemeAccent(baseTheme, castDesign.accentMode, castDesign.customAccentColor, track.dominantColor);

  // Local/NAS files and web radio are fully backend-controlled and always respond to
  // transport commands. Spotify only responds while a real Connect session is live —
  // without one, the buttons here would do nothing, so we hide them on the cast
  // display too instead of showing dead controls. An external source (turntable/CD)
  // never has controls — this app only observes it, it never plays it.
  type Source = 'spotify' | 'local' | 'radio' | 'external' | 'none';
  const source: Source = isExternalActive
    ? 'external'
    : !playback.currentTrack
    ? 'none'
    : playback.currentTrack.uri?.startsWith('spotify:')
    ? 'spotify'
    : playback.currentTrack.uri?.startsWith('file://')
    ? 'local'
    : 'radio';
  // previewMode (declared with the other URL flags above) also forces the
  // controls row visible — it's otherwise hidden whenever nothing is actually
  // connected, so there'd be no way to see or adjust it unless something
  // happened to be playing live at that exact moment while editing.
  const controlsEnabled = previewMode ? true : source === 'external' ? false : source === 'spotify' ? playback.spotifyConnected : source !== 'none';

  // Shared across every layout below — previously each one hardcoded its own
  // "SPOTIFY ..." badge/copy for whenever there's nothing to control, which
  // was correct for an unconnected Spotify session (source === 'spotify')
  // but wrong for the equally-common case of no source having been picked at
  // all yet (source === 'none'): radio/NAS/external never reach this branch,
  // since they're either always controllable or (external) have their own
  // "not controllable" message already.
  const sourceBadgeLabel =
    source === 'spotify'
      ? `SPOTIFY ${playback.systemStats.streamBitrate}k`
      : source === 'local'
      ? 'NAS BESTAND'
      : source === 'radio'
      ? 'WEB RADIO'
      : source === 'external'
      ? externalSource?.sourceLabel?.toUpperCase() || 'EXTERNE BRON'
      : 'GEEN BRON';
  const idleControlsMessage = source === 'spotify' ? 'Verbind via Spotify Connect om te bedienen' : 'Kies een bron om te beginnen';

  // 'auto' picks the disc shape from the actual source — turntable/CD show
  // their real medium, anything else (Spotify/NAS/radio, no physical medium)
  // falls back to flat. Explicit flat/vinyl/cd is taken literally, even for
  // an external source — only 'auto' reacts to what's actually playing.
  const effectiveArtDisplayMode: 'flat' | 'vinyl' | 'cd' =
    castDesign.artDisplayMode !== 'auto'
      ? castDesign.artDisplayMode
      : source === 'external' && externalSource?.sourceType === 'turntable'
      ? 'vinyl'
      : source === 'external' && externalSource?.sourceType === 'cd'
      ? 'cd'
      : 'flat';

  // playback.isPlaying reflects the app's OWN transport, which is always
  // false while listening to an external source (starting that listener
  // pauses whatever the app itself was driving) — so the disc never spun
  // for turntable/CD. Whether the physical medium is actually spinning is
  // "is the listener active", not the app's playback state.
  const effectiveSpinning = castDesign.discSpin && (source === 'external' ? Boolean(externalSource?.active) : playback.isPlaying);

  // Size/fill/hole/position are configured per medium (see CastSettings) rather
  // than one shared value, so 'auto' picking vinyl vs. cd vs. flat also picks up
  // that medium's own look and placement instead of whatever was last configured.
  const activeArtSize =
    effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylArtSize : effectiveArtDisplayMode === 'cd' ? castDesign.cdArtSize : castDesign.flatArtSize;
  const activeFillPct = effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylFillPct : castDesign.cdFillPct;
  const activeHoleSizePct = effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylHoleSizePct : castDesign.cdHoleSizePct;
  const activeArtAnchorH =
    effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylArtAnchorH : effectiveArtDisplayMode === 'cd' ? castDesign.cdArtAnchorH : castDesign.flatArtAnchorH;
  const activeArtAnchorV =
    effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylArtAnchorV : effectiveArtDisplayMode === 'cd' ? castDesign.cdArtAnchorV : castDesign.flatArtAnchorV;
  const activeArtOffsetX =
    effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylArtOffsetX : effectiveArtDisplayMode === 'cd' ? castDesign.cdArtOffsetX : castDesign.flatArtOffsetX;
  const activeArtOffsetY =
    effectiveArtDisplayMode === 'vinyl' ? castDesign.vinylArtOffsetY : effectiveArtDisplayMode === 'cd' ? castDesign.cdArtOffsetY : castDesign.flatArtOffsetY;

  const activeDac = audioDevices.find((d) => d.id === playback.dacConfig.activeDeviceId) || {
    id: 'hifiberry-dacplus',
    name: 'HiFiBerry DAC+ Pro (I2S)',
  };

  const dominantGlow = track.dominantColor || activeTheme.accentColor;

  // Deliberately isolated from the main render below rather than woven into
  // it — the normal layout threads playback.isPlaying through dozens of
  // spots (art/controls/spectrum/progress) with no single existing gate.
  // Standby is a distinct, simple, full-screen state; keeping it as its own
  // early return avoids touching that already-elaborate render tree at all.
  // Background/image/opacity/blur/overlay/font are fully independent of
  // the normal view's own bgStyle/customBgImageUrl/fontFamily — only
  // clockSize/clockColor stay shared (genuinely the same "how big/what
  // color is a clock" knob wherever a clock shows up).
  if (isStandby) {
    const standbyAccent = castDesign.standbyUseCustomAccent ? castDesign.standbyAccentColor : activeTheme.accentColor;
    return (
      <div
        onClick={handleWakeFromStandby}
        className="w-screen h-screen overflow-hidden select-none relative font-sans text-slate-100 cursor-pointer"
        style={{ backgroundColor: castDesign.standbyBgColor }}
      >
        {castDesign.standbyBgStyle === 'glow' && (
          <div
            className="absolute inset-0 pointer-events-none blur-[160px]"
            style={{
              opacity: castDesign.standbyBgGlowIntensity / 100,
              background: `radial-gradient(circle at 50% 40%, ${castDesign.standbyBgGlowColor}, ${castDesign.standbyBgColor} 70%)`,
            }}
          />
        )}
        {castDesign.standbyBgStyle === 'gradient' && (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(${castDesign.standbyBgGradientAngle}deg, ${castDesign.standbyBgGradientColors[0]}, ${castDesign.standbyBgGradientColors[1]})` }}
          />
        )}
        {(castDesign.standbyBgStyle === 'album_art' || castDesign.standbyBgStyle === 'custom_image') && (
          <>
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${
                  castDesign.standbyBgStyle === 'custom_image'
                    ? castDesign.standbyCustomBgImageUrl || track.highResCoverUrl || track.coverUrl
                    : track.highResCoverUrl || track.coverUrl
                })`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: `blur(${castDesign.standbyBgBlur}px) saturate(1.3)`,
                transform: 'scale(1.15)',
                opacity: castDesign.standbyBgOpacity / 100,
              }}
            />
            <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${castDesign.standbyBgOverlayOpacity / 100})` }} />
          </>
        )}

        {/* Time and date are independent positioned elements (own anchor,
            offset, size, color) — no longer one fixed block sharing
            clockSize/clockColor with a hardcoded reduced-opacity date. */}
        {castDesign.standbyShowTime && (
          <StandbyTimeText
            effect={castDesign.standbyTimeEffect}
            auroraColors={castDesign.standbyTimeAuroraColors}
            reflectDistance={castDesign.standbyTimeReflectDistance}
            reflectOpacity={castDesign.standbyTimeReflectOpacity}
            slicedGap={castDesign.standbyTimeSlicedGap}
            slicedVerticalGap={castDesign.standbyTimeSlicedVerticalGap}
            slicedColor={castDesign.standbyTimeSlicedColor}
            foldedSkew={castDesign.standbyTimeFoldedSkew}
            foldedRotation={castDesign.standbyTimeFoldedRotation}
            foldedCreaseSkew={castDesign.standbyTimeFoldedCreaseSkew}
            foldedOffset={castDesign.standbyTimeFoldedOffset}
            foldedBaseColor={castDesign.standbyTimeFoldedBaseColor}
            foldedTopColor={castDesign.standbyTimeFoldedTopColor}
            foldedBottomColor={castDesign.standbyTimeFoldedBottomColor}
            color={castDesign.standbyTimeColor}
            style={{
              ...anchoredStyle(castDesign.standbyTimeAnchorH, castDesign.standbyTimeAnchorV, castDesign.standbyTimeOffsetX, castDesign.standbyTimeOffsetY, 1),
              fontSize: castDesign.standbyTimeSize,
              letterSpacing: castDesign.standbyTimeLetterSpacing,
              textShadow: '0 4px 16px rgba(0,0,0,0.8)',
              fontFamily: resolveFontFamily(castDesign.standbyFontFamily, castDesign.customFonts),
            }}
          >
            {currentTime}
          </StandbyTimeText>
        )}
        {castDesign.standbyShowDate && (
          <div
            className="font-mono uppercase"
            style={{
              ...anchoredStyle(castDesign.standbyDateAnchorH, castDesign.standbyDateAnchorV, castDesign.standbyDateOffsetX, castDesign.standbyDateOffsetY, 1),
              fontSize: castDesign.standbyDateSize,
              letterSpacing: castDesign.standbyDateLetterSpacing,
              color: castDesign.standbyDateColor,
              textShadow: '0 4px 16px rgba(0,0,0,0.8)',
              fontFamily: resolveFontFamily(castDesign.standbyFontFamily, castDesign.customFonts),
            }}
          >
            {currentDate}
          </div>
        )}

        <div
          className="flex flex-col items-center gap-5"
          style={{
            ...anchoredStyle(castDesign.standbyClockAnchorH, castDesign.standbyClockAnchorV, castDesign.standbyClockOffsetX, castDesign.standbyClockOffsetY, 1),
            textShadow: '0 4px 16px rgba(0,0,0,0.8)',
            fontFamily: resolveFontFamily(castDesign.standbyFontFamily, castDesign.customFonts),
          }}
        >
          <span className="font-mono uppercase tracking-[0.3em]" style={{ fontSize: 15, color: standbyAccent }}>
            Standby
          </span>
          {castDesign.standbyShowTrack ? (
            <div className="mt-4 flex items-center gap-3 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3">
              <img src={track.coverUrl} alt={track.title} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
              <div className="text-left">
                <div className="font-bold" style={{ fontSize: 14, color: castDesign.clockColor }}>{track.title}</div>
                <div className="font-mono" style={{ fontSize: 12, color: castDesign.clockColor, opacity: 0.6 }}>{track.artist}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 font-mono" style={{ fontSize: 14, color: castDesign.clockColor, opacity: 0.45 }}>
              Gereed — start iets af om verder te gaan
            </div>
          )}

          {/* Read-only: the volume itself is already settable while nothing
              plays (the GPIO knob writes straight to the ALSA mixer via
              applyVolumeChange), standby just never showed the result. On a
              directly-wired amp that readout is the whole point — you set the
              level BEFORE the first note. Deliberately not a slider: the
              entire standby screen is a tap-to-wake target, so a stray touch
              would jump the volume to wherever the finger landed. */}
          {castDesign.standbyShowVolume && (
            <div className="mt-4 flex items-center gap-3" style={{ color: castDesign.clockColor }}>
              {playback.isMuted || playback.volume === 0 ? (
                <VolumeX size={18} className="text-rose-400" />
              ) : (
                <Volume2 size={18} style={{ color: standbyAccent }} />
              )}
              <div className="rounded-full overflow-hidden" style={{ width: 160, height: 6, background: 'rgba(255,255,255,0.15)' }}>
                <div
                  style={{
                    width: `${playback.isMuted ? 0 : fillPercent(playback.volume, 0, maxVolumeLimit)}%`,
                    height: '100%',
                    background: standbyAccent,
                    transition: 'width 200ms linear',
                  }}
                />
              </div>
              <span className="font-mono" style={{ fontSize: 13, opacity: 0.7 }}>
                {playback.isMuted ? 'Gedempt' : `${playback.volume}%`}
              </span>
            </div>
          )}
        </div>

        {/* Purely a visible hint — the whole screen already carries the
            onClick above, this just tells the viewer they can tap it.
            No handler of its own: it'd double-fire via bubbling anyway. */}
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 font-mono uppercase tracking-widest"
          style={{ bottom: 28, fontSize: 11, color: castDesign.clockColor, opacity: 0.35 }}
        >
          <Sun size={12} />
          Tik om te ontwaken
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-screen h-screen overflow-hidden flex flex-col justify-between select-none relative font-sans text-slate-100"
      style={{ backgroundColor: activeTheme.bgMain }}
    >
      {/* Dynamic Ambient Background Aura */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25 blur-[160px] transition-all duration-1000"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${dominantGlow}, ${activeTheme.bgMain} 70%)`,
        }}
      />

      {/* LAYOUT 5 background/overlay — rendered here (true full-screen root) rather than
          inside <main>, which has padding: an `absolute inset-0` in there was inset by
          that padding on every side, so the darkening overlay never reached the physical
          screen edges. This is the same layer, just anchored to the unpadded root. */}
      {layout === 'custom_design' && (
        <>
          {castDesign.bgStyle === 'solid' && (
            <div className="absolute inset-0" style={{ background: castDesign.bgColor }} />
          )}
          {(castDesign.bgStyle === 'album_art' || castDesign.bgStyle === 'custom_image') && (
            <>
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${
                    castDesign.bgStyle === 'custom_image'
                      ? castDesign.customBgImageUrl || track.highResCoverUrl || track.coverUrl
                      : track.highResCoverUrl || track.coverUrl
                  })`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: `blur(${castDesign.bgBlur}px) saturate(1.3)`,
                  transform: 'scale(1.15)',
                  opacity: castDesign.bgOpacity / 100,
                }}
              />
              <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${castDesign.bgOverlayOpacity / 100})` }} />
            </>
          )}
          {castDesign.bgStyle === 'glow' && (
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${castDesign.bgGlowColor}, transparent 70%)`,
                opacity: castDesign.bgGlowIntensity / 100,
              }}
            />
          )}
          {castDesign.bgStyle === 'gradient' && (
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(${castDesign.bgGradientAngle}deg, ${castDesign.bgGradientColors[0]}, ${castDesign.bgGradientColors[1]})` }}
            />
          )}
        </>
      )}

      {/* Live connection dot + (preview-only) exit — small and out of the way, not a bar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full animate-pulse shadow-md"
          style={{ backgroundColor: wsConnected ? '#10b981' : '#f43f5e' }}
        />
        {onExitCast && (
          <button
            onClick={onExitCast}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-white transition-all"
            title="Sluit Cast Kiosk"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* The only two on-screen buttons: Source and Info. Everything else lives behind
          a swipe (see handleTouchStart/End on <main>) so the kiosk stays uncluttered. */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        <button
          onClick={() => setIsSourcePickerOpen(true)}
          className="w-14 h-14 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 text-white flex items-center justify-center active:scale-90 transition-all shadow-xl"
          title="Bron kiezen"
        >
          <ArrowLeftRight className="w-6 h-6" />
        </button>
        <button
          onClick={() => setShowInfoModal(true)}
          className="w-14 h-14 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 text-white flex items-center justify-center active:scale-90 transition-all shadow-xl"
          title="Technische informatie"
        >
          <Info className="w-6 h-6" />
        </button>
      </div>

      {/* Crossfade Active Banner (If transitioning) */}
      {playback.systemStats.crossfadeActive && (
        <div className="relative z-20 px-6 py-2 bg-gradient-to-r from-indigo-950/90 via-purple-950/90 to-indigo-950/90 border-b border-indigo-500/30 flex items-center justify-between text-xs font-mono text-indigo-300 animate-fadeIn">
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 animate-pulse text-indigo-400" />
            <span>Crossfade Actief: Overvloeien naar volgende track...</span>
          </div>
          <span className="font-bold">{playback.systemStats.crossfadeProgressPct}%</span>
        </div>
      )}

      {/* MAIN VIEW AREA (LAYOUT SWITCHER) */}
      <main
        className="flex-1 relative z-10 p-4 sm:p-6 md:p-8 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* LAYOUT 1: KIOSK TOUCH CONTROLLER (Full Remote Control) */}
        {layout === 'kiosk_touch' && (
          <div className="w-full max-w-5xl h-full flex flex-col justify-between gap-6">
            {/* Top Row: Artwork + Large Track Metadata + Spectrum */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* Spinning 3D Vinyl / Jacket */}
              <div className="md:col-span-5 flex items-center justify-center">
                <div className="relative flex items-center justify-center">
                  <div
                    className={`w-44 h-44 sm:w-52 sm:h-52 md:w-60 md:h-60 rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-2 border-white/10 bg-black relative group transition-transform ${
                      playback.isPlaying ? 'scale-100' : 'scale-95'
                    }`}
                  >
                    <img
                      src={track.highResCoverUrl || track.coverUrl}
                      alt={track.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                  </div>
                  {/* Bron-badge onder de art, niet erover */}
                  <div className="mt-2.5 inline-flex bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-mono text-emerald-400 border border-emerald-500/30">
                    {sourceBadgeLabel}
                  </div>
                </div>
              </div>

              {/* Track Metadata & FFT Spectrum */}
              <div className="md:col-span-7 flex flex-col justify-center space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${activeTheme.accentColor}20`,
                        color: activeTheme.accentColor,
                      }}
                    >
                      Nu Afspelen op HiFi DAC
                    </span>
                    <span className="text-xs font-mono text-slate-500">{track.releaseYear}</span>
                  </div>
                  <h1
                    className="font-extrabold text-white mt-1 line-clamp-1"
                    style={{ fontSize: castDesign.titleSize, letterSpacing: castDesign.titleLetterSpacing, lineHeight: castDesign.titleLineHeight / 100 }}
                  >
                    {track.title}
                  </h1>
                  <p
                    className="text-slate-300 font-medium mt-1 line-clamp-1"
                    style={{ fontSize: castDesign.artistSize, letterSpacing: castDesign.artistLetterSpacing, lineHeight: castDesign.artistLineHeight / 100 }}
                  >
                    {track.artist}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {source === 'radio' ? 'Zender' : 'Album'}: <span className="text-slate-200">{track.album}</span>
                  </p>
                </div>

                {/* 16-Band Visualizer Bar */}
                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <SpectrumBars
                    values={playback.spectrum}
                    active={playback.isPlaying}
                    visualStyle={castDesign.spectrumStyle}
                    colors={activeTheme.spectrumGradient}
                    height={56}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Row: Scrubber + Big Touch Transport Buttons + Volume Bar */}
            <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-4 sm:p-5 backdrop-blur-xl space-y-3">
              {/* Progress Scrubber */}
              {controlsEnabled && (
                <div className="space-y-1">
                  <input
                    type="range"
                    min="0"
                    max={playback.durationMs || 100}
                    value={playback.positionMs}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: activeTheme.accentColor }}
                  />
                  <div className="flex justify-between text-xs font-mono text-slate-400">
                    <span>{formatTime(playback.positionMs)}</span>
                    <span>-{formatTime(Math.max(0, playback.durationMs - playback.positionMs))}</span>
                  </div>
                </div>
              )}

              {/* Transport Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Left: Queue Drawer & Source Switcher Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowQueueDrawer(!showQueueDrawer)}
                    className="px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-100 border border-white/20 flex items-center gap-2 text-xs font-mono transition-all active:scale-95"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '14px' }}
                  >
                    <ListMusic className="w-4 h-4" style={{ color: activeTheme.accentColor }} />
                    <span>Wachtrij</span>
                  </button>

                  <button
                    onClick={() => setShowDacSourceModal(true)}
                    className="px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-100 border border-white/20 flex items-center gap-2 text-xs font-mono transition-all active:scale-95"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '14px' }}
                  >
                    <Radio className="w-4 h-4" style={{ color: activeTheme.accentColor }} />
                    <span>DAC Output</span>
                  </button>

                  {/* Outside the controlsEnabled gate above on purpose: a
                      turntable/CD has no transport this app can drive, but
                      that's exactly the source you want to save a song from. */}
                  {castDesign.showLike !== false && (
                    <LikeButton track={likeTrack} likes={likes} size={18} variant="kiosk" />
                  )}
                </div>

                {/* Center: Playback Control, or a note when there's nothing controllable */}
                {controlsEnabled ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handlePrevious}
                      className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all active:scale-90"
                      style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '16px' }}
                      title="Vorige nummer"
                    >
                      <Rewind className="w-6 h-6" />
                    </button>

                    <button
                      onClick={handleTogglePlay}
                      className="p-4 rounded-3xl shadow-xl transition-transform active:scale-90 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${activeTheme.accentColor}, #4f46e5)`,
                        color: '#ffffff',
                        boxShadow: `0 0 25px ${activeTheme.accentColor}60`,
                        borderRadius: '24px',
                      }}
                      title={playback.isPlaying ? 'Pauze' : 'Afspelen'}
                    >
                      {playback.isPlaying ? (
                        <Pause className="w-7 h-7 text-white fill-white" />
                      ) : (
                        <Play className="w-7 h-7 text-white fill-white ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={handleNext}
                      className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all active:scale-90"
                      style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '16px' }}
                      title="Volgende nummer"
                    >
                      <FastForward className="w-6 h-6" />
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-mono text-slate-500">{idleControlsMessage}</span>
                )}

                {/* Right: Touch Volume Slider */}
                {controlsEnabled && castDesign.showVolume && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleToggleMute}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300"
                    >
                      {playback.isMuted || playback.volume === 0 ? (
                        <VolumeX className="w-5 h-5 text-rose-400" />
                      ) : (
                        <Volume2 className="w-5 h-5" style={{ color: activeTheme.accentColor }} />
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max={maxVolumeLimit}
                      value={playback.isMuted ? 0 : playback.volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      className="h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      style={{ accentColor: activeTheme.accentColor, width: castDesign.volumeSize }}
                    />
                    <span className="text-xs font-mono font-bold text-white w-10 text-right">
                      {playback.isMuted ? '0%' : `${playback.volume}%`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LAYOUT 2: ARTWORK FOCUS (Massive 3D Vinyl & Cover Art) */}
        {layout === 'artwork_focus' && (
          <div className="w-full max-w-4xl flex flex-col md:flex-row items-center justify-center gap-8 text-center md:text-left">
            {/* Spinning Vinyl Record + Album Sleeve */}
            <div className="relative flex items-center justify-center group">
              <div
                className={`w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-full bg-[#08080c] border-4 border-white/15 shadow-[0_25px_60px_rgba(0,0,0,0.95)] flex items-center justify-center relative transition-all duration-700 ${
                  playback.isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
                }`}
              >
                <div className="absolute inset-4 rounded-full border border-white/5" />
                <div className="absolute inset-8 rounded-full border border-white/5" />
                <div className="absolute inset-16 rounded-full border border-white/5" />

                {/* Center Label */}
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden border-2 border-white/20 relative shadow-2xl">
                  <img
                    src={track.highResCoverUrl || track.coverUrl}
                    alt={track.title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center p-2 text-center pointer-events-none">
                    <span className="text-[9px] font-bold text-white uppercase line-clamp-1">
                      {track.title}
                    </span>
                    <span className="text-[7px] text-indigo-300 font-mono">33⅓ RPM STEREO</span>
                  </div>
                  <div className="absolute w-4 h-4 rounded-full bg-black border border-white/30" />
                </div>
              </div>
            </div>

            {/* Info & Floating Play Button */}
            <div className="space-y-4 max-w-md">
              <span
                className="text-[11px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded-full"
                style={{
                  backgroundColor: `${activeTheme.accentColor}25`,
                  color: activeTheme.accentColor,
                }}
              >
                {sourceBadgeLabel}
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                {track.title}
              </h2>
              <p className="text-xl text-slate-300 font-medium">{track.artist}</p>
              <p className="text-xs text-slate-400 font-mono">{track.album} • {track.releaseYear}</p>

              {/* Big Touch Play Pause */}
              <div className="flex items-center gap-4 pt-2 justify-center md:justify-start">
                {!controlsEnabled ? (
                  <span className="text-xs font-mono text-slate-500">{idleControlsMessage}</span>
                ) : (
                  <>
                <button
                  onClick={handleTogglePlay}
                  className="px-6 py-3 rounded-2xl text-sm font-mono font-bold text-white flex items-center gap-2 shadow-xl active:scale-95 transition-transform"
                  style={{
                    backgroundColor: activeTheme.accentColor,
                    boxShadow: `0 0 25px ${activeTheme.glowColor}`,
                  }}
                >
                  {playback.isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                  <span>{playback.isPlaying ? 'PAUZEREN' : 'AFSPELEN'}</span>
                </button>

                <button
                  onClick={handleNext}
                  className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-transform"
                  title="Volgend nummer"
                >
                  <FastForward className="w-5 h-5" />
                </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LAYOUT 3: AUDIOPHILE SPECTRUM HUD */}
        {layout === 'audiophile_spectrum' && (
          <div className="w-full max-w-5xl h-full flex flex-col justify-between space-y-6">
            {/* Top Telemetry Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 bg-white/[0.03] border border-white/5 rounded-2xl">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">ALSA Routing</span>
                <span className="text-sm font-bold font-mono text-emerald-400 mt-0.5 block">
                  hw:{activeDac.name.split(' ')[0]} Direct
                </span>
              </div>
              <div className="p-3.5 bg-white/[0.03] border border-white/5 rounded-2xl">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">DAC Master Clock</span>
                <span className="text-sm font-bold font-mono text-indigo-300 mt-0.5 block">
                  24-bit / 44.1 kHz (Locked)
                </span>
              </div>
              <div className="p-3.5 bg-white/[0.03] border border-white/5 rounded-2xl">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Pi SoC Temp & Load</span>
                <span className="text-sm font-bold font-mono text-amber-400 mt-0.5 block">
                  {playback.systemStats.cpuTempC}°C ({playback.systemStats.cpuUsagePct}% load)
                </span>
              </div>
              <div className="p-3.5 bg-white/[0.03] border border-white/5 rounded-2xl">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Bit-Perfect Stream</span>
                <span className="text-sm font-bold font-mono text-cyan-400 mt-0.5 block">
                  320 kbps Extreme Vorbis
                </span>
              </div>
            </div>

            {/* Massive Full Spectrum Visualizer (32 bars) */}
            <div className="flex-1 bg-white/[0.02] border border-white/10 rounded-3xl p-6 flex flex-col justify-end">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-3">
                <span className="flex items-center gap-2">
                  <Activity className="w-4 h-4" style={{ color: activeTheme.accentColor }} />
                  REAL-TIME I2S FFT SPECTRUM ANALYZER
                </span>
                <span>31 Hz – 16 kHz</span>
              </div>

              <SpectrumBars
                values={playback.spectrum}
                opacity={1}
                visualStyle={castDesign.spectrumStyle}
                colors={activeTheme.spectrumGradient}
                glowColor={activeTheme.glowColor}
                height={176}
              />
            </div>

            {/* Quick Track & Transport Bar */}
            <div className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/10 rounded-2xl">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{track.title}</h4>
                  <p className="text-xs text-slate-400 font-mono truncate">{track.artist}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {controlsEnabled ? (
                  <button
                    onClick={handleTogglePlay}
                    className="px-5 py-2.5 rounded-xl text-xs font-mono font-bold text-white shadow-lg active:scale-95"
                    style={{ backgroundColor: activeTheme.accentColor }}
                  >
                    {playback.isPlaying ? 'PAUZEER' : 'SPEEL AF'}
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-slate-500">{idleControlsMessage}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LAYOUT 4: AMBIENT CLOCK & BACKDROP */}
        {layout === 'ambient_clock' && (
          <div className="flex flex-col items-center justify-center text-center space-y-6 max-w-xl">
            <span className="text-6xl sm:text-7xl md:text-8xl font-extrabold font-mono text-white tracking-tighter drop-shadow-2xl">
              {currentTime}
            </span>
            <span className="text-lg font-mono text-slate-300 uppercase tracking-widest">
              {currentDate}
            </span>

            {/* Currently Playing Card */}
            <div className="p-4 bg-white/[0.04] border border-white/10 rounded-3xl backdrop-blur-md flex items-center gap-4 text-left w-full shadow-2xl">
              <img
                src={track.coverUrl}
                alt={track.title}
                className="w-16 h-16 rounded-2xl object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider block">
                  {source === 'local'
                    ? 'Nu vanaf NAS'
                    : source === 'radio'
                    ? 'Nu op Web Radio'
                    : source === 'external'
                    ? `Nu op ${externalSource?.sourceLabel || 'externe bron'}`
                    : 'Nu op Spotify HSS'}
                </span>
                <h4 className="text-base font-bold text-white truncate mt-0.5">{track.title}</h4>
                <p className="text-xs text-slate-300 truncate">{track.artist}</p>
              </div>
              {controlsEnabled && (
                <button
                  onClick={handleTogglePlay}
                  className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white"
                >
                  {playback.isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                </button>
              )}
            </div>
          </div>
        )}

        {/* LAYOUT 5: EIGEN ONTWERP — fully driven by the Cast Content Editor's live settings */}
        {layout === 'custom_design' && (
          <div className="w-full h-full relative" style={{ minHeight: '68vh' }}>
            {/* Art / plaat — slides off-screen (toward its own anchor edge) while an
                external CD/LP source is re-recognizing a track, back in once found. */}
            <div
              style={anchoredStyle(
                activeArtAnchorH,
                activeArtAnchorV,
                activeArtOffsetX,
                activeArtOffsetY,
                castDesign.artZIndex,
                castDesign.transitionAnimation,
                castDesign.transitionAnimation && source === 'external' && externalSource?.status === 'recognizing',
              )}
            >
              <div style={{ pointerEvents: previewMode ? 'none' : undefined }}>
                {effectiveArtDisplayMode === 'vinyl' ? (
                  <VinylDisc
                    track={track}
                    size={activeArtSize}
                    spinning={effectiveSpinning}
                    accentColor={activeTheme.accentColor}
                    fillPct={activeFillPct}
                    holeSizePct={activeHoleSizePct}
                  />
                ) : effectiveArtDisplayMode === 'cd' ? (
                  <CdDisc
                    track={track}
                    size={activeArtSize}
                    spinning={effectiveSpinning}
                    accentColor={activeTheme.accentColor}
                    fillPct={activeFillPct}
                    holeSizePct={activeHoleSizePct}
                  />
                ) : (
                  <div
                    style={{
                      width: activeArtSize,
                      height: activeArtSize,
                      borderRadius: castDesign.artRadius,
                      overflow: 'hidden',
                      boxShadow: castDesign.artShadow ? '0 30px 80px rgba(0,0,0,0.65)' : 'none',
                    }}
                  >
                    <img src={track.highResCoverUrl || track.coverUrl} alt={track.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              {previewMode && <EditorSelectOverlay element="art" accentColor={activeTheme.accentColor} />}
            </div>

            {/* Titel / artiest */}
            <div
              style={{
                ...anchoredStyle(castDesign.textAnchorH, castDesign.textAnchorV, castDesign.textOffsetX, castDesign.textOffsetY, castDesign.textZIndex),
                width: castDesign.textWidth,
                maxWidth: '90vw',
                textAlign: castDesign.align === 'center' ? 'center' : 'left',
                fontFamily: resolveFontFamily(castDesign.fontFamily, castDesign.customFonts),
                textShadow: castDesign.textShadow ? '0 2px 10px rgba(0,0,0,0.8)' : 'none',
              }}
            >
              <div style={{ pointerEvents: previewMode ? 'none' : undefined }}>
                <span className="text-xs uppercase tracking-widest" style={{ color: activeTheme.accentColor }}>
                  {source === 'external'
                    ? `Nu op ${externalSource?.sourceLabel || 'externe bron'}`
                    : controlsEnabled
                    ? source === 'local'
                      ? 'Nu vanaf NAS'
                      : source === 'radio'
                      ? 'Nu op Web Radio'
                      : 'Nu op Spotify'
                    : source === 'spotify'
                    ? 'Gereed voor Spotify Connect'
                    : 'Wachten op bron'}
                </span>
                <h1
                  className="font-extrabold mt-2 line-clamp-2"
                  style={{
                    fontSize: castDesign.titleSize * 1.7,
                    color: castDesign.titleColor,
                    letterSpacing: castDesign.titleLetterSpacing,
                    lineHeight: castDesign.titleLineHeight / 100,
                  }}
                >
                  {track.title}
                </h1>
                <p
                  className="font-medium mt-1 line-clamp-1"
                  style={{
                    fontSize: castDesign.artistSize,
                    color: castDesign.artistColor,
                    letterSpacing: castDesign.artistLetterSpacing,
                    lineHeight: castDesign.artistLineHeight / 100,
                  }}
                >
                  {track.artist}
                </p>
              </div>
              {previewMode && <EditorSelectOverlay element="text" accentColor={activeTheme.accentColor} />}
            </div>

            {/* Frequentiespectrum — independently anchored, no longer tied to the text block's flow */}
            {castDesign.showSpectrum && (
              <div style={anchoredStyle(castDesign.spectrumAnchorH, castDesign.spectrumAnchorV, castDesign.spectrumOffsetX, castDesign.spectrumOffsetY, castDesign.spectrumZIndex)}>
                <div style={{ pointerEvents: previewMode ? 'none' : undefined }}>
                  {/* Idle spectrum data is flat/near-zero, and the isPlaying dim (0.25x)
                      stacks on top of the user's own Doorzichtigheid setting — while
                      positioning in the editor preview, that made the bars nearly
                      invisible. previewMode shows varied demo heights at full
                      brightness (still scaled by their chosen Doorzichtigheid, so
                      that slider's effect stays visible) instead. */}
                  <SpectrumBars
                    values={previewMode ? [45, 60, 85, 90, 75, 65, 80, 95, 70, 60, 55, 45, 35, 30, 25, 20] : playback.spectrum}
                    opacity={(previewMode ? 1 : playback.isPlaying ? 0.9 : 0.25) * (castDesign.spectrumOpacity / 100)}
                    visualStyle={castDesign.spectrumStyle}
                    colors={activeTheme.spectrumGradient}
                    align={castDesign.align}
                    width={castDesign.spectrumWidth}
                    height={castDesign.spectrumHeight}
                  />
                </div>
                {previewMode && <EditorSelectOverlay element="spectrum" accentColor={activeTheme.accentColor} />}
              </div>
            )}

            {/* Bedieningsknoppen — independently anchored; the "verbind eerst" hint
                renders in the same spot so it's never orphaned when controls hide. */}
            <div style={anchoredStyle(castDesign.controlsAnchorH, castDesign.controlsAnchorV, castDesign.controlsOffsetX, castDesign.controlsOffsetY, castDesign.controlsZIndex)}>
              <div style={{ pointerEvents: previewMode ? 'none' : undefined }} className="flex items-center gap-3">
                {controlsEnabled ? (
                  castDesign.showControls && (
                    <div className="flex items-center gap-3" style={{ justifyContent: castDesign.align === 'center' ? 'center' : 'flex-start' }}>
                      <button onClick={handlePrevious} className="rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-transform" style={{ padding: castDesign.controlsSize * 0.5 }}>
                        <Rewind size={castDesign.controlsSize} />
                      </button>
                      <button
                        onClick={handleTogglePlay}
                        className="rounded-2xl text-white shadow-xl active:scale-90 transition-transform"
                        style={{ background: activeTheme.accentColor, boxShadow: `0 0 24px ${activeTheme.accentColor}55`, padding: castDesign.controlsSize * 0.7 }}
                      >
                        {playback.isPlaying ? <Pause size={castDesign.controlsSize} className="fill-current" /> : <Play size={castDesign.controlsSize} className="fill-current" />}
                      </button>
                      <button onClick={handleNext} className="rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-transform" style={{ padding: castDesign.controlsSize * 0.5 }}>
                        <FastForward size={castDesign.controlsSize} />
                      </button>
                      {castDesign.showQueue && (
                        <button onClick={() => setShowQueueDrawer(true)} className="rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-transform" style={{ padding: castDesign.controlsSize * 0.5 }} title="Wachtrij">
                          <ListMusic size={castDesign.controlsSize} />
                        </button>
                      )}
                      {castDesign.showSourceSwitcher && (
                        <button onClick={() => setShowDacSourceModal(true)} className="rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-transform" style={{ padding: castDesign.controlsSize * 0.5 }} title="Bronkeuze">
                          <Radio size={castDesign.controlsSize} />
                        </button>
                      )}
                    </div>
                  )
                ) : source === 'external' ? (
                  <p className="font-mono text-xs text-slate-500">Alleen weergave — deze bron wordt niet door de Hub bediend</p>
                ) : (
                  <p className="font-mono text-xs text-slate-500">{idleControlsMessage}</p>
                )}
                {/* Buiten de controlsEnabled-tak hierboven: bij een platenspeler
                    of CD staat daar alleen een "niet bedienbaar"-tekst, en juist
                    dan wil je een nummer kunnen bewaren. */}
                {castDesign.showLike !== false && (
                  <LikeButton track={likeTrack} likes={likes} size={castDesign.controlsSize} variant="kiosk" />
                )}
              </div>
              {previewMode && <EditorSelectOverlay element="controls" accentColor={activeTheme.accentColor} />}
            </div>

            {/* Volumeregeling — independently anchored, own width */}
            {controlsEnabled && castDesign.showVolume && (
              <div style={anchoredStyle(castDesign.volumeAnchorH, castDesign.volumeAnchorV, castDesign.volumeOffsetX, castDesign.volumeOffsetY, castDesign.volumeZIndex)}>
                <div
                  className="flex items-center gap-2 rounded-xl bg-white/10 pl-2 pr-3"
                  style={{
                    paddingTop: castDesign.controlsSize * 0.3,
                    paddingBottom: castDesign.controlsSize * 0.3,
                    pointerEvents: previewMode ? 'none' : undefined,
                  }}
                >
                  <button onClick={handleToggleMute} className="text-white active:scale-90 transition-transform" title={playback.isMuted ? 'Dempen opheffen' : 'Dempen'}>
                    {playback.isMuted || playback.volume === 0 ? <VolumeX size={castDesign.controlsSize * 0.7} /> : <Volume2 size={castDesign.controlsSize * 0.7} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max={maxVolumeLimit}
                    value={playback.isMuted ? 0 : playback.volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: activeTheme.accentColor, width: castDesign.volumeSize }}
                  />
                </div>
                {previewMode && <EditorSelectOverlay element="volume" accentColor={activeTheme.accentColor} />}
              </div>
            )}

            {/* Voortgangsbalk — independently anchored, own width/height */}
            {castDesign.showProgress && (
              <div style={anchoredStyle(castDesign.progressAnchorH, castDesign.progressAnchorV, castDesign.progressOffsetX, castDesign.progressOffsetY, castDesign.progressZIndex)}>
                <div
                  style={{
                    width: castDesign.progressWidth,
                    height: castDesign.progressHeight,
                    borderRadius: castDesign.progressHeight,
                    background: 'rgba(255,255,255,0.15)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${playback.durationMs > 0 ? Math.min(100, Math.max(0, (playback.positionMs / playback.durationMs) * 100)) : 0}%`,
                      background: activeTheme.accentColor,
                      borderRadius: 'inherit',
                      transition: 'width 400ms linear',
                    }}
                  />
                </div>
                {previewMode && <EditorSelectOverlay element="progress" accentColor={activeTheme.accentColor} />}
              </div>
            )}

            {castDesign.showClock && castDesign.clockStyle === 'small' && (
              <div style={anchoredStyle(castDesign.clockAnchorH, castDesign.clockAnchorV, castDesign.clockOffsetX, castDesign.clockOffsetY, castDesign.clockZIndex)}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: castDesign.clockSize,
                    color: castDesign.clockColor,
                    letterSpacing: castDesign.clockLetterSpacing,
                    textShadow: castDesign.clockShadow ? '0 2px 10px rgba(0,0,0,0.8)' : 'none',
                    pointerEvents: previewMode ? 'none' : undefined,
                  }}
                >
                  {currentTime} · {currentDate}
                </span>
                {previewMode && <EditorSelectOverlay element="clock" accentColor={activeTheme.accentColor} />}
              </div>
            )}
            {castDesign.showClock && castDesign.clockStyle === 'large' && (
              <div style={anchoredStyle(castDesign.clockAnchorH, castDesign.clockAnchorV, castDesign.clockOffsetX, castDesign.clockOffsetY, castDesign.clockZIndex)}>
                <div style={{ textShadow: castDesign.clockShadow ? '0 4px 16px rgba(0,0,0,0.8)' : 'none', pointerEvents: previewMode ? 'none' : undefined }}>
                  <div className="font-extrabold" style={{ fontSize: castDesign.clockSize, color: castDesign.clockColor, letterSpacing: castDesign.clockLetterSpacing }}>
                    {currentTime}
                  </div>
                  <div
                    className="font-mono uppercase tracking-widest mt-1"
                    style={{ fontSize: Math.max(10, castDesign.clockSize * 0.35), color: castDesign.clockColor, opacity: 0.75 }}
                  >
                    {currentDate}
                  </div>
                </div>
                {previewMode && <EditorSelectOverlay element="clock" accentColor={activeTheme.accentColor} />}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL: DAC AUDIO SOURCE SWITCHER (Select Hardware Output) */}
      {showDacSourceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn">
          <div className="w-full max-w-lg bg-[#09090d] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Radio className="w-5 h-5" style={{ color: activeTheme.accentColor }} />
                <h3 className="text-lg font-bold text-white">DAC Audio Output Schakelen</h3>
              </div>
              <button
                onClick={() => setShowDacSourceModal(false)}
                className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white"
              >
                Sluiten
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Selecteer welke I2S DAC HAT of USB Audio Class interface direct op de Raspberry Pi geactiveerd moet worden:
            </p>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {audioDevices.map((device) => {
                const isSelected = device.id === playback.dacConfig.activeDeviceId;
                return (
                  <div
                    key={device.id}
                    onClick={() => handleSwitchAudioDevice(device.id)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-white/10 text-white font-bold shadow-lg ring-1'
                        : 'bg-white/[0.02] hover:bg-white/[0.06] border-white/5 text-slate-300'
                    }`}
                    style={{
                      borderColor: isSelected ? activeTheme.accentColor : 'rgba(255,255,255,0.07)',
                      // Tailwind's `ring-1` utility reads its color from this CSS
                      // custom property, not a `ringColor` style key (not real CSS).
                      ['--tw-ring-color' as any]: isSelected ? activeTheme.accentColor : 'transparent',
                    }}
                  >
                    <div>
                      <h4 className="text-sm font-bold">{device.name}</h4>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {device.chipset} • {device.type.toUpperCase()} • Max {device.maxBitDepth}-bit
                      </p>
                    </div>

                    {isSelected && (
                      <span
                        className="flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: `${activeTheme.accentColor}25`,
                          color: activeTheme.accentColor,
                        }}
                      >
                        <Check className="w-3.5 h-3.5" />
                        ACTIEF
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* DRAWER: PLAYLISTS & QUEUE BROWSER */}
      {showQueueDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn">
          <div className="w-full max-w-2xl bg-[#09090d] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <ListMusic className="w-5 h-5" style={{ color: activeTheme.accentColor }} />
                <h3 className="text-lg font-bold text-white">Afspeellijsten & Wachtrij</h3>
              </div>
              <button
                onClick={() => setShowQueueDrawer(false)}
                className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white"
              >
                Sluiten
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4">
              {/* Playlists Strip */}
              <div className="space-y-2">
                <span className="text-xs font-mono text-slate-400 font-bold uppercase tracking-wider">
                  Beschikbare Afspeellijsten
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {playlists.map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => handlePlayPlaylist(pl.id)}
                      className="p-3 bg-white/[0.02] hover:bg-white/[0.07] border border-white/5 rounded-2xl cursor-pointer transition-all flex items-center gap-3"
                    >
                      <img
                        src={pl.coverUrl}
                        alt={pl.name}
                        className="w-12 h-12 rounded-xl object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-white truncate">{pl.name}</h4>
                        <p className="text-[11px] text-slate-400">{pl.trackCount} tracks</p>
                      </div>
                      <Play className="w-4 h-4 text-emerald-400 mr-2" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Up Next Queue */}
              {playback.queue.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <span className="text-xs font-mono text-slate-400 font-bold uppercase tracking-wider">
                    Volgende Nummers in Wachtrij
                  </span>
                  <div className="space-y-1.5">
                    {playback.queue.map((t, idx) => (
                      <div
                        key={t.id || idx}
                        className="p-2.5 bg-white/[0.02] rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-slate-500 w-4">{idx + 1}</span>
                          <img
                            src={t.coverUrl}
                            alt={t.title}
                            className="w-8 h-8 rounded-lg object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="truncate">
                            <span className="font-bold text-white block truncate">{t.title}</span>
                            <span className="text-[11px] text-slate-400 truncate">{t.artist}</span>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">
                          {formatTime(t.durationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TECHNISCHE INFO — hardware + de nu afgespeelde media */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn">
          <div className="w-full max-w-lg bg-[#09090d] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Info className="w-5 h-5" style={{ color: activeTheme.accentColor }} />
                <h3 className="text-lg font-bold text-white">Technische Informatie</h3>
              </div>
              <button
                onClick={() => setShowInfoModal(false)}
                className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white"
              >
                Sluiten
              </button>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-mono text-slate-400 font-bold uppercase tracking-wider">Hardware</span>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {[
                  ['Pi Model', playback.systemStats.piModel],
                  ['OS', playback.systemStats.osVersion],
                  ['CPU Temp', `${playback.systemStats.cpuTempC}°C`],
                  ['CPU Load', `${playback.systemStats.cpuUsagePct}%`],
                  ['RAM', `${playback.systemStats.ramUsedMb} / ${playback.systemStats.ramTotalMb} MB`],
                  ['Uptime', formatUptime(playback.systemStats.uptimeSeconds)],
                  ['DAC', activeDac.name],
                  ['DAC Clock', playback.systemStats.dacClockLocked ? 'Locked' : 'Unlocked'],
                  ['ALSA Underruns', String(playback.systemStats.alsaUnderruns)],
                  ['Mixer Control', playback.dacConfig.hardwareMixerControl || '—'],
                  ['Buffer / Period', `${playback.dacConfig.bufferTimeMs}ms / ${playback.dacConfig.periodTimeMs}ms`],
                  ['Bit-Perfect', playback.dacConfig.bitPerfect ? 'Ja' : 'Nee'],
                  ['Resampling', playback.dacConfig.resamplingQuality],
                  ['Target Sample Rate', `${playback.dacConfig.targetSampleRate} Hz`],
                ].map(([label, value]) => (
                  <div key={label} className="p-2.5 bg-white/[0.03] border border-white/5 rounded-xl">
                    <span className="text-slate-500 block text-[10px] uppercase">{label}</span>
                    <span className="text-slate-200 font-semibold">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-white/5">
              <span className="text-xs font-mono text-slate-400 font-bold uppercase tracking-wider">Nu Afspelen</span>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {[
                  ['Titel', track.title],
                  ['Artiest', track.artist],
                  [source === 'radio' ? 'Zender' : 'Album', track.album],
                  ['Bron', source === 'local' ? 'NAS' : source === 'radio' ? 'Web Radio' : source === 'spotify' ? 'Spotify' : source === 'external' ? externalSource?.sourceLabel || 'Externe bron' : '—'],
                  ['Formaat', track.format || '—'],
                  ['Stream', `${playback.systemStats.streamBitDepth}-bit / ${playback.systemStats.streamSampleRate}Hz @ ${playback.systemStats.streamBitrate}kbps`],
                  ['Duur', formatTime(track.durationMs)],
                  ['Jaar', track.releaseYear || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="p-2.5 bg-white/[0.03] border border-white/5 rounded-xl">
                    <span className="text-slate-500 block text-[10px] uppercase">{label}</span>
                    <span className="text-slate-200 font-semibold truncate block">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SourcePicker leans on the shared admin-app CSS tokens (var(--bg-inset)
          etc.), which normally follow the admin's own light/dark preference —
          scoping data-theme here overrides that just for this subtree with
          the Nest Hub color theme actually chosen for this screen, matching
          the rest of the kiosk view instead of the admin page it's borrowed
          from. colors.css defines the same theme names/colors as THEME_PRESETS. */}
      <div data-theme={themeId}>
        <SourcePicker isOpen={isSourcePickerOpen} onClose={() => setIsSourcePickerOpen(false)} scale={castDesign.sourcePickerScale} />
      </div>
    </div>
  );
};
