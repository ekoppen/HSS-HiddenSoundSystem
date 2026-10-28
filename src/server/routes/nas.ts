// NAS/SMB/NFS share management, browsing, local playback, and the
// whole-library Catalogic scan (see src/services/nasLibraryScan.ts).
import { execFile } from 'child_process';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { isAudioFile, isSystemDirectory } from '../../services/localTrackMetadata.ts';
import { getNasScanResults, getNasScanStatus, reconcileNasBacklog, resolveLocalTrack, startNasLibraryScan, stopNasLibraryScan } from '../../services/nasLibraryScan.ts';
import { getDbConfig, getDbImportedPlaylists, getDbNasLibraryFileCountForShare, getDbNetworkShares, saveDbImportedPlaylist, saveDbNetworkShare } from '../../../db.ts';
import { verifyCatalogicWebhookSignature } from '../../services/catalogicClient.ts';
import { getEffectiveNasShares, validateWithinNasShares } from '../../services/nasPathGuard.ts';
import { broadcastWebSocket, hubConfig, maybeAutoCast, playbackState, reconcileRadioLogBacklog, requireAudioPermission, startLocalAudio } from '../state.ts';

const router = express.Router();

router.get('/api/nas/shares', (req, res) => {
  // GET, deliberately left open for read-browsing (see the mutation-only
  // auth gate above) — but that means the stored SMB/NFS password must
  // never round-trip here in full; nothing in the UI reads it back anyway.
  const shares = getDbNetworkShares().map((s) => ({
    ...s,
    password: s.password ? '••••••••' : '',
    fileCount: getDbNasLibraryFileCountForShare(s.id, s.mountPoint),
  }));
  res.json({ success: true, shares });
});

// Performs the actual Linux mount for one configured share and writes the
// real outcome back to its stored status — never left as an optimistic
// guess. That optimism was exactly the bug: Linux mounts aren't persisted
// across a reboot (no /etc/fstab entry; shares are added dynamically via
// this API), so a restart silently drops the mount while the DB kept saying
// "Gekoppeld (Actief)" from whenever it was last mounted — the library
// explorer then quietly showed an empty folder instead of an obvious error.
// execFile (never exec()'s shell string) means nothing in these fields can
// break out into an arbitrary shell command; args reach `mount`/`mkdir`
// directly, no shell ever parses them.
function mountNasShare(share: {
  id: string;
  name: string;
  shareType: string;
  host: string;
  sharePath: string;
  username?: string | null;
  password?: string | null;
  mountPoint: string;
}) {
  const type = (share.shareType || 'nfs').toLowerCase();
  const targetMount = share.mountPoint || '/mnt/nas';
  const cleanPath = share.sharePath.startsWith('/') ? share.sharePath : `/${share.sharePath}`;

  const finish = (status: string) =>
    saveDbNetworkShare({ ...share, username: share.username || undefined, password: share.password || undefined, shareType: type, mountPoint: targetMount, status });

  try {
    if (!fs.existsSync(targetMount)) {
      execFile('sudo', ['mkdir', '-p', '--', targetMount], () => {});
    }

    let mountArgs: string[];
    if (type === 'nfs') {
      mountArgs = ['mount', '-t', 'nfs', '-o', 'ro,nolock,soft,intr', '--', `${share.host}:${cleanPath}`, targetMount];
    } else {
      // SMB / CIFS
      const cleanHost = share.host.replace(/^\/+/, '');
      const cleanShare = cleanPath.replace(/^\/+/, '');
      let opts = 'ro,iocharset=utf8';
      if (share.username) opts += `,username=${share.username}`;
      if (share.password) opts += `,password=${share.password}`;
      else if (!share.username) opts += ',guest';
      mountArgs = ['mount', '-t', 'cifs', '-o', opts, '--', `//${cleanHost}/${cleanShare}`, targetMount];
    }

    execFile('sudo', mountArgs, { timeout: 3000 }, (err: any, stdout: any, stderr: any) => {
      if (err) {
        console.warn(`[NAS Mount] Background mount warning:`, stderr || err.message);
        finish('Verbinding mislukt');
      } else {
        console.log(`[NAS Mount] Successfully mounted ${type.toUpperCase()} share to ${targetMount}`);
        finish('Gekoppeld (Actief)');
        // Nieuwe share (of een nieuwe wijziging op een bestaande) is nu
        // gekoppeld — meteen indexeren zodat de verkenner titels/artwork
        // toont zonder dat iemand eerst handmatig "Bibliotheek scannen" moet
        // klikken. Incrementeel (zelfde functie als de knop), dus goedkoop
        // als deze share al eerder gescand was.
        startNasLibraryScan({
          allowCatalogicLookup: !!hubConfig.catalogicScanLookupEnabled,
          onProgress: (status) => broadcastWebSocket({ event: 'nas_scan_progress', timestamp: Date.now(), data: status }),
        });
      }
    });
  } catch (e: any) {
    console.warn(`[NAS Mount] Error initiating mount:`, e.message);
    finish('Verbinding mislukt');
  }
}

/** Re-issues the mount for every configured share once at server boot —
 * mirrors syncLiveSpotifyState()'s same "restore live state after restart"
 * role for Spotify Connect (see server.ts). Without this, every restart
 * silently drops NAS mounts until someone re-saves the share from Instellingen. */
export function remountAllNasShares() {
  for (const share of getDbNetworkShares()) {
    mountNasShare(share);
  }
}

// admin:all — mounts an arbitrary CIFS/NFS share via `sudo mount`; a
// scoped integration key has no business adding storage to the system.
router.post('/api/nas/mount', requireAudioPermission('admin:all'), (req, res) => {
  const { name, shareType, host, sharePath, username, password, mountPoint } = req.body || {};
  if (!name || !host || !sharePath) {
    return res.status(400).json({ error: 'Naam, Host IP en Netwerkpad zijn verplicht' });
  }
  // CIFS credentials ride along as a single comma-separated `-o` argument that
  // `mount` itself parses into suboptions — a comma here could inject an extra
  // mount option (e.g. uid=0) even though execFile below never goes through a
  // shell, so it's rejected up front rather than silently split apart.
  if ((username && username.includes(',')) || (password && password.includes(','))) {
    return res.status(400).json({ error: 'Gebruikersnaam/wachtwoord mag geen komma bevatten' });
  }

  const type = (shareType || 'nfs').toLowerCase();
  const targetMount = mountPoint || '/mnt/nas';

  // execFile (below) already keeps a shell out of the picture, but `mount`/
  // `mkdir` still parse any argument starting with "-" as a flag rather than
  // a literal value. The CIFS "//host/share" form always starts with "/" so
  // it's safe by construction, but `host` (used bare as "host:path" for NFS)
  // and `targetMount` (mkdir's arg and mount's destination) are not — e.g.
  // host: "--bind" could smuggle in an unintended mount flag. Reject leading
  // "-" up front, and belt-and-suspenders a `--` end-of-options marker
  // before the positional args in mountNasShare above.
  if (host.startsWith('-') || targetMount.startsWith('-')) {
    return res.status(400).json({ error: 'Host en koppelpunt mogen niet met een "-" beginnen' });
  }

  // 1. Save to SQLite immediately — status is provisional, mountNasShare
  // below overwrites it with the real outcome once the attempt completes.
  const id = saveDbNetworkShare({
    name,
    shareType: type,
    host,
    sharePath,
    username,
    password,
    mountPoint: targetMount,
    status: 'Verbinden…',
  });

  // 2. Perform Linux mount in background
  mountNasShare({ id, name, shareType: type, host, sharePath, username, password, mountPoint: targetMount });

  res.json({
    success: true,
    message: `Netwerkschijf '${name}' (${type.toUpperCase()}) opgeslagen, koppelen gestart op ${targetMount}`,
    shares: getDbNetworkShares(),
  });
});

router.get('/api/nas/browse', async (req, res) => {
  const queryPath = req.query.path;
  // Only an explicit caller-supplied path needs allowlist validation — the
  // computed default is server-config-derived, never attacker-controlled.
  // See src/services/nasPathGuard.ts.
  const targetDir = queryPath !== undefined ? validateWithinNasShares(queryPath) : getEffectiveNasShares()[0];
  if (!targetDir) {
    return res.status(400).json({ success: false, error: 'invalid path', files: [] });
  }

  try {
    if (!fs.existsSync(targetDir)) {
      return res.json({
        success: true,
        currentPath: targetDir,
        files: [],
        message: 'Netwerkschijf map bestaat niet of is niet gekoppeld op de Pi.',
      });
    }

    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    const rawFiles = await Promise.all(
      items.map(async (item: any) => {
        const isDir = item.isDirectory();
        const filePath = path.join(targetDir, item.name);
        const isAudio = !isDir && isAudioFile(item.name);
        if (!isAudio) {
          return { name: item.name, isDir, isAudio, path: filePath, playable: true };
        }
        // Fast, network-free resolve — no Catalogic call here, that would
        // block the whole listing. See /api/nas/enrich for artwork lookup.
        const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
        return {
          name: item.name,
          isDir,
          isAudio,
          path: filePath,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          coverUrl: track.coverUrl,
          playable: track.playable,
        };
      }),
    );
    const files = rawFiles.filter((f) => (f.isDir ? !isSystemDirectory(f.name) : !f.isAudio || f.playable !== false));

    res.json({ success: true, currentPath: targetDir, files });
  } catch (e: any) {
    res.json({ success: false, error: e.message, files: [] });
  }
});

// Best-effort artwork/metadata enrichment for a batch of NAS files — call
// after /api/nas/browse renders, so the folder listing itself stays fast.
router.post('/api/nas/enrich', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  try {
    const shares = getEffectiveNasShares();
    const filePaths = paths.filter((p: unknown) => validateWithinNasShares(p, shares) !== null).slice(0, 200);
    const CONCURRENCY = 4;
    const tracks: Record<string, any> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < filePaths.length) {
        const filePath = filePaths[cursor++];
        try {
          tracks[filePath] = await resolveLocalTrack(filePath, { allowCatalogicLookup: true });
        } catch {
          // skip unreadable file, caller keeps whatever it already had
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker));
    res.json({ success: true, tracks });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/nas/play-file', async (req, res) => {
  const { filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'Bestandspad is verplicht' });

  try {
    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: true });

    playbackState.isPlaying = true;
    maybeAutoCast();
    playbackState.currentTrack = track;
    playbackState.positionMs = 0;
    playbackState.durationMs = track.durationMs;
    playbackState.queue = [];
    startLocalAudio(track);

    broadcastWebSocket({ event: 'track_change', timestamp: Date.now(), data: { track, queue: [] } });
    broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: true, positionMs: 0 } });

    res.json({ success: true, message: `Bestand '${track.title}' wordt afgespeeld`, track });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Volumio-style "play this whole folder": queues every audio file in the
// directory (non-recursive, same scope as browse/create-playlist) and starts
// playing the first one.
router.post('/api/nas/play-folder', async (req, res) => {
  const dirPath = validateWithinNasShares(req.body?.dirPath);
  if (!dirPath) return res.status(400).json({ error: 'Map-pad is verplicht of ligt buiten een gekoppelde share' });
  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Map niet gevonden' });

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const audioNames = items
      .filter((item: any) => !item.isDirectory() && isAudioFile(item.name))
      .map((item: any) => item.name)
      .sort((a: string, b: string) => a.localeCompare(b));

    if (audioNames.length === 0) {
      return res.status(404).json({ error: 'Geen audiobestanden in deze map' });
    }

    // First track gets the (slower) Catalogic lookup since it's about to play;
    // the rest of the queue enriches in the background via resolveLocalTrack's
    // persisted result once /api/nas/enrich or a future play catches up to them.
    const [firstTrack, ...rest] = await Promise.all(
      audioNames.map((name: string, idx: number) =>
        resolveLocalTrack(path.join(dirPath, name), { allowCatalogicLookup: idx === 0 }),
      ),
    );

    playbackState.isPlaying = true;
    maybeAutoCast();
    playbackState.currentTrack = firstTrack;
    playbackState.queue = rest;
    playbackState.positionMs = 0;
    playbackState.durationMs = firstTrack.durationMs;
    startLocalAudio(firstTrack);

    broadcastWebSocket({ event: 'track_change', timestamp: Date.now(), data: { track: firstTrack, queue: rest } });
    broadcastWebSocket({ event: 'playback_state', timestamp: Date.now(), data: { isPlaying: true, positionMs: 0 } });

    res.json({ success: true, message: `Map '${path.basename(dirPath)}' wordt afgespeeld (${audioNames.length} nummers)`, track: firstTrack, queue: rest });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/nas/create-playlist', async (req, res) => {
  const { name } = req.body || {};
  const dirPath = validateWithinNasShares(req.body?.dirPath);
  if (!dirPath) return res.status(400).json({ error: 'Map-pad is verplicht of ligt buiten een gekoppelde share' });

  try {
    if (!fs.existsSync(dirPath)) {
      return res.status(404).json({ error: 'Map niet gevonden' });
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const audioNames = items
      .filter((item: any) => !item.isDirectory() && isAudioFile(item.name))
      .map((item: any) => item.name)
      .sort((a: string, b: string) => a.localeCompare(b));

    // Cache/tags only (no live Catalogic call) — a folder can have many
    // tracks and this endpoint shouldn't block on N network round-trips.
    const audioFiles = await Promise.all(
      audioNames.map((n: string) => resolveLocalTrack(path.join(dirPath, n), { allowCatalogicLookup: false })),
    );

    const newPlaylist = {
      id: 'nas-pl-' + Date.now(),
      name: name || path.basename(dirPath),
      description: `Lokale & NAS Afspeellijst (${dirPath})`,
      coverUrl: audioFiles[0]?.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
      trackCount: audioFiles.length,
      tracks: audioFiles,
      isSpotify: false,
      uri: `local:folder:${dirPath}`,
    };

    saveDbImportedPlaylist(newPlaylist);
    res.json({ success: true, playlist: newPlaylist, playlists: getDbImportedPlaylists() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Whole-library "Bibliotheek scannen" — proactive scan of every configured
// NAS share, reconciled against Catalogic. See nasLibraryScan.ts.
router.post('/api/nas/scan/start', (req, res) => {
  const started = startNasLibraryScan({
    allowCatalogicLookup: !!hubConfig.catalogicScanLookupEnabled,
    onProgress: (status) => broadcastWebSocket({ event: 'nas_scan_progress', timestamp: Date.now(), data: status }),
  });
  if (!started) {
    res.status(409).json({ error: 'Scan is al bezig' });
    return;
  }
  res.json({ success: true, status: getNasScanStatus() });
});

router.post('/api/nas/scan/stop', (req, res) => {
  stopNasLibraryScan();
  res.json({ success: true, status: getNasScanStatus() });
});

router.get('/api/nas/scan/status', (req, res) => {
  res.json({ success: true, status: getNasScanStatus() });
});

router.get('/api/nas/scan/results', (req, res) => {
  const filter = (req.query.filter as string) || 'all';
  if (filter !== 'all' && filter !== 'matched' && filter !== 'unmatched') {
    res.status(400).json({ error: 'filter moet all, matched of unmatched zijn' });
    return;
  }
  res.json({ success: true, results: getNasScanResults(filter) });
});

// Catalogic calls this whenever it resolves something from our backlog (see
// registerCatalogicWebhook / ensureCatalogicWebhookRegistered). Treated as a
// generic "go check your backlog again" poke — see reconcileNasBacklog.
router.post('/api/catalogic/webhook', (req, res) => {
  const secret = getDbConfig('catalogic_webhook_secret', '');
  const rawBody = ((req as any).rawBody as Buffer | undefined)?.toString('utf8') || '';
  if (!secret || !verifyCatalogicWebhookSignature(rawBody, req.header('X-Catalogic-Signature'), secret)) {
    res.status(401).json({ error: 'Ongeldige of ontbrekende signature' });
    return;
  }

  res.json({ success: true });

  // Fire-and-forget: Catalogic's own delivery already retries on non-2xx, so
  // this response must not wait on how long a reconcile pass takes.
  void reconcileNasBacklog(!!hubConfig.catalogicScanLookupEnabled, (result) => {
    broadcastWebSocket({ event: 'nas_backlog_reconciled', timestamp: Date.now(), data: result });
  }).catch(() => {});

  // Zelfde poke, maar dan voor radio-logregels die nog geen albumart hadden
  // toen ze gelogd werden (zie lookupRadioSongArtwork in state.ts).
  void reconcileRadioLogBacklog()
    .then((result) => {
      if (result.matched > 0) {
        broadcastWebSocket({ event: 'radio_log_reconciled', timestamp: Date.now(), data: result });
      }
    })
    .catch(() => {});
});

export default router;
