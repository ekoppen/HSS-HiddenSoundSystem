import React, { useState } from 'react';
import { Lock, LogIn, Radio } from 'lucide-react';
import { Button, Card } from './ui';

interface LoginScreenProps {
  onLogin: (email: string, password?: string) => Promise<boolean>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  font: 'var(--text-body)',
  color: 'var(--text-primary)',
};

// minHeight reserves 2 lines' worth of --text-label so a label that wraps
// to 2 lines doesn't push just its own column's input down relative to
// shorter, single-line sibling labels in the same grid row.
const labelStyle: React.CSSProperties = {
  display: 'block',
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
  minHeight: 29,
};

/** Gates the whole admin dashboard behind a real login — the cast kiosk (a
 * passive display with no keyboard) never reaches this, it renders before
 * this check in App.tsx. */
export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const success = await onLogin(email, password);
      if (!success) setError('Onjuist e-mailadres of wachtwoord.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page)',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Radio size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <span style={{ font: 'var(--text-title)', fontSize: 18, color: 'var(--text-primary)' }}>HSS HiddenSoundSystem</span>
        </div>

        <Card>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Inloggen</span>
            </div>

            {error && (
              <div
                style={{
                  padding: 10,
                  background: 'rgba(251,113,133,0.12)',
                  border: '1px solid rgba(251,113,133,0.3)',
                  borderRadius: 'var(--radius-md)',
                  font: 'var(--text-mono-sm)',
                  color: 'var(--status-danger)',
                }}
              >
                {error}
              </div>
            )}

            <div>
              <label style={labelStyle}>E-mailadres</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Wachtwoord</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>

            <Button type="submit" disabled={loading} icon={<LogIn size={15} />}>
              {loading ? 'Inloggen...' : 'Inloggen'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
