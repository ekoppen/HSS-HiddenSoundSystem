SpectrumBars — 16-band real-time meter, driven by the ALSA/WebSocket spectrum feed.

```jsx
<SpectrumBars values={playback.spectrum} active={isPlaying} />
```

Uses the theme's 3-stop meter gradient (`--meter-1/2/3`), not the accent color directly — keeps it readable even on the copper/emerald themes.
