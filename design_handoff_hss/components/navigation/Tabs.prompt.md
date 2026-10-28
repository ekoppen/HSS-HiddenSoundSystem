Tabs — the app's primary section switcher, shown in the header.

```jsx
<Tabs items={[{id:'player', label:'Nu Afspelen', icon:<Radio size={14}/>}]} activeId="player" onChange={setTab} />
```

Active tab gets accent soft-fill + a thin accent border, never a solid accent-filled pill — this is a wayfinding control, not a call to action.
