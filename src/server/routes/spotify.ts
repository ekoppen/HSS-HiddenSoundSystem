// Spotify artwork/lookup helpers, user OAuth login, search/browse/import,
// and the real-time Connect event webhook from librespot. The shared
// credential/transport chain (getSpotifyClientId/getSpotifyAppCredentials..
// sendSpotifyPlayerCommand) lives in state.ts since playback/playlists also
// call into it. Two separate Spotify auth paths: user login (Authorization
// Code + PKCE, getSpotifyClientId — no secret) and the app-level search
// feature (client_credentials, getSpotifyAppCredentials — needs both).
import crypto from 'crypto';
import express from 'express';
import { INITIAL_TRACKS } from '../../services/mockPiData.ts';
import { piHardware } from '../../services/piHardware.ts';
import { Track } from '../../types.ts';
import {
  getCachedArtwork,
  getDbImportedPlaylists,
  getDbSpotifyAccount,
  saveDbImportedPlaylist,
  setCachedArtwork,
  setDbSpotifyAccount,
} from '../../../db.ts';
import {
  advanceLocalQueue,
  broadcastWebSocket,
  cancelPendingAutoStopCast,
  clearSpotifyToStandby,
  dacConfig,
  exitCastStandby,
  findSpotifyConnectDeviceId,
  getSpotifyApiAccessToken,
  getSpotifyClientId,
  getSpotifyUserAccessToken,
  PORT,
  hubConfig,
  isLocalPlayerActive,
  maybeAutoCast,
  playbackState,
  playSpotifyUri,
  queueControlsPlayback,
  requireAudioPermission,
  saveDiskConfig,
  scheduleAutoStopCast,
  sendSpotifyPlayerCommand,
  setQueueControlsPlayback,
  SPOTIFY_PAUSED_IDLE_MS,
  stopExternalListening,
  stopLocal,
} from '../state.ts';

const router = express.Router();

// Spotify Artwork & Metadata Resolver
router.get('/api/spotify/artwork', async (req, res) => {
  const uri = (req.query.uri as string) || '';
  const url = (req.query.url as string) || '';
  const target = url || (uri.startsWith('spotify:') ? `https://open.spotify.com/${uri.replace('spotify:', '').replace(':', '/')}` : '');

  // Check if matching in local tracks first
  const matchedTrack = INITIAL_TRACKS.find(
    (t) => (uri && t.uri === uri) || (url && t.uri.includes(url.split('/').pop() || ''))
  );

  if (matchedTrack) {
    res.json({
      success: true,
      title: matchedTrack.title,
      artist: matchedTrack.artist,
      album: matchedTrack.album,
      coverUrl: matchedTrack.coverUrl,
      highResCoverUrl: matchedTrack.highResCoverUrl || matchedTrack.coverUrl,
      artistCoverUrl: matchedTrack.artistCoverUrl,
      dominantColor: matchedTrack.dominantColor || '#4f46e5',
      releaseYear: matchedTrack.releaseYear,
      recordLabel: matchedTrack.recordLabel,
    });
    return;
  }

  if (target) {
    try {
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`);
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        res.json({
          success: true,
          title: data.title,
          coverUrl: data.thumbnail_url,
          highResCoverUrl: data.thumbnail_url,
          dominantColor: '#10b981',
        });
        return;
      }
    } catch (e) {
      // Fallback below
    }
  }

  // Default fallback artwork
  res.json({
    success: true,
    title: playbackState.currentTrack?.title || 'Spotify Track',
    coverUrl: playbackState.currentTrack?.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    highResCoverUrl: playbackState.currentTrack?.highResCoverUrl || playbackState.currentTrack?.coverUrl,
    dominantColor: playbackState.currentTrack?.dominantColor || '#4f46e5',
  });
});

router.post('/api/spotify/lookup', async (req, res) => {
  const { query, spotifyUrlOrUri } = req.body;
  const target = spotifyUrlOrUri || query;
  if (!target) {
    res.status(400).json({ error: 'Geen query of Spotify URL opgegeven' });
    return;
  }

  // Match in known library
  const matched = INITIAL_TRACKS.find(
    (t) =>
      t.title.toLowerCase().includes(target.toLowerCase()) ||
      t.artist.toLowerCase().includes(target.toLowerCase()) ||
      (t.uri && t.uri === target)
  );

  if (matched) {
    res.json({ success: true, track: matched });
    return;
  }

  // Try Spotify oEmbed
  if (target.includes('open.spotify.com') || target.startsWith('spotify:')) {
    try {
      const webUrl = target.startsWith('spotify:')
        ? `https://open.spotify.com/${target.replace('spotify:', '').replace(':', '/')}`
        : target;
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(webUrl)}`);
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        const generatedTrack: Track = {
          id: 'spotify-imported-' + Date.now(),
          title: data.title || 'Spotify Nummer',
          artist: 'Spotify Artiest',
          album: 'Spotify Album',
          coverUrl: data.thumbnail_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
          highResCoverUrl: data.thumbnail_url,
          durationMs: 210000,
          uri: target,
          bitrate: 320,
          sampleRate: 44100,
          bitDepth: 24,
          dominantColor: '#10b981',
        };
        res.json({ success: true, track: generatedTrack });
        return;
      }
    } catch (err) {
      console.warn('Spotify oEmbed fetch failed:', err);
    }
  }

  res.json({
    success: true,
    track: {
      id: 'spotify-custom-' + Date.now(),
      title: target,
      artist: 'Geïmporteerde Artiest',
      album: 'Spotify HiFi Stream',
      coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
      highResCoverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&auto=format&fit=crop&q=90',
      durationMs: 240000,
      uri: `spotify:track:${Date.now()}`,
      bitrate: 320,
      dominantColor: '#6366f1',
    },
  });
});

// 6.5. Spotify Account & Connection Testing Endpoints — backed by the real
// OAuth tokens in the spotify_account table (see the login/callback routes
// further down), not a hardcoded identity.
router.get('/api/spotify/account', (req, res) => {
  const account = getDbSpotifyAccount();
  res.json({
    success: true,
    account: {
      isConnected: account.isConnected,
      displayName: account.displayName,
      email: account.email,
      product: account.product || 'premium',
      avatarUrl: account.avatarUrl,
      deviceName: hubConfig.spotifyDeviceName || 'HSSwoonkamer',
      bitrate: hubConfig.spotifyBitrate || 320,
    },
    // The login flow needs the HTTPS-only listener (see selfSignedCert.ts
    // in server.ts) — Spotify rejects a plain-http redirect_uri.
    loginUrl: `https://${req.hostname}:${PORT + 1}/api/spotify/auth/login`,
  });
});

router.post('/api/spotify/test', async (req, res) => {
  const startTime = Date.now();
  const userToken = await getSpotifyUserAccessToken();

  if (!userToken) {
    return res.json({
      success: false,
      status: 'unauthenticated',
      message: 'Geen actieve Spotify login gevonden. Gebruik "Inloggen bij Spotify" om te koppelen.',
      latencyMs: Date.now() - startTime,
    });
  }

  try {
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!meRes.ok) throw new Error(`Spotify /me gaf ${meRes.status}`);
    const me = await meRes.json();
    const deviceId = await findSpotifyConnectDeviceId(userToken);

    res.json({
      success: true,
      status: 'active',
      message: 'Verbinding met Spotify account succesvol geverifieerd!',
      account: {
        displayName: me.display_name,
        email: me.email,
        product: me.product,
        country: me.country,
      },
      device: {
        id: deviceId,
        name: hubConfig.spotifyDeviceName || 'HSSwoonkamer',
        is_active: Boolean(deviceId),
        volume_percent: playbackState.volume,
      },
      latencyMs: Date.now() - startTime,
    });
  } catch (e: any) {
    res.json({
      success: false,
      status: 'error',
      message: `Spotify verbindingstest mislukt: ${e.message}`,
      latencyMs: Date.now() - startTime,
    });
  }
});

// ==========================================
// SPOTIFY USER LOGIN (Authorization Code flow)
// ==========================================
// Needed for anything scoped to "the logged-in user" — their real playlists
// (GET /me/playlists) and starting playback on their behalf (PUT
// /me/player/play) — which the client-credentials token above cannot do at
// all (it has no user context). Tokens persist in the spotify_account table.
const SPOTIFY_OAUTH_SCOPES =
  'playlist-read-private playlist-read-collaborative user-read-private user-read-email user-read-playback-state user-modify-playback-state';
let pendingSpotifyOAuthState: string | null = null;
let pendingSpotifyOAuthStateExpiresAt = 0;
let pendingSpotifyCodeVerifier: string | null = null;
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

function spotifyRedirectUri(req: express.Request): string {
  return `${req.protocol}://${req.get('host')}/api/spotify/auth/callback`;
}

// The login round-trip runs on the HTTPS-only port (Spotify requires it —
// see selfSignedCert.ts), but that port only exists for this one flow —
// once it's done, send the browser back to the app's normal HTTP port
// rather than leaving it sitting on the self-signed-cert origin.
function returnToAppUrl(req: express.Request, query: string): string {
  // Always http — PORT is the plain HTTP listener regardless of which
  // protocol this callback request itself arrived over.
  return `http://${req.hostname}:${PORT}/${query}`;
}

// Authorization Code + PKCE — no client_secret anywhere in this flow. This
// app runs on whatever Pi a user owns rather than a server Eelko controls,
// so it can't keep a secret confidential the way a traditional web-app
// backend can; PKCE is Spotify's (and OAuth's) recommended flow for exactly
// this "public client" case, and is how consumer apps like Volumio let you
// just click "Log in" without creating your own Spotify app first.
function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

router.get('/api/spotify/auth/login', (req, res) => {
  const clientId = getSpotifyClientId();
  if (!clientId) {
    return res.status(400).json({ error: 'Stel eerst je Spotify Client ID in bij Instellingen' });
  }
  pendingSpotifyOAuthState = crypto.randomBytes(16).toString('hex');
  pendingSpotifyOAuthStateExpiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  const { verifier, challenge } = generatePkcePair();
  pendingSpotifyCodeVerifier = verifier;
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', spotifyRedirectUri(req));
  authUrl.searchParams.set('scope', SPOTIFY_OAUTH_SCOPES);
  authUrl.searchParams.set('state', pendingSpotifyOAuthState);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  res.redirect(authUrl.toString());
});

router.get('/api/spotify/auth/callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.redirect(returnToAppUrl(req, `?spotify_auth=error&reason=${encodeURIComponent(error)}`));
  // An abandoned login left `pendingSpotifyOAuthState` valid forever otherwise —
  // a stale state token, if it ever leaked (e.g. via referrer or browser
  // history), stayed usable indefinitely to complete a spoofed callback.
  const stateExpired = Date.now() > pendingSpotifyOAuthStateExpiresAt;
  if (!code || !state || state !== pendingSpotifyOAuthState || stateExpired) {
    return res.redirect(returnToAppUrl(req, '?spotify_auth=error&reason=state_mismatch'));
  }
  pendingSpotifyOAuthState = null;
  const codeVerifier = pendingSpotifyCodeVerifier;
  pendingSpotifyCodeVerifier = null;

  const clientId = getSpotifyClientId();
  if (!clientId || !codeVerifier) return res.redirect(returnToAppUrl(req, '?spotify_auth=error&reason=no_credentials'));

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: spotifyRedirectUri(req),
        client_id: clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokenData = await tokenRes.json();

    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = meRes.ok ? await meRes.json() : {};

    setDbSpotifyAccount({
      isConnected: true,
      displayName: me.display_name || null,
      email: me.email || null,
      product: me.product || 'premium',
      avatarUrl: me.images?.[0]?.url || null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    res.redirect(returnToAppUrl(req, '?spotify_auth=success'));
  } catch (e: any) {
    console.error('[Spotify OAuth] Callback failed:', e.message);
    res.redirect(returnToAppUrl(req, '?spotify_auth=error&reason=token_exchange_failed'));
  }
});

router.post('/api/spotify/play', requireAudioPermission('audio:control'), async (req, res) => {
  const { uri } = req.body || {};
  if (!uri) return res.status(400).json({ error: 'Spotify URI is verplicht' });
  const result = await playSpotifyUri(uri);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(409).json({ error: result.error });
  }
});

// Live Spotify Search API
router.get('/api/spotify/search', async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) return res.json({ success: true, tracks: [], albums: [], playlists: [] });

  try {
    const token = await getSpotifyApiAccessToken();
    if (!token) {
      return res.status(401).json({ error: 'Spotify Client ID / Secret niet ingesteld in Instellingen' });
    }

    // This app's Spotify quota rejects /v1/search with limit > 10 ("Invalid limit",
    // verified empirically — 12 and 20 both 400, 10 is the highest that works).
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,album,playlist&limit=10`;
    const apiRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error('[Spotify Search Error]', apiRes.status, errBody);
      return res.status(apiRes.status).json({ error: `Spotify Search error (${apiRes.status}): ${errBody}` });
    }

    const data = await apiRes.json();
    const tracks = (data.tracks?.items || []).map((item: any) => {
      const coverUrl = item.album?.images[0]?.url || item.album?.images[1]?.url || '';
      return {
        id: item.id,
        title: item.name,
        artist: item.artists.map((a: any) => a.name).join(', '),
        album: item.album?.name || 'Spotify Track',
        coverUrl: coverUrl,
        highResCoverUrl: coverUrl,
        durationMs: item.duration_ms || 200000,
        uri: item.uri,
        bitrate: 320,
        sampleRate: 44100,
        bitDepth: 24,
        dominantColor: '#10b981',
        releaseYear: item.album?.release_date?.substring(0, 4),
      };
    });

    const playlists = (data.playlists?.items || [])
      .filter((item: any) => item && item.id && item.name)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description || 'Spotify Afspeellijst',
        coverUrl: (item.images && item.images[0]?.url) || '',
        trackCount: item.tracks?.total || 0,
        uri: item.uri,
        isSpotify: true,
        audioProfileName: 'Spotify Connect Direct',
        tracks: [],
      }));

    const albums = (data.albums?.items || [])
      .filter((item: any) => item && item.id && item.name)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.artists?.map((a: any) => a.name).join(', ') || 'Spotify Album',
        coverUrl: (item.images && item.images[0]?.url) || '',
        trackCount: item.total_tracks || 0,
        uri: item.uri,
        releaseYear: item.release_date?.substring(0, 4),
      }));

    res.json({ success: true, tracks, albums, playlists });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Live Spotify Featured & Browse Playlists
router.get('/api/spotify/featured', async (req, res) => {
  try {
    const token = await getSpotifyApiAccessToken();
    let spotifyPlaylists: any[] = [];

    if (token) {
      const featRes = await fetch('https://api.spotify.com/v1/browse/featured-playlists?limit=12', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (featRes.ok) {
        const data = await featRes.json();
        spotifyPlaylists = (data.playlists?.items || [])
          .filter((item: any) => item && item.id && item.name)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.description || 'Spotify Featured Afspeellijst',
            coverUrl: (item.images && item.images[0]?.url) || '',
            tracksCount: item.tracks?.total || 0,
            audioProfileName: 'Spotify Connect Direct',
            tracks: [],
          }));
      }
    }

    res.json({ success: true, playlists: spotifyPlaylists });
  } catch (e) {
    res.json({ success: true, playlists: [] });
  }
});

// Helper to extract full real track list from Spotify embed JSON (100% reliable)
async function fetchSpotifyEmbedPlaylist(playlistId: string): Promise<any | null> {
  try {
    let cleanId = playlistId.trim();
    if (cleanId.includes('spotify.com/playlist/')) {
      cleanId = cleanId.split('spotify.com/playlist/')[1].split('?')[0].split('/')[0];
    } else if (cleanId.startsWith('spotify:playlist:')) {
      cleanId = cleanId.replace('spotify:playlist:', '');
    }

    const embedUrl = `https://open.spotify.com/embed/playlist/${cleanId}`;
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script id="resource" type="application\/json">(.*?)<\/script>/s) || html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!match) return null;

    const json = JSON.parse(match[1]);
    const state = json.props?.pageProps?.state || json.props?.pageProps;
    const entity = state?.data?.entity;
    if (!entity) return null;

    let oembedCover = '';
    let oembedTitle = '';
    try {
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${cleanId}`);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.thumbnail_url) oembedCover = oembedData.thumbnail_url;
        if (oembedData.title) oembedTitle = oembedData.title;
      }
    } catch (e) {}

    const coverUrl = oembedCover || entity.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
    const playlistName = entity.name || oembedTitle || 'Spotify Afspeellijst';
    // Fetch individual track album covers in parallel
    const tracksWithCovers = await Promise.all(
      (entity.trackList || []).map(async (t: any, idx: number) => {
        const trackId = t.uri ? t.uri.replace('spotify:track:', '') : `embed-tr-${idx}`;
        let trackCover = coverUrl;
        if (trackId && !trackId.startsWith('embed-tr-')) {
          try {
            const trOembed = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
            if (trOembed.ok) {
              const trData = await trOembed.json();
              if (trData.thumbnail_url) trackCover = trData.thumbnail_url;
            }
          } catch (e) {}
        }

        return {
          id: trackId,
          title: t.title || 'Spotify Track',
          artist: t.subtitle || t.artist || 'Spotify Artist',
          album: playlistName,
          coverUrl: trackCover,
          highResCoverUrl: trackCover,
          durationMs: t.duration || t.duration_ms || 200000,
          uri: t.uri || `spotify:track:${trackId}`,
          bitrate: 320,
          sampleRate: 44100,
          bitDepth: 24,
          dominantColor: '#10b981',
        };
      })
    );

    const importedPlaylist = {
      id: cleanId,
      name: playlistName,
      description: entity.subtitle || 'Geïmporteerde Spotify Afspeellijst',
      coverUrl: coverUrl,
      trackCount: tracksWithCovers.length,
      tracks: tracksWithCovers,
      isSpotify: true,
      uri: `spotify:playlist:${cleanId}`,
    };

    // Permanently persist to SQLite DB!
    saveDbImportedPlaylist(importedPlaylist);

    return importedPlaylist;
  } catch (e) {
    return null;
  }
}

// Fetch Real Spotify Playlist Tracks by ID or URL
router.get('/api/spotify/playlist/:id', async (req, res) => {
  const playlistId = req.params.id;
  try {
    // First check SQLite persistent DB
    const dbPlaylists = getDbImportedPlaylists();
    const matchDb = dbPlaylists.find((p) => p.id === playlistId);
    if (matchDb && matchDb.tracks && matchDb.tracks.length > 0) {
      return res.json({ success: true, playlist: matchDb });
    }

    // Then try embed playlist extractor
    const embedPlaylist = await fetchSpotifyEmbedPlaylist(playlistId);
    if (embedPlaylist && embedPlaylist.tracks && embedPlaylist.tracks.length > 0) {
      return res.json({ success: true, playlist: embedPlaylist });
    }

    // Fallback to Search API if embed is unavailable
    const token = await getSpotifyApiAccessToken();
    if (!token) {
      return res.status(401).json({ error: 'Spotify API credentials niet ingesteld' });
    }

    let searchQuery = playlistId.replace(/-/g, ' ');
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track`;
    const sRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!sRes.ok) {
      return res.status(sRes.status).json({ error: 'Spotify live track lookup mislukt' });
    }

    const data = await sRes.json();
    const tracks = (data.tracks?.items || [])
      .filter((item: any) => item && item.id)
      .map((t: any) => {
        const coverUrl = t.album?.images[0]?.url || t.album?.images[1]?.url || '';
        return {
          id: t.id,
          title: t.name,
          artist: t.artists.map((a: any) => a.name).join(', '),
          album: t.album?.name || 'Spotify Track',
          coverUrl: coverUrl,
          highResCoverUrl: coverUrl,
          durationMs: t.duration_ms || 200000,
          uri: t.uri,
          bitrate: 320,
          sampleRate: 44100,
          bitDepth: 24,
          dominantColor: '#10b981',
          releaseYear: t.album?.release_date?.substring(0, 4),
        };
      });

    const playlist = {
      id: playlistId,
      name: playlistId,
      description: 'Live Spotify Web API Stream Tracks',
      coverUrl: tracks[0]?.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
      trackCount: tracks.length,
      tracks: tracks,
      isSpotify: true,
      uri: tracks[0]?.uri || `spotify:playlist:${playlistId}`,
    };

    res.json({ success: true, playlist });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Import Spotify Playlist by URL or ID (Uses Embed Extractor for 100% Accuracy)
router.post('/api/spotify/import-playlist', async (req, res) => {
  const { urlOrId } = req.body || {};
  if (!urlOrId) return res.status(400).json({ error: 'Spotify Playlist URL of ID is verplicht' });

  try {
    const embedPlaylist = await fetchSpotifyEmbedPlaylist(urlOrId);
    if (embedPlaylist) {
      return res.json({ success: true, playlist: embedPlaylist });
    }
    res.status(404).json({ error: 'Kon Spotify afspeellijst niet ophalen van Spotify servers' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/spotify/logout', (req, res) => {
  setDbSpotifyAccount({
    isConnected: false,
    displayName: null,
    email: null,
    avatarUrl: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
  });
  hubConfig.spotifyClientId = '';
  hubConfig.spotifyClientSecret = '';
  saveDiskConfig();
  res.json({ success: true, message: 'Spotify account succesvol ontkoppeld.' });
});

// User's Spotify Personal Playlists Endpoint
// All playlists of the logged-in Spotify user (real GET /me/playlists, requires
// the OAuth user token below — the client-credentials token used elsewhere has
// no user context and cannot see this at all) plus every NAS/local playlist —
// NAS playlists are this app's own and live only in the local DB.
router.get('/api/spotify/user-playlists', async (req, res) => {
  const dbPlaylists = getDbImportedPlaylists();
  const nasPlaylists = dbPlaylists.filter((p) => !p.isSpotify);
  const importedSpotifyPlaylists = dbPlaylists.filter((p) => p.isSpotify);

  try {
    const userToken = await getSpotifyUserAccessToken();
    if (!userToken) {
      // Not logged in yet — still show anything previously imported by URL,
      // plus every NAS playlist.
      return res.json({ success: true, playlists: [...importedSpotifyPlaylists, ...nasPlaylists] });
    }

    const spotifyPlaylists: any[] = [];
    let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url && spotifyPlaylists.length < 300) {
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${userToken}` } });
      if (!r.ok) break;
      const data = await r.json();
      spotifyPlaylists.push(
        ...(data.items || [])
          .filter((item: any) => item && item.id && item.name)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.description || 'Spotify Afspeellijst',
            coverUrl: (item.images && item.images[0]?.url) || '',
            trackCount: item.tracks?.total || 0,
            isSpotify: true,
            uri: item.uri,
            audioProfileName: 'Spotify Connect Direct',
            tracks: [],
          })),
      );
      url = data.next || null;
    }

    // Anything imported by URL that isn't already in the live account list
    // (e.g. someone else's public playlist) stays visible too.
    const extraImported = importedSpotifyPlaylists.filter((p) => !spotifyPlaylists.some((sp) => sp.id === p.id));

    res.json({ success: true, playlists: [...spotifyPlaylists, ...extraImported, ...nasPlaylists] });
  } catch (e) {
    res.json({ success: true, playlists: [...importedSpotifyPlaylists, ...nasPlaylists] });
  }
});

// Fires only for events sourced from this app's own queue-driven Spotify
// playback (see queueControlsPlayback) so a paused live session doesn't get
// silently clobbered by the idle timeout below.
let spotifyPausedIdleTimer: ReturnType<typeof setTimeout> | null = null;

// The "auto-stop bij pauze" cast delay used to have its own separate timer
// here (independent from the shared one below), which meant a resume via
// this Spotify Connect event-hook path couldn't cancel a pending stop that
// had been scheduled via the app's own /api/playback routes, and vice versa
// — a stale timer from either path could fire after the other had already
// resumed. Now uses the shared scheduleAutoStopCast/cancelPendingAutoStopCast
// from state.ts (src/server/state.ts) so every trigger path coordinates
// through one timer.

// 7. Real-Time Spotify Connect Event Hook Receiver
router.post('/api/spotify/event', async (req, res) => {
  const {
    event,
    track_id,
    track_name,
    artist_name,
    album_name,
    duration_ms,
    position_ms,
    volume,
    uri,
  } = req.body;

  console.log(`[Spotify Hook Event] Received: '${event}'`, req.body);

  const isTrackEvent = [
    'started',
    'playing',
    'track_changed',
    'change',
    'loading',
    'pre-exec',
    'metadata',
  ].includes(event);

  if (isTrackEvent) {
    if (spotifyPausedIdleTimer) {
      clearTimeout(spotifyPausedIdleTimer);
      spotifyPausedIdleTimer = null;
    }
    cancelPendingAutoStopCast();
    exitCastStandby();
    // Spotify Connect (librespot) is taking over the ALSA device — stop
    // any NAS/radio playback we were feeding through mpv so they don't overlap.
    if (isLocalPlayerActive()) stopLocal();
    // Covers someone starting playback from their own Spotify app (not
    // through this app's API) while external listening was active — the
    // only signal we get for that is this webhook, so the input-exclusivity
    // rule has to be enforced here too, not just at playSpotifyUri().
    stopExternalListening();
    const wasPlaying = playbackState.isPlaying;
    playbackState.isPlaying = true;
    if (!wasPlaying) maybeAutoCast();

    const spotifyUri = uri || (track_id ? `spotify:track:${track_id}` : '');
    const cleanId = (track_id || spotifyUri.replace('spotify:track:', '')).trim();

    // Tell "we dispatched this Spotify track ourselves from the queue" apart
    // from "someone picked this device from their own Spotify app" — only
    // the latter should nuke our queue; a queue-driven track just continues.
    const isOwnQueueDispatch = queueControlsPlayback && playbackState.currentTrack?.uri === spotifyUri;
    if (!isOwnQueueDispatch) {
      setQueueControlsPlayback(false);
      playbackState.queue = [];
    }
    playbackState.activeProfileName = 'Spotify Connect (Bit-Perfect Direct)';

    const isNewTrack = !playbackState.currentTrack || cleanId !== playbackState.currentTrack.id;

    // Check if we have incoming track details directly from librespot
    let title = (track_name || '').trim();
    let artist = (artist_name || '').trim();
    let album = (album_name || '').trim();
    let coverUrl = '';
    let highResCoverUrl = '';
    let dominantColor = '#10b981';
    let releaseYear: string | undefined = undefined;
    // Librespot only reports DURATION_MS on some event types (the hook now sends
    // `null`, not a fake 0, when it's absent — see spotify-event.sh) — undefined
    // here means "this event has no opinion", never "the duration is zero".
    let durationMs: number | undefined = typeof duration_ms === 'number' ? duration_ms : undefined;

    // 1. Check SQLite DB for cached artwork FIRST for 0ms latency
    const cachedArt = cleanId ? getCachedArtwork(cleanId) : null;
    if (cachedArt && cachedArt.coverUrl) {
      if (!title && cachedArt.title) title = cachedArt.title;
      if (!artist && cachedArt.artist) artist = cachedArt.artist;
      if (!album && cachedArt.album) album = cachedArt.album;
      coverUrl = cachedArt.coverUrl;
      highResCoverUrl = cachedArt.highResCoverUrl || cachedArt.coverUrl;
      dominantColor = cachedArt.dominantColor || '#10b981';
      releaseYear = cachedArt.releaseYear || releaseYear;
      if (durationMs === undefined && cachedArt.durationMs > 0) durationMs = cachedArt.durationMs;
    }

    if (!isNewTrack && playbackState.currentTrack) {
      // Retain existing cached metadata if it is the SAME track
      if (!title) title = playbackState.currentTrack.title;
      if (!artist) artist = playbackState.currentTrack.artist;
      if (!album) album = playbackState.currentTrack.album;
      if (!coverUrl) coverUrl = playbackState.currentTrack.coverUrl;
      if (!highResCoverUrl) highResCoverUrl = playbackState.currentTrack.highResCoverUrl;
      if (!dominantColor) dominantColor = playbackState.currentTrack.dominantColor;
      if (!releaseYear) releaseYear = playbackState.currentTrack.releaseYear;
      // This event reported no duration at all — never let that read as "the
      // duration is now unknown" and fall through to the 210000 guess below,
      // clobbering a duration this same track already had mid-song.
      if (durationMs === undefined && playbackState.currentTrack.durationMs > 0) {
        durationMs = playbackState.currentTrack.durationMs;
      }
    }

    // Reached only for a track with no duration from this event, the cache, or
    // the currently-playing state — a genuinely brand-new track librespot didn't
    // report a duration for. Last-resort guess, never allowed to win over real data.
    if (durationMs === undefined) durationMs = 210000;

    // If it's a NEW track and cover is missing, query oEmbed for this cleanId
    if (cleanId && !coverUrl) {
      try {
        const webUrl = `https://open.spotify.com/track/${cleanId}`;
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(webUrl)}`);
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          if (oembedData.title && !title) {
            title = oembedData.title;
          }
          if (oembedData.thumbnail_url) {
            coverUrl = oembedData.thumbnail_url;
            // Convert 300x300 thumbnail to 640x640 high-res version
            highResCoverUrl = oembedData.thumbnail_url
              .replace('ab67616d00001e02', 'ab67616d0000b273')
              .replace('ab67616d00004851', 'ab67616d0000b273');
          }
        }
      } catch (e) {
        // Ignore oEmbed failure
      }
    }

    // If release year or artist is still missing, fetch track page
    if (cleanId && (!releaseYear || !artist || !album)) {
      try {
        const webUrl = `https://open.spotify.com/track/${cleanId}`;
        const pageRes = await fetch(webUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
          if (ogDesc) {
            const parts = ogDesc.split(' · ');
            if (parts[0] && (!artist || artist === 'Spotify Artist')) artist = parts[0];
            if (parts[1] && parts[1] !== 'Song' && parts[1] !== 'Single' && (!album || album === 'Spotify Connect')) {
              album = parts[1];
            }
            const yr = parts[parts.length - 1];
            if (yr && yr.match(/^\d{4}$/)) {
              releaseYear = yr;
            }
          }
        }
      } catch (e) {}
    }

    if (!coverUrl) {
      coverUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
      highResCoverUrl = coverUrl;
    }

    if (!title) title = 'Spotify Live Track';
    if (!artist) artist = 'Spotify Artist';
    if (!album) album = 'Spotify Connect';

    // Store in SQLite DB for instant 0ms retrieval next time
    if (cleanId && coverUrl) {
      setCachedArtwork({
        trackId: cleanId,
        title,
        artist,
        album,
        coverUrl,
        highResCoverUrl,
        dominantColor,
        releaseYear,
        durationMs,
      });
    }

    const liveTrack: Track = {
      id: cleanId || track_id || 'spotify-live-' + Date.now(),
      title,
      artist,
      album,
      coverUrl,
      highResCoverUrl,
      durationMs,
      uri: spotifyUri || 'spotify:track:live',
      bitrate: Number(hubConfig.spotifyBitrate) || 320,
      sampleRate: 44100,
      bitDepth: 24,
      dominantColor,
      releaseYear,
    };

    playbackState.currentTrack = liveTrack;
    if (isNewTrack || ['started', 'track_changed', 'loading', 'change'].includes(event)) {
      playbackState.positionMs = typeof position_ms === 'number' ? position_ms : 0;
    } else if (typeof position_ms === 'number' && position_ms >= 0) {
      playbackState.positionMs = position_ms;
    }
    playbackState.durationMs = liveTrack.durationMs;
    playbackState.spotifyConnected = true;
    piHardware.setSpotifyPlaybackState(true, liveTrack);

    broadcastWebSocket({
      event: 'track_change',
      timestamp: Date.now(),
      data: { track: liveTrack, isLiveSpotify: true, queue: [], spotifyConnected: true },
    });

    broadcastWebSocket({
      event: 'playback_state',
      timestamp: Date.now(),
      data: { isPlaying: true, positionMs: playbackState.positionMs, spotifyConnected: true },
    });
  } else if (event === 'paused') {
    // Session stays connected while paused — only a real disconnect (below)
    // or the idle timeout clears it. Closing/backgrounding Spotify on a
    // phone usually only ever sends this event, never a follow-up
    // 'stopped'/'session_disconnected' — without the timeout, the paused
    // track would stay on screen indefinitely.
    playbackState.isPlaying = false;
    piHardware.setSpotifyPlaybackState(false);
    if (spotifyPausedIdleTimer) clearTimeout(spotifyPausedIdleTimer);
    spotifyPausedIdleTimer = setTimeout(() => {
      spotifyPausedIdleTimer = null;
      if (!playbackState.isPlaying && playbackState.currentTrack?.uri?.startsWith('spotify:')) {
        clearSpotifyToStandby();
      }
    }, SPOTIFY_PAUSED_IDLE_MS);

    // "Automatisch stoppen bij pauze" — Cast setting. Enters standby (not a
    // hard stop) after the configured delay; cancelled if playback resumes
    // in the meantime. See scheduleAutoStopCast in src/server/state.ts.
    scheduleAutoStopCast();

    broadcastWebSocket({
      event: 'playback_state',
      timestamp: Date.now(),
      data: { isPlaying: false, positionMs: playbackState.positionMs, spotifyConnected: true },
    });
  } else if (['stopped', 'kicked', 'closed', 'session_cleared'].includes(event)) {
    // A different source (NAS/radio) may have taken over playback since this Spotify
    // session started — "last action wins". Only clear the now-playing state if
    // Spotify is still the thing actually showing, so we don't clobber it.
    const wasShowingSpotify = playbackState.currentTrack?.uri?.startsWith('spotify:') ?? false;
    playbackState.spotifyConnected = false;
    piHardware.setSpotifyPlaybackState(false);
    if (spotifyPausedIdleTimer) {
      clearTimeout(spotifyPausedIdleTimer);
      spotifyPausedIdleTimer = null;
    }

    // This Spotify track was one we started from our own queue, and there's
    // more queued after it (NAS, radio, or another Spotify track) — continue
    // into it instead of going to standby, so a mixed-source queue plays
    // straight through.
    if (wasShowingSpotify && queueControlsPlayback && playbackState.queue.length > 0) {
      advanceLocalQueue();
    } else if (wasShowingSpotify) {
      clearSpotifyToStandby();
    } else {
      broadcastWebSocket({
        event: 'playback_state',
        timestamp: Date.now(),
        data: { spotifyConnected: false },
      });
    }
  } else if (event === 'volume_set' && typeof volume === 'number') {
    const percentage = Math.round((volume / 65535) * 100);
    playbackState.volume = percentage;
    piHardware.setHardwareVolume(percentage, false, dacConfig.balance);
    broadcastWebSocket({
      event: 'volume_change',
      timestamp: Date.now(),
      data: { volume: percentage, isMuted: false },
    });
  }

  res.json({ success: true, event });
});

export default router;
