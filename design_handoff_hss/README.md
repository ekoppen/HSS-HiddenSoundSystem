# Handoff: Soloist HiFi Hub — Design System & Cast Editor

## Overview
Redesign of the web control UI for **Raspberry Pi Soloist HiFi Hub**, a self-hosted music streaming
controller (Spotify Connect, web radio, local/NAS) running on a Raspberry Pi with a DAC HAT. It casts
its now-playing display to a Google Nest Hub. This is the only visible control surface for an otherwise
"invisible" streamer.

Source repo: `ekoppen/HSS-HiddenSoundSystem` (branch `main`). Rebuilt from the real `src/`
components (`Header.tsx`, `NowPlaying.tsx`, `PlaylistManager.tsx`, `ThemeCustomizerModal.tsx`,
`themeManager.ts`, `NestHubCastManager.tsx`, `NestHubCastView.tsx`) — see `github.md` for the sync record.

## About the Design Files
The files in this bundle are **design references built in HTML/JS with React (no build step)** — they
render directly in a browser via CDN `<script>` tags and a hand-rolled JSX transform. They are NOT
production code to copy verbatim. The task is to **recreate these designs inside the existing Soloist
HiFi Hub React/TypeScript codebase**, using its existing component patterns, state management and API
wiring — porting layout, styling and interaction design, not the file structure.

## Fidelity
**High-fidelity.** Colors, type, spacing and component styling are final (all values are CSS custom
properties, listed below) — implement pixel-for-pixel. Screen content (track titles, playlist data,
device names) is illustrative placeholder data; wire it to the app's real state/APIs.

## What changed from the original UI
The original interface used six neon/glassmorphism themes with heavy drop-shadow glows, gradient badges
and dense mono-font chips. This redesign keeps the product's core idea — **switchable color themes** and
a **compact, technical, audiophile register** (mono readouts for bitrate/sample-rate/dB) — but grounds it
in a calmer "premium consumer audio" register (Sonos/Devialet-like): flat surfaces, soft ambient shadows
instead of glow, one deliberate accent color per theme, and four refined themes instead of six.

## Screens / Views

### 1. App Shell (`ui_kits/soloist-hub/AppShell.jsx`)
Left sidebar navigation, replacing the original's horizontal wrapping tab row.
- **Layout**: `display:flex` row. Sidebar `width:232px`, `flex-shrink:0`, full height, `background: var(--bg-surface)`, right border `1px solid var(--border-subtle)`. Content area `flex:1`.
- **Sidebar header** (`padding: 24px 20px 20px`): 38×38px icon tile (`border-radius: var(--radius-md)`, `background: var(--accent-soft)`) with the Radio icon (`color: var(--accent)`), next to wordmark "Soloist Hub" (`var(--text-title)`, size 16) + a small "v2.4" pill badge, and "Raspberry Pi 5" subtitle in `var(--text-mono-sm)`.
- **Nav list** (`padding: 4px 12px`, `gap: 2px`): one button per tab — 8 tabs total (Nu Afspelen, Cast & Smart Display, Volume & DAC Output, Media Center & Radio, Geavanceerde Audio & EQ, Spotify & Instellingen, Raspberry Pi Script Center, Live WebSocket Stream). Each: icon (16px) + label, `padding: 10px 12px`, `border-radius: var(--radius-md)`. Active state: `background: var(--accent-soft)`, `color: var(--accent)`, `border: 1px solid var(--accent-soft-strong)`. Inactive: transparent, `color: var(--text-secondary)`.
- **Sidebar footer** (`padding:12px`, top border): "Thema" button (opens the theme picker modal — see Modal below) styled like a secondary button; below it a small live status line ("CPU 47°C · 320kbps") with a status-dot.
- **Content header**: `padding: 16px 32px`, bottom border, shows the active tab's label (left) and a "Live WebSocket verbonden" status pill (right, success-colored).
- **Main content**: `max-width: 1080px`, `padding: 28px 32px 60px`.

### 2. Nu Afspelen / Now Playing (`ui_kits/soloist-hub/NowPlayingScreen.jsx`)
- **Layout**: one `Card` (padding 0) containing a two-column grid `minmax(180px,280px) 1fr`, gap 32, padding 32.
- **Left column**: album art slot 232×232 (`border-radius: var(--radius-lg)`) with a status badge overlay (top-left) reading "SPOTIFY HD" (success) or "STANDBY" (neutral) depending on play state. Below it, a row of two `SpecStat` readouts (Bitrate, DAC) inside a `var(--bg-inset)` strip.
- **Right column** (flex column, `justify-content: space-between`, gap 20):
  - Eyebrow label ("Nu Wordt Afgespeeld"/"Gepauzeerd", `var(--accent)`, uppercase) + a Cast icon button, top-right.
  - Track title (`var(--text-display)`, 32px), artist (`var(--text-subtitle)`), album/label line (`var(--text-mono-sm)`, muted).
  - "REAL-TIME I2S FREQUENTIE SPECTRUM" label + a 16-band `SpectrumBars` meter (real component, animates via `setInterval` when playing — replace with the real FFT/WebSocket feed).
  - Seek `Slider` showing elapsed/remaining time in mono.
  - Transport row (centered, wraps on narrow widths): Shuffle → Rewind → Play/Pause (56px circular, `background: var(--accent)`, `box-shadow: var(--shadow-accent-glow)` — the ONE glow allowed in this system) → FastForward → Repeat.
  - Volume row: icon + `Slider` + `NN%` mono label.
- **Queue card** below: "Volgende in Wachtrij (N)" header with `ListMusic` icon, then a 3-column grid of track rows (index, 34×34 art thumbnail, title/artist, duration).

### 3. Cast & Smart Display — settings screen (`ui_kits/soloist-hub/index.html`, function `CastDesignScreen`)
Entry point for the Cast tab. Global/functional settings, NOT visual design (that's the separate editor below).
- **Header card**: Tv icon + "Cast & Smart Display" title, subtitle, status badge.
- **Two-column grid** below (`1fr 1fr`, gap 24):
  - Left column, three cards:
    1. **"1. Cast apparaat"** — list of paired Nest Hub devices (name, IP, model), selectable rows with a checkmark on the active one.
    2. **"2. Weergave layout"** — 2×2 grid of layout-preset cards (Touch Kiosk Controller / Artwork Focus / Audiophile Spectrum HUD / Ambient Klok & Track), each with name + one-line description.
    3. **"3. Automatisering"** — two `Toggle`s: "Automatisch casten bij afspelen" and "Automatisch stoppen bij pauze" (functional/global settings — kept OUT of the content editor per explicit user direction).
  - Right column: **live device-shaped preview** (16:10 box mimicking the Nest Hub screen) reflecting the selected device/layout, plus action buttons "Cast naar {device}" (primary) and "Test in browser" (secondary), and a secondary "Inhoud & vormgeving bewerken" button that opens the content editor (function `CastContentEditor`) as a full-screen overlay.

### 4. Cast content/visual editor (`ui_kits/soloist-hub/index.html`, function `CastContentEditor`)
Opens as a full-screen overlay (`position:fixed; inset:0; z-index:60`) with its own sticky header (title + close ✕). This is the actual **visual design surface** — everything about how content looks (not device/automation logic).
- **Layout**: two-column grid, `1fr 340px`, gap 24.
- **Left: live preview card** — a 16:10 box re-rendering the now-playing content live as controls change: album-art size/radius/shadow, background style, text alignment/size, an inner glow effect, and which screen elements (spectrum, controls, queue button, source switch, clock) are visible.
- **Right: control panels**, one `Card` per group:
  - **Achtergrond**: 3-way segmented control — Effen (solid) / Gloed (radial accent glow) / Verloop (gradient).
  - **Album art**: `Slider` for size (48–140px) and corner radius (0–32px), `Toggle` for drop shadow.
  - **Tekst & uitlijning**: 2-way segmented (Links/Gecentreerd), `Slider` for title font size (14–32px).
  - **Effecten**: `Toggle` for an inner-edge accent glow.
  - **Schermelementen**: 5 `Toggle`s — Frequentiespectrum, Bedieningsknoppen, Wachtrij-knop, Bronkeuze (DAC output), Klok & datum. These are visual/what's-shown-on-screen choices, distinct from the automation toggles on the settings screen.
- A small reusable `SegButton` inline component implements the segmented controls (active state: `background: var(--accent-soft)`, `border-color: var(--accent-soft-strong)`, `color: var(--accent)`).

### 5. Media Center & Radio (`ui_kits/soloist-hub/MediaCenterScreen.jsx`)
Source switcher (Spotify Playlists / Web Radio / Lokale & NAS Muziek / Wachtrij) as a segmented control
inside a header card. Spotify view: two-column layout — playlist list (left) + selected playlist detail
with track list (right). Web Radio view: search bar + station grid. Local/NAS and Queue are placeholder
states reusing the same card/list patterns.

### 6. Theme picker modal (`ui_kits/soloist-hub/ThemeCustomizerModalContent.jsx` + `components/surfaces/Modal.jsx`)
Standard `Modal` (see Design Tokens/Components) containing a 2×2 grid of `ThemeSwitchCard` tiles (one per
theme: Obsidian Indigo, Nordic Slate, Spotify Emerald, Vintage Tube). Selecting one sets `data-theme` on
`<html>` immediately — swap this for a real theme-persistence call.

## Interactions & Behavior
- Sidebar nav: click to switch tabs, no transition needed beyond the existing `120ms` background/color fade.
- Play/Pause button toggles playing state; while playing, `SpectrumBars` values re-randomize every ~700ms (stub — wire to the real FFT feed) and position advances.
- Sliders (volume, seek, EQ, art size/radius, title size) are native `<input type="range">` under a styled track/knob — drag to change; no separate commit step.
- Toggles: click anywhere on the row (label + switch) to flip; switch animates the knob position over `120ms`.
- Theme picker: click a tile to apply immediately (no separate "Apply" step) — matches the original app's behavior.
- Cast content editor: opens as a full-screen overlay via the "Inhoud & vormgeving bewerken" button; closes via the ✕ in its own sticky header. All its controls update the live preview in real time, no separate save step in this prototype — add persistence when wiring to the real cast-config API.
- No skeleton/loading or error states are designed yet — ask before building extensive ones; keep them minimal and on-brand (flat, muted mono text) if needed sooner.

## State Management
Illustrative `useState` in this prototype — replace with the app's real state layer:
- Now Playing: `isPlaying`, `shuffle`, `repeat`, `volume`, `position`, `spectrum[]` (16 values).
- Media Center: `source` (spotify/radio/local_nas/queue), `selectedPlaylist` index.
- Cast settings: `deviceId`, `layout`, `autoCast.{onPlay,onPause}`.
- Cast content editor: `artSize`, `artRadius`, `artShadow`, `bgStyle`, `align`, `titleSize`, `glow`, `els.{spectrum,controls,queue,sourceSwitch,clock}` — this shape is a reasonable starting point for a `castDisplayConfig` object persisted per device.
- Theme: single `theme` string driving `data-theme` on the root element — mirrors the existing `themeManager.ts` pattern in the source repo.

## Design Tokens
All in `tokens/*.css`, composed via `styles.css`. Full token names — use these exactly, don't invent new ones.

**Colors** (`tokens/colors.css`) — 4 themes as `[data-theme="obsidian|slate|emerald|copper"]` scopes, each defining: `--bg-page`, `--bg-surface`, `--bg-card`, `--bg-card-hover`, `--bg-inset`, `--border-subtle`, `--border-default`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-active`, `--accent-soft`, `--accent-soft-strong`, `--on-accent`, `--meter-1/2/3`. Shared across all themes: `--status-success` (#34d399), `--status-warning` (#f59e0b), `--status-danger` (#fb7185), `--status-live`.

**Typography** (`tokens/typography.css`) — General Sans (UI text) + Fira Code (mono, numeric/technical values only): `--text-display` (600 32px), `--text-title` (600 20px), `--text-subtitle` (500 15px), `--text-body` (400 14px), `--text-body-strong` (600 14px), `--text-label` (600 11px, `--letter-label: 0.08em`, uppercase), `--text-mono-lg` (500 18px), `--text-mono` (500 12px), `--text-mono-sm` (500 11px).

**Spacing** (`tokens/spacing.css`) — 4px grid: `--space-1` through `--space-16` (4/8/12/16/20/24/32/40/48/64px).

**Effects** (`tokens/effects.css`) — `--radius-sm` 8px, `--radius-md` 12px, `--radius-lg` 16px, `--radius-xl` 22px, `--radius-full`; `--shadow-card`, `--shadow-elevated` (soft ambient only), `--shadow-accent-glow` (the ONE glow, reserved for the primary play button); `--ease-standard`, `--duration-fast` 120ms, `--duration-base` 200ms, `--duration-slow` 400ms.

## Components
Reusable primitives, each with a JSX reference implementation + a plain-JS render in `components-bundle.js` (used because the prototype has no build step — your React app should use the `.jsx` versions as the porting reference, not the bundle):
- `components/core/Button.jsx` — variants primary/secondary/ghost/danger, sizes sm/md.
- `components/core/IconButton.jsx` — icon-only, active state.
- `components/core/Badge.jsx` — variants accent/success/warning/danger/neutral.
- `components/core/Toggle.jsx` — on/off switch with optional label+description.
- `components/surfaces/Card.jsx` — base surface, optional hoverable state.
- `components/surfaces/Modal.jsx` — overlay dialog, header/body/footer.
- `components/navigation/Tabs.jsx` — (superseded by the sidebar nav for primary navigation, but kept for any secondary in-page tab needs).
- `components/forms/Slider.jsx` — range control.
- `components/feedback/ProgressBar.jsx` — determinate progress.
- `components/data/SpecStat.jsx` — label-over-mono-value readout.
- `components/data/SpectrumBars.jsx` — 16-band meter.
- `components/theme/ThemeSwitchCard.jsx` — theme picker tile.
Each `.jsx` file has a matching `.d.ts` (prop types) and `.prompt.md` (usage note) alongside it.

## Iconography
Vendored local stroke-icon set (`icons.js`, plain SVG React components, `24×24` viewBox, `strokeWidth:2`,
matches Lucide's visual weight — the original codebase used `lucide-react`, so prefer swapping in the real
`lucide-react` package in the target codebase rather than this vendored stand-in). Sizes: 13–14px inline,
16–18px toolbar/transport, 20–28px feature/empty states. No emoji anywhere.

## Assets
- `image-slot.js` — a drag-and-drop placeholder component used for album art in this prototype only (lets a
  reviewer drop a test image). Not for production — replace with the app's real artwork URLs/`<img>`.
- No logo/wordmark asset — "Soloist Hub" is set in type next to the existing Radio icon (no brand mark yet).

## Files
- `styles.css` + `tokens/*.css` — design tokens, single source of truth for all values above.
- `components/**/*.jsx` (+ `.d.ts`, `.prompt.md`) — component reference implementations.
- `components-bundle.js`, `icons.js` — plain-JS runtime versions used only so this HTML prototype runs
  without a build step; not meant to be ported as-is.
- `ui_kits/soloist-hub/index.html` — the full interactive prototype (App shell, all four built screens,
  theme modal, cast settings + cast content editor). This is the primary reference for exact JSX/layout —
  read it alongside the individual `.jsx` files, since `CastDesignScreen`/`CastContentEditor`/`App` only
  exist inlined in this file (not yet split into standalone `.jsx` files).
- `ui_kits/soloist-hub/AppShell.jsx`, `NowPlayingScreen.jsx`, `MediaCenterScreen.jsx`,
  `ThemeCustomizerModalContent.jsx` — standalone versions of those 4 screens.
- `design-system-readme.md` — the design system's own rationale doc (visual foundations, content voice/tone,
  caveats on what was intentionally scoped down from the original 6-theme/8-screen app).
- `github.md` — sync record of which source-repo files this design was built from.

## Caveats carried over from the design phase
- Only 4 of the original app's 6 color themes were rebuilt (Tokyo Midnight and OLED Gold were dropped).
- Only 4 of 8 app screens are designed (Nu Afspelen, Cast & Smart Display incl. content editor, Media
  Center & Radio, Theme picker). The other 4 (Volume & DAC Output, Geavanceerde Audio & EQ, Spotify &
  Instellingen, Raspberry Pi Script Center, Live WebSocket Stream) should reuse these same tokens/components.
- Cast device list, layout presets, and playlist/track data are all placeholder — wire to real APIs.
