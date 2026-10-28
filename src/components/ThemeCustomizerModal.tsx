import React from 'react';
import { Palette, Sparkles } from 'lucide-react';
import { Modal, ThemeSwitchCard } from './ui';
import { saveThemeId } from '../services/themeManager';
import { ThemeId } from '../types';

interface ThemeCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentThemeId: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

const THEME_IDS: ThemeId[] = ['obsidian', 'slate', 'emerald', 'copper', 'daylight'];

export const ThemeCustomizerModal: React.FC<ThemeCustomizerModalProps> = ({
  isOpen,
  onClose,
  currentThemeId,
  onSelectTheme,
}) => {
  const handleSelect = (themeId: ThemeId) => {
    saveThemeId(themeId);
    onSelectTheme(themeId);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      icon={<Palette size={18} />}
      title="Kies een thema"
      subtitle="Kies een visuele stijl voor de web-interface en je Google Nest Hub schermen"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {THEME_IDS.map((id) => (
            <ThemeSwitchCard key={id} themeId={id} active={currentThemeId === id} onSelect={handleSelect} />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 14,
            background: 'var(--bg-inset)',
            borderRadius: 'var(--radius-md)',
            font: 'var(--text-mono-sm)',
            color: 'var(--text-muted)',
          }}
        >
          <Sparkles size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span>
            Thema&rsquo;s worden direct gesynchroniseerd met de Google Nest Hub weergave — behalve Daylight, dat
            geldt alleen voor de web-interface (het Nest Hub scherm blijft dan op Obsidian staan).
          </span>
        </div>
      </div>
    </Modal>
  );
};
