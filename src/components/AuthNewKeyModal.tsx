import React, { useState } from 'react';
import { Key } from 'lucide-react';
import { AuthUser, UserApiKey } from '../types';
import { Button, Modal, Toggle } from './ui';
import { ActionButton, labelStyle, inputStyle } from './AuthViewShared';

interface AuthNewKeyModalProps {
  open: boolean;
  onClose: () => void;
  currentUser?: AuthUser | null;
  authToken?: string | null;
  onCreated: (key: UserApiKey) => void;
}

const PERMISSION_OPTIONS = [
  { id: 'audio:read', name: 'audio:read', desc: 'Status, metadata en spectrum telemetrie opvragen' },
  { id: 'audio:control', name: 'audio:control', desc: 'Play, pause, volume, skip en wachtrij beheren' },
  { id: 'dac:configure', name: 'dac:configure', desc: 'EQ presets, crossfade en DAC hardware instellen' },
  { id: 'admin:all', name: 'admin:all', desc: 'Volledige beheerderstoegang' },
];

export const AuthNewKeyModal: React.FC<AuthNewKeyModalProps> = ({ open, onClose, currentUser, authToken, onCreated }) => {
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(['audio:read', 'audio:control']);
  const [keyExpiry, setKeyExpiry] = useState<string>('never');

  const togglePermission = (perm: string) => {
    if (selectedPermissions.includes(perm)) {
      setSelectedPermissions(selectedPermissions.filter((p) => p !== perm));
    } else {
      setSelectedPermissions([...selectedPermissions, perm]);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyLabel.trim() || !currentUser) return;

    try {
      const token = localStorage.getItem('hss_auth_token') || authToken;
      const res = await fetch('/api/auth/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newKeyLabel.trim(),
          permissions: selectedPermissions,
          expiresDays: keyExpiry === 'never' ? null : Number(keyExpiry),
        }),
      }).then((r) => r.json());

      if (res.apiKey) {
        onCreated(res.apiKey);
        onClose();
        setNewKeyLabel('');
      }
    } catch (e) {
      console.warn('Create API key failed:', e);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Key size={18} />}
      title="Nieuwe API sleutel genereren"
      subtitle="Kies een herkenbare naam en specifieke rechten voor deze externe integratie."
    >
      <form onSubmit={handleCreateApiKey} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Sleutel label / naam *</label>
          <input
            type="text"
            required
            placeholder="bijv. Home Assistant Woonkamer"
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Toegestane rechten:</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PERMISSION_OPTIONS.map((perm) => (
              <div
                key={perm.id}
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid ' + (selectedPermissions.includes(perm.id) ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                  background: selectedPermissions.includes(perm.id) ? 'var(--accent-soft)' : 'var(--bg-inset)',
                  cursor: 'pointer',
                }}
              >
                <Toggle
                  checked={selectedPermissions.includes(perm.id)}
                  onChange={() => togglePermission(perm.id)}
                  label={perm.name}
                  description={perm.desc}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Geldigheidsduur</label>
          <select value={keyExpiry} onChange={(e) => setKeyExpiry(e.target.value)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
            <option value="never">Nooit laten verlopen</option>
            <option value="30">30 dagen</option>
            <option value="90">90 dagen</option>
            <option value="365">1 jaar</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <ActionButton variant="ghost" onClick={onClose}>
            Annuleren
          </ActionButton>
          <Button>Sleutel genereren</Button>
        </div>
      </form>
    </Modal>
  );
};
