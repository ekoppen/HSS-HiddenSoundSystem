import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { AuthUser, UserApiKey } from '../types';
import { Badge, Button, Card } from './ui';
import { cardHeaderStyle } from './AuthViewShared';

interface AuthTabKeysProps {
  apiKeys: UserApiKey[];
  setApiKeys: React.Dispatch<React.SetStateAction<UserApiKey[]>>;
  currentUser?: AuthUser | null;
  authToken?: string | null;
  onFeedback: (msg: string) => void;
}

// API Sleutelbeheer (View, Rotate, Revoke, Permissions)
export const AuthTabKeys: React.FC<AuthTabKeysProps> = ({ apiKeys, setApiKeys, currentUser, authToken, onFeedback }) => {
  const [visibleKeyTokens, setVisibleKeyTokens] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleRotateKey = async (keyId: string) => {
    if (!currentUser) return;
    if (confirm('Weet je zeker dat je deze sleutel wilt vernieuwen? Externe integraties moeten de nieuwe sleutel gebruiken.')) {
      try {
        const token = localStorage.getItem('hss_auth_token') || authToken;
        const res = await fetch(`/api/auth/keys/${keyId}/rotate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).then((r) => r.json());

        if (res.apiKey) {
          setApiKeys((prev) => prev.map((k) => (k.id === keyId ? res.apiKey : k)));
          onFeedback('API Sleutel geroteerd met nieuw veilig token!');
        }
      } catch (e) {
        console.warn('Rotate API key failed:', e);
      }
    }
  };

  const handleRevokeKey = async (keyId: string, label: string) => {
    if (!currentUser) return;
    if (confirm(`Weet je zeker dat je de sleutel '${label}' wilt intrekken?`)) {
      try {
        const token = localStorage.getItem('hss_auth_token') || authToken;
        await fetch(`/api/auth/keys/${keyId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
        onFeedback(`API Sleutel '${label}' ingetrokken`);
      } catch (e) {
        console.warn('Revoke API key failed:', e);
      }
    }
  };

  const handleCopyKey = (keyString: string, keyId: string) => {
    navigator.clipboard.writeText(keyString);
    setCopiedKeyId(keyId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleToggleKeyVisibility = (keyId: string) => {
    setVisibleKeyTokens((prev) => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  return (
    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
              <ShieldCheck size={18} color="var(--accent)" />
              Actieve API sleutels voor externe aansturing
            </h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Gebruik deze sleutels in Home Assistant, Node-RED, curl of ESP32 om audio, volume en DAC hardware aan te sturen.
            </p>
          </div>
        </div>

        {/* API Keys Table / Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {apiKeys.map((key) => {
            const isVisible = visibleKeyTokens[key.id];
            const displayKey = isVisible
              ? key.key
              : `${key.key.substring(0, 14)}${'•'.repeat(20)}${key.key.substring(key.key.length - 4)}`;

            return (
              <div
                key={key.id}
                style={{ padding: 18, borderRadius: 'var(--radius-lg)', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h4 style={{ font: 'var(--text-mono)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{key.name}</h4>
                      <Badge variant={key.status === 'active' ? 'success' : 'danger'}>{key.status === 'active' ? 'Actief' : 'Ingetrokken'}</Badge>
                    </div>
                    <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Aangemaakt op {new Date(key.createdAt).toLocaleDateString()} · Laatst gebruikt:{' '}
                      {new Date(key.lastUsedAt).toLocaleTimeString()}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button variant="secondary" size="sm" icon={<RefreshCw size={13} color="var(--accent)" />} onClick={() => handleRotateKey(key.id)}>
                      Vernieuwen
                    </Button>
                    <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => handleRevokeKey(key.id, key.name)}>
                      Intrekken
                    </Button>
                  </div>
                </div>

                {/* Token Value & Copy Box */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="text"
                      readOnly
                      value={displayKey}
                      style={{ width: '100%', padding: '10px 40px 10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--accent)', outline: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleKeyVisibility(key.id)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                    >
                      {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={copiedKeyId === key.id ? <Check size={13} color="var(--status-success)" /> : <Copy size={13} />}
                    onClick={() => handleCopyKey(key.key, key.id)}
                  >
                    {copiedKeyId === key.id ? 'Gekopieerd' : 'Kopiëren'}
                  </Button>
                </div>

                {/* Permissions Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Rechten:</span>
                  {key.permissions.map((perm) => (
                    <Badge key={perm} variant="neutral">{perm}</Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
