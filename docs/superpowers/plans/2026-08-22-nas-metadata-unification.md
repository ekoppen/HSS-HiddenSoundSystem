# NAS-metadata Unificatie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de twee gescheiden, niet-communicerende opslagplekken voor NAS-bestandsmetadata (`nas_library_index` voor scans, `artwork_cache` voor weergave) door één bron van waarheid (`nas_library_index`), met wijzigingsdetectie overal — niet alleen tijdens een volledige scan.

**Architecture:** Eén nieuwe gedeelde functie `resolveLocalTrack(filePath, opts)` in `nasLibraryScan.ts` wordt het enige punt dat beslist "is deze rij nog vers, of moet er herlezen worden." Scan, browse, afspelen en verrijken roepen deze allemaal aan in plaats van hun eigen aparte cache-logica te hebben. `artwork_cache` (gedeeld met Spotify) blijft volledig ongemoeid.

**Tech Stack:** Express, better-sqlite3, TypeScript, music-metadata, node:test (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-08-22-nas-metadata-unification-design.md`

## Global Constraints

- Alle Catalogic-netwerkaanroepen blijven best-effort: nooit throwen, nooit een gebruikersactie blokkeren — zelfde patroon als vóór deze refactor.
- `artwork_cache`-tabel en zijn Spotify-gebruik (`src/server/routes/spotify.ts`) worden NIET aangeraakt — alleen het NAS-gebruik ervan (`localTrackMetadata.ts`'s cache-functies) wordt vervangen.
- Dit repo heeft geen testdatabase-isolatie — nieuwe geautomatiseerde tests blijven beperkt tot pure, I/O-vrije functies. Alles wat de database raakt (`resolveLocalTrack`, de routes) wordt handmatig geverifieerd via een lokale dev-server in de werkboom (niet tegen productie).
- Een bestaande rij in `nas_library_index` wordt alleen vertrouwd (geen herlezing) wanneer: de rij bestaat, `playable !== 0`, én `file_size`/`mtime_ms` ongewijzigd zijn t.o.v. de laatste keer. Dit is de bestaande regel uit de scan-worker en de eerdere `playable`-heronderzoek-fix — niet opnieuw uitvinden, hergebruiken.
- `shareId` mag nooit stilletjes overschreven worden naar `null` bij een re-resolve vanuit browse/afspelen (die geen shareId kennen) — de bestaande waarde uit de rij moet behouden blijven wanneer de aanroeper er zelf geen meegeeft.

---

## Bestandenoverzicht

- Modify: `db.ts` — `duration_ms`-kolom op `nas_library_index`, `upsertDbNasLibraryEntry` uitgebreid.
- Modify: `src/services/nasLibraryScan.ts` — nieuwe `resolveLocalTrack()`-functie, scan-worker wordt een dunne wrapper eromheen.
- Modify: `src/server/routes/nas.ts` — vijf routes (`browse`, `enrich`, `play-file`, `play-folder`, `create-playlist`) gebruiken `resolveLocalTrack` i.p.v. de oude cache-functies.
- Modify: `src/services/localTrackMetadata.ts` — krimpt tot alleen `isAudioFile` + `readLocalTags`.

---

### Task 1: `duration_ms`-kolom op `nas_library_index`

**Files:**
- Modify: `db.ts:134-147` (CREATE TABLE), `db.ts:150-155` (ALTER TABLE-migraties), `db.ts:488-532` (`upsertDbNasLibraryEntry`)

**Interfaces:**
- Produces: `upsertDbNasLibraryEntry(entry: { filePath: string; shareId?: string; title: string; artist: string; album: string; fileSize: number; mtimeMs: number; catalogicSongId?: string | null; matchConfidence?: string | null; artworkUrl?: string | null; playable?: boolean; durationMs?: number })` — nieuw optioneel veld `durationMs`, ontbrekend/`undefined` → `NULL` in de kolom.
- Produces: rijen uit `getDbNasLibraryEntry`/`getDbNasLibraryResults` bevatten voortaan een `duration_ms`-kolom (integer of `null`, `SELECT *` pikt 'm automatisch op).

- [ ] **Step 1: Kolom toevoegen aan de CREATE TABLE + ALTER TABLE-migratie**

In `db.ts`, in de bestaande `CREATE TABLE IF NOT EXISTS nas_library_index` (regels 134-147), voeg `duration_ms` toe vóór `last_scanned_at`:

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
    duration_ms INTEGER,
    last_scanned_at INTEGER NOT NULL
  );
```

Direct na de bestaande `playable`-ALTER-TABLE-migratie (regels 150-155), voeg de nieuwe migratie toe voor installs waar de tabel al bestond vóór deze kolom er was:

```ts
try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN duration_ms INTEGER').run();
} catch (e) {}
```

- [ ] **Step 2: `upsertDbNasLibraryEntry` schrijft `duration_ms` weg**

In `db.ts`, pas de functiesignatuur en de INSERT aan (regels 488-532):

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
```

- [ ] **Step 3: Handmatig verifiëren**

Run: `npm run dev` in de werkboom, en in een tweede terminal:
```bash
curl -s -X POST http://localhost:3000/api/nas/scan/start -H 'Authorization: Bearer <hub-api-key>'
sleep 2
curl -s http://localhost:3000/api/nas/scan/results | head -c 400
```
Expected: JSON-resultaten bevatten nu een `duration_ms`-veld per rij (getal of `null` voor nog niet herscande rijen). (Poort/auth: zie `docs/API.md` voor de actuele waarden in deze checkout.)

- [ ] **Step 4: Commit**

```bash
git add db.ts
git commit -m "feat(nas): add duration_ms column to nas_library_index"
```

---

### Task 2: `resolveLocalTrack()` + scan-worker refactor

**Files:**
- Modify: `src/services/nasLibraryScan.ts` (volledige worker-loop vervangen, nieuwe geëxporteerde functie toegevoegd)

**Interfaces:**
- Consumes: `upsertDbNasLibraryEntry` (Task 1, met nieuwe `durationMs`-parameter), `getDbNasLibraryEntry` (bestaand, `db.ts`), `readLocalTags` (bestaand, `localTrackMetadata.ts`), `lookupCatalogicSong` (bestaand, `catalogicClient.ts`), `Track`-type (`src/types.ts`).
- Produces: `resolveLocalTrack(filePath: string, opts: { allowCatalogicLookup: boolean; shareId?: string }): Promise<Track & { playable: boolean; fromCache: boolean; catalogicSongId: string | null }>` — nieuwe export, gebruikt door Task 3's routes. `fromCache`/`catalogicSongId` zijn puur voor de scan-worker's eigen statustellers; andere aanroepers (routes) negeren ze gewoon.

- [ ] **Step 1: Imports en helpers toevoegen**

In `src/services/nasLibraryScan.ts`, voeg bovenaan toe (naast de bestaande imports):

```ts
import { createHash } from 'crypto';
import { Track } from '../types.ts';
```

Voeg deze twee private helpers toe (verplaatst uit `localTrackMetadata.ts` — zie Task 4 — alleen deze functie heeft ze straks nog nodig):

```ts
const PLACEHOLDER_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

function idFor(filePath: string): string {
  // A truncated encoding of the path (rather than a hash of the whole thing)
  // would collide for any two files sharing a long common directory prefix —
  // hash the full path instead so every file gets a distinct id.
  const hash = createHash('sha1').update(filePath).digest('base64url').slice(0, 24);
  return 'local-' + hash;
}

function toTrack(
  filePath: string,
  meta: { title: string; artist: string; album: string; durationMs: number },
  coverUrl: string,
  highResCoverUrl: string,
): Track {
  const ext = path.extname(filePath).toLowerCase();
  const isHiRes = ['.flac', '.wav', '.dsd', '.dsf', '.alac'].includes(ext);
  return {
    id: idFor(filePath),
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    coverUrl,
    highResCoverUrl,
    durationMs: meta.durationMs,
    uri: `file://${filePath}`,
    bitrate: isHiRes ? 1411 : 320,
    sampleRate: isHiRes ? 96000 : 44100,
    bitDepth: isHiRes ? 24 : 16,
    dominantColor: '#0ea5e9',
  };
}
```

- [ ] **Step 2: `resolveLocalTrack` toevoegen**

Voeg deze nieuwe geëxporteerde functie toe (bijvoorbeeld vlak vóór `startNasLibraryScan`):

```ts
/**
 * Single entry point for resolving a local/NAS file's Track metadata,
 * shared by the whole-library scan, folder browsing, playback, and
 * playlist creation — the one place that decides "is this row still
 * fresh, or do we need to re-read/re-look-up." A row is trusted as-is
 * only when it exists, was last found playable, and the file's size/mtime
 * haven't changed since — otherwise (new file, changed file, or a
 * previously-unplayable file, which always gets retried) tags are re-read
 * and, when requested, Catalogic is re-queried, then the result is
 * persisted so every other caller sees it too.
 *
 * `opts.shareId` is only known by the whole-library scan (which walked the
 * file from a specific share's mount point) — browse/play/playlist callers
 * omit it, in which case an existing row's share_id is preserved rather
 * than overwritten with null.
 */
export async function resolveLocalTrack(
  filePath: string,
  opts: { allowCatalogicLookup: boolean; shareId?: string },
): Promise<Track & { playable: boolean; fromCache: boolean; catalogicSongId: string | null }> {
  const stat = fs.statSync(filePath);
  const existing = getDbNasLibraryEntry(filePath);

  if (
    existing &&
    existing.playable !== 0 &&
    existing.file_size === stat.size &&
    existing.mtime_ms === stat.mtimeMs
  ) {
    const coverUrl = existing.artwork_url || PLACEHOLDER_COVER;
    return {
      ...toTrack(
        filePath,
        {
          title: existing.title,
          artist: existing.artist,
          album: existing.album,
          durationMs: existing.duration_ms || 240000,
        },
        coverUrl,
        coverUrl,
      ),
      playable: true,
      fromCache: true,
      catalogicSongId: existing.catalogic_song_id ?? null,
    };
  }

  const tags = await readLocalTags(filePath);
  let catalogicSongId: string | null = null;
  let matchConfidence: string | null = null;
  let artworkUrl: string | null = null;
  let durationMs = tags.durationMs;

  if (opts.allowCatalogicLookup) {
    const match = await lookupCatalogicSong(tags.title, tags.artist);
    if (match) {
      catalogicSongId = match.songId;
      artworkUrl = match.artworkUrl;
      if (match.durationMs) durationMs = match.durationMs;
      matchConfidence =
        match.artistName && match.artistName.toLowerCase().includes(tags.artist.toLowerCase()) ? 'hoog' : 'laag';
    }
  }

  upsertDbNasLibraryEntry({
    filePath,
    shareId: opts.shareId ?? existing?.share_id ?? undefined,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
    catalogicSongId,
    matchConfidence,
    artworkUrl,
    playable: tags.playable,
    durationMs,
  });

  const coverUrl = artworkUrl || PLACEHOLDER_COVER;
  return {
    ...toTrack(filePath, { title: tags.title, artist: tags.artist, album: tags.album, durationMs }, coverUrl, coverUrl),
    playable: tags.playable,
    fromCache: false,
    catalogicSongId,
  };
}
```

- [ ] **Step 3: Scan-worker vervangen door een dunne wrapper**

In `startNasLibraryScan`'s `worker()`-functie (huidige regels ~122-184), vervang de hele body door:

```ts
      let cursor = 0;
      async function worker() {
        while (cursor < files.length) {
          if (stopRequested) return;
          const { filePath, shareId } = files[cursor++];
          status.currentFile = filePath;

          try {
            const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: opts.allowCatalogicLookup, shareId });
            if (track.fromCache) status.filesSkippedUnchanged++;
            if (track.catalogicSongId) status.matched++;
            else status.unmatched++;
          } catch {
            // unreadable file — skip, doesn't block the rest of the scan
          }

          status.filesScanned++;
          if (status.filesScanned % 10 === 0 || status.filesScanned === files.length) {
            opts.onProgress?.(getNasScanStatus());
          }
        }
      }
```

De rest van `startNasLibraryScan` (bestandenwandeling, `Promise.all(...)` over de workers, de `finally`-blok backlog-indiening) blijft ongewijzigd — alleen de body van `worker()` wordt vervangen.

De import van `readLocalTags`/`lookupCatalogicSong` bovenaan het bestand blijft nodig (nu gebruikt door `resolveLocalTrack` i.p.v. rechtstreeks door de worker) — geen wijziging aan de import-regels nodig.

- [ ] **Step 4: `npx tsc --noEmit` en bestaande tests draaien**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
Expected: 0 tsc-fouten, alle bestaande tests slagen (nog niets in `nas.ts` is aangepast, dus die blijven werken tegen de oude imports totdat Task 3 ze bijwerkt — als `tsc` hier al fouten geeft over `nas.ts` die `resolveLocalTrack` nog niet gebruikt, is dat verwacht en wordt in Task 3 opgelost, niet hier).

- [ ] **Step 5: Handmatig verifiëren**

Run: `npm run dev`, trigger een scan (`POST /api/nas/scan/start`), en vergelijk de resultaten met Task 1's verificatie — `matched`/`unmatched`/`filesSkippedUnchanged`-tellers in `GET /api/nas/scan/status` moeten er hetzelfde uitzien als vóór deze refactor (zelfde library, zelfde uitkomst, alleen de interne implementatie is anders).

- [ ] **Step 6: Commit**

```bash
git add src/services/nasLibraryScan.ts
git commit -m "feat(nas): add resolveLocalTrack, the single fresh-or-refresh entry point"
```

---

### Task 3: Routes overzetten op `resolveLocalTrack`

**Files:**
- Modify: `src/server/routes/nas.ts` (imports + vijf route-handlers)

**Interfaces:**
- Consumes: `resolveLocalTrack` (Task 2, exacte signatuur zoals hierboven).
- Produces: geen nieuwe exports — dezelfde vijf route-contracten (request/response-vorm) blijven ongewijzigd voor de frontend.

- [ ] **Step 1: Imports bijwerken**

In `src/server/routes/nas.ts`, regels 7-9, vervang:

```ts
import { isAudioFile } from '../../services/localTrackMetadata.ts';
import { getNasScanResults, getNasScanStatus, reconcileNasBacklog, resolveLocalTrack, startNasLibraryScan, stopNasLibraryScan } from '../../services/nasLibraryScan.ts';
import { getDbConfig, getDbImportedPlaylists, getDbNetworkShares, saveDbImportedPlaylist, saveDbNetworkShare } from '../../../db.ts';
```

(`getDbNasLibraryEntry` verdwijnt uit de `db.ts`-import — die wordt straks alleen nog intern door `resolveLocalTrack` gebruikt, niet meer rechtstreeks door deze route-file.)

- [ ] **Step 2: `GET /api/nas/browse` bijwerken**

Vervang de hele handler (huidige regels 115-166) door:

```ts
router.get('/api/nas/browse', async (req, res) => {
  const targetDir = (req.query.path as string) || '/mnt/nas';

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
    const files = rawFiles.filter((f) => f.isDir || !f.isAudio || f.playable !== false);

    res.json({ success: true, currentPath: targetDir, files });
  } catch (e: any) {
    res.json({ success: false, error: e.message, files: [] });
  }
});
```

- [ ] **Step 3: `POST /api/nas/enrich` bijwerken**

Vervang de hele handler (huidige regels 168-181) door:

```ts
// Best-effort artwork/metadata enrichment for a batch of NAS files — call
// after /api/nas/browse renders, so the folder listing itself stays fast.
router.post('/api/nas/enrich', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  try {
    const filePaths = paths.slice(0, 200).filter((p: unknown) => typeof p === 'string');
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
```

- [ ] **Step 4: `POST /api/nas/play-file` bijwerken**

In de handler (huidige regels 183-205), vervang alleen deze regel:

```ts
    const track = await buildLocalTrack(filePath, true);
```

door:

```ts
    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: true });
```

De rest van de handler blijft ongewijzigd.

- [ ] **Step 5: `POST /api/nas/play-folder` bijwerken**

In de handler (huidige regels 210-248), vervang:

```ts
    const [firstTrack, ...rest] = await Promise.all(
      audioNames.map((name: string, idx: number) => buildLocalTrack(path.join(dirPath, name), idx === 0)),
    );
```

door:

```ts
    const [firstTrack, ...rest] = await Promise.all(
      audioNames.map((name: string, idx: number) =>
        resolveLocalTrack(path.join(dirPath, name), { allowCatalogicLookup: idx === 0 }),
      ),
    );
```

De rest van de handler blijft ongewijzigd.

- [ ] **Step 6: `POST /api/nas/create-playlist` bijwerken**

In de handler (huidige regels 250-285), vervang:

```ts
    const audioFiles = await Promise.all(audioNames.map((n: string) => peekLocalTrack(path.join(dirPath, n))));
```

door:

```ts
    const audioFiles = await Promise.all(
      audioNames.map((n: string) => resolveLocalTrack(path.join(dirPath, n), { allowCatalogicLookup: false })),
    );
```

De rest van de handler blijft ongewijzigd.

- [ ] **Step 7: `npx tsc --noEmit` en de volledige testsuite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
Expected: 0 tsc-fouten, alle bestaande tests slagen (inclusief de smoke-test voor `GET /api/nas/browse` met een niet-bestaand pad, en de webhook-signature-tests — geen van beide raakt de gewijzigde code-paden inhoudelijk, maar moeten nog steeds groen zijn).

- [ ] **Step 8: Handmatig verifiëren**

Run: `npm run dev`, en test achtereenvolgens met een echte of scratch NAS-map:
```bash
curl -s "http://localhost:3000/api/nas/browse?path=<map-met-audio>" | head -c 800
curl -s -X POST http://localhost:3000/api/nas/enrich -H 'Content-Type: application/json' -H 'Authorization: Bearer <hub-api-key>' -d '{"paths":["<volledig-pad-naar-1-bestand>"]}'
```
Expected: `browse` toont titel/artiest/albumhoes zoals voorheen; `enrich` retourneert een `tracks`-object met dezelfde vorm als voorheen (title/artist/album/coverUrl/durationMs/uri/bitrate/sampleRate/bitDepth/dominantColor/playable/fromCache/catalogicSongId — de laatste drie zijn nieuw in de payload maar breken niets aan de frontend-kant, die leest alleen de bekende velden).

- [ ] **Step 9: Commit**

```bash
git add src/server/routes/nas.ts
git commit -m "feat(nas): route all NAS metadata resolution through resolveLocalTrack"
```

---

### Task 4: `localTrackMetadata.ts` opschonen

**Files:**
- Modify: `src/services/localTrackMetadata.ts` (volledige herschrijving — krimpt fors)

**Interfaces:**
- Consumes: niets nieuws.
- Produces: `isAudioFile(fileName: string): boolean` en `readLocalTags(filePath: string): Promise<LocalFileMeta>` blijven ongewijzigd geëxporteerd — dit is de enige twee functies die dit bestand na deze taak nog exporteert. `LocalFileMeta`-interface blijft ongewijzigd.

- [ ] **Step 1: Bestand vervangen**

Vervang de volledige inhoud van `src/services/localTrackMetadata.ts` door:

```ts
// Reads local/NAS audio-file tags: embedded tags if present,
// filename/folder-derived otherwise. Pure and network-free — the
// Catalogic-aware, cached Track-building this file used to also do now
// lives in resolveLocalTrack (nasLibraryScan.ts), which is the single
// place that decides whether a file needs re-reading at all (see
// docs/superpowers/specs/2026-08-22-nas-metadata-unification-design.md).
import * as mm from 'music-metadata';
import path from 'path';

const AUDIO_EXTENSIONS = ['.flac', '.mp3', '.wav', '.dsd', '.dsf', '.m4a', '.alac', '.ogg'];

export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

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

- [ ] **Step 2: `npx tsc --noEmit` en de volledige testsuite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
Expected: 0 tsc-fouten (bevestigt dat niets elders nog `peekLocalTrack`/`buildLocalTrack`/`enrichLocalFiles`/`fromCache`/`cacheKeyFor`/`toTrack`/`idFor` importeert — als dat wel zo was, zou dit nu een compile-fout geven), alle tests slagen inclusief `tests/local-track-metadata.test.ts` (die alleen `readLocalTags` gebruikt, ongewijzigd).

- [ ] **Step 3: Handmatig verifiëren**

Herhaal Task 3 Step 8's handmatige check nog één keer — bevestigt dat de opschoning niets stuk heeft gemaakt.

- [ ] **Step 4: Commit**

```bash
git add src/services/localTrackMetadata.ts
git commit -m "refactor(nas): trim localTrackMetadata.ts to pure tag-reading only"
```

---

## Self-Review

**Spec coverage:**
- "Nieuwe gedeelde functie `resolveLocalTrack`" → Task 2. ✅
- "Routewijzigingen (vijf routes)" → Task 3. ✅
- "Scanwijziging (dunne wrapper)" → Task 2 Step 3. ✅
- "DB-migratie (`duration_ms`)" → Task 1. ✅
- "Opschoning (`localTrackMetadata.ts`)" → Task 4. ✅
- "Wat niet verandert" (artwork_cache/Spotify, playable-heronderzoek-regel, snel-browse-vs-traag-enrich-onderscheid, Catalogic-matching zelf) → geen enkele taak raakt deze, bevestigd door het bestandenoverzicht hierboven. ✅

**Placeholder scan:** geen "TBD"/"later"/"voeg foutafhandeling toe" — elke stap bevat volledige code of een concrete, uitvoerbare verificatie-opdracht.

**Type consistency:** `resolveLocalTrack`'s signatuur (Task 2) — `(filePath: string, opts: { allowCatalogicLookup: boolean; shareId?: string }) => Promise<Track & { playable: boolean; fromCache: boolean; catalogicSongId: string | null }>` — wordt in Task 3 op alle vijf plekken exact zo aangeroepen (browse/create-playlist geven geen `shareId` mee, play-folder geeft `allowCatalogicLookup: idx === 0`, scan-worker in Task 2 zelf geeft wél `shareId` mee). `upsertDbNasLibraryEntry`'s nieuwe `durationMs?: number`-parameter (Task 1) wordt in Task 2's `resolveLocalTrack` consistent aangeroepen. `readLocalTags`'s `LocalFileMeta`-vorm (ongewijzigd) wordt in Task 2 en Task 4 identiek gebruikt.
