repo: ekoppen/HSS-HiddenSoundSystem
branch: main

## Last sync
date: 2026-08-18T19:29:24Z

### Updated in this project
- Read Header.tsx, NowPlaying.tsx, PlaylistManager.tsx, ThemeCustomizerModal.tsx, themeManager.ts, types.ts, index.css
- Read NestHubCastManager.tsx, NestHubCastView.tsx (cast configurator + kiosk display layouts)
- Rebuilt tokens, core components (incl. Toggle), and a UI kit for 4 screens against this source

## Screen map
| Design system item | Source file(s) |
|---|---|
| tokens/colors.css (4 themes) | src/services/themeManager.ts |
| ui_kits/soloist-hub/NowPlayingScreen.jsx | src/components/NowPlaying.tsx |
| ui_kits/soloist-hub/MediaCenterScreen.jsx | src/components/PlaylistManager.tsx |
| ui_kits/soloist-hub/ThemeCustomizerModalContent.jsx | src/components/ThemeCustomizerModal.tsx |
| ui_kits/soloist-hub/AppShell.jsx | src/components/Header.tsx |
| CastDesignScreen (in index.html) | src/components/NestHubCastManager.tsx, NestHubCastView.tsx |
