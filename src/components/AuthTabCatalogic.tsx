import React, { useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, Image, Save, Zap } from 'lucide-react';
import { HubConfig } from '../types';
import { Button, Card, Toggle } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabCatalogicProps {
  daemonConfig: HubConfig;
  setDaemonConfig: React.Dispatch<React.SetStateAction<HubConfig>>;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onFeedback: (msg: string) => void;
}

// Catalogic koppeling (read-only metadata & album art voor NAS-nummers)
export const AuthTabCatalogic: React.FC<AuthTabCatalogicProps> = ({ daemonConfig, setDaemonConfig, onSaveConfig, onFeedback }) => {
  const [showCatalogicKey, setShowCatalogicKey] = useState(false);
  const [catalogicTesting, setCatalogicTesting] = useState(false);
  const [catalogicTestResult, setCatalogicTestResult] = useState<{ success: boolean; message: string; scopes?: string[] } | null>(null);

  const handleTestCatalogic = async () => {
    setCatalogicTesting(true);
    setCatalogicTestResult(null);
    try {
      const res = await fetch('/api/catalogic/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: daemonConfig.catalogicUrl, apiKey: daemonConfig.catalogicApiKey }),
      }).then((r) => r.json());
      setCatalogicTestResult(res);
    } catch (e) {
      setCatalogicTestResult({ success: false, message: 'Test mislukt — kon geen verbinding maken met de Hub zelf.' });
    } finally {
      setCatalogicTesting(false);
    }
  };

  const handleSaveCatalogic = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig({
      catalogicEnabled: daemonConfig.catalogicEnabled,
      catalogicUrl: daemonConfig.catalogicUrl,
      catalogicApiKey: daemonConfig.catalogicApiKey,
      publicUrl: daemonConfig.publicUrl,
    });
    onFeedback('Catalogic-koppeling opgeslagen!');
  };

  return (
    <Card padding={0}>
      <form onSubmit={handleSaveCatalogic} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Catalogic koppeling</h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Haalt automatisch echte titel, artiest en albumhoes op voor je NAS/lokale nummers. Optioneel en alleen
              leesrichting — er wordt niets naar Catalogic teruggeschreven.
            </p>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Button
              type="button"
              variant="secondary"
              icon={<Zap size={15} />}
              disabled={catalogicTesting}
              onClick={handleTestCatalogic}
            >
              {catalogicTesting ? 'Bezig…' : 'Test verbinding'}
            </Button>
            <Button icon={<Save size={15} />}>Koppeling opslaan</Button>
          </div>
        </div>

        {catalogicTestResult && (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              background: catalogicTestResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(251,113,133,0.12)',
              border: '1px solid ' + (catalogicTestResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(251,113,133,0.3)'),
            }}
          >
            {catalogicTestResult.success ? (
              <Check size={16} style={{ color: 'var(--status-success)', flexShrink: 0, marginTop: 1 }} />
            ) : (
              <AlertCircle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0, marginTop: 1 }} />
            )}
            <div>
              <p style={{ margin: 0, font: 'var(--text-body)', color: catalogicTestResult.success ? 'var(--status-success)' : 'var(--status-danger)' }}>
                {catalogicTestResult.message}
              </p>
              {catalogicTestResult.scopes && catalogicTestResult.scopes.length > 0 && (
                <p style={{ margin: '4px 0 0', font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                  Scopes: {catalogicTestResult.scopes.join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: 16, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          <Toggle
            checked={!!daemonConfig.catalogicEnabled}
            onChange={(v) => setDaemonConfig({ ...daemonConfig, catalogicEnabled: v })}
            label="Catalogic-koppeling inschakelen"
            description="Als dit uit staat, wordt Catalogic nooit benaderd en vallen NAS-nummers terug op hun eigen ID3/FLAC-tags"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <div>
            <label style={labelStyle}>Catalogic URL</label>
            <input
              type="text"
              placeholder="https://catalogic.doorkoppen.nl"
              value={daemonConfig.catalogicUrl || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, catalogicUrl: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>

          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>API-sleutel (optioneel)</span>
              <button
                type="button"
                onClick={() => setShowCatalogicKey(!showCatalogicKey)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {showCatalogicKey ? <EyeOff size={12} /> : <Eye size={12} />}
                {showCatalogicKey ? 'Verbergen' : 'Tonen'}
              </button>
            </label>
            <input
              type={showCatalogicKey ? 'text' : 'password'}
              placeholder="Niet nodig voor lezen — alleen voor toekomstige schrijftoegang"
              value={daemonConfig.catalogicApiKey || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, catalogicApiKey: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Hub-URL (voor Catalogic webhook)</label>
            <input
              type="text"
              placeholder="http://192.168.x.x:3000"
              value={daemonConfig.publicUrl || ''}
              onChange={(e) => setDaemonConfig({ ...daemonConfig, publicUrl: e.target.value })}
              style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
            />
          </div>
        </div>

        <div style={{ padding: 16, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-strong)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-body-strong)', color: 'var(--accent)', margin: 0 }}>
            <Image size={15} />
            <span>Hoe werkt dit?</span>
          </h4>
          <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>
            Bij het doorbladeren van je NAS-map wordt eerst gekeken naar de ingebedde tags van elk bestand. Daarna
            wordt — best-effort — bij Catalogic gezocht op titel en artiest voor een canonieke albumhoes. Geen
            match, of Catalogic onbereikbaar? Dan blijft gewoon de tag-data staan. Resultaten worden lokaal
            gecachet, dus dit gebeurt maar één keer per nummer.
          </p>
          <p style={{ margin: 0, font: 'var(--text-mono-sm)', color: 'var(--text-secondary)' }}>
            <strong>Hub-URL</strong> is het omgekeerde: het adres waarop Catalogic déze Hub kan bereiken, bijv.
            het LAN-adres van deze Pi (<code>http://192.168.x.x:3000</code>). Nodig voor de bibliotheek-scan: pas
            nadat dit veld is opgeslagen meldt de Hub zich aan bij Catalogic voor een webhook, zodat nummers die
            Catalogic later alsnog matcht automatisch worden bijgewerkt — zonder handmatig herscannen.
          </p>
        </div>
      </form>
    </Card>
  );
};
