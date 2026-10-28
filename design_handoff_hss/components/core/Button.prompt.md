Button — the single committing action on a screen or card.

```jsx
<Button variant="primary" onClick={handleSave}>Toepassen</Button>
<Button variant="secondary" size="sm" icon={<RefreshCw size={14}/>}>Vernieuwen</Button>
```

Variants: primary (accent-filled, one per view), secondary (outlined, default choice for most actions), ghost (lowest emphasis, inline with text), danger (destructive — revoke, delete, reset). Sizes: md default, sm for dense toolbars (renders uppercase label type).
