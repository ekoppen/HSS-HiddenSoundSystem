import React, { useState } from 'react';
import { Check, Code, Copy, Eye, EyeOff, Key, RefreshCw, Save, Shield } from 'lucide-react';
import { HubConfig } from '../types';
import { Button, Card, Toggle } from './ui';

interface AccountApiKeysProps {
  config: HubConfig;
  onSaveConfig: (updated: Partial<HubConfig>) => Promise<void>;
  onRegenerateApiKey: () => Promise<string>;
}

// minHeight reserves 2 lines' worth of --text-label so a label that wraps
// to 2 lines doesn't push just its own column's input down relative to
// shorter, single-line sibling labels in the same grid row.
const labelStyle: React.CSSProperties = {
  display: 'block',
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  marginBottom: 8,
  minHeight: 29,
};

const hintStyle: React.CSSProperties = {
  font: 'var(--text-mono-sm)',
  color: 'var(--text-muted)',
  marginTop: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  font: 'var(--text-body)',
  color: 'var(--text-primary)',
  outline: 'none',
};

export const AccountApiKeys: React.FC<AccountApiKeysProps> = ({
  config,
  onSaveConfig,
  onRegenerateApiKey,
}) => {
  const [formData, setFormData] = useState<HubConfig>({ ...config });
  const [showSecret, setShowSecret] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveConfig(formData);
      setSaveStatus('Configuratie opgeslagen en daemon parameters bijgewerkt!');
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (err) {
      setSaveStatus('Fout bij opslaan configuratie.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(formData.apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const sampleCurl = `curl -X POST http://\${PI_IP}:3000/api/playback/play \\
  -H "Authorization: Bearer ${formData.apiKey}" \\
  -H "Content-Type: application/json"`;

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(sampleCurl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const handleRegen = async () => {
    if (window.confirm('Weet je zeker dat je een nieuwe API Key wilt genereren? Oude externe koppelingen moeten worden bijgewerkt.')) {
      const newKey = await onRegenerateApiKey();
      setFormData((prev) => ({ ...prev, apiKey: newKey }));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Spotify HSS & Spotify Connect Account Settings */}
      <Card padding={0}>
        <form onSubmit={handleSave} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={18} color="var(--accent)" />
                <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Spotify account &amp; HSS Connect configuratie
                </h2>
              </div>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Verbind je Spotify Developer applicatie voor live metadata &amp; afspeellijsten synchronisatie
              </p>
            </div>

            <Button disabled={isSaving} icon={<Save size={16} />}>
              {isSaving ? 'Opslaan...' : 'Opslaan in daemon'}
            </Button>
          </div>

          {saveStatus && (
            <div
              style={{
                padding: 12,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft-strong)',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-mono-sm)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Check size={16} />
              <span>{saveStatus}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {/* Spotify Device Name */}
            <div>
              <label style={labelStyle}>Spotify Connect apparaatnaam *</label>
              <input
                type="text"
                required
                value={formData.spotifyDeviceName}
                onChange={(e) => setFormData({ ...formData, spotifyDeviceName: e.target.value })}
                placeholder="bijv. Pi-HSS-HiFi-Woonkamer"
                style={inputStyle}
              />
              <p style={hintStyle}>Deze naam verschijnt in je officiële Spotify app onder &ldquo;Verbinden met een apparaat&rdquo;.</p>
            </div>

            {/* Audio Bitrate Selector */}
            <div>
              <label style={labelStyle}>Audio kwaliteit (bitrate) *</label>
              <select
                value={formData.spotifyBitrate}
                onChange={(e) => setFormData({ ...formData, spotifyBitrate: e.target.value as any })}
                style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
              >
                <option value="320">320 kbps (extreme audiophile kwaliteit — Ogg Vorbis)</option>
                <option value="160">160 kbps (high quality)</option>
                <option value="96">96 kbps (normal bandwidth)</option>
              </select>
              <p style={hintStyle}>320 kbps wordt aanbevolen voor directe I2S DAC conversie zonder compressieartefacten.</p>
            </div>

            {/* Spotify Client ID */}
            <div>
              <label style={labelStyle}>Spotify Client ID (optioneel / Web API)</label>
              <input
                type="text"
                value={formData.spotifyClientId}
                onChange={(e) => setFormData({ ...formData, spotifyClientId: e.target.value })}
                placeholder="32-cijferige Spotify developer client id..."
                style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
              />
              <p style={hintStyle}>Verkrijgbaar via het Spotify Developer Dashboard (developer.spotify.com/dashboard).</p>
            </div>

            {/* Spotify Client Secret */}
            <div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Spotify Client Secret</span>
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
                value={formData.spotifyClientSecret}
                onChange={(e) => setFormData({ ...formData, spotifyClientSecret: e.target.value })}
                placeholder="Spotify client secret token..."
                style={{ ...inputStyle, font: 'var(--text-mono-sm)' }}
              />
              <p style={hintStyle}>Wordt veilig versleuteld opgeslagen op de lokale Raspberry Pi instantie.</p>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ padding: 14, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <Toggle
                checked={formData.spotifyNormalisation}
                onChange={(checked) => setFormData({ ...formData, spotifyNormalisation: checked })}
                label="Volume normalisatie (ReplayGain)"
                description="Gelijke volumebalans tussen verschillende opnames"
              />
            </div>

            <div style={{ padding: 14, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <Toggle
                checked={formData.broadcastSpectrum}
                onChange={(checked) => setFormData({ ...formData, broadcastSpectrum: checked })}
                label="WebSocket FFT spectrum uitzenden"
                description="Zendt realtime frequentie-data uit naar externe schermen / ESP32 VU-meters"
              />
            </div>
          </div>
        </form>
      </Card>

      {/* Hub REST API Keys & Integration for External Devices */}
      <Card padding={0}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={18} color="var(--accent)" />
                <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                  Hub REST API sleutel &amp; externe koppelingen
                </h3>
              </div>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Gebruik deze API sleutel om de Raspberry Pi audio output en volume aan te sturen via Home Assistant, Node-RED,
                curl of ESP32
              </p>
            </div>

            <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={handleRegen}>
              Hergenereer sleutel
            </Button>
          </div>

          {/* API Key Box */}
          <div style={{ padding: 16, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Jouw actieve Hub API token:</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="text"
                readOnly
                value={formData.apiKey}
                style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', font: 'var(--text-mono-sm)', color: 'var(--accent)', outline: 'none' }}
              />
              <Button variant="secondary" size="sm" icon={copiedKey ? <Check size={14} color="var(--status-success)" /> : <Copy size={14} />} onClick={handleCopyApiKey}>
                {copiedKey ? 'Gekopieerd' : 'Kopiëren'}
              </Button>
            </div>
          </div>

          {/* cURL Example Snippet */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                <Code size={14} color="var(--accent)" />
                Voorbeeld cURL request (remote playback control):
              </span>
              <button
                onClick={handleCopyCurl}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', font: 'var(--text-mono-sm)', cursor: 'pointer' }}
              >
                {copiedCurl ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedCurl ? 'Gekopieerd' : 'Kopieer cURL'}</span>
              </button>
            </div>
            <pre style={{ padding: 16, background: 'var(--bg-inset)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', font: 'var(--text-mono-sm)', overflowX: 'auto', margin: 0 }}>
              {sampleCurl}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
};
