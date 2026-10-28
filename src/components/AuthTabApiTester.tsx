import React, { useEffect, useState } from 'react';
import { Code, Send } from 'lucide-react';
import { HubConfig, UserApiKey } from '../types';
import { Badge, Button, Card } from './ui';
import { cardHeaderStyle, labelStyle, inputStyle } from './AuthViewShared';

interface AuthTabApiTesterProps {
  apiKeys: UserApiKey[];
  config?: HubConfig;
}

// Interactieve API Test Console
export const AuthTabApiTester: React.FC<AuthTabApiTesterProps> = ({ apiKeys, config }) => {
  const [testerKey, setTesterKey] = useState<string>(apiKeys[0]?.key || config?.apiKey || '');
  const [testerEndpoint, setTesterEndpoint] = useState<string>('/api/status');
  const [testerMethod, setTesterMethod] = useState<string>('GET');
  const [testerBody, setTesterBody] = useState<string>('{}');
  const [testerResponse, setTesterResponse] = useState<any>(null);
  const [testerStatus, setTesterStatus] = useState<number | null>(null);
  const [testerLoading, setTesterLoading] = useState(false);

  useEffect(() => {
    if (apiKeys.length > 0 && !testerKey) {
      setTesterKey(apiKeys[0].key);
    }
  }, [apiKeys]);

  const handleRunApiTest = async () => {
    setTesterLoading(true);
    setTesterResponse(null);
    setTesterStatus(null);

    try {
      let options: RequestInit = {
        method: testerMethod,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testerKey}`,
        },
      };

      if (testerMethod !== 'GET') {
        try {
          JSON.parse(testerBody);
          options.body = testerBody;
        } catch {
          // invalid JSON body
        }
      }

      const res = await fetch(testerEndpoint, options);
      setTesterStatus(res.status);
      const data = await res.json();
      setTesterResponse(data);
    } catch (err: any) {
      setTesterStatus(500);
      setTesterResponse({ error: err.message || 'API request network error' });
    } finally {
      setTesterLoading(false);
    }
  };

  return (
    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
              <Code size={18} color="var(--accent)" />
              Live API console &amp; endpoint tester
            </h3>
            <p style={{ font: 'var(--text-body)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Test audio REST endpoints direct in de browser met autorisatie headers en bekijk de live Pi response
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(280px,1fr)', gap: 20 }} className="grid-cols-1 lg:grid">
          {/* Request Builder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Selecteer API sleutel:</label>
              <select value={testerKey} onChange={(e) => setTesterKey(e.target.value)} style={{ ...inputStyle, font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.key}>
                    {k.name} ({k.key.substring(0, 18)}...)
                  </option>
                ))}
                <option value={config?.apiKey}>Standaard Hub key ({config?.apiKey})</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Endpoint &amp; methode:</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={testerMethod} onChange={(e) => setTesterMethod(e.target.value)} style={{ ...inputStyle, width: 110, font: 'var(--text-mono-sm)', fontWeight: 700 }}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="DELETE">DELETE</option>
                </select>

                <select
                  value={testerEndpoint}
                  onChange={(e) => {
                    setTesterEndpoint(e.target.value);
                    if (e.target.value === '/api/volume') {
                      setTesterMethod('POST');
                      setTesterBody(JSON.stringify({ volume: 82, isMuted: false }, null, 2));
                    } else if (e.target.value === '/api/playback/play' || e.target.value === '/api/playback/pause') {
                      setTesterMethod('POST');
                      setTesterBody('{}');
                    } else if (e.target.value === '/api/audio/advanced') {
                      setTesterMethod('GET');
                    } else {
                      setTesterMethod('GET');
                      setTesterBody('{}');
                    }
                  }}
                  style={{ ...inputStyle, flex: 1, font: 'var(--text-mono-sm)' }}
                >
                  <option value="/api/status">/api/status (status &amp; DAC telemetrie)</option>
                  <option value="/api/playback/play">/api/playback/play (hervat afspelen)</option>
                  <option value="/api/playback/pause">/api/playback/pause (pauzeer afspelen)</option>
                  <option value="/api/playback/next">/api/playback/next (volgend nummer)</option>
                  <option value="/api/volume">/api/volume (volume &amp; balans instellen)</option>
                  <option value="/api/audio/advanced">/api/audio/advanced (EQ &amp; crossfade status)</option>
                  <option value="/api/audio/eq-presets">/api/audio/eq-presets (EQ presets ophalen)</option>
                  <option value="/api/audio/devices">/api/audio/devices (I2S DAC hardware lijst)</option>
                </select>
              </div>
            </div>

            {testerMethod !== 'GET' && (
              <div>
                <label style={labelStyle}>JSON request body:</label>
                <textarea
                  value={testerBody}
                  onChange={(e) => setTesterBody(e.target.value)}
                  style={{ ...inputStyle, height: 112, font: 'var(--text-mono-sm)', resize: 'vertical' }}
                />
              </div>
            )}

            <Button disabled={testerLoading} icon={<Send size={15} />} onClick={handleRunApiTest}>
              {testerLoading ? 'Verzoek versturen...' : 'Verzoek uitvoeren'}
            </Button>
          </div>

          {/* Response Viewer */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--text-mono-sm)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Response output:</span>
              {testerStatus !== null && (
                <Badge variant={testerStatus === 200 ? 'success' : 'danger'}>
                  HTTP {testerStatus} {testerStatus === 200 ? 'OK' : 'ERROR'}
                </Badge>
              )}
            </div>

            <pre style={{ flex: 1, padding: 16, background: 'var(--bg-inset)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', font: 'var(--text-mono-sm)', color: 'var(--accent)', overflow: 'auto', maxHeight: 340, margin: 0 }}>
              {testerResponse ? JSON.stringify(testerResponse, null, 2) : '// Druk op "Verzoek uitvoeren" om de respons te bekijken...'}
            </pre>
          </div>
        </div>
      </div>
    </Card>
  );
};
