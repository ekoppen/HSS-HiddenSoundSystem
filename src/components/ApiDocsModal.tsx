import React, { useState } from 'react';
import { BookOpen, Check, Copy, Terminal, Wifi, X } from 'lucide-react';
import { Badge, Button, IconButton, Tabs } from './ui';

interface ApiDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
}

export const ApiDocsModal: React.FC<ApiDocsModalProps> = ({
  isOpen,
  onClose,
  apiKey,
}) => {
  const [activeTab, setActiveTab] = useState<'rest' | 'ws' | 'python'>('rest');
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(id);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const endpoints = [
    {
      method: 'GET',
      path: '/api/status',
      desc: 'Vraag actuele afspeelstatus, DAC hardware, CPU telemetry en volume op.',
      curl: `curl http://\${PI_IP}:3000/api/status -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      method: 'POST',
      path: '/api/playback/play',
      desc: 'Hervat het afspelen van Spotify HSS.',
      curl: `curl -X POST http://\${PI_IP}:3000/api/playback/play -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      method: 'POST',
      path: '/api/playback/pause',
      desc: 'Pauzeer het afspelen.',
      curl: `curl -X POST http://\${PI_IP}:3000/api/playback/pause -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      method: 'POST',
      path: '/api/playback/next',
      desc: 'Sla over naar volgend nummer in de wachtrij.',
      curl: `curl -X POST http://\${PI_IP}:3000/api/playback/next -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      method: 'POST',
      path: '/api/volume',
      desc: 'Stel master volume (0-100) en demping in.',
      curl: `curl -X POST http://\${PI_IP}:3000/api/volume \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"volume": 80, "isMuted": false}'`,
    },
    {
      method: 'POST',
      path: '/api/audio/output',
      desc: 'Schakel actieve DAC audio output om (bijv. hifiberry-dacplus, allo-boss-dac, usb-dac-uac2).',
      curl: `curl -X POST http://\${PI_IP}:3000/api/audio/output \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"deviceId": "hifiberry-dacplus"}'`,
    },
    {
      method: 'GET',
      path: '/api/playlists',
      desc: 'Haal alle Spotify en HiFi afspeellijsten en de huidige wachtrij op.',
      curl: `curl http://\${PI_IP}:3000/api/playlists -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      method: 'GET',
      path: '/api/spotify/artwork',
      desc: 'Haal hoge resolutie Spotify artwork (1200x1200), liner notes en dominant kleurenpalet op per URI of URL.',
      curl: `curl "http://\${PI_IP}:3000/api/spotify/artwork?uri=spotify:track:670iZ4b6Xw2997V8qjYg5i" -H "Authorization: Bearer ${apiKey}"`,
    },
  ];

  const pythonExample = `import websocket
import json
import time

def on_message(ws, message):
    data = json.loads(message)
    event_type = data.get("event")

    if event_type == "track_change":
        track = data["data"]["track"]
        print(f"Now Playing on Pi: {track['title']} - {track['artist']}")
    elif event_type == "progress_tick":
        pos = data["data"]["positionMs"] // 1000
        dur = data["data"]["durationMs"] // 1000
        print(f"Progress: {pos}s / {dur}s", end="\\r")
    elif event_type == "volume_change":
        print(f"DAC Volume: {data['data']['volume']}% ({data['data']['volumeDb']} dB)")

def on_open(ws):
    print("Connected to Raspberry Pi HSS WebSocket Broadcast!")
    # Sending a command (not just receiving broadcasts) requires the ?token=
    # on the connection URL below — an unauthenticated connection can still
    # listen, but any command it sends is ignored.
    # ws.send(json.dumps({"action": "set_volume", "volume": 75}))

ws = websocket.WebSocketApp("ws://YOUR_PI_IP:3000/ws?token=${apiKey}",
                            on_message=on_message,
                            on_open=on_open)

ws.run_forever()
`;

  const codeBlockStyle: React.CSSProperties = {
    padding: 12,
    background: 'var(--bg-inset)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    font: 'var(--text-mono-sm)',
    color: 'var(--text-secondary)',
    overflowX: 'auto',
    whiteSpace: 'pre',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,5,7,0.72)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 900,
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <BookOpen size={20} />
            </div>
            <div>
              <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>
                Hub REST API &amp; WebSocket documentatie
              </div>
              <div style={{ font: 'var(--text-body)', color: 'var(--text-muted)', marginTop: 2 }}>
                Aansturing van audio-output, volumeregeling en real-time data streaming
              </div>
            </div>
          </div>
          <IconButton icon={<X size={18} />} title="Sluiten" onClick={onClose} />
        </div>

        {/* Tabs */}
        <div style={{ padding: '14px 24px 0', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <Tabs
            items={[
              { id: 'rest', label: 'REST API endpoints' },
              { id: 'ws', label: 'WebSocket specificatie' },
              { id: 'python', label: 'Python client' },
            ]}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as any)}
          />
          <div style={{ height: 14 }} />
        </div>

        {/* Body */}
        <div className="scrollbar-thin" style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeTab === 'rest' &&
            endpoints.map((ep, idx) => (
              <div
                key={idx}
                style={{
                  padding: 16,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Badge variant={ep.method === 'GET' ? 'accent' : 'success'}>{ep.method}</Badge>
                    <span style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>{ep.path}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={copiedEndpoint === `ep-${idx}` ? <Check size={14} color="var(--status-success)" /> : <Copy size={14} />}
                    onClick={() => copyToClipboard(ep.curl, `ep-${idx}`)}
                  >
                    {copiedEndpoint === `ep-${idx}` ? 'Gekopieerd' : 'Kopieer cURL'}
                  </Button>
                </div>
                <p style={{ font: 'var(--text-body)', color: 'var(--text-secondary)', margin: 0 }}>{ep.desc}</p>
                <pre style={{ ...codeBlockStyle, margin: 0 }}>{ep.curl}</pre>
              </div>
            ))}

          {activeTab === 'ws' && (
            <div
              style={{
                padding: 16,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-subtitle)', color: 'var(--text-primary)', margin: 0 }}>
                <Wifi size={16} color="var(--accent)" />
                Real-time event schema (/ws)
              </h4>
              <p style={{ font: 'var(--text-body)', color: 'var(--text-secondary)', margin: 0 }}>
                Zodra een client verbinding maakt met{' '}
                <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>ws://PI_IP:3000/ws</span>, zendt de server
                automatische events uit:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ padding: 12, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', fontWeight: 700 }}>1. progress_tick (elke 1000ms):</span>
                  <pre style={{ ...codeBlockStyle, marginTop: 6, padding: 0, background: 'transparent', border: 'none' }}>
{`{
  "event": "progress_tick",
  "timestamp": 1723901234567,
  "data": {
    "positionMs": 45000,
    "durationMs": 330000,
    "isPlaying": true,
    "spectrum": [45, 60, 85, 90, ...],
    "systemStats": { "cpuTempC": 44.8, "cpuUsagePct": 12.4 }
  }
}`}
                  </pre>
                </div>

                <div style={{ padding: 12, background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)', fontWeight: 700 }}>2. track_change (bij nieuw nummer):</span>
                  <pre style={{ ...codeBlockStyle, marginTop: 6, padding: 0, background: 'transparent', border: 'none' }}>
{`{
  "event": "track_change",
  "timestamp": 1723901234567,
  "data": {
    "track": { "title": "Teardrop", "artist": "Massive Attack", "durationMs": 330000 },
    "queue": [...]
  }
}`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'python' && (
            <div
              style={{
                padding: 16,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-subtitle)', color: 'var(--text-primary)', margin: 0 }}>
                  <Terminal size={16} color="var(--accent)" />
                  Python realtime listener script
                </h4>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={copiedEndpoint === 'python-code' ? <Check size={14} color="var(--status-success)" /> : <Copy size={14} />}
                  onClick={() => copyToClipboard(pythonExample, 'python-code')}
                >
                  {copiedEndpoint === 'python-code' ? 'Gekopieerd' : 'Kopieer script'}
                </Button>
              </div>
              <pre style={{ ...codeBlockStyle, lineHeight: 1.6 }}>{pythonExample}</pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-inset)',
            display: 'flex',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          <Button variant="secondary" onClick={onClose}>
            Sluiten
          </Button>
        </div>
      </div>
    </div>
  );
};
