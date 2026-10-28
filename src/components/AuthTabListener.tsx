import React, { useState } from 'react';
import { Eye, EyeOff, Heart, Save } from 'lucide-react';
import { HubConfig } from '../types';
import { Button, Card, Toggle } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabListenerProps {
  daemonConfig: HubConfig;
  setDaemonConfig: React.Dispatch<React.SetStateAction<HubConfig>>;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onFeedback: (msg: string) => void;
}

// Listener-koppeling: gelikete nummers doorsturen naar de eigen
// muzieklijst-app (POST /api/integration/songs, zie listenerClient.ts).
export const AuthTabListener: React.FC<AuthTabListenerProps> = ({ daemonConfig, setDaemonConfig, onSaveConfig, onFeedback }) => {
  const [showKey, setShowKey] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig({
      listenerPushLikes: daemonConfig.listenerPushLikes,
      listenerUrl: daemonConfig.listenerUrl,
      listenerIntegrationKey: daemonConfig.listenerIntegrationKey,
    });
    onFeedback('Listener-koppeling opgeslagen!');
  };

  return (
    <Card padding={0}>
      <form onSubmit={handleSave} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Listener koppeling</h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Stuurt elk nummer dat je met het hartje bewaart ook naar Listener, die het aan zijn catalogus toevoegt
              (dubbele nummers worden daar zelf herkend). De favoriet in HSS blijft altijd staan, ook als Listener
              onbereikbaar is.
            </p>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '8px 0 0' }}>
              Wil je ze ook in een lijst? Maak in Listener een collectie met exact dezelfde naam als de API-sleutel
              (bijvoorbeeld "HSS tuinhuis") — dan komt elk gelikt nummer daar vanzelf in. Geen collectie met die naam
              betekent alleen: het nummer staat in de catalogus. HSS maakt zelf nooit een collectie aan.
            </p>
          </div>
          <Button icon={<Save size={15} />}>Koppeling opslaan</Button>
        </div>

        <div style={{ padding: 16, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          <Toggle
            checked={!!daemonConfig.listenerPushLikes}
            onChange={(v) => setDaemonConfig({ ...daemonConfig, listenerPushLikes: v })}
            label="Favorieten naar Listener sturen"
            description="Let op bij radio: die stuurt soms zenderteksten in plaats van een echte titel, en die komen dan ook in Listener terecht"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <div>
            <label style={labelStyle}>Listener URL</label>
            <input
              type="text"
              placeholder="https://listener.doorkoppen.nl"
              value={daemonConfig.listenerUrl || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, listenerUrl: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Integratiesleutel</span>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                {showKey ? 'Verbergen' : 'Tonen'}
              </button>
            </label>
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="x-integration-key uit Listener"
              value={daemonConfig.listenerIntegrationKey || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, listenerIntegrationKey: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>
        </div>

        <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Heart size={13} style={{ color: 'var(--status-danger)' }} />
          Mislukt het versturen, dan verschijnt dat als systeemmelding — de favoriet zelf is dan al bewaard.
        </p>
      </form>
    </Card>
  );
};
