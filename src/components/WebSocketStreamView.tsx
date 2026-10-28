import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  FastForward,
  Send,
  Terminal,
  Trash2,
  Volume2,
  Wifi,
  Zap,
} from 'lucide-react';
import { PlaybackState, WebSocketEventPayload } from '../types';
import { Badge, Button, Card } from './ui';

interface WebSocketStreamViewProps {
  playback: PlaybackState;
  wsConnected: boolean;
  onSendWsCommand: (cmd: any) => void;
  recentEvents: WebSocketEventPayload[];
  onClearEvents: () => void;
}

export const WebSocketStreamView: React.FC<WebSocketStreamViewProps> = ({
  playback,
  wsConnected,
  onSendWsCommand,
  recentEvents,
  onClearEvents,
}) => {
  const [customAction, setCustomAction] = useState('toggle');
  const [customPayload, setCustomPayload] = useState('{\n  "action": "set_volume",\n  "volume": 85\n}');
  const [copiedWsUrl, setCopiedWsUrl] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const wsUrl = `ws://${window.location.host}/ws`;

  const handleSendCustom = () => {
    try {
      const parsed = JSON.parse(customPayload);
      onSendWsCommand(parsed);
    } catch (e) {
      alert('Ongeldige JSON syntaxis');
    }
  };

  const handleCopyWsUrl = () => {
    navigator.clipboard.writeText(wsUrl);
    setCopiedWsUrl(true);
    setTimeout(() => setCopiedWsUrl(false), 2000);
  };

  const quickCommandButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '9px 12px',
    background: 'var(--bg-inset)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    font: 'var(--text-mono-sm)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'background var(--duration-fast) var(--ease-standard)',
  };

  return (
    <div className="space-y-6">
      {/* Top banner: WebSocket server status & endpoint */}
      <Card padding={28}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 20,
            marginBottom: 20,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wifi size={18} style={{ color: 'var(--accent)' }} />
              <h2 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>
                Live
              </h2>
            </div>
            <p style={{ font: 'var(--text-body)', fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
              Zendt continu de huidige afspeelstatus, voortgangs-ticks, spectrum data en volume uit naar alle aangesloten apparaten
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              font: 'var(--text-mono-sm)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                background: wsConnected ? 'var(--status-success)' : 'var(--status-danger)',
              }}
            />
            <span style={{ color: 'var(--text-primary)' }}>{wsConnected ? 'Live verbonden' : 'Verbroken'}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              · {playback.systemStats.connectedClients} client(s)
            </span>
          </div>
        </div>

        {/* WebSocket URL box */}
        <div
          style={{
            padding: 16,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <label style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
            WebSocket server URI (voor Home Assistant, ESP32, Python of web clients)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="text"
              readOnly
              value={wsUrl}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 14px',
                background: 'var(--bg-page)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                font: 'var(--text-mono-sm)',
                color: 'var(--accent)',
              }}
            />
            <Button variant="secondary" size="sm" icon={copiedWsUrl ? <Check size={14} /> : <Copy size={14} />} onClick={handleCopyWsUrl}>
              {copiedWsUrl ? 'Gekopieerd!' : 'Kopieer URI'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Grid: live event log stream + interactive WebSocket sender */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Live broadcast stream log */}
        <div className="lg:col-span-7">
          <Card padding={24}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Terminal size={16} style={{ color: 'var(--accent)' }} />
                <h3
                  style={{
                    font: 'var(--text-label)',
                    letterSpacing: 'var(--letter-label)',
                    textTransform: 'uppercase',
                    color: 'var(--text-primary)',
                    margin: 0,
                  }}
                >
                  Live broadcast event stream ({recentEvents.length})
                </h3>
              </div>
              <button
                onClick={onClearEvents}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  font: 'var(--text-mono-sm)',
                  color: 'var(--text-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--status-danger)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <Trash2 size={13} />
                <span>Wissen</span>
              </button>
            </div>

            <div
              className="scrollbar-thin"
              style={{
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 16,
                height: 384,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {recentEvents.length === 0 ? (
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0', margin: 0 }}>
                  Wachten op inkomende WebSocket berichten...
                </p>
              ) : (
                recentEvents.map((evt, idx) => {
                  const timeStr = new Date(evt.timestamp).toLocaleTimeString();
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Badge variant="accent" mono={false}>
                          {evt.event}
                        </Badge>
                        <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{timeStr}</span>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          font: 'var(--text-mono-sm)',
                          color: 'var(--text-secondary)',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {JSON.stringify(evt.data, null, 2)}
                      </pre>
                    </div>
                  );
                })
              )}
              <div ref={logEndRef} />
            </div>
          </Card>
        </div>

        {/* WebSocket command console */}
        <div className="lg:col-span-5">
          <Card padding={24}>
            <div style={{ paddingBottom: 14, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
              <h3
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                <Send size={16} style={{ color: 'var(--accent)' }} />
                WebSocket remote controller
              </h3>
              <p style={{ font: 'var(--text-body)', fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                Stuur live JSON payload opdrachten over de open WebSocket socket
              </p>
            </div>

            {/* Quick command buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              <label
                style={{
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Snelle opdrachten
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button style={quickCommandButtonStyle} onClick={() => onSendWsCommand({ action: 'toggle' })}>
                  <Zap size={14} style={{ color: 'var(--accent)' }} />
                  <span>Play / pause</span>
                </button>

                <button style={quickCommandButtonStyle} onClick={() => onSendWsCommand({ action: 'next' })}>
                  <FastForward size={14} style={{ color: 'var(--accent)' }} />
                  <span>Volgend nummer</span>
                </button>

                <button style={quickCommandButtonStyle} onClick={() => onSendWsCommand({ action: 'set_volume', volume: 50 })}>
                  <Volume2 size={14} style={{ color: 'var(--status-warning)' }} />
                  <span>Volume 50%</span>
                </button>

                <button style={quickCommandButtonStyle} onClick={() => onSendWsCommand({ action: 'set_volume', volume: 90 })}>
                  <Volume2 size={14} style={{ color: 'var(--accent)' }} />
                  <span>Volume 90%</span>
                </button>
              </div>
            </div>

            {/* Custom JSON payload editor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <label
                style={{
                  font: 'var(--text-label)',
                  letterSpacing: 'var(--letter-label)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Aangepast JSON bericht
              </label>
              <textarea
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                style={{
                  width: '100%',
                  height: 144,
                  padding: 12,
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  font: 'var(--text-mono-sm)',
                  color: 'var(--accent)',
                  resize: 'none',
                }}
              />
            </div>

            <Button className="w-full" variant="primary" size="sm" icon={<Send size={14} />} onClick={handleSendCustom}>
              Verzenden over WebSocket
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
};
