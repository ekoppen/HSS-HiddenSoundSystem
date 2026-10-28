import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ items, activeId, onChange }) => {
  return (
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 14px',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-body-strong)',
              fontWeight: isActive ? 600 : 500,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              border: '1px solid ' + (isActive ? 'var(--accent-soft-strong)' : 'transparent'),
              transition: 'all var(--duration-fast) var(--ease-standard)',
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
