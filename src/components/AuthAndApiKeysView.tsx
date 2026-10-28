import React, { useEffect, useState } from 'react';
import { Check, Clock, Code, Cpu, HardDrive, Heart, Image, Key, LogOut, Mic, Plus, Sliders, User, UserCheck } from 'lucide-react';
import { AuthUser, HubConfig, UserApiKey } from '../types';
import { Badge, Button, Card, Tabs } from './ui';
import { AuthTabSpotify } from './AuthTabSpotify';
import { AuthTabNas } from './AuthTabNas';
import { AuthTabCatalogic } from './AuthTabCatalogic';
import { AuthTabListener } from './AuthTabListener';
import { AuthTabRecognition } from './AuthTabRecognition';
import { AuthTabSystemTime } from './AuthTabSystemTime';
import { AuthTabGpio } from './AuthTabGpio';
import { AuthTabKeys } from './AuthTabKeys';
import { AuthTabUsers } from './AuthTabUsers';
import { AuthTabApiTester } from './AuthTabApiTester';
import { AuthNewKeyModal } from './AuthNewKeyModal';

interface AuthAndApiKeysViewProps {
  currentUser?: AuthUser | null;
  config?: HubConfig;
  hubConfig?: HubConfig;
  authToken?: string | null;
  onUserUpdated?: (user: AuthUser | null, token: string | null) => void;
  onRegister?: (name: string, email: string, password?: string, role?: string) => Promise<boolean>;
  onLogout?: () => void;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onRegenerateApiKey?: () => Promise<string>;
}

// Thin shell: owns the top profile banner, the sub-tab nav, and the state that's
// genuinely shared across sub-tabs (daemonConfig — several tabs edit different
// fields of the same draft object — and apiKeys, shared between the "keys" tab,
// the API tester and the new-key modal). Everything else lives in its own
// AuthTab*.tsx, one per sub-tab — see ARCHITECTURE.md.
export const AuthAndApiKeysView: React.FC<AuthAndApiKeysViewProps> = ({
  currentUser,
  config,
  hubConfig,
  authToken,
  onRegister,
  onLogout,
  onSaveConfig,
}) => {
  const activeConfig = config || hubConfig;
  const [activeSubTab, setActiveSubTab] = useState<'spotify_daemon' | 'nas' | 'catalogic' | 'listener' | 'recognition' | 'system_time' | 'gpio' | 'keys' | 'auth' | 'api_tester'>('spotify_daemon');
  const [apiKeys, setApiKeys] = useState<UserApiKey[]>(currentUser?.apiKeys || []);
  const [isNewKeyModalOpen, setIsNewKeyModalOpen] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const safeConfig: HubConfig = activeConfig || {
    spotifyClientId: '',
    spotifyClientSecret: '',
    spotifyDeviceName: 'HSSwoonkamer',
    spotifyBitrate: '320',
    spotifyNormalisation: true,
    soloistEnabled: true,
    autostartService: true,
    apiKey: 'HSS-demo-key-2026',
    broadcastSpectrum: true,
    enableAlsaDirectHw: true,
    maxVolumeLimit: 100,
    catalogicEnabled: false,
    catalogicUrl: '',
    publicUrl: '',
  };

  const [daemonConfig, setDaemonConfig] = useState<HubConfig>({ ...safeConfig });

  useEffect(() => {
    if (activeConfig) {
      setDaemonConfig((prev) => ({
        ...activeConfig,
        spotifyClientId: activeConfig.spotifyClientId || prev.spotifyClientId || '',
        spotifyClientSecret: activeConfig.spotifyClientSecret || prev.spotifyClientSecret || '',
      }));
    }
  }, [activeConfig]);

  // Keys already come attached to currentUser (from /api/auth/me) — no separate
  // GET /api/auth/keys endpoint exists, so just sync from that (create/rotate/
  // revoke elsewhere keep it in sync locally afterwards).
  useEffect(() => {
    setApiKeys(currentUser?.apiKeys || []);
  }, [currentUser]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Banner with Active User Profile Status */}
      <Card padding={0}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative' }}>
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.name}
                    style={{ width: 60, height: 60, borderRadius: 'var(--radius-lg)', objectFit: 'cover', border: '1px solid var(--border-default)' }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 'var(--radius-lg)', background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <User size={28} />
                  </div>
                )}
                <span
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'var(--status-success)',
                    border: '2px solid var(--bg-card)',
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>{currentUser?.name || 'Gast gebruiker'}</h2>
                  <Badge variant="accent">{currentUser?.role || 'Guest'}</Badge>
                </div>
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  {currentUser?.email || 'Niet ingelogd'} · {apiKeys.length} actieve API sleutel(s)
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {currentUser && (
                <Button variant="secondary" icon={<LogOut size={15} />} onClick={onLogout}>
                  Uitloggen
                </Button>
              )}
              <Button icon={<Plus size={16} />} onClick={() => setIsNewKeyModalOpen(true)}>
                Nieuwe API sleutel
              </Button>
            </div>
          </div>

          {actionFeedback && (
            <div style={{ padding: 12, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={15} />
              <span>{actionFeedback}</span>
            </div>
          )}

          <Tabs
            items={[
              { id: 'spotify_daemon', label: 'Spotify HSS daemon & account', icon: <Sliders size={15} /> },
              { id: 'nas', label: 'Netwerkschijf (NAS/SMB)', icon: <HardDrive size={15} /> },
              { id: 'catalogic', label: 'Catalogic koppeling', icon: <Image size={15} /> },
              { id: 'listener', label: 'Listener koppeling', icon: <Heart size={15} /> },
              { id: 'recognition', label: 'Muziekherkenning (LP/CD)', icon: <Mic size={15} /> },
              { id: 'system_time', label: 'Datum, tijd & tijdzone', icon: <Clock size={15} /> },
              { id: 'gpio', label: 'GPIO-hardware', icon: <Cpu size={15} /> },
              { id: 'keys', label: 'API sleutelbeheer', icon: <Key size={15} /> },
              { id: 'auth', label: 'Gebruikers & authenticatie', icon: <UserCheck size={15} /> },
              { id: 'api_tester', label: 'Interactieve API test console', icon: <Code size={15} /> },
            ]}
            activeId={activeSubTab}
            onChange={(id) => setActiveSubTab(id as any)}
          />
        </div>
      </Card>

      {activeSubTab === 'keys' && (
        <AuthTabKeys apiKeys={apiKeys} setApiKeys={setApiKeys} currentUser={currentUser} authToken={authToken} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'auth' && <AuthTabUsers currentUser={currentUser} onRegister={onRegister} />}

      {activeSubTab === 'api_tester' && <AuthTabApiTester apiKeys={apiKeys} config={config} />}

      {activeSubTab === 'spotify_daemon' && (
        <AuthTabSpotify daemonConfig={daemonConfig} setDaemonConfig={setDaemonConfig} onSaveConfig={onSaveConfig} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'nas' && (
        <AuthTabNas daemonConfig={daemonConfig} setDaemonConfig={setDaemonConfig} onSaveConfig={onSaveConfig} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'catalogic' && (
        <AuthTabCatalogic daemonConfig={daemonConfig} setDaemonConfig={setDaemonConfig} onSaveConfig={onSaveConfig} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'listener' && (
        <AuthTabListener daemonConfig={daemonConfig} setDaemonConfig={setDaemonConfig} onSaveConfig={onSaveConfig} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'recognition' && (
        <AuthTabRecognition daemonConfig={daemonConfig} setDaemonConfig={setDaemonConfig} onSaveConfig={onSaveConfig} onFeedback={showFeedback} />
      )}

      {activeSubTab === 'system_time' && <AuthTabSystemTime />}

      {activeSubTab === 'gpio' && <AuthTabGpio />}

      <AuthNewKeyModal
        open={isNewKeyModalOpen}
        onClose={() => setIsNewKeyModalOpen(false)}
        currentUser={currentUser}
        authToken={authToken}
        onCreated={(key) => {
          setApiKeys((prev) => [key, ...prev]);
          showFeedback('Nieuwe unieke API sleutel gegenereerd!');
        }}
      />
    </div>
  );
};
