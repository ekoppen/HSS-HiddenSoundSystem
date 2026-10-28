import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Disc,
  Globe,
  HardDrive,
  ListMusic,
  Loader2,
  LogIn,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Trash2,
} from 'lucide-react';
import { Playlist, Track } from '../types';
import { Card, Button, Modal } from './ui';
import { NasBrowser } from './NasBrowser';
import { NasMusicLibrary } from './NasMusicLibrary';

interface WebRadioStation {
  id: string;
  name: string;
  genre: string;
  url: string;
  bitrate: number;
  logoUrl?: string;
  isCustom?: boolean;
  codec?: string;
}

interface PlaylistManagerProps {
  playlists: Playlist[];
  currentPlaylistId: string | null;
  queue: Track[];
  onPlayPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (name: string, description: string) => Promise<void>;
  onAddTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  onRemoveTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  onAddToQueue: (track: Track) => void;
  onClearQueue: () => void;
  onSelectTrackFromQueue?: (track: Track) => void;
  onConfigureProfile?: (playlistId: string) => void;
}

// Shared inline-style tokens for form controls — no dedicated Input primitive
// in the design kit, so this mirrors the Card/Button register (flat bg-inset
// surface, subtle border, mono-sm label) consistently across every form here.
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  font: 'var(--text-body)',
  color: 'var(--text-primary)',
};

const fieldLabelStyle: React.CSSProperties = {
  font: 'var(--text-mono-sm)',
  color: 'var(--text-muted)',
  display: 'block',
  marginBottom: 6,
};

const sectionLabelStyle: React.CSSProperties = {
  font: 'var(--text-label)',
  letterSpacing: 'var(--letter-label)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '48px 0',
  color: 'var(--text-muted)',
};

export const PlaylistManager: React.FC<PlaylistManagerProps> = ({
  playlists,
  currentPlaylistId,
  queue,
  onPlayPlaylist,
  onCreatePlaylist,
  onAddTrackToPlaylist,
  onRemoveTrackFromPlaylist,
  onAddToQueue,
  onClearQueue,
  onSelectTrackFromQueue,
  onConfigureProfile,
}) => {
  const [activeMediaSource, setActiveMediaSource] = useState<'spotify' | 'radio' | 'local_nas' | 'queue'>('spotify');

  // Spotify State
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [spotifySearchResults, setSpotifySearchResults] = useState<Track[]>([]);
  const [spotifySearchAlbums, setSpotifySearchAlbums] = useState<any[]>([]);
  const [spotifySearchPlaylists, setSpotifySearchPlaylists] = useState<any[]>([]);
  const [spotifySearchLoading, setSpotifySearchLoading] = useState(false);
  const [userSpotifyPlaylists, setUserSpotifyPlaylists] = useState<Playlist[]>([]);
  const [showSearchSection, setShowSearchSection] = useState(false);
  const [isImportingModal, setIsImportingModal] = useState(false);
  const [importUrlInput, setImportUrlInput] = useState('');
  const [importingStatus, setImportingStatus] = useState<string | null>(null);
  const [playlistTracksMap, setPlaylistTracksMap] = useState<Record<string, Track[]>>({});
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyLoginUrl, setSpotifyLoginUrl] = useState('/api/spotify/auth/login');

  // Radio State
  const [radioStations, setRadioStations] = useState<WebRadioStation[]>([]);
  const [radioSearchQuery, setRadioSearchQuery] = useState('');
  const [radioSearchResults, setRadioSearchResults] = useState<WebRadioStation[]>([]);
  const [radioSearchLoading, setRadioSearchLoading] = useState(false);
  const [isAddingRadioModal, setIsAddingRadioModal] = useState(false);
  const [editingRadioStationId, setEditingRadioStationId] = useState<string | null>(null);
  const [newRadioName, setNewRadioName] = useState('');
  const [newRadioGenre, setNewRadioGenre] = useState('');
  const [newRadioUrl, setNewRadioUrl] = useState('');
  const [newRadioBitrate, setNewRadioBitrate] = useState(192);
  const [newRadioLogoUrl, setNewRadioLogoUrl] = useState('');

  // NAS / Local State — mount config lives in Settings now; NasBrowser owns its own browse state.
  const [localPlaylists, setLocalPlaylists] = useState<Playlist[]>([]);
  const [expandedLocalPlaylistId, setExpandedLocalPlaylistId] = useState<string | null>(null);
  const [nasSubView, setNasSubView] = useState<'library' | 'files'>(
    () => (localStorage.getItem('nas-sub-view') as 'library' | 'files') || 'library',
  );

  useEffect(() => {
    fetchUserSpotifyPlaylists();
    fetchRadioStations();
    fetchSpotifyAccount();

    // Coming back from the Spotify OAuth redirect (/api/spotify/auth/callback)
    if (window.location.search.includes('spotify_auth=')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('spotify_auth');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const fetchSpotifyAccount = async () => {
    try {
      const res = await fetch('/api/spotify/account').then((r) => r.json());
      if (res.account) setSpotifyConnected(Boolean(res.account.isConnected));
      if (res.loginUrl) setSpotifyLoginUrl(res.loginUrl);
    } catch (e) {}
  };

  useEffect(() => {
    if (selectedPlaylistId) {
      loadPlaylistTracks(selectedPlaylistId);
    }
  }, [selectedPlaylistId]);

  const fetchUserSpotifyPlaylists = async () => {
    try {
      const res = await fetch('/api/spotify/user-playlists').then((r) => r.json());
      if (res.playlists && res.playlists.length > 0) {
        const spotifyLists = res.playlists.filter((p: any) => p.isSpotify);
        const nasLists = res.playlists.filter((p: any) => !p.isSpotify);
        setUserSpotifyPlaylists(spotifyLists);
        setLocalPlaylists(nasLists);

        setSelectedPlaylistId((currentId) => {
          if (!currentId || !spotifyLists.some((p: any) => p.id === currentId)) {
            return spotifyLists[0]?.id || '';
          }
          return currentId;
        });
      }
    } catch (e) {}
  };

  const fetchRadioStations = async () => {
    try {
      const res = await fetch('/api/radio/stations').then((r) => r.json());
      if (res.stations) setRadioStations(res.stations);
    } catch (e) {}
  };

  const loadPlaylistTracks = async (playlistId: string) => {
    if (!playlistId) return;
    setPlaylistTracksLoading(true);
    try {
      const res = await fetch(`/api/spotify/playlist/${playlistId}`).then((r) => r.json());
      if (res.success && res.playlist?.tracks) {
        setPlaylistTracksMap((prev) => ({
          ...prev,
          [playlistId]: res.playlist.tracks,
        }));
      }
    } catch (e) {
    } finally {
      setPlaylistTracksLoading(false);
    }
  };

  const handleSearchSpotify = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSpotifySearchResults([]);
      setSpotifySearchAlbums([]);
      setSpotifySearchPlaylists([]);
      return;
    }
    setSpotifySearchLoading(true);
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`).then((r) => r.json());
      if (res.tracks) setSpotifySearchResults(res.tracks);
      if (res.albums) setSpotifySearchAlbums(res.albums);
      if (res.playlists) setSpotifySearchPlaylists(res.playlists);
    } catch (e) {
    } finally {
      setSpotifySearchLoading(false);
    }
  };

  // Actually starts real Spotify playback (track/album/playlist) on the Pi's
  // librespot Connect device via the Web API — requires being logged in
  // (see the "Inloggen bij Spotify" button) and librespot to be running.
  const handlePlaySpotifyUri = async (uri: string, label: string) => {
    try {
      const res = await fetch('/api/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri }),
      }).then((r) => r.json());
      if (!res.success) alert(res.error || `Kon '${label}' niet afspelen`);
    } catch (e: any) {
      alert(`Fout bij afspelen: ${e.message}`);
    }
  };

  const handleDeleteLocalPlaylist = async (id: string) => {
    if (!confirm('Deze afspeellijst verwijderen?')) return;
    try {
      await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      setLocalPlaylists((prev) => prev.filter((p) => p.id !== id));
      if (expandedLocalPlaylistId === id) setExpandedLocalPlaylistId(null);
    } catch (e) {}
  };

  const handleRemoveLocalTrack = async (playlistId: string, trackId: string) => {
    try {
      await onRemoveTrackFromPlaylist(playlistId, trackId);
      setLocalPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), trackCount: p.trackCount - 1 } : p)),
      );
    } catch (e) {}
  };

  const handleReorderPlaylistTrack = async (playlistId: string, trackId: string, toIndex: number) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, toIndex }),
      }).then((r) => r.json());
      if (res.playlist) {
        setLocalPlaylists((prev) => prev.map((p) => (p.id === playlistId ? res.playlist : p)));
      }
    } catch (e) {}
  };

  const handleAddTrackToPlaylistAndRefresh = async (playlistId: string, track: Track) => {
    await onAddTrackToPlaylist(playlistId, track);
    await fetchUserSpotifyPlaylists();
  };

  const handleImportPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrlInput.trim()) return;
    setImportingStatus('Spotify playlist inladen...');
    try {
      const res = await fetch('/api/spotify/import-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId: importUrlInput.trim() }),
      }).then((r) => r.json());

      if (res.success && res.playlist) {
        setUserSpotifyPlaylists((prev) => [res.playlist, ...prev.filter((p) => p.id !== res.playlist.id)]);
        setSelectedPlaylistId(res.playlist.id);
        setPlaylistTracksMap((prev) => ({ ...prev, [res.playlist.id]: res.playlist.tracks }));
        setIsImportingModal(false);
        setImportUrlInput('');
        setImportingStatus(null);
      } else {
        setImportingStatus(res.error || 'Playlist importeren mislukt');
      }
    } catch (e: any) {
      setImportingStatus('Fout bij importeren: ' + e.message);
    }
  };

  // Radio-Browser API Search
  const handleSearchRadio = async (query: string) => {
    setRadioSearchQuery(query);
    if (!query.trim()) {
      setRadioSearchResults([]);
      return;
    }
    setRadioSearchLoading(true);
    try {
      const res = await fetch(`/api/radio/search?q=${encodeURIComponent(query)}`).then((r) => r.json());
      if (res.stations) setRadioSearchResults(res.stations);
    } catch (e) {
    } finally {
      setRadioSearchLoading(false);
    }
  };

  const handlePlayRadio = async (station: WebRadioStation) => {
    try {
      await fetch('/api/radio/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: station.id,
          url: station.url,
          name: station.name,
          genre: station.genre,
          logoUrl: station.logoUrl,
        }),
      });
    } catch (e) {}
  };

  const handleSubmitRadioStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRadioName || !newRadioUrl) return;
    try {
      const body = {
        name: newRadioName,
        genre: newRadioGenre || 'Web Radio',
        url: newRadioUrl,
        bitrate: newRadioBitrate,
        logoUrl: newRadioLogoUrl || undefined,
      };
      const res = await (editingRadioStationId
        ? fetch(`/api/radio/stations/${editingRadioStationId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : fetch('/api/radio/stations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      ).then((r) => r.json());
      if (res.stations) setRadioStations(res.stations);
      setIsAddingRadioModal(false);
      setEditingRadioStationId(null);
      setNewRadioName('');
      setNewRadioGenre('');
      setNewRadioUrl('');
      setNewRadioLogoUrl('');
    } catch (e) {}
  };

  const handleOpenEditRadioStation = (station: WebRadioStation) => {
    setEditingRadioStationId(station.id);
    setNewRadioName(station.name);
    setNewRadioGenre(station.genre);
    setNewRadioUrl(station.url);
    setNewRadioBitrate(station.bitrate || 192);
    setNewRadioLogoUrl(station.logoUrl || '');
    setIsAddingRadioModal(true);
  };

  const handleSaveRadioFromSearch = async (station: WebRadioStation) => {
    try {
      const tempId = 'radio-' + Date.now();
      const newStation = { ...station, id: tempId, isCustom: true };
      setRadioStations((prev) => [newStation, ...prev.filter((s) => s.url !== station.url)]);

      const res = await fetch('/api/radio/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: station.name,
          genre: station.genre,
          url: station.url,
          bitrate: station.bitrate,
          logoUrl: station.logoUrl,
        }),
      }).then((r) => r.json());

      if (res.stations && res.stations.length > 0) {
        setRadioStations(res.stations);
      }
    } catch (e) {}
  };

  const handleDeleteRadioStation = async (id: string) => {
    try {
      const res = await fetch(`/api/radio/stations/${id}`, { method: 'DELETE' }).then((r) => r.json());
      if (res.stations) setRadioStations(res.stations);
    } catch (e) {}
  };

  // No local state update here — the queue arrives via the `queue` prop,
  // refreshed by App.tsx when the WebSocket `queue_update` event comes in
  // (same pattern as `onClearQueue`).
  const handleReorderQueueTrack = async (trackId: string, toIndex: number) => {
    try {
      await fetch('/api/queue/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, toIndex }),
      });
    } catch (e) {}
  };

  const handleRemoveQueueTrack = async (trackId: string) => {
    try {
      await fetch('/api/queue/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
    } catch (e) {}
  };

  const allSpotifyPlaylists = userSpotifyPlaylists;
  const activePlaylist = allSpotifyPlaylists.find((p) => p.id === selectedPlaylistId) || allSpotifyPlaylists[0];

  const formatDuration = (ms: number) => {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const mediaSources: { id: typeof activeMediaSource; label: string; icon: typeof Disc }[] = [
    { id: 'spotify', label: `Spotify Playlists (${allSpotifyPlaylists.length})`, icon: Disc },
    { id: 'radio', label: `Web Radio (${radioStations.length})`, icon: Radio },
    { id: 'local_nas', label: `Lokale & NAS Muziek (${localPlaylists.length})`, icon: HardDrive },
    { id: 'queue', label: `Wachtrij (${queue.length})`, icon: ListMusic },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header & Source Switcher */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--accent-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Disc size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <span style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>Bronnen</span>
            </div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
              Koppel Spotify, Web Radio, Lokale/NAS bestanden en beheer je live wachtrij
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'var(--bg-inset)',
              borderRadius: 'var(--radius-lg)',
              flexWrap: 'wrap',
            }}
          >
            {mediaSources.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeMediaSource === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveMediaSource(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    font: 'var(--text-mono-sm)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    background: isActive ? 'var(--bg-card)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: '1px solid ' + (isActive ? 'var(--border-default)' : 'transparent'),
                    transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast)',
                  }}
                >
                  <Icon size={13} style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* SPOTIFY PLAYLISTS */}
      {activeMediaSource === 'spotify' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!spotifyConnected && (
            <Card>
              <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
                <div>
                  <div style={{ font: 'var(--text-body-strong)', color: 'var(--text-primary)' }}>Niet ingelogd bij Spotify</div>
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
                    Log in om al je eigen playlists te zien en nummers/albums/playlists direct af te spelen.
                  </p>
                </div>
                <Button variant="primary" icon={<LogIn size={14} />} onClick={() => { window.location.href = spotifyLoginUrl; }}>
                  Inloggen bij Spotify
                </Button>
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Button variant="secondary" icon={<Search size={14} />} onClick={() => setShowSearchSection(!showSearchSection)}>
              {showSearchSection ? 'Zoeken sluiten' : 'Zoek live in Spotify catalogus'}
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setIsImportingModal(true)}>
              Spotify playlist importeren (URL)
            </Button>
          </div>

          <Modal
            open={isImportingModal}
            onClose={() => setIsImportingModal(false)}
            icon={<Plus size={18} />}
            title="Spotify afspeellijst importeren"
          >
            <form onSubmit={handleImportPlaylist} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={fieldLabelStyle}>Spotify playlist URL of ID</label>
                <input
                  type="text"
                  placeholder="Plak Spotify playlist link (bijv. https://open.spotify.com/playlist/...)"
                  value={importUrlInput}
                  onChange={(e) => setImportUrlInput(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {importingStatus && (
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>{importingStatus}</p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="ghost" onClick={() => setIsImportingModal(false)}>
                  Annuleren
                </Button>
                <Button variant="primary">Playlist inladen</Button>
              </div>
            </form>
          </Modal>

          {showSearchSection && (
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-inset)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Zoek live in Spotify op nummer, artiest of album..."
                    value={searchQuery}
                    onChange={(e) => handleSearchSpotify(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', font: 'var(--text-body)', color: 'var(--text-primary)' }}
                  />
                </div>

                {spotifySearchLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Live zoeken via Spotify Web API...</span>
                  </div>
                )}

                {spotifySearchResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ ...sectionLabelStyle, padding: '0 2px' }}>Nummers</span>
                    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 10 }}>
                      {spotifySearchResults.map((track) => (
                        <div
                          key={track.id}
                          className="flex items-center justify-between min-w-0"
                          style={{ gap: 12, padding: 10, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
                        >
                          <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                            <img
                              src={track.coverUrl}
                              alt={track.title}
                              className="flex-shrink-0"
                              style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                                {track.title}
                              </p>
                              <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                                {track.artist}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
                            <button
                              onClick={() => handlePlaySpotifyUri(track.uri, track.title)}
                              title="Speel direct af"
                              style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--on-accent)' }}
                            >
                              <Play size={14} fill="currentColor" />
                            </button>
                            <button
                              onClick={() => onAddToQueue(track)}
                              title="Voeg toe aan wachtrij"
                              style={{
                                padding: 8,
                                borderRadius: 'var(--radius-md)',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--accent)',
                              }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {spotifySearchAlbums.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ ...sectionLabelStyle, padding: '0 2px' }}>Albums</span>
                    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 10 }}>
                      {spotifySearchAlbums.map((album) => (
                        <div
                          key={album.id}
                          className="flex items-center justify-between min-w-0"
                          style={{ gap: 12, padding: 10, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
                        >
                          <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                            <img
                              src={album.coverUrl}
                              alt={album.name}
                              className="flex-shrink-0"
                              style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                                {album.name}
                              </p>
                              <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                                {album.description}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handlePlaySpotifyUri(album.uri, album.name)}
                            title="Speel album af"
                            style={{ flexShrink: 0, padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--on-accent)' }}
                          >
                            <Play size={14} fill="currentColor" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {spotifySearchPlaylists.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ ...sectionLabelStyle, padding: '0 2px' }}>Afspeellijsten</span>
                    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 10 }}>
                      {spotifySearchPlaylists.map((pl) => (
                        <div
                          key={pl.id}
                          className="flex items-center justify-between min-w-0"
                          style={{ gap: 12, padding: 10, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
                        >
                          <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                            <img
                              src={pl.coverUrl}
                              alt={pl.name}
                              className="flex-shrink-0"
                              style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                                {pl.name}
                              </p>
                              <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                                {pl.trackCount} nummers
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handlePlaySpotifyUri(pl.uri, pl.name)}
                            title="Speel afspeellijst af"
                            style={{ flexShrink: 0, padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--on-accent)' }}
                          >
                            <Play size={14} fill="currentColor" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Playlist Selector + Live Tracks */}
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]" style={{ gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...sectionLabelStyle, padding: '0 4px' }}>
                Mijn Spotify account playlists ({allSpotifyPlaylists.length})
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allSpotifyPlaylists.map((playlist) => {
                  const isSelected = playlist.id === (activePlaylist?.id || '');
                  return (
                    <div
                      key={playlist.id}
                      onClick={() => setSelectedPlaylistId(playlist.id)}
                      className="flex items-center min-w-0"
                      style={{
                        gap: 12,
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--accent-soft)' : 'var(--bg-card)',
                        border: '1px solid ' + (isSelected ? 'var(--accent-soft-strong)' : 'var(--border-subtle)'),
                        transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast)',
                      }}
                    >
                      <img
                        src={playlist.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80'}
                        alt={playlist.name}
                        className="flex-shrink-0"
                        style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' }}>
                          {playlist.name}
                        </div>
                        <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                          {playlist.trackCount || 0} nummers
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayPlaylist(playlist.id);
                        }}
                        className="flex-shrink-0"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--accent)',
                          color: 'var(--on-accent)',
                        }}
                      >
                        <Play size={14} fill="currentColor" style={{ marginLeft: 1 }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <Card>
              {activePlaylist ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div
                    className="flex flex-wrap items-center justify-between"
                    style={{ gap: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}
                  >
                    <div className="flex items-center" style={{ gap: 14 }}>
                      <img
                        src={activePlaylist.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80'}
                        alt={activePlaylist.name}
                        style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', objectFit: 'cover' }}
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{activePlaylist.name}</div>
                        <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                          {activePlaylist.description}
                        </div>
                      </div>
                    </div>
                    <Button variant="primary" icon={<Play size={14} fill="currentColor" />} onClick={() => onPlayPlaylist(activePlaylist.id)}>
                      Speel alles af
                    </Button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(() => {
                      const currentTracks = playlistTracksMap[activePlaylist?.id] || activePlaylist?.tracks || [];
                      if (playlistTracksLoading && currentTracks.length === 0) {
                        return (
                          <div
                            className="flex items-center justify-center"
                            style={{ gap: 8, padding: '24px 0', font: 'var(--text-mono-sm)', color: 'var(--accent)' }}
                          >
                            <Loader2 size={13} className="animate-spin" />
                            <span>Live nummers ophalen via Spotify Web API...</span>
                          </div>
                        );
                      }
                      if (currentTracks.length > 0) {
                        return currentTracks.map((track, idx) => (
                          <div
                            key={track.id}
                            className="flex items-center min-w-0"
                            style={{ gap: 12, padding: '10px 8px', borderRadius: 'var(--radius-md)' }}
                          >
                            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', width: 18, textAlign: 'center' }}>
                              {idx + 1}
                            </span>
                            <img
                              src={track.coverUrl}
                              alt={track.title}
                              className="flex-shrink-0"
                              style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                                {track.title}
                              </div>
                              <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                                {track.artist}
                              </div>
                            </div>
                            <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                              {formatDuration(track.durationMs)}
                            </span>
                            <button
                              onClick={() => handlePlaySpotifyUri(track.uri, track.title)}
                              title="Speel direct af"
                              style={{ color: 'var(--accent)', padding: 4, flexShrink: 0 }}
                            >
                              <Play size={14} fill="currentColor" />
                            </button>
                            <button
                              onClick={() => onAddToQueue(track)}
                              title="Voeg toe aan wachtrij"
                              style={{ color: 'var(--accent)', padding: 4, flexShrink: 0 }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        ));
                      }
                      return (
                        <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
                          Geen nummers gevonden in deze afspeellijst.
                        </p>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div style={emptyStateStyle}>
                  <Disc size={28} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--text-muted)' }} />
                  <p style={{ font: 'var(--text-body)', color: 'var(--text-secondary)' }}>Geen Spotify afspeellijsten aanwezig.</p>
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
                    Gebruik "Spotify playlist importeren (URL)" om een afspeellijst toe te voegen.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* WEB RADIO & RADIO-BROWSER API SEARCH */}
      {activeMediaSource === 'radio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <span style={sectionLabelStyle}>Mijn web radio zenders ({radioStations.length})</span>
            <Button
              variant="secondary"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditingRadioStationId(null);
                setNewRadioName('');
                setNewRadioGenre('');
                setNewRadioUrl('');
                setNewRadioBitrate(192);
                setNewRadioLogoUrl('');
                setIsAddingRadioModal(true);
              }}
            >
              Zender handmatig toevoegen
            </Button>
          </div>

          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="flex items-center" style={{ gap: 8, font: 'var(--text-label)', letterSpacing: 'var(--letter-label)', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                <Globe size={14} style={{ color: 'var(--accent)' }} />
                <span>Zoek wereldwijd in 40.000+ internet radio zenders</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: 'var(--bg-inset)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Zoek live op zendernaam, genre of stad (bijv. NPO Radio 1, Jazz, BBC, Paris)..."
                  value={radioSearchQuery}
                  onChange={(e) => handleSearchRadio(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', font: 'var(--text-body)', color: 'var(--text-primary)' }}
                />
              </div>

              {radioSearchLoading && (
                <div className="flex items-center" style={{ gap: 8, font: 'var(--text-mono-sm)', color: 'var(--accent)' }}>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Live zenders zoeken via Radio-Browser API...</span>
                </div>
              )}

              {radioSearchResults.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 10 }}>
                  {radioSearchResults.map((station) => (
                    <div
                      key={station.id}
                      className="flex items-center justify-between min-w-0"
                      style={{ gap: 10, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
                    >
                      <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                        <img
                          src={station.logoUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80'}
                          alt={station.name}
                          className="flex-shrink-0"
                          style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover' }}
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                            {station.name}
                          </p>
                          <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                            {station.genre}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
                        <button
                          onClick={() => handlePlayRadio(station)}
                          title="Speel zender af"
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--accent)',
                            color: 'var(--on-accent)',
                          }}
                        >
                          <Radio size={13} />
                        </button>
                        <button
                          onClick={() => handleSaveRadioFromSearch(station)}
                          title="Bewaar in mijn zenders"
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--accent)',
                          }}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Modal
            open={isAddingRadioModal}
            onClose={() => { setIsAddingRadioModal(false); setEditingRadioStationId(null); }}
            icon={<Radio size={18} />}
            title={editingRadioStationId ? 'Web radio zender bewerken' : 'Web radio zender handmatig toevoegen'}
          >
            <form onSubmit={handleSubmitRadioStation} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={fieldLabelStyle}>Zendernaam</label>
                <input
                  type="text"
                  placeholder="Bijv. NPO Radio 1"
                  value={newRadioName}
                  onChange={(e) => setNewRadioName(e.target.value)}
                  style={inputStyle}
                  required
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Genre / omschrijving</label>
                <input
                  type="text"
                  placeholder="Bijv. Nieuws & Achtergronden"
                  value={newRadioGenre}
                  onChange={(e) => setNewRadioGenre(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Stream URL (.mp3 / .aac / .m3u)</label>
                <input
                  type="text"
                  placeholder="Bijv. https://icecast.omroep.nl/radio1-bb-mp3"
                  value={newRadioUrl}
                  onChange={(e) => setNewRadioUrl(e.target.value)}
                  style={inputStyle}
                  required
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Bitrate (kbps)</label>
                <input
                  type="number"
                  value={newRadioBitrate}
                  onChange={(e) => setNewRadioBitrate(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Logo (URL naar afbeelding, optioneel)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="text"
                    placeholder="Bijv. https://.../logo.png"
                    value={newRadioLogoUrl}
                    onChange={(e) => setNewRadioLogoUrl(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {newRadioLogoUrl && (
                    <img
                      src={newRadioLogoUrl}
                      alt="Voorbeeld"
                      referrerPolicy="no-referrer"
                      style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-inset)' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                      onLoad={(e) => { (e.target as HTMLImageElement).style.visibility = 'visible'; }}
                    />
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="ghost" onClick={() => { setIsAddingRadioModal(false); setEditingRadioStationId(null); }}>
                  Annuleren
                </Button>
                <Button variant="primary">{editingRadioStationId ? 'Wijzigingen opslaan' : 'Zender opslaan'}</Button>
              </div>
            </form>
          </Modal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 14 }}>
            {radioStations.map((station) => (
              <Card key={station.id} hoverable>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="flex items-center justify-between min-w-0" style={{ gap: 10 }}>
                    <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                      <img
                        src={station.logoUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80'}
                        alt={station.name}
                        className="flex-shrink-0"
                        style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', objectFit: 'cover' }}
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <div className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 13, color: 'var(--text-primary)' }}>
                          {station.name}
                        </div>
                        <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                          {station.genre}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-shrink-0" style={{ gap: 4 }}>
                      <button
                        onClick={() => handleOpenEditRadioStation(station)}
                        title="Logo/gegevens bewerken"
                        style={{ padding: 6, borderRadius: 'var(--radius-md)', color: 'var(--text-muted)' }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRadioStation(station.id)}
                        title="Zender verwijderen"
                        style={{ padding: 6, borderRadius: 'var(--radius-md)', color: 'var(--text-muted)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <Button variant="secondary" icon={<Radio size={14} />} onClick={() => handlePlayRadio(station)}>
                    Speel radio af
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* LOCAL & NAS MUSIC ENGINE */}
      {activeMediaSource === 'local_nas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* App-native afspeellijsten gelden hier alleen voor NAS-bestanden — Spotify
              afspeellijsten leven en worden beheerd in je Spotify account zelf. */}
          <Card>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div className="flex items-center" style={{ gap: 8 }}>
                <ListMusic size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={sectionLabelStyle}>Mijn NAS afspeellijsten ({localPlaylists.length})</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={13} />}
                onClick={async () => {
                  const name = prompt('Naam voor de nieuwe afspeellijst:');
                  if (!name || !name.trim()) return;
                  await onCreatePlaylist(name.trim(), 'Handmatig aangemaakt in HSS');
                  await fetchUserSpotifyPlaylists();
                }}
              >
                Nieuwe playlist
              </Button>
            </div>
            {localPlaylists.length === 0 ? (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '8px 0' }}>
                Nog geen afspeellijsten. Gebruik "Maak afspeellijst van deze map" hieronder om er een aan te maken.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {localPlaylists.map((pl) => {
                  const isExpanded = expandedLocalPlaylistId === pl.id;
                  return (
                    <div key={pl.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                      <div className="flex items-center justify-between min-w-0" style={{ gap: 10, padding: 10, background: 'var(--bg-inset)' }}>
                        <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                          <img
                            src={pl.coverUrl}
                            alt={pl.name}
                            className="flex-shrink-0"
                            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
                          />
                          <div className="min-w-0">
                            <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                              {pl.name}
                            </p>
                            <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                              {pl.trackCount} nummers
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
                          <button
                            onClick={() => onPlayPlaylist(pl.id)}
                            title="Speel af"
                            style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--on-accent)' }}
                          >
                            <Play size={13} fill="currentColor" />
                          </button>
                          <button
                            onClick={() => setExpandedLocalPlaylistId(isExpanded ? null : pl.id)}
                            title="Nummers tonen"
                            style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                          >
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                          <button
                            onClick={() => handleDeleteLocalPlaylist(pl.id)}
                            title="Afspeellijst verwijderen"
                            style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--status-danger, #f87171)' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}>
                          {pl.tracks.length === 0 && (
                            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '8px 4px' }}>Geen nummers.</p>
                          )}
                          {pl.tracks.map((track, trackIdx) => (
                            <div key={track.id} className="flex items-center justify-between min-w-0" style={{ gap: 10, padding: '6px 8px' }}>
                              <div className="min-w-0">
                                <p className="truncate" style={{ font: 'var(--text-body)', fontSize: 12, color: 'var(--text-primary)' }}>
                                  {track.title}
                                </p>
                                <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>{track.artist}</p>
                              </div>
                              <div className="flex items-center flex-shrink-0" style={{ gap: 2 }}>
                                <button
                                  onClick={() => trackIdx > 0 && handleReorderPlaylistTrack(pl.id, track.id, trackIdx - 1)}
                                  disabled={trackIdx === 0}
                                  title="Omhoog"
                                  style={{ padding: 4, color: trackIdx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: trackIdx === 0 ? 0.4 : 1 }}
                                >
                                  <ChevronUp size={12} />
                                </button>
                                <button
                                  onClick={() => trackIdx < pl.tracks.length - 1 && handleReorderPlaylistTrack(pl.id, track.id, trackIdx + 1)}
                                  disabled={trackIdx === pl.tracks.length - 1}
                                  title="Omlaag"
                                  style={{ padding: 4, color: trackIdx === pl.tracks.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: trackIdx === pl.tracks.length - 1 ? 0.4 : 1 }}
                                >
                                  <ChevronDown size={12} />
                                </button>
                                <button
                                  onClick={() => handleRemoveLocalTrack(pl.id, track.id)}
                                  title="Verwijder uit afspeellijst"
                                  style={{ color: 'var(--text-muted)', padding: 4 }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="flex items-center" style={{ gap: 2, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)', padding: 2, alignSelf: 'flex-start' }}>
            <button
              onClick={() => { setNasSubView('library'); localStorage.setItem('nas-sub-view', 'library'); }}
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', font: 'var(--text-mono-sm)', background: nasSubView === 'library' ? 'var(--accent-soft)' : 'transparent', color: nasSubView === 'library' ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              Muziekbibliotheek
            </button>
            <button
              onClick={() => { setNasSubView('files'); localStorage.setItem('nas-sub-view', 'files'); }}
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', font: 'var(--text-mono-sm)', background: nasSubView === 'files' ? 'var(--accent-soft)' : 'transparent', color: nasSubView === 'files' ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              Bestanden
            </button>
          </div>
          {nasSubView === 'library' ? (
            <NasMusicLibrary
              onAddToQueue={onAddToQueue}
              playlists={localPlaylists.map((pl) => ({ id: pl.id, name: pl.name }))}
              onAddTrackToPlaylist={handleAddTrackToPlaylistAndRefresh}
            />
          ) : (
            <NasBrowser onAddToQueue={onAddToQueue} onPlaylistCreated={fetchUserSpotifyPlaylists} />
          )}
        </div>
      )}

      {/* LIVE AUDIO QUEUE MANAGER */}
      {activeMediaSource === 'queue' && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              className="flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}
            >
              <div className="flex items-center" style={{ gap: 12 }}>
                <ListMusic size={20} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Live audio wachtrij</div>
                  <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {queue.length} nummers in wachtrij
                  </p>
                </div>
              </div>

              {queue.length > 0 && (
                <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={onClearQueue}>
                  Wachtrij leegmaken
                </Button>
              )}
            </div>

            {queue.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queue.map((track, idx) => (
                  <div
                    key={`${track.id}-${idx}`}
                    className="flex items-center justify-between min-w-0"
                    onClick={() => onSelectTrackFromQueue?.(track)}
                    style={{ gap: 12, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', cursor: onSelectTrackFromQueue ? 'pointer' : 'default' }}
                  >
                    <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                      <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', width: 18, textAlign: 'center' }}>
                        {idx + 1}
                      </span>
                      <img
                        src={track.coverUrl}
                        alt={track.title}
                        className="flex-shrink-0"
                        style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }}
                      />
                      <div className="min-w-0">
                        <p className="truncate" style={{ font: 'var(--text-body-strong)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                          {track.title}
                        </p>
                        <p className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                          {track.artist}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center flex-shrink-0" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <span style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginRight: 8 }}>
                        {formatDuration(track.durationMs)}
                      </span>
                      <button
                        onClick={() => idx > 0 && handleReorderQueueTrack(track.id, idx - 1)}
                        disabled={idx === 0}
                        title="Omhoog"
                        style={{ padding: 4, color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: idx === 0 ? 0.4 : 1 }}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => idx < queue.length - 1 && handleReorderQueueTrack(track.id, idx + 1)}
                        disabled={idx === queue.length - 1}
                        title="Omlaag"
                        style={{ padding: 4, color: idx === queue.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: idx === queue.length - 1 ? 0.4 : 1 }}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button onClick={() => handleRemoveQueueTrack(track.id)} title="Verwijder uit wachtrij" style={{ padding: 4, color: 'var(--text-muted)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={emptyStateStyle}>
                <ListMusic size={26} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--text-muted)' }} />
                <p style={{ font: 'var(--text-body)', color: 'var(--text-secondary)' }}>De wachtrij is momenteel leeg.</p>
                <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
                  Zoek nummers via Spotify of Web Radio om ze direct toe te voegen.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};
