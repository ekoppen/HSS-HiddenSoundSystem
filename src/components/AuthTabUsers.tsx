import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, ShieldCheck, User, UserPlus } from 'lucide-react';
import { AuthUser } from '../types';
import { Badge, Button, Card } from './ui';
import { labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabUsersProps {
  currentUser?: AuthUser | null;
  onRegister?: (name: string, email: string, password?: string, role?: string) => Promise<boolean>;
}

// Gebruikersauthenticatie & Account Beheer
export const AuthTabUsers: React.FC<AuthTabUsersProps> = ({ currentUser, onRegister }) => {
  const [usersList, setUsersList] = useState<AuthUser[]>([]);

  // Register Form State
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<'admin' | 'audiophile' | 'studio_engineer'>('audiophile');
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);

  // Change Password Form State
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users').then((r) => r.json());
      if (res.users) {
        setUsersList(res.users);
      }
    } catch (e) {
      console.warn('Could not fetch users:', e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);
    try {
      const success = await onRegister(regName, regEmail, regPassword, regRole);
      if (success) {
        setRegSuccess(`Account '${regName}' succesvol geregistreerd en ingelogd!`);
        setRegName('');
        setRegEmail('');
        setRegPassword('');
        fetchUsers();
      } else {
        setRegError('Registratie mislukt. Controleer de invoergegevens.');
      }
    } catch (err: any) {
      setRegError(err.message || 'Registratiefout opgetreden');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    setPwSaving(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || 'Wachtwoord wijzigen mislukt');
        return;
      }
      setPwSuccess('Wachtwoord gewijzigd.');
      setCurPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPwError(err.message || 'Wachtwoord wijzigen mislukt');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 5fr) minmax(320px, 7fr)', gap: 20 }} className="grid-cols-1 lg:grid">
      {/* Quick User Switcher & Registered Accounts List */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
            <User size={16} color="var(--accent)" />
            Systeem gebruikers &amp; rollen ({usersList.length})
          </h3>
          <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: 0 }}>
            Accounts met toegang tot deze HSS Hub.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {usersList.map((user) => {
              const isSelected = user.email === currentUser?.email;
              return (
                <div
                  key={user.id}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid ' + (isSelected ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                    background: isSelected ? 'var(--accent-soft)' : 'var(--bg-inset)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    transition: 'all var(--duration-fast) var(--ease-standard)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <img src={user.avatarUrl} alt={user.name} style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} referrerPolicy="no-referrer" />
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ font: 'var(--text-mono-sm)', fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</h4>
                      <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '2px 0 0' }}>{user.email}</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <Badge variant="neutral">{user.role}</Badge>
                    {isSelected && <span style={{ font: 'var(--text-mono-sm)', color: 'var(--status-success)', fontWeight: 700 }}>Huidige sessie</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Change Own Password */}
      <Card>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
            <ShieldCheck size={17} color="var(--accent)" />
            Wachtwoord wijzigen
          </h3>

          {pwError && (
            <div style={{ padding: 10, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={15} />
              <span>{pwError}</span>
            </div>
          )}
          {pwSuccess && (
            <div style={{ padding: 10, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={15} />
              <span>{pwSuccess}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <div>
              <label style={labelStyle}>Huidig wachtwoord</label>
              <input type="password" required placeholder="••••••••" value={curPassword} onChange={(e) => setCurPassword(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nieuw wachtwoord (min. 8 tekens)</label>
              <input type="password" required minLength={8} placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <Button disabled={pwSaving} icon={<ShieldCheck size={15} />}>
            {pwSaving ? 'Bezig...' : 'Wachtwoord opslaan'}
          </Button>
        </form>
      </Card>

      {/* Registration & Login Forms */}
      <Card>
        <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
            <UserPlus size={17} color="var(--accent)" />
            Nieuwe gebruiker registreren
          </h3>

          {regError && (
            <div style={{ padding: 10, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={15} />
              <span>{regError}</span>
            </div>
          )}

          {regSuccess && (
            <div style={{ padding: 10, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={15} />
              <span>{regSuccess}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <div>
              <label style={labelStyle}>Volledige naam *</label>
              <input type="text" required placeholder="bijv. Jan Jansen" value={regName} onChange={(e) => setRegName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>E-mailadres *</label>
              <input type="email" required placeholder="naam@domein.nl" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <div>
              <label style={labelStyle}>Wachtwoord</label>
              <input type="password" placeholder="••••••••" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Gebruikersrol</label>
              <select value={regRole} onChange={(e) => setRegRole(e.target.value as any)} style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}>
                <option value="audiophile">Audiophile (playback &amp; EQ)</option>
                <option value="studio_engineer">Studio engineer (DSP &amp; DAC config)</option>
                <option value="admin">System admin (volledige toegang &amp; API beheer)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
            <Button icon={<UserPlus size={15} />}>Registreer &amp; maak API sleutel</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
