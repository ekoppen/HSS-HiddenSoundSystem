# Soloist HiFi Hub — Design System

Design system for **Raspberry Pi Soloist HiFi Hub**, a self-hosted music streaming controller that runs
on a Raspberry Pi with a DAC HAT. It plays audio from Spotify Connect, web radio and local/NAS files, casts
its now-playing display to a Google Nest Hub, and exposes REST/WebSocket APIs. The web UI is the only visible
control surface for what is otherwise an "invisible" streamer — this system exists to make that control surface
calm, legible from across a room, and consistent across the product's switchable color themes.

**Source:** `ekoppen/HSS-HiddenSoundSystem` (GitHub, private). Rebuilt from the real `src/`
codebase — `Header.tsx`, `NowPlaying.tsx`, `PlaylistManager.tsx`, `ThemeCustomizerModal.tsx`,
`themeManager.ts`, `types.ts`.

## What changed from the original UI

The original interface used six neon/glassmorphism themes with heavy drop-shadow glows, gradient badges and
a very high density of mono-font chips. This system keeps the product's defining idea — **switchable color
themes** and a **compact, technical, audiophile register** (mono readouts for bitrate/sample-rate/dB) — but
grounds it in a calmer, more premium "consumer audio" register (think Sonos/Devialet): flat surfaces, soft
ambient shadows instead of glow, one accent color per theme used deliberately, and four refined themes instead
of six.

## Index

- `styles.css` — the single global CSS entry point (import this).
- `tokens/` — colors (4 themes + shared status colors), typography, spacing, radius/shadow/motion.
- `components/` — reusable primitives: `core` (Button, IconButton, Badge), `surfaces` (Card, Modal),
  `navigation` (Tabs), `forms` (Slider), `feedback` (ProgressBar), `data` (SpecStat, SpectrumBars),
  `theme` (ThemeSwitchCard).
- `guidelines/` — color/type/spacing/radius/iconography specimen cards.
- `ui_kits/soloist-hub/` — interactive recreation of Nu Afspelen, Media Center & Radio, and the Thema picker.

## Content fundamentals

- **Language:** Dutch, informal "je" register throughout ("Kies een visuele stijl...", "Selecteer 'HSSwoonkamer'
  in je Spotify app"). Keep new copy in the same register — direct, second person, no marketing tone.
- **Voice:** technical and matter-of-fact. Status lines read like a hardware readout ("CPU 47°C (12% load)",
  "24-bit / 44.1kHz"), not conversational copy.
- **Casing:** sentence case for headings/body; UPPERCASE only for short mono labels/buttons that mirror a
  hardware panel ("SPEEL ALLES AF", "ACTIEF").
- **Emoji:** the original UI used emoji as inline bullets (🟢, 📻, 📁) inside labels — this system drops that in
  favor of a small Lucide icon + text, which reads better at a distance and scales with theme color. No emoji
  in this design system.

## Visual foundations

- **Color:** dark-only (this runs on a home-audio display, always viewed in a dim room). Four selectable
  themes (Obsidian Indigo default, Nordic Slate, Spotify Emerald, Vintage Tube/Copper), each a `data-theme`
  scope with the same token names — layouts never hardcode a hue. One accent color per theme; a shared
  success/warning/danger triad stays constant across themes so status meaning never shifts.
- **Type:** General Sans (UI text: display/title/body/labels) + Fira Code (mono, reserved for numeric/technical
  values only — bitrate, sample rate, dB, timestamps, hardware IDs). Never mix mono into headings or prose.
- **Spacing:** 4px grid, generous by default (`--space-6`/24px+ around major groups) — the product is dense
  with data, so whitespace is what keeps it from feeling like a debug console.
- **Backgrounds:** flat, no full-bleed imagery, no gradients as backgrounds. Album/station art is the only
  imagery; everything else is solid token colors.
- **Shadow & elevation:** soft ambient shadows only (`--shadow-card`, `--shadow-elevated`). No neon glow —
  the one exception is `--shadow-accent-glow`, reserved for the single primary transport action (play button)
  per screen.
- **Borders:** 1px, low-opacity white/tint borders (`--border-subtle` → `--border-strong`) for separating
  surfaces; never a colored "accent left-border" card.
- **Radius:** 8–22px scale (`--radius-sm` → `--radius-xl`), generous but not fully rounded — pill radius
  (`--radius-full`) is reserved for progress tracks and sliders.
- **Motion:** fast, functional transitions only (120–200ms, `--ease-standard`) on hover/active/theme swap.
  No bounce, no entrance animations — this is a control surface, not a marketing site.
- **Hover/press:** hover raises to `--bg-card-hover` or tints with `--accent-soft`; press states use a subtle
  scale (0.97) on buttons. No color inversion.
- **Density:** compact/technical, matching the original — multiple stat readouts per row, tabs and toolbars
  stay information-dense — but grouped and spaced so it doesn't read as cluttered.

## Iconography

[Lucide](https://lucide.dev), loaded from CDN (`unpkg.com/lucide`). 1.5–2px stroke, no fill except on the
play/pause glyph. Sizes: 13–14px inline/labels, 16–18px toolbar/transport, 20–28px feature/empty states. No
emoji, no icon font, no custom SVG icon set — the original codebase used `lucide-react` throughout, so this
continues that exact system. See `guidelines/iconography.card.html` for the working subset used across the
kit.

## Intentional additions

None of the components above invent UI the original app doesn't have — SpecStat, SpectrumBars and
ThemeSwitchCard formalize repeated inline patterns (label/value readouts, the 16-band meter, the theme grid
tile) that appeared ad-hoc in the source into reusable primitives.

## Caveats

- Only 4 of the original 6 themes were rebuilt (Tokyo Midnight / synthwave-violet and OLED Gold were dropped
  per the "premium consumer audio, 3–4 themes" direction) — say the word if you'd like either restored.
- Only 3 of the 8 app screens were rebuilt into the UI kit (Nu Afspelen, Media Center & Radio, Thema picker),
  per your priority pick. The other 5 (Cast & Smart Display, Volume & DAC, Geavanceerde Audio & EQ, Spotify &
  Instellingen, Script Center, WebSocket Stream) use the same tokens/components but aren't laid out yet.
- No logo — wordmark + the existing Radio icon, per your answer. If a mark exists, send it over.
