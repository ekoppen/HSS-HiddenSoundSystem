import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Radio, Disc, Music, Cloud, Trash2 } from 'lucide-react';
import { HubConfig, LikedTrack, RadioLogEntry } from '../types';
import { Badge, Button, Card, IconButton, Toggle } from './ui';

const RADIO_LOG_PAGE_SIZE = 20;

interface FavoritesViewProps {
  likes: LikedTrack[];
  hubConfig: HubConfig;
  onSaveConfig: (updated: Partial<HubConfig>) => void;
}

// Radio is the reason this list exists as its own thing: a song heard on a
// stream has no uri worth keeping, so it can't live in a playlist — you want
// to look it up later, not press play on it here.
const SOURCE_LABEL: Record<string, { label: string; icon: React.ReactNode; variant: 'accent' | 'success' | 'warning' | 'neutral' }> = {
  radio: { label: 'Radio', icon: <Radio size={12} />, variant: 'warning' },
  spotify: { label: 'Spotify', icon: <Cloud size={12} />, variant: 'success' },
  nas: { label: 'NAS', icon: <Music size={12} />, variant: 'accent' },
  external: { label: 'Extern', icon: <Disc size={12} />, variant: 'neutral' },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Radiogeschiedenis (optioneel, hubConfig.radioLogEnabled — de toggle staat
// bovenaan de pagina) — apart van de favorieten hierboven: dit is alles wat
// voorbij kwam, niet alleen wat bewaard werd. Zie db.ts (radio_log) en de
// ticker in state.ts die 'm vult. Paginering zonder losse COUNT-query: een
// volle pagina terug betekent "er kan een volgende zijn".
const RadioLogSection: React.FC = () => {
  const [entries, setEntries] = useState<RadioLogEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    fetch(`/api/radio/log?limit=${RADIO_LOG_PAGE_SIZE}&offset=${page * RADIO_LOG_PAGE_SIZE}`)
      .then((r) => r.json())
      .then((d) => {
        const rows: RadioLogEntry[] = d.entries || [];
        setEntries(rows);
        setHasMore(rows.length === RADIO_LOG_PAGE_SIZE);
      })
      .catch(() => {});
  }, [page]);

  const clear = async () => {
    await fetch('/api/radio/log', { method: 'DELETE' }).catch(() => {});
    setPage(0);
    setEntries([]);
    setHasMore(false);
  };

  return (
    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Radiogeschiedenis</h3>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Wat er wanneer op welk radiostation voorbijkwam.
            </p>
          </div>
          {(page > 0 || entries.length > 0) && (
            <IconButton icon={<Trash2 size={15} />} title="Geschiedenis wissen" onClick={clear} />
          )}
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              textAlign: 'center',
              background: 'var(--bg-inset)',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0 }}>
              Nog niets gelogd — zet de radio aan.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '8px 10px',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {entry.artworkUrl ? (
                    <img
                      src={entry.artworkUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Radio size={14} />
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.title}
                    </div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.artist} · {entry.station}
                    </div>
                  </div>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDateTime(entry.playedAt)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronLeft size={14} />}
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Vorige
              </Button>
              <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Pagina {page + 1}</span>
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronRight size={14} />}
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Volgende
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

export const FavoritesView: React.FC<FavoritesViewProps> = ({ likes, hubConfig, onSaveConfig }) => {
  const remove = async (likeKey: string) => {
    await fetch(`/api/likes/${encodeURIComponent(likeKey)}`, { method: 'DELETE' }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <Card padding={0}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Toggle
          checked={!!hubConfig.radioLogEnabled}
          onChange={(v) => onSaveConfig({ radioLogEnabled: v })}
          label="Radiogeschiedenis bijhouden"
          description="Uit tot je 'm zelf aanzet — logt alleen echt herkende nummers, geen zenderbranding"
        />
        {hubConfig.radioLogEnabled && (
          <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--border-subtle)' }}>
            <Toggle
              checked={!!hubConfig.listenerPushRadioLog}
              onChange={(v) => onSaveConfig({ listenerPushRadioLog: v })}
              label="Automatisch naar Listener sturen"
              description="Elk gelogd nummer meteen doorsturen naar Listener, net als bij het hartje — vereist een werkende Listener-koppeling"
            />
          </div>
        )}
      </div>
    </Card>

    <Card padding={0}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Favorieten</h3>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Alles wat je met het hartje bewaarde — ook nummers die je op de radio hoorde.
            </p>
          </div>
          <Badge variant="danger" icon={<Heart size={12} />}>{likes.length}</Badge>
        </div>

        {likes.length === 0 ? (
          <div
            style={{
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              textAlign: 'center',
              background: 'var(--bg-inset)',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <Heart size={22} style={{ color: 'var(--text-muted)' }} />
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', margin: 0, maxWidth: 420 }}>
              Nog niets bewaard. Tik op het hartje bij wat er speelt — in de webinterface of op het kioskscherm.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {likes.map((like) => {
              const meta = SOURCE_LABEL[like.source] || SOURCE_LABEL.spotify;
              return (
                <div
                  key={like.likeKey}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 10,
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {like.coverUrl ? (
                    <img
                      src={like.coverUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      style={{ width: 48, height: 48, borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Music size={18} />
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {like.title}
                    </div>
                    <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {like.artist}
                      {like.sourceDetail ? ` · ${like.sourceDetail}` : ''}
                    </div>
                  </div>

                  <Badge variant={meta.variant} icon={meta.icon}>{meta.label}</Badge>
                  <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(like.likedAt)}
                  </span>
                  <IconButton icon={<Trash2 size={15} />} title="Uit favorieten halen" onClick={() => remove(like.likeKey)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>

    {hubConfig.radioLogEnabled && <RadioLogSection />}
    </div>
  );
};
