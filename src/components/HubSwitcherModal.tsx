import React, { useEffect, useState } from 'react';
import { Plus, Router, Trash2 } from 'lucide-react';
import { Modal, Button } from './ui';
import { labelStyle, inputStyle } from './AuthViewShared';

interface KnownHub {
  id: string;
  name: string;
  url: string;
}

interface HubSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Bookmark-style switcher — no discovery, no shared session. Picking a hub
// just navigates this browser tab to that hub's own URL, same as typing it
// in by hand, each hub keeps its own independent login.
export const HubSwitcherModal: React.FC<HubSwitcherModalProps> = ({ isOpen, onClose }) => {
  const [hubs, setHubs] = useState<KnownHub[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    fetch('/api/hubs')
      .then((r) => r.json())
      .then((d) => setHubs(d.hubs || []))
      .catch(() => {});
  }, [isOpen]);

  const addHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/hubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      }).then((r) => r.json());
      if (!res.success) {
        setError(res.error || 'Toevoegen mislukt');
        return;
      }
      setHubs(res.hubs);
      setName('');
      setUrl('');
    } catch {
      setError('Toevoegen mislukt — geen verbinding met deze hub.');
    }
  };

  const removeHub = async (id: string) => {
    try {
      const res = await fetch(`/api/hubs/${id}`, { method: 'DELETE' }).then((r) => r.json());
      if (res.hubs) setHubs(res.hubs);
    } catch {}
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      icon={<Router size={18} />}
      title="Andere HSS-hubs"
      subtitle="Wissel naar een andere HSS op je netwerk, of voeg er een toe."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {hubs.length === 0 && (
          <div style={{ font: 'var(--text-body)', color: 'var(--text-muted)' }}>
            Nog geen andere hubs toegevoegd.
          </div>
        )}

        {hubs.map((hub) => (
          <div
            key={hub.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              background: 'var(--bg-inset)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <a
              href={hub.url}
              style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>{hub.name}</div>
              <div
                style={{
                  font: 'var(--text-mono-sm)',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {hub.url}
              </div>
            </a>
            <button
              onClick={() => removeHub(hub.id)}
              title="Verwijderen"
              style={{
                flexShrink: 0,
                width: 30,
                height: 30,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-card)',
                color: 'var(--status-danger)',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={14} style={{ margin: 'auto' }} />
            </button>
          </div>
        ))}

        <form
          onSubmit={addHub}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}
        >
          <div>
            <label style={labelStyle}>Naam</label>
            <input type="text" placeholder="bijv. HSS Woonkamer" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>URL</label>
            <input
              type="text"
              placeholder="http://192.168.1.50:3000"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={inputStyle}
            />
          </div>
          {error && <div style={{ font: 'var(--text-mono-sm)', color: 'var(--status-danger)' }}>{error}</div>}
          <Button type="submit" variant="secondary" size="sm" icon={<Plus size={14} />}>
            Hub toevoegen
          </Button>
        </form>
      </div>
    </Modal>
  );
};
