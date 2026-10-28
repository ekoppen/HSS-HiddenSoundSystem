# NAS-sectie (HSS-kant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onspeelbare NAS-bestanden verbergen, automatisch scannen bij het koppelen van een share, een backlog+webhook-lus met Catalogic opzetten, en tabel/detail/icoon-weergaves toevoegen aan de bestandenverkenner.

**Architecture:** Alles bouwt voort op de bestaande whole-library scan (`nasLibraryScan.ts`), de bestaande `nas_library_index`-tabel, en het bestaande best-effort Catalogic-clientpatroon (`catalogicClient.ts`). Geen nieuwe subsystemen — een kolom erbij, twee nieuwe client-functies, één nieuwe route, één nieuwe UI-module.

**Tech Stack:** Express, better-sqlite3, React 19, music-metadata, node:test (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-08-22-nas-catalogic-backlog-design.md`

## Global Constraints

- Alle Catalogic-netwerkaanroepen zijn best-effort: een falende aanroep mag nooit een gebruikersactie (mount, browse, scan) blokkeren of laten crashen — zelfde patroon als het bestaande `lookupCatalogicSong` (try/catch → `null`/`false`, geen throw).
- `catalogicScanLookupEnabled` (bestaande instelling) bepaalt of een scan/backlog-aanroep Catalogic-netwerkverkeer mag maken — nooit negeren.
- Geen geheimen (webhook-secret) in `hubConfig` of `config.json` — alleen via `getDbConfig`/`setDbConfig` in de SQLite `config`-tabel, zelfde behandeling als het NAS-share-wachtwoord.
- Dit repo heeft geen testdatabase-isolatie (de enige bestaande test, `tests/smoke.test.ts`, spawnt de echte server-subprocess tegen de echte SQLite-db-locatie). Bouw die isolatie niet alsnog — buiten scope. Nieuwe geautomatiseerde tests blijven daarom beperkt tot pure, I/O-vrije functies (of I/O op een scratch-bestand buiten de app-db); DB-rondslag-gedrag wordt handmatig geverifieerd zoals in elke taak beschreven.
- Catalogic-kant (job-soort + `/v1/songs/backlog`-route) staat als apart Kompas-taakje (`catalogic`-project) en wordt niet in dit plan geïmplementeerd.

---

## Bestandenoverzicht

- Modify: `db.ts` — `playable`-kolom op `nas_library_index`, `upsertDbNasLibraryEntry` uitgebreid.
- Modify: `src/services/localTrackMetadata.ts` — `readLocalTags`/`peekLocalTrack` geven `playable` door.
- Modify: `src/server/routes/nas.ts` — browse filtert onspeelbare bestanden, mount triggert scan, nieuwe webhook-route.
- Modify: `server.ts` — globale JSON-parser bewaart de raw body (nodig voor de webhook-signature-check).
- Modify: `src/services/nasLibraryScan.ts` — schrijft `playable` weg, dient backlog in, nieuwe `reconcileNasBacklog()`.
- Modify: `src/services/catalogicClient.ts` — `submitCatalogicBacklog`, `registerCatalogicWebhook`, `verifyCatalogicWebhookSignature`.
- Modify: `src/server/state.ts` — `hubConfig.publicUrl`, startup-registratie van de webhook.
- Modify: `src/server/routes/config.ts` — `publicUrl` in GET/POST `/api/config`, her-registratie na save.
- Modify: `src/components/NasBrowser.tsx` — view-switcher, gebruikt de nieuwe view-renderers.
- Create: `src/components/NasFileViews.tsx` — tabel- en icoonweergave (detail blijft in `NasBrowser.tsx`).
- Modify: `tests/smoke.test.ts` — dekking voor de nieuwe browse-filtering en webhook-signature-check.

---

### Task 1: `playable`-kolom in `nas_library_index`

**Files:**
- Modify: `db.ts:134-147` (CREATE TABLE), `db.ts:480-521` (`upsertDbNasLibraryEntry`)
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `upsertDbNasLibraryEntry(entry: { filePath: string; shareId?: string; title: string; artist: string; album: string; fileSize: number; mtimeMs: number; catalogicSongId?: string | null; matchConfidence?: string | null; artworkUrl?: string | null; playable?: boolean })` — nieuw optioneel veld `playable`, default `true` wanneer weggelaten.
- Produces: rijen uit `getDbNasLibraryEntry`/`getDbNasLibraryResults` bevatten voortaan een `playable` kolom (`0`/`1`, `SELECT *` pikt 'm automatisch op — geen signatuurwijziging nodig).

- [ ] **Step 1: Kolom toevoegen aan de CREATE TABLE + ALTER TABLE-migratie voor bestaande installs**

In `db.ts`, in het grote `db.exec(...)`-blok, voeg de kolom toe aan de bestaande `CREATE TABLE IF NOT EXISTS nas_library_index`:

```sql
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
    last_scanned_at INTEGER NOT NULL
  );
```

Direct na het `db.exec(...)`-blok (na de sluitende backtick rond regel 147), voeg de migratie toe voor installs waar de tabel al bestond vóór deze kolom er was — zelfde patroon als `audio_profile_json` op `playlists` (`db.ts:562-566`):

```ts
// Kolom toegevoegd na eerdere releases van nas_library_index — ALTER TABLE
// kent geen "IF NOT EXISTS" in SQLite, dus de "duplicate column"-fout wordt
// hier bewust genegeerd.
try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN playable INTEGER NOT NULL DEFAULT 1').run();
} catch (e) {}
```

- [ ] **Step 2: `upsertDbNasLibraryEntry` schrijft `playable` weg**

In `db.ts`, pas de functiesignatuur en de INSERT aan (`db.ts:480-521`):

```ts
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
}) {
  try {
    db.prepare(`
      INSERT INTO nas_library_index (file_path, share_id, title, artist, album, file_size, mtime_ms, catalogic_song_id, match_confidence, artwork_url, playable, last_scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      Date.now(),
    );
  } catch (e) {}
}
```

- [ ] **Step 3: Handmatig verifiëren**

Run: `npm run dev`, en in een tweede terminal:
```bash
curl -s -X POST http://localhost:3000/api/nas/scan/start -H 'Authorization: Bearer <hub-api-key>'
sleep 2
curl -s http://localhost:3000/api/nas/scan/results | head -c 400
```
Expected: JSON-resultaten bevatten een `playable`-veld (`0` of `1`) per rij. (Poort/auth: zie `docs/API.md` voor de actuele waarden in deze checkout.)

- [ ] **Step 4: Commit**

```bash
git add db.ts
git commit -m "feat(nas): add playable column to nas_library_index"
```

---

### Task 2: `readLocalTags`/`peekLocalTrack` geven `playable` door

**Files:**
- Modify: `src/services/localTrackMetadata.ts:31-54` (`LocalFileMeta`, `readLocalTags`), `:94-99` (`peekLocalTrack`)
- Test: `tests/local-track-metadata.test.ts` (nieuw)

**Interfaces:**
- Consumes: niets nieuws (geen wijziging aan `mm.parseFile`-aanroep zelf).
- Produces: `readLocalTags(filePath: string): Promise<LocalFileMeta>` waar `LocalFileMeta` nu een `playable: boolean` veld heeft. `peekLocalTrack(filePath: string): Promise<Track & { playable: boolean }>`.

- [ ] **Step 1: Schrijf de falende test**

Nieuw bestand `tests/local-track-metadata.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLocalTags } from '../src/services/localTrackMetadata.ts';

test('readLocalTags marks a file that music-metadata cannot parse as not playable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-nas-test-'));
  const filePath = join(dir, 'corrupt.mp3');
  writeFileSync(filePath, Buffer.from('this is not a valid mp3 frame at all'));
  try {
    const meta = await readLocalTags(filePath);
    assert.equal(meta.playable, false);
    assert.equal(meta.title, 'corrupt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test, verifieer dat 'ie faalt**

Run: `npx tsx --test tests/local-track-metadata.test.ts`
Expected: FAIL — `meta.playable` is `undefined`, niet `false` (het veld bestaat nog niet).

- [ ] **Step 3: Implementeer**

In `src/services/localTrackMetadata.ts`, pas `LocalFileMeta` en `readLocalTags` aan:

```ts
export interface LocalFileMeta {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  playable: boolean;
}

/** Local-only: embedded tags if present, filename/folder-derived otherwise. No network. */
export async function readLocalTags(filePath: string): Promise<LocalFileMeta> {
  const ext = path.extname(filePath).toLowerCase();
  const fallbackTitle = path.basename(filePath, ext);
  const fallbackArtist = path.basename(path.dirname(filePath));
  try {
    const parsed = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    // music-metadata does not throw on garbage bytes with an audio-like
    // extension — it returns a best-effort format object with `container`
    // left undefined. A real container is always populated for anything it
    // actually recognized (verified: a hand-built minimal valid WAV parses
    // with `container: "WAVE"`; garbage bytes named `corrupt.mp3` parse
    // without throwing but with `container: undefined`). "Did parseFile
    // throw" alone is therefore not a reliable playability signal — checking
    // `format.container` is.
    const playable = !!parsed.format.container;
    return {
      title: parsed.common.title || fallbackTitle,
      artist: parsed.common.artist || parsed.common.albumartist || fallbackArtist,
      album: parsed.common.album || fallbackArtist,
      durationMs: parsed.format.duration ? Math.round(parsed.format.duration * 1000) : 240000,
      playable,
    };
  } catch {
    return { title: fallbackTitle, artist: fallbackArtist, album: fallbackArtist, durationMs: 240000, playable: false };
  }
}
```

En `peekLocalTrack` (regels 94-99), zodat een cache-hit als speelbaar geldt (het bestand is ooit succesvol getagd — zie spec §1 voor de afweging) en een verse parse zijn eigen `playable`-uitkomst doorgeeft:

```ts
export async function peekLocalTrack(filePath: string): Promise<Track & { playable: boolean }> {
  const cached = getCachedArtwork(cacheKeyFor(filePath));
  if (cached) return { ...fromCache(filePath, cached), playable: true };
  const tags = await readLocalTags(filePath);
  return { ...toTrack(filePath, tags, PLACEHOLDER_COVER, PLACEHOLDER_COVER), playable: tags.playable };
}
```

- [ ] **Step 4: Run test, verifieer dat 'ie slaagt**

Run: `npx tsx --test tests/local-track-metadata.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/localTrackMetadata.ts tests/local-track-metadata.test.ts
git commit -m "feat(nas): surface whether a local file's tags could be parsed"
```

---

### Task 3: Onspeelbare bestanden verbergen in `/api/nas/browse`

**Files:**
- Modify: `src/server/routes/nas.ts:105-145` (`GET /api/nas/browse`)
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: `peekLocalTrack` (Task 2, `Track & { playable: boolean }`), `getDbNasLibraryEntry` uit `db.ts` (bestaand, nu met `playable`-kolom uit Task 1).
- Produces: `GET /api/nas/browse` response `files[]` bevat geen audio-bestanden meer waarvan `playable === false` bekend is.

- [ ] **Step 1: Implementeer het filter**

In `src/server/routes/nas.ts`, voeg `getDbNasLibraryEntry` toe aan de bestaande import op regel 9:

```ts
import { getDbImportedPlaylists, getDbNasLibraryEntry, getDbNetworkShares, saveDbImportedPlaylist, saveDbNetworkShare } from '../../../db.ts';
```

Vervang de body van `GET /api/nas/browse` (regels 118-141):

```ts
    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    const rawFiles = await Promise.all(
      items.map(async (item: any) => {
        const isDir = item.isDirectory();
        const filePath = path.join(targetDir, item.name);
        const isAudio = !isDir && isAudioFile(item.name);
        if (!isAudio) {
          return { name: item.name, isDir, isAudio, path: filePath, playable: true };
        }
        // Local tags (or a prior cache hit) only — no Catalogic network call here,
        // that would block the whole listing. See /api/nas/enrich for artwork.
        const track = await peekLocalTrack(filePath);
        // A dedicated library scan (nasLibraryScan.ts) already knows whether this
        // exact file decodes — trust that over peekLocalTrack's cache-hit guess
        // when we have it, since an artwork_cache hit doesn't distinguish a real
        // parse from the filename-fallback path (see localTrackMetadata.ts).
        const scanned = getDbNasLibraryEntry(filePath);
        const playable = scanned ? !!scanned.playable : track.playable;
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
          playable,
        };
      }),
    );
    const files = rawFiles.filter((f) => f.isDir || !f.isAudio || f.playable !== false);

    res.json({ success: true, currentPath: targetDir, files });
```

- [ ] **Step 2: Handmatige verificatie**

Run: `npm run dev`, plaats een corrupt bestand met een audio-extensie in een NAS-map (bijv. `echo garbage > /mnt/nas/test/broken.mp3`), en:
```bash
curl -s "http://localhost:3000/api/nas/browse?path=/mnt/nas/test"
```
Expected: `broken.mp3` staat niet in `files`. Verwijder het testbestand na afloop.

- [ ] **Step 3: Smoke-test toevoegen**

In `tests/smoke.test.ts`, voeg een test toe die aantoont dat de route een niet-bestaand pad nette lege `files` teruggeeft (regressie-guard voor de nieuwe filterstap, zonder een echte NAS-mount nodig te hebben in CI):

```ts
test('GET /api/nas/browse on a path that does not exist returns an empty file list, not an error', async () => {
  const res = await fetch(`${BASE_URL}/api/nas/browse?path=/nonexistent-nas-path-for-tests`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.files, []);
});
```

- [ ] **Step 4: Run de volledige testsuite**

Run: `npm test`
Expected: alle tests slagen, inclusief de nieuwe.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/nas.ts tests/smoke.test.ts
git commit -m "feat(nas): hide files that failed to parse from the browser"
```

---

### Task 4: Scan schrijft `playable` weg

**Files:**
- Modify: `src/services/nasLibraryScan.ts:127-166` (worker-loop)

**Interfaces:**
- Consumes: `readLocalTags` (Task 2, geeft nu `playable` terug), `upsertDbNasLibraryEntry` (Task 1, accepteert nu `playable`).
- Produces: geen nieuwe exports — bestaand gedrag, extra veld doorgegeven.

- [ ] **Step 1: Geef `tags.playable` door aan de upsert**

In `src/services/nasLibraryScan.ts`, in de worker-functie, de bestaande `upsertDbNasLibraryEntry(...)`-aanroep (rond regel 152) krijgt er één regel bij:

```ts
              upsertDbNasLibraryEntry({
                filePath,
                shareId,
                title: tags.title,
                artist: tags.artist,
                album: tags.album,
                fileSize: stat.size,
                mtimeMs: stat.mtimeMs,
                catalogicSongId,
                matchConfidence,
                artworkUrl,
                playable: tags.playable,
              });
```

- [ ] **Step 2: Handmatige verificatie**

Run: `npm run dev`, trigger een scan (`POST /api/nas/scan/start`), en na afloop:
```bash
curl -s "http://localhost:3000/api/nas/scan/results?filter=all" | python3 -c "import json,sys; d=json.load(sys.stdin); print(set(r['playable'] for r in d['results']))"
```
Expected: bevat `1` (en `0` als de teststhevestigde `broken.mp3` uit Task 3 nog aanwezig is).

- [ ] **Step 3: Commit**

```bash
git add src/services/nasLibraryScan.ts
git commit -m "feat(nas): record playability during the library scan"
```

---

### Task 5: Scan bij koppelen

**Files:**
- Modify: `src/server/routes/nas.ts:22-103` (`POST /api/nas/mount`)

**Interfaces:**
- Consumes: `startNasLibraryScan` (bestaand, al geïmporteerd op regel 8), `hubConfig` (bestaand, al geïmporteerd op regel 10).
- Produces: geen nieuwe exports.

- [ ] **Step 1: Trigger de scan in de mount-callback**

In `src/server/routes/nas.ts`, binnen `router.post('/api/nas/mount', ...)`, de bestaande `execFile('sudo', mountArgs, { timeout: 3000 }, (err, stdout, stderr) => { ... })`-callback (regels 87-93):

```ts
    execFile('sudo', mountArgs, { timeout: 3000 }, (err: any, stdout: any, stderr: any) => {
      if (err) {
        console.warn(`[NAS Mount] Background mount warning:`, stderr || err.message);
      } else {
        console.log(`[NAS Mount] Successfully mounted ${type.toUpperCase()} share to ${targetMount}`);
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
```

`broadcastWebSocket` staat al in de bestaande import op regel 10.

- [ ] **Step 2: Handmatige verificatie**

Run: `npm run dev`, koppel een test-share via `POST /api/nas/mount`, en volg de servelogs: `[NAS Mount] Successfully mounted ...` moet gevolgd worden door scan-voortgang (`filesScanned`/`filesFound` in de `nas_scan_progress`-websocketberichten, te zien via `curl -s http://localhost:3000/api/nas/scan/status` kort na het koppelen).

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/nas.ts
git commit -m "feat(nas): auto-scan a share right after it mounts"
```

---

### Task 6: `catalogicClient.ts` — backlog indienen + webhook registreren

**Files:**
- Modify: `src/services/catalogicClient.ts`
- Test: `tests/catalogic-client.test.ts` (nieuw)

**Interfaces:**
- Produces:
  - `submitCatalogicBacklog(items: { externalId: string; title: string; artist?: string }[]): Promise<boolean>`
  - `registerCatalogicWebhook(callbackUrl: string): Promise<string | null>` (retourneert het secret, of `null` bij falen)
  - `verifyCatalogicWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean`

- [ ] **Step 1: Schrijf de falende test voor de signature-check (puur, geen netwerk nodig)**

Nieuw bestand `tests/catalogic-client.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyCatalogicWebhookSignature } from '../src/services/catalogicClient.ts';

test('verifyCatalogicWebhookSignature accepts a correctly signed body', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ type: 'song.created' });
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyCatalogicWebhookSignature(body, signature, secret), true);
});

test('verifyCatalogicWebhookSignature rejects a tampered body', () => {
  const secret = 'test-secret';
  const signature = 'sha256=' + createHmac('sha256', secret).update('{"type":"song.created"}').digest('hex');
  assert.equal(verifyCatalogicWebhookSignature('{"type":"tampered"}', signature, secret), false);
});

test('verifyCatalogicWebhookSignature rejects a missing header', () => {
  assert.equal(verifyCatalogicWebhookSignature('{}', undefined, 'test-secret'), false);
});
```

- [ ] **Step 2: Run test, verifieer dat 'ie faalt**

Run: `npx tsx --test tests/catalogic-client.test.ts`
Expected: FAIL — `verifyCatalogicWebhookSignature` bestaat nog niet (import error).

- [ ] **Step 3: Implementeer**

In `src/services/catalogicClient.ts`, werk het top-comment bij (het is straks niet meer puur read-only) en voeg de drie functies toe onderaan het bestand:

```ts
// Read/write client for Catalogic (https://catalogic.doorkoppen.nl), the shared
// music-metadata hub. Search/lookup reads are public — no API key needed.
// Submitting a backlog and registering a webhook are opt-in write calls, used
// only when Catalogic is enabled and a Hub API key is configured (see
// /api/config). Best-effort only: any failure (disabled, network, timeout, no
// match) resolves to `null`/`false` and callers fall back to locally-derived
// metadata, matching Catalogic's own "best-effort" integration philosophy
// (see CATALOGIC_SYNC.md in the catalogic repo).
```

```ts
import { createHmac, timingSafeEqual } from 'crypto';

export interface CatalogicBacklogItem {
  externalId: string;
  title: string;
  artist?: string;
}

/**
 * Hands a batch of not-yet-matched local files to Catalogic's own backlog
 * queue (job kind `songs.resolve_backlog_item` on the Catalogic side — see
 * docs/superpowers/specs/2026-08-22-nas-catalogic-backlog-design.md), so it
 * can resolve/create them at its own pace instead of blocking a scan on a
 * live Spotify lookup per file. Best-effort: a failure just means these files
 * stay unmatched until the next scan re-submits them (Catalogic dedupes by
 * external_id, so re-submitting the same backlog repeatedly is harmless).
 */
export async function submitCatalogicBacklog(items: CatalogicBacklogItem[]): Promise<boolean> {
  if (!config.enabled || items.length === 0) return false;
  const url = `${config.url}/v1/songs/backlog`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        items: items.slice(0, 500).map((i) => ({ external_id: i.externalId, title: i.title, artist: i.artist })),
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers this Hub as a Catalogic webhook subscriber for `song.created`,
 * so a resolved backlog item pokes `callbackUrl` instead of HSS having to
 * poll. Returns the delivery secret (for verifyCatalogicWebhookSignature) on
 * success, `null` on any failure — caller decides whether/how to retry.
 */
export async function registerCatalogicWebhook(callbackUrl: string): Promise<string | null> {
  if (!config.enabled) return null;
  const url = `${config.url}/webhooks`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ target_url: callbackUrl, events: ['song.created'] }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { secret?: string };
    return body.secret ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies the `X-Catalogic-Signature: sha256=<hex>` header Catalogic sends
 * with every webhook delivery (HMAC-SHA256 of the raw request body, keyed by
 * the secret returned from registerCatalogicWebhook). Constant-time compare
 * so response timing can't leak the secret.
 */
export function verifyCatalogicWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
```

- [ ] **Step 4: Run test, verifieer dat 'ie slaagt**

Run: `npx tsx --test tests/catalogic-client.test.ts`
Expected: PASS (alle drie)

- [ ] **Step 5: Commit**

```bash
git add src/services/catalogicClient.ts tests/catalogic-client.test.ts
git commit -m "feat(nas): add Catalogic backlog submission and webhook registration/verification"
```

---

### Task 7: Scan dient backlog in + `reconcileNasBacklog()`

**Files:**
- Modify: `src/services/nasLibraryScan.ts`

**Interfaces:**
- Consumes: `submitCatalogicBacklog`, `CatalogicBacklogItem` (Task 6), `getDbNasLibraryResults('unmatched', 500)` (bestaand, al geïmporteerd), `lookupCatalogicSong` (bestaand, al geïmporteerd), `upsertDbNasLibraryEntry` (bestaand).
- Produces: `reconcileNasBacklog(onReconciled?: (result: { checked: number; matched: number }) => void): Promise<{ checked: number; matched: number }>` — nieuwe export, aan te roepen vanuit de webhook-route (Task 10).

- [ ] **Step 1: Backlog indienen na een scan**

In `src/services/nasLibraryScan.ts`, voeg `submitCatalogicBacklog` toe aan de import op regel 20:

```ts
import { lookupCatalogicSong, submitCatalogicBacklog } from './catalogicClient.ts';
```

In de `finally`-tak van `startNasLibraryScan` (regels 182-187), vóór de bestaande `opts.onProgress?.(...)`-aanroep:

```ts
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
      status.currentFile = null;
      if (opts.allowCatalogicLookup) {
        const unmatched = getDbNasLibraryResults('unmatched', 500);
        void submitCatalogicBacklog(
          unmatched.map((r: any) => ({ externalId: r.file_path, title: r.title, artist: r.artist })),
        );
      }
      opts.onProgress?.(getNasScanStatus());
    }
```

`external_id` is hier gewoon het bestandspad zelf — stabiel per bestand, en Catalogic behandelt het als een ondoorzichtige string (geen hashing nodig, ponytail: minder code, en het pad staat toch al lokaal, niets gevoeligs wat niet al in de bestaande scan-resultaten zichtbaar is).

- [ ] **Step 2: `reconcileNasBacklog()` toevoegen**

Onderaan `src/services/nasLibraryScan.ts`:

```ts
/**
 * Re-checks every still-unmatched library entry against Catalogic — meant to
 * be triggered by the `song.created` webhook (see the design spec's §3):
 * treat the webhook purely as "go check your backlog again," not as
 * per-song detail, since the reconcile itself is cheap and idempotent (it
 * only ever touches rows that are already unmatched).
 */
export async function reconcileNasBacklog(
  onReconciled?: (result: { checked: number; matched: number }) => void,
): Promise<{ checked: number; matched: number }> {
  const unmatched = getDbNasLibraryResults('unmatched', 500);
  let matched = 0;
  for (const row of unmatched as any[]) {
    const match = await lookupCatalogicSong(row.title, row.artist);
    if (!match) continue;
    upsertDbNasLibraryEntry({
      filePath: row.file_path,
      shareId: row.share_id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      fileSize: row.file_size,
      mtimeMs: row.mtime_ms,
      catalogicSongId: match.songId,
      matchConfidence:
        match.artistName && match.artistName.toLowerCase().includes(String(row.artist).toLowerCase()) ? 'hoog' : 'laag',
      artworkUrl: match.artworkUrl,
      playable: row.playable !== 0,
    });
    matched++;
  }
  const result = { checked: unmatched.length, matched };
  if (matched > 0) onReconciled?.(result);
  return result;
}
```

- [ ] **Step 3: Handmatige verificatie**

Run: `npm run dev`, roep in de Node REPL of via een tijdelijk script `reconcileNasBacklog(console.log)` aan nadat er onopgeloste rijen in `nas_library_index` staan; controleer dat `checked`/`matched` kloppen met `GET /api/nas/scan/results?filter=unmatched` vóór en na de aanroep.

- [ ] **Step 4: Commit**

```bash
git add src/services/nasLibraryScan.ts
git commit -m "feat(nas): submit unmatched files to Catalogic's backlog and add a reconcile pass"
```

---

### Task 8: `hubConfig.publicUrl`

**Files:**
- Modify: `src/server/state.ts` (interface + default + disk-config load/save)
- Modify: `src/server/routes/config.ts` (GET/POST `/api/config`)

**Interfaces:**
- Produces: `hubConfig.publicUrl: string` — nieuw veld, leeg default. Gebruikt door Task 9.

- [ ] **Step 1: Veld toevoegen aan `HubConfig` en de default**

In `src/server/state.ts`, zoek de `HubConfig`-interface (bevat o.a. `catalogicUrl`) en voeg toe:

```ts
  /** Publiek bereikbare basis-URL van deze Hub (bv. via Tailscale of
   *  port-forwarding), gebruikt als Catalogic-webhook target. Leeg = webhook-
   *  registratie wordt overgeslagen (zie ensureCatalogicWebhookRegistered). */
  publicUrl: string;
```

In de `hubConfig`-initialisatie (rond regel 179, naast de andere `catalogic*`-velden):

```ts
  publicUrl: getDbConfig('public_url', ''),
```

In `loadDiskConfig()` (rond regel 231-240):

```ts
        if (parsed.publicUrl) hubConfig.publicUrl = parsed.publicUrl;
```

In `saveDiskConfig()` (rond regel 263-273):

```ts
    if (hubConfig.publicUrl) setDbConfig('public_url', hubConfig.publicUrl);
```

- [ ] **Step 2: Blootleggen via `/api/config`**

In `src/server/routes/config.ts`, `publicUrl` heeft geen geheim karakter (het is een URL, geen credential) dus geen masking nodig in de GET-response — die spread't `...hubConfig` toch al mee. In de POST-handler (naast `catalogicUrl`, rond regel 50):

```ts
  if (updates.publicUrl !== undefined) hubConfig.publicUrl = updates.publicUrl.trim();
```

- [ ] **Step 3: Handmatige verificatie**

Run: `npm run dev`, dan:
```bash
curl -s -X POST http://localhost:3000/api/config -H 'Content-Type: application/json' -H 'Authorization: Bearer <hub-api-key>' -d '{"publicUrl":"https://example.tailnet.ts.net"}'
curl -s http://localhost:3000/api/config | python3 -c "import json,sys; print(json.load(sys.stdin)['config']['publicUrl'])"
```
Expected: `https://example.tailnet.ts.net`

- [ ] **Step 4: Commit**

```bash
git add src/server/state.ts src/server/routes/config.ts
git commit -m "feat(nas): add a publicUrl hub setting for the Catalogic webhook target"
```

---

### Task 9: Webhook automatisch (her)registreren

**Files:**
- Modify: `src/services/catalogicClient.ts` (nieuwe helper)
- Modify: `src/server/state.ts` (startup-aanroep)
- Modify: `src/server/routes/config.ts` (her-registratie na save)

**Interfaces:**
- Consumes: `registerCatalogicWebhook` (Task 6), `hubConfig.publicUrl`/`hubConfig.catalogicEnabled` (Task 8 / bestaand), `configureCatalogic` (bestaand).
- Produces: `ensureCatalogicWebhookRegistered(publicUrl: string): Promise<void>` — nieuwe export in `catalogicClient.ts`.

- [ ] **Step 1: `ensureCatalogicWebhookRegistered` toevoegen**

In `src/services/catalogicClient.ts`, importeer `getDbConfig`/`setDbConfig` uit `db.ts` en voeg toe:

```ts
import { getDbConfig, setDbConfig } from '../../db.ts';
```

```ts
/**
 * Registers the webhook once and remembers the secret in the (non-hubConfig,
 * non-disk-serialized — see Global Constraints) SQLite config table. A stored
 * secret means "already registered," so this is a cheap no-op on every
 * subsequent call — including every server boot.
 *
 * ponytail: doesn't detect a changed `publicUrl` and re-register — if you
 * move the Hub to a new address, clear the `catalogic_webhook_secret` config
 * key manually (or add a re-register button) to force it. Upgrade when
 * that's actually happened to someone.
 */
export async function ensureCatalogicWebhookRegistered(publicUrl: string): Promise<void> {
  if (!config.enabled || !publicUrl.trim()) return;
  if (getDbConfig('catalogic_webhook_secret', '')) return;
  const callbackUrl = `${publicUrl.replace(/\/$/, '')}/api/catalogic/webhook`;
  const secret = await registerCatalogicWebhook(callbackUrl);
  if (secret) setDbConfig('catalogic_webhook_secret', secret);
}
```

- [ ] **Step 2: Aanroepen bij serverstart**

In `src/server/state.ts`, voeg `configureCatalogic` en `ensureCatalogicWebhookRegistered` toe aan een top-level import van `../services/catalogicClient.ts` (geen circulaire import: `catalogicClient.ts` importeert, ook na Task 9 Step 1, niets uit `state.ts` — alleen `../../db.ts`). Na de bestaande `loadDiskConfig();`-aanroep op module-niveau (regel 277) — dit is ook de plek waar `configureCatalogic` voor het eerst na boot wordt aangeroepen, wat vandaag nergens gebeurde (Catalogic-lookups stonden tot nu toe pas aan ná de eerste `POST /api/config`; dat is nodig om deze feature sowieso te laten werken):

```ts
loadDiskConfig();

// Catalogic-client meteen op de hoogte brengen van de geladen instellingen —
// zonder deze aanroep bleef `catalogicClient.ts`'s eigen config op de
// ingebouwde default (enabled: false) staan tot de eerste keer dat iemand
// Instellingen opsloeg. Fire-and-forget: best-effort, blokkeert de boot niet.
configureCatalogic({ enabled: hubConfig.catalogicEnabled, url: hubConfig.catalogicUrl, apiKey: hubConfig.catalogicApiKey });
void ensureCatalogicWebhookRegistered(hubConfig.publicUrl);
```

- [ ] **Step 3: Her-registratie na een config-save**

In `src/server/routes/config.ts`, na de bestaande `configureCatalogic(...)`-aanroep (rond regel 72):

```ts
  configureCatalogic({ enabled: hubConfig.catalogicEnabled, url: hubConfig.catalogicUrl, apiKey: hubConfig.catalogicApiKey });
  void ensureCatalogicWebhookRegistered(hubConfig.publicUrl);
```

En voeg `ensureCatalogicWebhookRegistered` toe aan de bestaande import op regel 4:

```ts
import { configureCatalogic, ensureCatalogicWebhookRegistered } from '../../services/catalogicClient.ts';
```

- [ ] **Step 4: Handmatige verificatie**

Zet `catalogicEnabled: true` en een geldige `publicUrl` via `POST /api/config`, herstart de server, en controleer in de logs/netwerk (of via een lokale mock-Catalogic-server) dat `POST {catalogicUrl}/webhooks` één keer wordt aangeroepen — een tweede herstart mag géén nieuwe aanroep meer doen (secret staat al in de db).

- [ ] **Step 5: Commit**

```bash
git add src/services/catalogicClient.ts src/server/state.ts src/server/routes/config.ts
git commit -m "feat(nas): auto-register the Catalogic webhook on boot and config save"
```

---

### Task 10: `POST /api/catalogic/webhook`

**Files:**
- Modify: `src/server/routes/nas.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: `verifyCatalogicWebhookSignature` (Task 6), `reconcileNasBacklog` (Task 7), `getDbConfig` uit `db.ts`, `broadcastWebSocket` (bestaand).
- Produces: nieuwe route, geen nieuwe exports.

- [ ] **Step 1: Raw body bewaren in de globale JSON-parser**

`server.ts:40` mount `express.json({ limit: '15mb' })` globaal, vóór de nas-router (`server.ts:99`) — tegen de tijd dat een request de nas-route bereikt is de body al geconsumeerd en tot een object geparsed. Een route-specifieke `express.raw()` zou dus niets meer krijgen om te lezen. Standaardoplossing: de globale parser bewaart de ruwe bytes zelf via zijn `verify`-hook (zelfde patroon als Stripe-achtige webhook-verificatie), zodat elke route erbij kan zonder dat de rest van de app iets merkt.

In `server.ts`, regel 40:

```ts
  app.use(
    express.json({
      limit: '15mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
```

- [ ] **Step 2: Route toevoegen**

In `src/server/routes/nas.ts`, breid de imports uit:

```ts
import { getDbImportedPlaylists, getDbConfig, getDbNasLibraryEntry, getDbNetworkShares, saveDbImportedPlaylist, saveDbNetworkShare } from '../../../db.ts';
import { reconcileNasBacklog } from '../../services/nasLibraryScan.ts';
import { verifyCatalogicWebhookSignature } from '../../services/catalogicClient.ts';
```

Voeg de route toe vlak vóór `export default router;`:

```ts
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
  void reconcileNasBacklog((result) => {
    broadcastWebSocket({ event: 'nas_backlog_reconciled', timestamp: Date.now(), data: result });
  });
});

export default router;
```

- [ ] **Step 3: Smoke-test**

In `tests/smoke.test.ts`:

```ts
test('POST /api/catalogic/webhook without a valid signature is rejected with 401', async () => {
  const res = await fetch(`${BASE_URL}/api/catalogic/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'song.created' }),
  });
  assert.equal(res.status, 401);
});
```

(Een test voor de geldige-signature-happy-path vereist een geregistreerd secret in de db, wat buiten het bereik van deze subprocess-smoke-test valt zonder db-isolatie — zie Global Constraints. De positieve flow is al gedekt door Task 6's `verifyCatalogicWebhookSignature`-unit-tests plus de handmatige verificatie hieronder.)

- [ ] **Step 4: Handmatige verificatie van de happy path**

Zet handmatig een testsecret: `sqlite3 <db-pad> "INSERT INTO config (key, value) VALUES ('catalogic_webhook_secret', 'test-secret')"`, dan:
```bash
BODY='{"type":"song.created"}'
SIG=$(node -e "console.log('sha256='+require('crypto').createHmac('sha256','test-secret').update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -X POST http://localhost:3000/api/catalogic/webhook -H "Content-Type: application/json" -H "X-Catalogic-Signature: $SIG" -d "$BODY"
```
Expected: `{"success":true}`, gevolgd door scan-achtige activiteit in de logs (reconcile-pass).

- [ ] **Step 5: Run de volledige testsuite + commit**

Run: `npm test`

```bash
git add src/server/routes/nas.ts tests/smoke.test.ts server.ts
git commit -m "feat(nas): add the Catalogic webhook receiver"
```

---

### Task 11: Tabel-, detail- en icoonweergave

**Files:**
- Create: `src/components/NasFileViews.tsx`
- Modify: `src/components/NasBrowser.tsx`

**Interfaces:**
- Consumes: bestaande `NasFile`-vorm (nu geëxporteerd vanuit `NasBrowser.tsx`), bestaande handlers `onPlayFile: (file: NasFile) => void`, `onQueueFile: (file: NasFile) => void`, `onOpenFolder: (path: string) => void`.
- Produces: `NasFileTable`, `NasFileIconGrid` (React-componenten, `src/components/NasFileViews.tsx`), gebruikt door `NasBrowser.tsx`.

- [ ] **Step 1: `NasFile` exporteren vanuit `NasBrowser.tsx`**

In `src/components/NasBrowser.tsx`, zet `export` vóór de bestaande `interface NasFile { ... }` (regel 6).

- [ ] **Step 2: `src/components/NasFileViews.tsx` aanmaken**

```tsx
import React from 'react';
import { Folder, Music, Play, Plus } from 'lucide-react';
import type { NasFile } from './NasBrowser';

interface NasFileViewProps {
  files: NasFile[];
  onOpenFolder: (path: string) => void;
  onPlayFile: (file: NasFile) => void;
  onQueueFile: (file: NasFile) => void;
}

function isHiRes(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext);
}

export const NasFileTable: React.FC<NasFileViewProps> = ({ files, onOpenFolder, onPlayFile, onQueueFile }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--text-mono-sm)' }}>
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
        <th style={{ padding: '6px 8px' }}>Naam</th>
        <th style={{ padding: '6px 8px' }}>Artiest</th>
        <th style={{ padding: '6px 8px' }}>Album</th>
        <th style={{ padding: '6px 8px', textAlign: 'right' }}></th>
      </tr>
    </thead>
    <tbody>
      {files.map((file, idx) => {
        if (file.isDir) {
          return (
            <tr key={`dir-${idx}`} onClick={() => onOpenFolder(file.path)} style={{ cursor: 'pointer' }}>
              <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Folder size={13} style={{ color: 'var(--accent)' }} />
                {file.name}
              </td>
              <td colSpan={3} />
            </tr>
          );
        }
        if (!file.isAudio) return null;
        return (
          <tr key={`audio-${idx}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>
              {file.title || file.name}
              {isHiRes(file.name) && <span style={{ color: 'var(--text-muted)' }}> · Hi-Res</span>}
            </td>
            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{file.artist || '—'}</td>
            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{file.album || '—'}</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <button onClick={() => onPlayFile(file)} title="Speel af" style={{ padding: 4, color: 'var(--accent)' }}>
                <Play size={12} fill="currentColor" />
              </button>
              <button onClick={() => onQueueFile(file)} title="Voeg toe aan wachtrij" style={{ padding: 4, color: 'var(--accent)' }}>
                <Plus size={12} />
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const NasFileIconGrid: React.FC<NasFileViewProps> = ({ files, onOpenFolder, onPlayFile }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" style={{ gap: 14 }}>
    {files.map((file, idx) => {
      if (file.isDir) {
        return (
          <div
            key={`dir-${idx}`}
            onClick={() => onOpenFolder(file.path)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Folder size={28} style={{ color: 'var(--accent)' }} />
            </div>
            <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%' }}>{file.name}</span>
          </div>
        );
      }
      if (!file.isAudio) return null;
      return (
        <div
          key={`audio-${idx}`}
          onClick={() => onPlayFile(file)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {file.coverUrl ? (
              <img src={file.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Music size={22} style={{ color: 'var(--status-success)' }} />
            )}
          </div>
          <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
            {file.title || file.name}
          </span>
        </div>
      );
    })}
  </div>
);
```

- [ ] **Step 3: View-switcher in `NasBrowser.tsx`**

In `src/components/NasBrowser.tsx`:

Import toevoegen (naast de bestaande `lucide-react`-import op regel 2):

```tsx
import { Folder, LayoutGrid, List, ListPlus, Music, Play, Plus, Rows3 } from 'lucide-react';
import { NasFileIconGrid, NasFileTable } from './NasFileViews';
```

State toevoegen (naast `nasFiles`/`nasCurrentPath`, regels 31-32):

```tsx
  const [nasView, setNasView] = useState<'detail' | 'table' | 'icon'>(
    () => (localStorage.getItem('nas-browser-view') as 'detail' | 'table' | 'icon') || 'detail',
  );

  const changeNasView = (view: 'detail' | 'table' | 'icon') => {
    setNasView(view);
    localStorage.setItem('nas-browser-view', view);
  };
```

View-switcher-knoppen toevoegen in de actieknoppenrij (naast de bestaande "Speel deze map af"/"Maak afspeellijst"-knoppen, rond regel 120-127):

```tsx
            <div className="flex items-center" style={{ gap: 2, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
              {([
                ['detail', Rows3, 'Detailweergave'],
                ['table', List, 'Tabelweergave'],
                ['icon', LayoutGrid, 'Icoonweergave'],
              ] as const).map(([view, Icon, label]) => (
                <button
                  key={view}
                  onClick={() => changeNasView(view)}
                  title={label}
                  style={{
                    padding: 6,
                    borderRadius: 'var(--radius-sm)',
                    background: nasView === view ? 'var(--accent-soft)' : 'transparent',
                    color: nasView === view ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
```

Tot slot de renderlogica: de bestaande `<div className="grid ...">{nasFiles.map(...)}</div>`-blok (regels 157-256) wordt vervangen door een `switch` op `nasView`, waarbij de huidige (ongewijzigde) JSX de `detail`-tak wordt, en `table`/`icon` de nieuwe componenten aanroepen:

```tsx
        {nasView === 'table' ? (
          <NasFileTable files={nasFiles} onOpenFolder={handleBrowseNasPath} onPlayFile={handlePlayLocalFile} onQueueFile={handleQueueFile} />
        ) : nasView === 'icon' ? (
          <NasFileIconGrid files={nasFiles} onOpenFolder={handleBrowseNasPath} onPlayFile={handlePlayLocalFile} onQueueFile={handleQueueFile} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 10 }}>
            {/* ...bestaande detail-JSX van regels 158-255, ongewijzigd... */}
          </div>
        )}
```

De bestaande inline `onClick={() => { onAddToQueue({...}) }}`-handler (regels 229-243) wordt geëxtraheerd naar een losse `handleQueueFile(file: NasFile)`-functie (zelfde body, nu herbruikbaar door alle drie de views) en in de detail-JSX aangeroepen als `onClick={() => handleQueueFile(file)}`.

- [ ] **Step 4: Handmatige verificatie**

Run: `npm run dev`, open de Bronnen-tab, schakel tussen de drie weergaveknoppen, herlaad de pagina en controleer dat de laatst gekozen weergave onthouden is (localStorage). Test play/queue-knoppen in alle drie de views.

- [ ] **Step 5: Commit**

```bash
git add src/components/NasBrowser.tsx src/components/NasFileViews.tsx
git commit -m "feat(nas): add table and icon views to the file browser"
```

---

## Self-Review

**Spec coverage:**
- §1 (onspeelbare bestanden verbergen) → Tasks 1–3. ✅
- §2 (scan bij koppelen) → Task 5. ✅
- §3 (backlog + callback, HSS-kant) → Tasks 6, 7, 8, 9, 10. Catalogic-kant bewust buiten dit plan (Kompas-taak). ✅
- §4 (tabel/detail/icoon) → Task 11. ✅

**Placeholder scan:** geen "TBD"/"later"/"add error handling" — elke stap bevat volledige code of een concrete, uitvoerbare verificatie-opdracht.

**Type consistency:** `LocalFileMeta`/`peekLocalTrack` (Task 2) → gebruikt door Task 3's browse-route. `upsertDbNasLibraryEntry`'s `playable?: boolean` (Task 1) → aangeroepen door Task 4 en Task 7 met hetzelfde veld. `submitCatalogicBacklog`/`registerCatalogicWebhook`/`verifyCatalogicWebhookSignature` (Task 6) → exact dezelfde namen en signaturen gebruikt in Tasks 7, 9, 10. `reconcileNasBacklog(onReconciled?)` (Task 7) → zelfde signatuur aangeroepen in Task 10. `hubConfig.publicUrl` (Task 8) → gelezen in Task 9. `NasFile` (bestaand, nu `export`) → geïmporteerd door Task 11's nieuwe bestand.
