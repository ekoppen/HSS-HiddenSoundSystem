import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { clearHealthIssue, reportHealthIssue } from './src/services/healthLog.ts';
import { LikedTrack, RadioLogEntry } from './src/types.ts';

// Actively create /etc/hss rather than only using it if it already happens
// to exist: the old `fs.existsSync('/etc/hss') ? ... : '/tmp/hss'` check
// meant which database a boot used depended on unrelated timing — anything
// that happened to create /etc/hss first (a settings save calling
// saveDiskConfig(), which does its own separate mkdir) silently switched
// *future* boots onto a different, freshly-seeded-empty database, orphaning
// everything written to /tmp/hss/hss.db in the meantime. Reproduced live:
// a user's saved radio station and GPIO config both "disappeared" this way.
let DB_DIR = '/etc/hss';
try {
  fs.mkdirSync(DB_DIR, { recursive: true });
} catch (e) {
  // No permission to create it (e.g. running unprivileged in dev) — /tmp is
  // the exception now, not something later boots can silently fall into.
  DB_DIR = '/tmp/hss';
  if (!fs.existsSync(DB_DIR)) {
    try {
      fs.mkdirSync(DB_DIR, { recursive: true });
    } catch (e) {}
  }
}

const DB_PATH = path.join(DB_DIR, 'hss.db');

let db: Database.Database;

try {
  db = new Database(DB_PATH);
  console.log(`[DB] Connected to SQLite database at: ${DB_PATH}`);
} catch (e) {
  const fallbackPath = '/tmp/hss.db';
  db = new Database(fallbackPath);
  console.log(`[DB] Connected to fallback SQLite database at: ${fallbackPath}`);
}

// Enable WAL mode for high performance concurrent access
db.pragma('journal_mode = WAL');

// Initialize Database Schemas
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    active_tab TEXT DEFAULT 'now_playing',
    active_theme TEXT DEFAULT 'obsidian',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spotify_account (
    id TEXT PRIMARY KEY DEFAULT 'primary',
    is_connected INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    email TEXT,
    product TEXT DEFAULT 'premium',
    avatar_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_token TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    permissions TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS artwork_cache (
    track_id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT NOT NULL,
    high_res_cover_url TEXT,
    artist_cover_url TEXT,
    dominant_color TEXT DEFAULT '#10b981',
    release_year TEXT,
    duration_ms INTEGER,
    cached_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS web_radio_stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT NOT NULL,
    url TEXT NOT NULL,
    bitrate INTEGER DEFAULT 320,
    logo_url TEXT,
    is_custom INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS network_shares (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    share_type TEXT NOT NULL DEFAULT 'smb',
    host TEXT NOT NULL,
    share_path TEXT NOT NULL,
    username TEXT,
    password TEXT,
    mount_point TEXT DEFAULT '/mnt/nas',
    status TEXT DEFAULT 'unmounted',
    updated_at INTEGER NOT NULL
  );

  -- Other HSS hubs on the same LAN, added manually via the sidebar's hub
  -- switcher — just a bookmark list (name + own base URL), the browser
  -- navigates there directly. No cross-hub auth/session sharing.
  CREATE TABLE IF NOT EXISTS known_hubs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Chromaprint fingerprint -> recognized track, so the same LP/CD track is
  -- never looked up via AcoustID twice. Keyed by a hash of the fingerprint
  -- (the raw fingerprint is a long string) plus a coarse duration bucket,
  -- since Chromaprint fingerprints for the same recording are near-identical
  -- but not always byte-identical across captures.
  CREATE TABLE IF NOT EXISTS recognized_audio (
    fingerprint_hash TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    duration_sec INTEGER,
    title TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    recognized_at INTEGER NOT NULL
  );

  -- Songs the user liked with the heart button, from any source. Keyed on a
  -- normalized artist+title (see src/services/likedTracks.ts) rather than on
  -- a uri, so liking the same song off the radio and later off Spotify keeps
  -- one row instead of two. source/source_detail record where it came from —
  -- for radio that's the station, which is the only thing left identifying
  -- it once the ICY tag has overwritten title and artist.
  CREATE TABLE IF NOT EXISTS liked_tracks (
    like_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    cover_url TEXT,
    source TEXT NOT NULL,
    source_detail TEXT,
    spotify_id TEXT,
    uri TEXT,
    liked_at INTEGER NOT NULL
  );

  -- Optioneel te activeren luistergeschiedenis voor de radio (zie hubConfig.
  -- radioLogEnabled) — los van liked_tracks: dit is alles wat voorbij kwam,
  -- niet alleen wat je bewaarde. Eén rij per herkend nummer (ICY-tag-wissel),
  -- station is het enige veld dat niet uit de ICY-tag komt.
  CREATE TABLE IF NOT EXISTS radio_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    artwork_url TEXT,
    played_at INTEGER NOT NULL
  );

  -- Whole-library index built by an explicit "Bibliotheek scannen" pass over
  -- every NAS share (see src/services/nasLibraryScan.ts) — distinct from
  -- artwork_cache, which only ever holds whatever's been browsed/played so
  -- far. file_size + mtime_ms let a re-scan skip anything unchanged instead
  -- of re-reading tags and re-asking Catalogic for the whole library again.
  CREATE TABLE IF NOT EXISTS nas_library_index (
    file_path TEXT PRIMARY KEY,
    share_id TEXT,
    title TEXT,
    artist TEXT,
    album TEXT,
    file_size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    catalogic_song_id TEXT,
    match_confidence TEXT,
    artwork_url TEXT,
    playable INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    last_scanned_at INTEGER NOT NULL
  );

  -- Artiest-niveau cache voor de muziekbibliotheek-weergave (los van
  -- nas_library_index, die is per-bestand). Geen file_size/mtime — een map
  -- heeft geen betrouwbaar enkel wijzigingssignaal zoals een bestand dat
  -- wel heeft. checked_at NULL = nog nooit opgezocht; eenmaal gezet (match
  -- of niet) blijft de rij permanent geldig in deze iteratie.
  CREATE TABLE IF NOT EXISTS nas_artist_index (
    artist_path TEXT PRIMARY KEY,
    artist_name TEXT NOT NULL,
    catalogic_artist_id TEXT,
    artwork_url TEXT,
    checked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS nas_album_index (
    album_path TEXT PRIMARY KEY,
    artist_path TEXT NOT NULL,
    album_name TEXT NOT NULL,
    catalogic_album_id TEXT,
    artwork_url TEXT,
    checked_at INTEGER
  );
`);

// Kolom toegevoegd na eerdere releases van nas_library_index — ALTER TABLE
// kent geen "IF NOT EXISTS" in SQLite, dus de "duplicate column"-fout wordt
// hier bewust genegeerd.
try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN playable INTEGER NOT NULL DEFAULT 1').run();
} catch (e) {}

try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN duration_ms INTEGER').run();
} catch (e) {}

try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN has_lyrics INTEGER').run();
} catch (e) {}

try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN lyrics_checked_at INTEGER').run();
} catch (e) {}

// The `users`/`api_keys` tables above are legacy schema — nothing reads
// from them; server.ts keeps the real auth state (users, password hashes,
// session tokens) in the `config` key-value store under 'auth_state_v1'
// (see saveAuthState/loadAuthState in server.ts). This used to seed a
// hardcoded, admin-scoped API key into these unused tables on every fresh
// DB — that literal was also checked into source and public on GitHub, so
// it's gone rather than perpetuated.

// Online, consistent backup via SQLite's own backup API — a raw file copy
// would risk an inconsistent snapshot: journal_mode is WAL (see above), so
// recent writes can sit in a separate -wal sidecar file that a plain copy
// of just hss.db would miss entirely.
export async function backupDbTo(destPath: string): Promise<void> {
  await db.backup(destPath);
}

// Config CRUD
export function getDbConfig(key: string, defaultValue = ''): string {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
    return row ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export function setDbConfig(key: string, value: string): void {
  try {
    db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    // Every setting the app has (cast design, DAC config, saved radio
    // stations...) ultimately writes through here — a bare `catch (e) {}`
    // meant a failed write (disk full, permissions, a locked WAL file)
    // just silently discarded whatever the user just changed, with no
    // trace anywhere but a journalctl someone would have to think to check.
    clearHealthIssue('db-write');
  } catch (e: any) {
    reportHealthIssue('db-write', 'database', 'error', `Instelling '${key}' kon niet worden opgeslagen: ${e.message}`);
  }
}

export function getAllDbConfig(): Record<string, string> {
  try {
    const rows = db.prepare('SELECT key, value FROM config').all() as any[];
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  } catch (e) {
    return {};
  }
}

// User Preferences CRUD
export function getUserPreferences(userId = 'usr-admin-01') {
  try {
    const row = db.prepare('SELECT active_tab, active_theme FROM user_preferences WHERE user_id = ?').get(userId) as any;
    if (row) {
      return { activeTab: row.active_tab, activeTheme: row.active_theme };
    }
  } catch (e) {}
  return { activeTab: 'now_playing', activeTheme: 'obsidian' };
}

export function setUserPreferences(userId = 'usr-admin-01', prefs: { activeTab?: string; activeTheme?: string }) {
  try {
    const current = getUserPreferences(userId);
    const activeTab = prefs.activeTab !== undefined ? prefs.activeTab : current.activeTab;
    const activeTheme = prefs.activeTheme !== undefined ? prefs.activeTheme : current.activeTheme;

    db.prepare(`
      INSERT INTO user_preferences (user_id, active_tab, active_theme, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        active_tab = excluded.active_tab,
        active_theme = excluded.active_theme,
        updated_at = excluded.updated_at
    `).run(userId, activeTab, activeTheme, Date.now());
  } catch (e) {}
}

// Spotify Account CRUD
export function getDbSpotifyAccount() {
  try {
    const row = db.prepare('SELECT * FROM spotify_account WHERE id = ?').get('primary') as any;
    if (row) {
      return {
        isConnected: Boolean(row.is_connected),
        displayName: row.display_name,
        email: row.email,
        product: row.product || 'premium',
        avatarUrl: row.avatar_url,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: row.expires_at,
      };
    }
  } catch (e) {}
  return {
    isConnected: false,
    displayName: null,
    email: null,
    product: 'premium',
    avatarUrl: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
  };
}

export function setDbSpotifyAccount(acc: Partial<{
  isConnected: boolean;
  displayName: string | null;
  email: string | null;
  product: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}>) {
  try {
    const current = getDbSpotifyAccount();
    const isConnected = acc.isConnected !== undefined ? (acc.isConnected ? 1 : 0) : (current.isConnected ? 1 : 0);
    const displayName = acc.displayName !== undefined ? acc.displayName : current.displayName;
    const email = acc.email !== undefined ? acc.email : current.email;
    const product = acc.product !== undefined ? acc.product : current.product;
    const avatarUrl = acc.avatarUrl !== undefined ? acc.avatarUrl : current.avatarUrl;
    const accessToken = acc.accessToken !== undefined ? acc.accessToken : current.accessToken;
    const refreshToken = acc.refreshToken !== undefined ? acc.refreshToken : current.refreshToken;
    const expiresAt = acc.expiresAt !== undefined ? acc.expiresAt : current.expiresAt;

    db.prepare(`
      INSERT INTO spotify_account (id, is_connected, display_name, email, product, avatar_url, access_token, refresh_token, expires_at, updated_at)
      VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        is_connected = excluded.is_connected,
        display_name = excluded.display_name,
        email = excluded.email,
        product = excluded.product,
        avatar_url = excluded.avatar_url,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(isConnected, displayName, email, product, avatarUrl, accessToken, refreshToken, expiresAt, Date.now());
  } catch (e) {}
}

// Artwork Cache CRUD
export function getCachedArtwork(trackId: string) {
  if (!trackId) return null;
  try {
    const row = db.prepare('SELECT * FROM artwork_cache WHERE track_id = ?').get(trackId) as any;
    if (row) {
      return {
        id: row.track_id,
        title: row.title,
        artist: row.artist,
        album: row.album,
        coverUrl: row.cover_url,
        highResCoverUrl: row.high_res_cover_url || row.cover_url,
        artistCoverUrl: row.artist_cover_url,
        dominantColor: row.dominant_color || '#10b981',
        releaseYear: row.release_year,
        durationMs: row.duration_ms,
      };
    }
  } catch (e) {}
  return null;
}

export function setCachedArtwork(artwork: {
  trackId: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl: string;
  highResCoverUrl?: string;
  artistCoverUrl?: string;
  dominantColor?: string;
  releaseYear?: string;
  durationMs?: number;
}) {
  if (!artwork.trackId || !artwork.coverUrl) return;
  try {
    db.prepare(`
      INSERT INTO artwork_cache (track_id, title, artist, album, cover_url, high_res_cover_url, artist_cover_url, dominant_color, release_year, duration_ms, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        title = COALESCE(excluded.title, artwork_cache.title),
        artist = COALESCE(excluded.artist, artwork_cache.artist),
        album = COALESCE(excluded.album, artwork_cache.album),
        cover_url = excluded.cover_url,
        high_res_cover_url = excluded.high_res_cover_url,
        artist_cover_url = excluded.artist_cover_url,
        dominant_color = excluded.dominant_color,
        release_year = excluded.release_year,
        duration_ms = COALESCE(excluded.duration_ms, artwork_cache.duration_ms),
        cached_at = excluded.cached_at
    `).run(
      artwork.trackId,
      artwork.title || null,
      artwork.artist || null,
      artwork.album || null,
      artwork.coverUrl,
      artwork.highResCoverUrl || artwork.coverUrl,
      artwork.artistCoverUrl || null,
      artwork.dominantColor || '#10b981',
      artwork.releaseYear || null,
      artwork.durationMs || null,
      Date.now()
    );
  } catch (e) {}
}

// Seed Web Radio Stations if empty
try {
  const radioCount = (db.prepare('SELECT COUNT(*) as count FROM web_radio_stations').get() as any)?.count || 0;
  if (radioCount === 0) {
    const seedRadio = db.prepare(`
      INSERT INTO web_radio_stations (id, name, genre, url, bitrate, logo_url, is_custom, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    seedRadio.run('radio-npo-2', 'NPO Radio 2', 'Pop / Rock / NL', 'https://icecast.omroep.nl/radio2-bb-aac', 192, 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-npo-klassiek', 'NPO Klassiek', 'Klassieke Muziek', 'https://icecast.omroep.nl/radioclassique-bb-aac', 192, 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-linn-jazz', 'Linn Jazz (320kbps Audiophile)', 'Acoustic / Jazz', 'http://stream.linn.co.uk:8000/stream1', 320, 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-fip', 'FIP Radio (France)', 'Eclectic / Jazz / Groove', 'https://icecast.radiofrance.fr/fip-midfi.mp3', 192, 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-kexp', 'KEXP 90.3 FM Seattle', 'Indie / Alternative', 'https://kexp.streamguys1.com/kexp160.mp3', 160, 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-sublime', 'Sublime FM', 'Funk / Soul / Jazz', 'https://stream.sublime.nl/sublime', 192, 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80', 0, Date.now());
    seedRadio.run('radio-bbc-6', 'BBC Radio 6 Music', 'Indie / Rock / Alternative', 'http://as-hls-ww-live.akamaized.net/pool_904/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio%3d128000.norewind.m3u8', 128, 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=300&auto=format&fit=crop&q=80', 0, Date.now());
  }
} catch (e) {}

// Web Radio CRUD
export function getDbWebRadioStations() {
  try {
    return db.prepare('SELECT * FROM web_radio_stations ORDER BY created_at ASC').all().map((r: any) => ({
      id: r.id,
      name: r.name,
      genre: r.genre,
      url: r.url,
      bitrate: r.bitrate,
      logoUrl: r.logo_url,
      isCustom: Boolean(r.is_custom),
    }));
  } catch (e) {
    return [];
  }
}

export function addDbWebRadioStation(station: { id?: string; name: string; genre: string; url: string; bitrate?: number; logoUrl?: string }) {
  const id = station.id || 'radio-custom-' + Date.now();
  try {
    db.prepare(`
      INSERT INTO web_radio_stations (id, name, genre, url, bitrate, logo_url, is_custom, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, station.name, station.genre, station.url, station.bitrate || 320, station.logoUrl || null, Date.now());
    return id;
  } catch (e) {
    return null;
  }
}

export function updateDbWebRadioStation(id: string, station: { name?: string; genre?: string; url?: string; bitrate?: number; logoUrl?: string }) {
  try {
    const existing = db.prepare('SELECT * FROM web_radio_stations WHERE id = ?').get(id) as any;
    if (!existing) return false;
    db.prepare(`
      UPDATE web_radio_stations SET name = ?, genre = ?, url = ?, bitrate = ?, logo_url = ? WHERE id = ?
    `).run(
      station.name ?? existing.name,
      station.genre ?? existing.genre,
      station.url ?? existing.url,
      station.bitrate ?? existing.bitrate,
      station.logoUrl ?? existing.logo_url,
      id,
    );
    return true;
  } catch (e) {
    return false;
  }
}

export function deleteDbWebRadioStation(id: string) {
  try {
    db.prepare('DELETE FROM web_radio_stations WHERE id = ?').run(id);
    return true;
  } catch (e) {
    return false;
  }
}

// Known Hubs CRUD (sidebar device switcher)
export function getDbKnownHubs() {
  try {
    return db.prepare('SELECT * FROM known_hubs ORDER BY created_at ASC').all().map((r: any) => ({
      id: r.id,
      name: r.name,
      url: r.url,
    }));
  } catch (e) {
    return [];
  }
}

export function addDbKnownHub(hub: { name: string; url: string }) {
  const id = 'hub-' + Date.now();
  try {
    db.prepare(`
      INSERT INTO known_hubs (id, name, url, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, hub.name, hub.url, Date.now());
    return id;
  } catch (e) {
    return null;
  }
}

export function deleteDbKnownHub(id: string) {
  try {
    db.prepare('DELETE FROM known_hubs WHERE id = ?').run(id);
    return true;
  } catch (e) {
    return false;
  }
}

// Network Shares CRUD
export function getDbNetworkShares() {
  try {
    return db.prepare('SELECT * FROM network_shares ORDER BY updated_at DESC').all().map((r: any) => ({
      id: r.id,
      name: r.name,
      shareType: r.share_type,
      host: r.host,
      sharePath: r.share_path,
      username: r.username,
      password: r.password,
      mountPoint: r.mount_point,
      status: r.status,
    }));
  } catch (e) {
    return [];
  }
}

export function saveDbNetworkShare(share: {
  id?: string;
  name: string;
  shareType: string;
  host: string;
  sharePath: string;
  username?: string;
  password?: string;
  mountPoint?: string;
  status?: string;
}) {
  const id = share.id || 'nas-' + Date.now();
  try {
    db.prepare(`
      INSERT INTO network_shares (id, name, share_type, host, share_path, username, password, mount_point, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        share_type = excluded.share_type,
        host = excluded.host,
        share_path = excluded.share_path,
        username = excluded.username,
        password = excluded.password,
        mount_point = excluded.mount_point,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      id,
      share.name,
      share.shareType || 'smb',
      share.host,
      share.sharePath,
      share.username || null,
      share.password || null,
      share.mountPoint || '/mnt/nas',
      share.status || 'mounted',
      Date.now()
    );
    return id;
  } catch (e) {
    return null;
  }
}

// NAS Library Index CRUD (whole-library scan results — see nasLibraryScan.ts)
export function getDbNasLibraryEntry(filePath: string): any {
  try {
    return db.prepare('SELECT * FROM nas_library_index WHERE file_path = ?').get(filePath);
  } catch (e) {
    return undefined;
  }
}

export function upsertDbNasLibraryEntry(entry: {
  filePath: string;
  shareId?: string;
  title: string;
  artist: string;
  album: string;
  fileSize: number;
  mtimeMs: number;
  catalogicSongId?: string | null;
  matchConfidence?: string | null;
  artworkUrl?: string | null;
  playable?: boolean;
  durationMs?: number;
}) {
  try {
    db.prepare(`
      INSERT INTO nas_library_index (file_path, share_id, title, artist, album, file_size, mtime_ms, catalogic_song_id, match_confidence, artwork_url, playable, duration_ms, last_scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        share_id = excluded.share_id,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        file_size = excluded.file_size,
        mtime_ms = excluded.mtime_ms,
        catalogic_song_id = excluded.catalogic_song_id,
        match_confidence = excluded.match_confidence,
        artwork_url = excluded.artwork_url,
        playable = excluded.playable,
        duration_ms = excluded.duration_ms,
        last_scanned_at = excluded.last_scanned_at
    `).run(
      entry.filePath,
      entry.shareId || null,
      entry.title,
      entry.artist,
      entry.album,
      entry.fileSize,
      entry.mtimeMs,
      entry.catalogicSongId || null,
      entry.matchConfidence || null,
      entry.artworkUrl || null,
      entry.playable === false ? 0 : 1,
      entry.durationMs ?? null,
      Date.now(),
    );
  } catch (e) {}
}

export function getDbNasLibraryStats() {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN catalogic_song_id IS NOT NULL THEN 1 ELSE 0 END) AS matched FROM nas_library_index`,
      )
      .get() as any;
    const total = row?.total || 0;
    const matched = row?.matched || 0;
    return { total, matched, unmatched: total - matched };
  } catch (e) {
    return { total: 0, matched: 0, unmatched: 0 };
  }
}

export function getDbNasLibraryResults(filter: 'all' | 'matched' | 'unmatched', limit = 500): any[] {
  try {
    const where =
      filter === 'matched' ? 'WHERE catalogic_song_id IS NOT NULL' : filter === 'unmatched' ? 'WHERE catalogic_song_id IS NULL' : '';
    return db.prepare(`SELECT * FROM nas_library_index ${where} ORDER BY file_path ASC LIMIT ?`).all(limit);
  } catch (e) {
    return [];
  }
}

export function getDbNasLibraryFileCountForShare(shareId: string, mountPoint: string): number {
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM nas_library_index WHERE share_id = ? OR file_path LIKE ? || '/%'")
      .get(shareId, mountPoint) as any;
    return row?.count || 0;
  } catch (e) {
    return 0;
  }
}

export function updateDbNasLibraryLyricsStatus(filePath: string, hasLyrics: boolean): void {
  try {
    db.prepare('UPDATE nas_library_index SET has_lyrics = ?, lyrics_checked_at = ? WHERE file_path = ?').run(
      hasLyrics ? 1 : 0,
      Date.now(),
      filePath,
    );
  } catch (e) {}
}

// Artiest-niveau cache voor de muziekbibliotheek (zie
// docs/superpowers/specs/2026-08-22-nas-music-library-design.md)
export function getDbNasArtistEntry(artistPath: string): any {
  try {
    return db.prepare('SELECT * FROM nas_artist_index WHERE artist_path = ?').get(artistPath);
  } catch (e) {
    return undefined;
  }
}

export function upsertDbNasArtistEntry(entry: {
  artistPath: string;
  artistName: string;
  catalogicArtistId?: string | null;
  artworkUrl?: string | null;
  checked: boolean;
}) {
  try {
    db.prepare(`
      INSERT INTO nas_artist_index (artist_path, artist_name, catalogic_artist_id, artwork_url, checked_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(artist_path) DO UPDATE SET
        artist_name = excluded.artist_name,
        catalogic_artist_id = excluded.catalogic_artist_id,
        artwork_url = excluded.artwork_url,
        checked_at = excluded.checked_at
    `).run(
      entry.artistPath,
      entry.artistName,
      entry.catalogicArtistId || null,
      entry.artworkUrl || null,
      entry.checked ? Date.now() : null,
    );
  } catch (e) {}
}

// Album-niveau cache — zelfde patroon, één niveau dieper.
export function getDbNasAlbumEntry(albumPath: string): any {
  try {
    return db.prepare('SELECT * FROM nas_album_index WHERE album_path = ?').get(albumPath);
  } catch (e) {
    return undefined;
  }
}

export function upsertDbNasAlbumEntry(entry: {
  albumPath: string;
  artistPath: string;
  albumName: string;
  catalogicAlbumId?: string | null;
  artworkUrl?: string | null;
  checked: boolean;
}) {
  try {
    db.prepare(`
      INSERT INTO nas_album_index (album_path, artist_path, album_name, catalogic_album_id, artwork_url, checked_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(album_path) DO UPDATE SET
        artist_path = excluded.artist_path,
        album_name = excluded.album_name,
        catalogic_album_id = excluded.catalogic_album_id,
        artwork_url = excluded.artwork_url,
        checked_at = excluded.checked_at
    `).run(
      entry.albumPath,
      entry.artistPath,
      entry.albumName,
      entry.catalogicAlbumId || null,
      entry.artworkUrl || null,
      entry.checked ? Date.now() : null,
    );
  } catch (e) {}
}

function ensurePlaylistsTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      track_count INTEGER DEFAULT 0,
      tracks_json TEXT,
      is_spotify INTEGER DEFAULT 1,
      uri TEXT,
      created_at INTEGER
    )
  `).run();
  // Column added after the table already shipped on some installs — ALTER TABLE has
  // no "IF NOT EXISTS" in SQLite, so just swallow the "duplicate column" error.
  try {
    db.prepare('ALTER TABLE playlists ADD COLUMN audio_profile_json TEXT').run();
  } catch (e) {}
}

export function saveDbImportedPlaylist(playlist: {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  trackCount: number;
  tracks: any[];
  isSpotify?: boolean;
  uri?: string;
  audioProfile?: any;
}) {
  try {
    ensurePlaylistsTable();

    db.prepare(`
      INSERT INTO playlists (id, name, description, cover_url, track_count, tracks_json, is_spotify, uri, audio_profile_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        cover_url = excluded.cover_url,
        track_count = excluded.track_count,
        tracks_json = excluded.tracks_json,
        audio_profile_json = excluded.audio_profile_json,
        created_at = excluded.created_at
    `).run(
      playlist.id,
      playlist.name,
      playlist.description || '',
      playlist.coverUrl || '',
      playlist.trackCount,
      JSON.stringify(playlist.tracks),
      playlist.isSpotify ? 1 : 0,
      playlist.uri || '',
      playlist.audioProfile ? JSON.stringify(playlist.audioProfile) : null,
      Date.now()
    );
  } catch (e) {}
}

export function getDbImportedPlaylists() {
  try {
    ensurePlaylistsTable();

    const rows = db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      coverUrl: r.cover_url,
      trackCount: r.track_count,
      tracks: JSON.parse(r.tracks_json || '[]'),
      isSpotify: Boolean(r.is_spotify),
      uri: r.uri,
      audioProfile: r.audio_profile_json ? JSON.parse(r.audio_profile_json) : undefined,
    }));
  } catch (e) {
    return [];
  }
}

export function deleteDbImportedPlaylist(id: string) {
  try {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    return true;
  } catch (e) {
    return false;
  }
}

// Recognized-audio fingerprint cache (turntable/CD recognition) — see
// src/services/audioRecognition.ts, which does the actual fuzzy matching
// against every row this returns.
export function getAllRecognizedFingerprints() {
  try {
    const rows = db.prepare('SELECT * FROM recognized_audio').all() as any[];
    return rows.map((r) => ({
      fingerprintHash: r.fingerprint_hash as string,
      fingerprint: JSON.parse(r.fingerprint) as number[],
      durationSec: r.duration_sec as number,
      title: r.title as string,
      artist: r.artist as string,
      album: r.album as string,
      coverUrl: r.cover_url as string,
    }));
  } catch (e) {
    return [];
  }
}

export function saveRecognizedAudio(entry: {
  fingerprintHash: string;
  fingerprint: number[];
  durationSec: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
}) {
  try {
    db.prepare(`
      INSERT INTO recognized_audio (fingerprint_hash, fingerprint, duration_sec, title, artist, album, cover_url, recognized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint_hash) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        cover_url = excluded.cover_url,
        recognized_at = excluded.recognized_at
    `).run(
      entry.fingerprintHash,
      JSON.stringify(entry.fingerprint),
      entry.durationSec,
      entry.title,
      entry.artist,
      entry.album,
      entry.coverUrl,
      Date.now(),
    );
  } catch (e) {}
}

// --- Liked tracks (heart button) — see src/services/likedTracks.ts for the
// likeKey that identifies a song across sources, and routes/likes.ts.

export function getLikedTracks(): LikedTrack[] {
  try {
    const rows = db.prepare('SELECT * FROM liked_tracks ORDER BY liked_at DESC').all() as any[];
    return rows.map((r) => ({
      likeKey: r.like_key,
      title: r.title,
      artist: r.artist,
      album: r.album || '',
      coverUrl: r.cover_url || '',
      source: r.source,
      sourceDetail: r.source_detail || '',
      spotifyId: r.spotify_id || null,
      uri: r.uri || null,
      likedAt: r.liked_at,
    }));
  } catch (e) {
    return [];
  }
}

export function isTrackLiked(likeKey: string): boolean {
  try {
    return !!db.prepare('SELECT 1 FROM liked_tracks WHERE like_key = ?').get(likeKey);
  } catch (e) {
    return false;
  }
}

// Re-liking a song already in the list refreshes what we know about it (a
// radio like has no cover or uri; the same song off Spotify later does)
// without moving it to the top — liked_at stays the moment you first liked it.
export function saveLikedTrack(entry: LikedTrack): void {
  db.prepare(`
    INSERT INTO liked_tracks (like_key, title, artist, album, cover_url, source, source_detail, spotify_id, uri, liked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(like_key) DO UPDATE SET
      album = COALESCE(NULLIF(excluded.album, ''), album),
      cover_url = COALESCE(NULLIF(excluded.cover_url, ''), cover_url),
      spotify_id = COALESCE(excluded.spotify_id, spotify_id),
      uri = COALESCE(excluded.uri, uri)
  `).run(
    entry.likeKey,
    entry.title,
    entry.artist,
    entry.album,
    entry.coverUrl,
    entry.source,
    entry.sourceDetail,
    entry.spotifyId,
    entry.uri,
    entry.likedAt,
  );
}

export function deleteLikedTrack(likeKey: string): boolean {
  try {
    return db.prepare('DELETE FROM liked_tracks WHERE like_key = ?').run(likeKey).changes > 0;
  } catch (e) {
    return false;
  }
}

// --- Radio-log (optionele luistergeschiedenis) — zie hubConfig.radioLogEnabled
// en de ticker in src/server/state.ts die hier bij elke ICY-tagwissel in schrijft.

export function logRadioPlay(station: string, title: string, artist: string, artworkUrl: string | null = null): void {
  db.prepare('INSERT INTO radio_log (station, title, artist, artwork_url, played_at) VALUES (?, ?, ?, ?, ?)').run(
    station,
    title,
    artist,
    artworkUrl,
    Date.now(),
  );
}

function mapRadioLogRow(r: any): RadioLogEntry {
  return { id: r.id, station: r.station, title: r.title, artist: r.artist, artworkUrl: r.artwork_url || null, playedAt: r.played_at };
}

export function getRadioLog(limit = 200, offset = 0): RadioLogEntry[] {
  try {
    const rows = db
      .prepare('SELECT * FROM radio_log ORDER BY played_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
    return rows.map(mapRadioLogRow);
  } catch (e) {
    return [];
  }
}

// Rijen die nog geen albumart hebben — het nummer stond bij het loggen nog
// niet in Catalogic (zie submitCatalogicBacklog in de ticker). Na een
// webhook-poke wordt hierover opnieuw een passieve lookup geprobeerd (zie
// reconcileRadioLogBacklog in state.ts).
export function getRadioLogEntriesWithoutArtwork(limit = 500): RadioLogEntry[] {
  try {
    const rows = db
      .prepare('SELECT * FROM radio_log WHERE artwork_url IS NULL ORDER BY played_at DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(mapRadioLogRow);
  } catch (e) {
    return [];
  }
}

// Meerdere rijen kunnen hetzelfde titel+artiest delen (herhalingen op de
// radio) — één geslaagde lookup vult ze allemaal in één keer.
export function setRadioLogArtworkForSong(title: string, artist: string, artworkUrl: string): void {
  db.prepare('UPDATE radio_log SET artwork_url = ? WHERE title = ? AND artist = ? AND artwork_url IS NULL').run(
    artworkUrl,
    title,
    artist,
  );
}

export function clearRadioLog(): void {
  db.prepare('DELETE FROM radio_log').run();
}

export default db;
