import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { calculateVolumeDb } from './src/services/piHardware.ts';
import {
  applyVolumeChange,
  audioDevices,
  broadcastWebSocket,
  dacConfig,
  getAuthenticatedUser,
  maybeAutoCast,
  PORT,
  playbackState,
  resolveCredential,
  setWss,
  stopExternalListening,
  syncLiveSpotifyState,
  systemStats,
} from './src/server/state.ts';
import { piHardware } from './src/services/piHardware.ts';
import { ensureSelfSignedCert } from './src/services/selfSignedCert.ts';
import { startServiceWatchdog } from './src/services/serviceWatchdog.ts';
import { installCrashGuard } from './src/services/crashGuard.ts';
import { WebSocketEventPayload } from './src/types.ts';

// As early as possible — before anything else has a chance to start —
// so an unhandled error anywhere at runtime gets recorded instead of
// silently taking the whole process down. See crashGuard.ts.
installCrashGuard();

import authRouter from './src/server/routes/auth.ts';
import audioRouter from './src/server/routes/audio.ts';
import playbackRouter from './src/server/routes/playback.ts';
import playlistsRouter from './src/server/routes/playlists.ts';
import recognitionRouter from './src/server/routes/recognition.ts';
import configRouter from './src/server/routes/config.ts';
import nasRouter, { remountAllNasShares } from './src/server/routes/nas.ts';
import nasLibraryRouter from './src/server/routes/nas-library.ts';
import spotifyRouter from './src/server/routes/spotify.ts';
import radioRouter from './src/server/routes/radio.ts';
import castRouter from './src/server/routes/cast.ts';
import systemRouter from './src/server/routes/system.ts';
import gpioRouter from './src/server/routes/gpio.ts';
import likesRouter from './src/server/routes/likes.ts';
import radioLogRouter from './src/server/routes/radioLog.ts';
import hubsRouter from './src/server/routes/hubs.ts';
import settingsBackupRouter from './src/server/routes/settingsBackup.ts';

async function startServer() {
  const app = express();
  // Raised from the 100kb default so a user-uploaded cast background image (sent as a
  // base64 data URL in the settings payload) fits in one request.
  app.use(
    express.json({
      limit: '15mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // CORS & Security headers for Google Cast / Nest Hub Dashcast iframe embedding
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Private-Network', 'true');
    res.header('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;");
    res.removeHeader('X-Frame-Options');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Requires a valid credential (session token or API key) on every
  // state-changing request. GET/HEAD are left open — this device is read-
  // browsable on the local network by design (the Nest Hub kiosk, and anyone
  // glancing at "what's playing", have no login flow) — but nothing that
  // changes config, plays/stops audio, deletes data, or links accounts
  // should be reachable by an unauthenticated request. Previously
  // `getAuthenticatedUser` silently treated *any* missing credential as the
  // default admin, which made every `requireAudioPermission` check below a
  // no-op for anonymous callers; this is what actually closes that gap for
  // the ~80 endpoints that never had a permission check applied at all.
  const PUBLIC_MUTATION_PATHS = new Set([
    '/api/auth/login',
    '/api/spotify/event', // librespot event hook — invoked by a local systemd service, not a browser
    '/api/catalogic/webhook', // Catalogic webhook — invoked by the external Catalogic service, authenticated by HMAC signature instead of a session/API key (see verifyCatalogicWebhookSignature)
  ]);
  // Because CORS is wide open (needed for Nest Hub Dashcast iframe
  // embedding above) and this endpoint needs no credential, without this
  // check any device on the LAN merely visiting a hostile webpage could
  // POST here to spoof "now playing" or drive real hardware volume — the
  // real caller is always the librespot systemd hook curl-ing localhost.
  function isLoopbackAddress(ip: string | undefined): boolean {
    if (!ip) return false;
    const normalized = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    return normalized === '127.0.0.1' || normalized === '::1';
  }
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    if (PUBLIC_MUTATION_PATHS.has(req.path)) {
      if (req.path === '/api/spotify/event' && !isLoopbackAddress(req.socket.remoteAddress)) {
        res.status(403).json({ error: 'Dit endpoint is alleen bereikbaar vanaf de Hub zelf' });
        return;
      }
      next();
      return;
    }
    const auth = getAuthenticatedUser(req);
    if (!auth.user) {
      res.status(401).json({ error: auth.error || 'Niet geauthenticeerd' });
      return;
    }
    (req as any).authUser = auth.user;
    (req as any).authApiKey = auth.apiKey;
    next();
  });

  // REST API Routes — grouped by domain, see src/server/routes/*.ts. Shared
  // state and engine functions (playback, cast, Spotify transport, external
  // source recognition) live in src/server/state.ts.
  app.use(authRouter);
  app.use(audioRouter);
  app.use(playbackRouter);
  app.use(playlistsRouter);
  app.use(recognitionRouter);
  app.use(configRouter);
  app.use(nasRouter);
  app.use(nasLibraryRouter);
  app.use(spotifyRouter);
  app.use(radioRouter);
  app.use(castRouter);
  app.use(systemRouter);
  app.use(gpioRouter);
  app.use(likesRouter);
  app.use(radioLogRouter);
  app.use(hubsRouter);
  app.use(settingsBackupRouter);

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize WebSocket Server on same HTTP port
  const wss = new WebSocketServer({ server, path: '/ws' });
  setWss(wss);

  wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WebSocket] Client connected: ${clientIp}, total: ${wss.clients.size}`);

    // Connecting to receive live broadcasts (now-playing, spectrum, etc.) needs
    // no credential — the Nest Hub kiosk display has no login flow at all and
    // must keep working read-only. Sending a *command* over this same socket
    // is a mutation though (documented for external integrators in the API
    // docs), so that's gated on a `?token=` query param instead, checked once
    // per connection rather than per message.
    const wsUrl = new URL(req.url || '', 'http://localhost');
    const wsToken = wsUrl.searchParams.get('token') || wsUrl.searchParams.get('api_key');
    const wsAuth = resolveCredential(wsToken);
    const wsCanControl = Boolean(wsAuth.user);

    // Send initial snapshot
    const initialPayload: WebSocketEventPayload = {
      event: 'playback_state',
      timestamp: Date.now(),
      data: {
        playback: playbackState,
        activeDac: audioDevices.find((d) => d.id === dacConfig.activeDeviceId),
        stats: systemStats,
      },
    };
    ws.send(JSON.stringify(initialPayload));

    // Listen for incoming control commands from external devices or web client
    ws.on('message', (message) => {
      if (!wsCanControl) {
        ws.send(JSON.stringify({ event: 'notification', timestamp: Date.now(), data: { message: 'Niet geauthenticeerd — commando genegeerd', error: true } }));
        return;
      }
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.action === 'play') {
          const wasPlaying = playbackState.isPlaying;
          playbackState.isPlaying = true;
          if (!wasPlaying) maybeAutoCast();
          stopExternalListening();
          broadcastWebSocket({
            event: 'playback_state',
            timestamp: Date.now(),
            data: { isPlaying: true },
          });
        } else if (parsed.action === 'pause') {
          playbackState.isPlaying = false;
          broadcastWebSocket({
            event: 'playback_state',
            timestamp: Date.now(),
            data: { isPlaying: false },
          });
        } else if (parsed.action === 'toggle') {
          const wasPlaying = playbackState.isPlaying;
          playbackState.isPlaying = !playbackState.isPlaying;
          if (!wasPlaying) {
            maybeAutoCast();
            stopExternalListening();
          }
          broadcastWebSocket({
            event: 'playback_state',
            timestamp: Date.now(),
            data: { isPlaying: playbackState.isPlaying },
          });
        } else if (parsed.action === 'set_volume' && typeof parsed.volume === 'number') {
          playbackState.volume = Math.max(0, Math.min(100, parsed.volume));
          dacConfig.volumeDb = calculateVolumeDb(playbackState.volume);
          broadcastWebSocket({
            event: 'volume_change',
            timestamp: Date.now(),
            data: { volume: playbackState.volume, volumeDb: dacConfig.volumeDb },
          });
        } else if (parsed.action === 'next') {
          if (playbackState.queue.length > 0) {
            playbackState.currentTrack = playbackState.queue.shift()!;
            playbackState.positionMs = 0;
            playbackState.durationMs = playbackState.currentTrack.durationMs;
          }
          broadcastWebSocket({
            event: 'track_change',
            timestamp: Date.now(),
            data: { track: playbackState.currentTrack, queue: playbackState.queue },
          });
        } else if (parsed.action === 'seek' && typeof parsed.positionMs === 'number') {
          playbackState.positionMs = Math.max(0, Math.min(parsed.positionMs, playbackState.durationMs));
          broadcastWebSocket({
            event: 'playback_state',
            timestamp: Date.now(),
            data: { positionMs: playbackState.positionMs },
          });
        }
      } catch (e) {
        console.error('[WebSocket] Failed to parse client message:', e);
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected, total: ${wss.clients.size}`);
    });
  });

  // Vite middleware in dev, static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[HSS Server] Running on http://localhost:${PORT}`);
    console.log(`[HSS WebSocket] Available at ws://localhost:${PORT}/ws`);
    // The app used to start every boot believing the volume was 78 — a
    // hardcoded default that was never written to the amplifier nor read
    // from it. So after a restart it could claim a level the hardware had
    // never been given, and even one above the configured "Maximaal
    // volume", which made every volume bar on every screen a guess. Adopt
    // what the mixer actually holds (alsactl restores it across reboots),
    // then push it back through applyVolumeChange so the ceiling gets
    // enforced and every screen hears the real number.
    const measuredVolume = piHardware.getHardwareVolumePct();
    applyVolumeChange({ volume: measuredVolume ?? playbackState.volume });
    piHardware.playStartupChime();
    syncLiveSpotifyState();
    // Linux mounts aren't persisted across a reboot — shares are added
    // dynamically via /api/nas/mount, not a static /etc/fstab entry — so
    // without this, every restart silently drops NAS mounts while the DB
    // still remembers the share as connected. Same role as the Spotify
    // resync above, for NAS instead of Spotify Connect.
    remountAllNasShares();
    // Keeps an eye on librespot and the kiosk display. Started here rather
    // than on import so a test that pulls the module in doesn't inherit a
    // running timer.
    startServiceWatchdog();
  });

  // A second, HTTPS-only listener solely for Spotify's OAuth login flow —
  // Spotify rejects any non-https redirect_uri except the literal address
  // 127.0.0.1, which isn't reachable from another device on the LAN.
  // Everything else in the app keeps using the plain HTTP port; this one is
  // only ever visited briefly during "Inloggen bij Spotify". Same Express
  // app on both listeners, so every route (including the callback) works
  // identically on either — only the WebSocket server stays HTTP-only,
  // since nothing needs a live socket during that brief redirect round-trip.
  const selfSignedCert = ensureSelfSignedCert();
  if (selfSignedCert) {
    const httpsPort = PORT + 1;
    https.createServer({ key: selfSignedCert.key, cert: selfSignedCert.cert }, app).listen(httpsPort, '0.0.0.0', () => {
      console.log(`[HSS Server] HTTPS (Spotify OAuth only) on https://localhost:${httpsPort}`);
    });
  }
}

startServer();
