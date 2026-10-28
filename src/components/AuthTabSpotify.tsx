import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, Key, LogOut, Save, User, UserCheck, Zap } from 'lucide-react';
import { HubConfig } from '../types';
import { Badge, Button, Card } from './ui';
import { ActionButton, cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabSpotifyProps {
  daemonConfig: HubConfig;
  setDaemonConfig: React.Dispatch<React.SetStateAction<HubConfig>>;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onFeedback: (msg: string) => void;
}

export const AuthTabSpotify: React.FC<AuthTabSpotifyProps> = ({ daemonConfig, setDaemonConfig, onSaveConfig, onFeedback }) => {
  const [showSecret, setShowSecret] = useState(false);
  const [spotifyAccount, setSpotifyAccount] = useState<{
    isConnected: boolean;
    displayName: string | null;
    email: string | null;
    product: string | null;
    avatarUrl: string | null;
  }>({
    isConnected: false,
    displayName: null,
    email: null,
    product: null,
    avatarUrl: null,
  });
  const [spotifyLoginUrl, setSpotifyLoginUrl] = useState('/api/spotify/auth/login');
  // Derived from spotifyLoginUrl once the backend reports the real HTTPS
  // origin (see /api/spotify/account) — same origin the login flow itself
  // uses, so this is guaranteed to match what needs registering with Spotify.
  const spotifyRedirectUri = spotifyLoginUrl.replace('/auth/login', '/auth/callback');
  const [spotifyTestResult, setSpotifyTestResult] = useState<any>(null);
  const [spotifyTestLoading, setSpotifyTestLoading] = useState(false);

  useEffect(() => {
    fetch('/api/spotify/account')
      .then((r) => r.json())
      .then((res) => {
        if (res.account) {
          setSpotifyAccount({
            isConnected: Boolean(res.account.isConnected),
            displayName: res.account.displayName,
            email: res.account.email,
            product: res.account.product,
            avatarUrl: res.account.avatarUrl,
          });
        }
        if (res.loginUrl) setSpotifyLoginUrl(res.loginUrl);
      })
      .catch(() => {});
  }, []);

  const handleTestSpotifyConnection = async () => {
    setSpotifyTestLoading(true);
    try {
      const res = await fetch('/api/spotify/test', { method: 'POST' }).then((r) => r.json());
      setSpotifyTestResult(res);
      if (res.success && res.account) {
        setSpotifyAccount((prev) => ({
          ...prev,
          isConnected: true,
          displayName: res.account.displayName,
          email: res.account.email,
        }));
      }
    } catch (e) {
      setSpotifyTestResult({ success: false, message: 'Verbinding testen mislukt' });
    } finally {
      setSpotifyTestLoading(false);
    }
  };

  const handleSpotifyLogout = async () => {
    try {
      await fetch('/api/spotify/logout', { method: 'POST' });
      setSpotifyAccount({
        isConnected: false,
        displayName: null,
        email: null,
        product: null,
        avatarUrl: null,
      });
      setDaemonConfig((prev) => ({ ...prev, spotifyClientId: '', spotifyClientSecret: '' }));
      setSpotifyTestResult(null);
    } catch (e) {}
  };

  const handleSaveSpotifyDaemon = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig(daemonConfig);
    onFeedback('Spotify HSS Daemon configuratie opgeslagen!');
  };

  return (
    <Card padding={0}>
      <form onSubmit={handleSaveSpotifyDaemon} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Spotify HSS daemon &amp; Connect configuratie</h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Stel de broadcast naam, account koppeling en Web API credentials in voor live bediening
            </p>
          </div>
          <Button icon={<Save size={15} />}>Daemon config opslaan</Button>
        </div>

        {/* Spotify Account & Status Card */}
        <div style={{ padding: 20, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-soft-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: spotifyAccount.isConnected ? 'var(--accent)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {spotifyAccount.isConnected ? <UserCheck size={22} /> : <User size={22} />}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: spotifyAccount.isConnected ? 'var(--status-success)' : 'var(--text-muted)' }}>
                    {spotifyAccount.isConnected ? 'Spotify gekoppeld' : 'Spotify niet gekoppeld'}
                  </span>
                  <Badge variant="neutral">Spotify Connect active</Badge>
                </div>
                <h4 style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', margin: '4px 0 0' }}>
                  {spotifyAccount.isConnected ? spotifyAccount.displayName || 'Spotify account' : 'Geen Spotify account gekoppeld'}
                </h4>
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  {spotifyAccount.isConnected
                    ? `${spotifyAccount.email || ''} · ${spotifyAccount.product || 'Spotify'}`
                    : 'Koppel je Spotify account om playlists en direct afspelen te activeren'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ActionButton variant="secondary" disabled={spotifyTestLoading} icon={<Zap size={15} />} onClick={handleTestSpotifyConnection}>
                {spotifyTestLoading ? 'Testen...' : 'Verbinding testen'}
              </ActionButton>

              {spotifyAccount.isConnected ? (
                <ActionButton variant="danger" icon={<LogOut size={15} />} onClick={handleSpotifyLogout}>
                  Ontkoppelen
                </ActionButton>
              ) : (
                <ActionButton icon={<Key size={15} />} onClick={() => { window.location.href = spotifyLoginUrl; }}>
                  Inloggen bij Spotify
                </ActionButton>
              )}
            </div>
          </div>

          {/* Connection Test Results Output */}
          {spotifyTestResult && (
            <div
              style={{
                padding: 14,
                borderRadius: 'var(--radius-lg)',
                border: '1px solid ' + (spotifyTestResult.success ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)'),
                background: spotifyTestResult.success ? 'rgba(52,211,153,0.08)' : 'rgba(251,113,133,0.08)',
                font: 'var(--text-mono-sm)',
                color: spotifyTestResult.success ? 'var(--status-success)' : 'var(--status-danger)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {spotifyTestResult.success ? <Check size={15} /> : <AlertCircle size={15} />}
                  <span>{spotifyTestResult.message}</span>
                </span>
                {spotifyTestResult.latencyMs && (
                  <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    Latency: {spotifyTestResult.latencyMs}ms
                  </span>
                )}
              </div>

              {spotifyTestResult.device && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Actief apparaat:</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{spotifyTestResult.device.name}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Hardware audio backend:</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{spotifyTestResult.device.type}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Bitrate:</span>
                    <span style={{ color: 'var(--status-success)', fontWeight: 700 }}>320 kbps (bit-perfect)</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <div>
            <label style={labelStyle}>Spotify Connect apparaatnaam</label>
            <input
              type="text"
              required
              value={daemonConfig.spotifyDeviceName}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, spotifyDeviceName: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Bitrate kwaliteit</label>
            <select
              value={daemonConfig.spotifyBitrate}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, spotifyBitrate: e.target.value as any })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            >
              <option value="320">320 kbps (extreme audiophile kwaliteit — Ogg Vorbis)</option>
              <option value="160">160 kbps (high quality)</option>
              <option value="96">96 kbps (normal bandwidth)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Spotify Client ID (nodig om in te loggen)</label>
            <input
              type="text"
              placeholder="bijv. 4a8e2b9c7d1e3f..."
              value={daemonConfig.spotifyClientId || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, spotifyClientId: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Spotify Client secret (optioneel — alleen voor zoeken)</span>
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                {showSecret ? 'Verbergen' : 'Tonen'}
              </button>
            </label>
            <input
              type={showSecret ? 'text' : 'password'}
              placeholder="••••••••••••••••••••••••"
              value={daemonConfig.spotifyClientSecret || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, spotifyClientSecret: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>
        </div>

        <div style={{ padding: 16, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-body-strong)', color: 'var(--accent)', margin: 0 }}>
            <Zap size={15} />
            <span>Hoe koppel je je Spotify-account?</span>
          </h4>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>
            <li>
              Ga naar{' '}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                developer.spotify.com/dashboard
              </a>{' '}
              en log in.
            </li>
            <li>
              Maak een gratis app aan en voeg deze redirect-URL toe:{' '}
              <code style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                {spotifyRedirectUri}
              </code>
            </li>
            <li>
              Vul alleen je <strong style={{ color: 'var(--text-primary)' }}>Client ID</strong> hierboven in —
              een secret is niet nodig om in te loggen.
            </li>
            <li>
              Sla op en klik op "Inloggen bij Spotify". Spotify staat alleen <code style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>https://</code> redirect-URL's
              toe, dus de Hub gebruikt daarvoor eenmalig een zelf-ondertekend certificaat — je browser toont dan één keer een
              beveiligingswaarschuwing ("niet veilig" / "Advanced" → "Doorgaan"), dat hoort erbij.
            </li>
            <li>Vanaf dat moment bedien je play, pause &amp; skip direct op de Nest Hub en webpagina.</li>
            <li style={{ color: 'var(--text-muted)' }}>
              Wil je ook live in de Spotify-catalogus kunnen zoeken? Vul dan ook het Client secret hierboven in — dat gebruikt een apart, app-niveau toegangspad dat (in tegenstelling tot inloggen) wél een secret vereist.
            </li>
          </ol>
        </div>
      </form>
    </Card>
  );
};
