
function ThemeCustomizerModalContent({ current, onSelect }) {
  const { ThemeSwitchCard, Button } = window.SoloistDS;
  const { Sparkles } = window.Icons;
  const themes = ['obsidian', 'slate', 'emerald', 'copper'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {themes.map((id) => (
          <ThemeSwitchCard key={id} themeId={id} active={current === id} onSelect={onSelect} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 14, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
          <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          <span>Thema's worden direct gesynchroniseerd met de Google Nest Hub weergave.</span>
        </div>
      </div>
    </div>
  );
}

window.ThemeCustomizerModalContent = ThemeCustomizerModalContent;
