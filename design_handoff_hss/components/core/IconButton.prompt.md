IconButton — toolbar and transport controls (shuffle, repeat, mute, cast trigger).

```jsx
<IconButton icon={<Shuffle size={18}/>} active={shuffle} onClick={toggleShuffle} title="Shuffle" />
```

Active state uses the accent soft-fill, not a glow — keep it legible at a glance from across the room.
