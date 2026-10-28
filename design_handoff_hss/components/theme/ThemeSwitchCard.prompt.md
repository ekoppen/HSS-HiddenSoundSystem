ThemeSwitchCard — one tile in the theme picker grid.

```jsx
<ThemeSwitchCard themeId="slate" active={current === 'slate'} onSelect={setTheme} />
```

Render one per theme in a 2-column grid. Selected state uses an inset accent-colored ring, not a glow — legible even on the emerald/copper themes where a glow would clash.
