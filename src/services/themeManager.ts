import { ThemeConfig, ThemeId } from '../types';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(99,102,241,${alpha})`; // falls back to obsidian's glow if the color is malformed
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Resolves the theme's accentColor/glowColor against the design's accent
// override (see CastSettings.accentMode in types.ts) — the single point both
// the Cast Designer and the live receiver call so an override applies
// everywhere accentColor is used (text, buttons, borders, glow) at once.
export function resolveThemeAccent(
  theme: ThemeConfig,
  accentMode: 'theme' | 'custom' | 'auto_albumart' | undefined,
  customAccentColor: string | undefined,
  dominantColor: string | undefined
): ThemeConfig {
  const accentColor =
    accentMode === 'custom' && customAccentColor
      ? customAccentColor
      : accentMode === 'auto_albumart' && dominantColor
        ? dominantColor
        : theme.accentColor;
  if (accentColor === theme.accentColor) return theme;
  return { ...theme, accentColor, glowColor: hexToRgba(accentColor, 0.35) };
}

// Four refined "premium consumer audio" themes — see design_handoff_hss/
// for the full token set. bgMain/accentColor/glowColor/spectrumGradient are kept
// here only for the standalone Nest Hub kiosk view, which renders outside the
// main app shell and can't rely on the data-theme CSS scope.
export const THEME_PRESETS: Partial<Record<ThemeId, ThemeConfig>> = {
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian Indigo',
    description: 'Diep antraciet met een indigo accent — het standaard thema.',
    bgMain: '#08090c',
    accentColor: '#6366f1',
    glowColor: 'rgba(99,102,241,0.35)',
    spectrumGradient: ['#4f46e5', '#6366f1', '#38bdf8'],
  },
  slate: {
    id: 'slate',
    name: 'Nordic Slate',
    description: 'Strakke Scandinavische studio-esthetiek met leisteen en ijsblauw.',
    bgMain: '#07090c',
    accentColor: '#4fa3c7',
    glowColor: 'rgba(79,163,199,0.35)',
    spectrumGradient: ['#3b87aa', '#4fa3c7', '#8fd4ec'],
  },
  emerald: {
    id: 'emerald',
    name: 'Spotify Emerald',
    description: 'Donker antraciet met smaragdgroen accent.',
    bgMain: '#06100c',
    accentColor: '#10b981',
    glowColor: 'rgba(16,185,129,0.4)',
    spectrumGradient: ['#0c9268', '#10b981', '#6ee7b7'],
  },
  copper: {
    id: 'copper',
    name: 'Vintage Tube',
    description: 'Warme buizenversterker gloed met koper en walnoothout.',
    bgMain: '#0c0906',
    accentColor: '#c8781f',
    glowColor: 'rgba(200,120,31,0.4)',
    spectrumGradient: ['#a8631a', '#c8781f', '#eab06a'],
  },
  // Daylight (web-admin-only) is deliberately absent here: title/artist/
  // clock colors on the Nest Hub kiosk are separately user-configured per
  // design (Cast Designer), defaulting to white — flipping bgMain to light
  // without also knowing whether those were customized risks white-on-white
  // text. Every lookup below already falls back to obsidian, so selecting
  // Daylight in the picker re-themes the web UI and leaves the kiosk as-is.
};

export const DEFAULT_THEME: ThemeId = 'obsidian';

export function applyTheme(themeId: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', themeId);
}

export function getStoredThemeId(): ThemeId {
  return DEFAULT_THEME;
}

export function saveThemeId(themeId: ThemeId): void {
  applyTheme(themeId);
  if (typeof window === 'undefined') return;
  fetch('/api/user/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeTheme: themeId }),
  }).catch(() => {});
}

export function getThemeConfig(themeId: ThemeId): ThemeConfig {
  return THEME_PRESETS[themeId] || THEME_PRESETS[DEFAULT_THEME]!;
}
