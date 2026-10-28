# Muziekbibliotheek (artiest → album → song) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een nieuwe "Muziekbibliotheek"-tab naast de bestaande rauwe bestandenverkenner: artiesten (met foto) → albums van een artiest (met hoes) → songs van een album (met details). De bestaande verkenner blijft ongewijzigd bestaan.

**Architecture:** Zelfde "snel browsen, dan los verrijken"-principe als de bestaande verkenner, toegepast op drie niveaus i.p.v. één. Structuur komt live van de schijf (mapnamen); Catalogic-verrijking (foto/hoes) is asynchroon en cachet in twee nieuwe tabellen, analoog aan `nas_library_index` maar zonder bestandsspecifieke wijzigingsdetectie.

**Tech Stack:** Express, better-sqlite3, React 19, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-22-nas-music-library-design.md`

## Global Constraints

- Songs-niveau hergebruikt `resolveLocalTrack` en de bestaande `/api/nas/enrich`-route ONGEWIJZIGD — dit plan voegt geen nieuwe song-matchlogica toe.
- Artiest-matching accepteert alleen een EXACTE (case-insensitieve) naamsgelijkheid — geen "beste van de eerste N hits ongeacht naam"-fallback (zelfde les als de songmatch-bugfix van eerder vandaag).
- Album-matching disambigueert via `primary_artist_id` (exacte ID-vergelijking tegen de al-opgeloste artiest-id), NIET via een fuzzy naamsvergelijking.
- Catalogic's media-assets-endpoint gebruikt `owner_type`/`owner_id` als query-parameters — NIET `resource_type`/`resource_id` (expliciet geverifieerd tegen de live API; de verkeerde namen worden stilzwijgend genegeerd en leveren een ongefilterd/verkeerd resultaat, geen fout).
- Alle Catalogic-aanroepen blijven best-effort: nooit throwen, nooit een gebruikersactie blokkeren.
- `checked_at IS NULL` betekent altijd "nog nooit opgezocht" — nooit gelijkstellen aan "definitief geen match" (zelfde discriminator-principe als de `match_confidence`-fix van vandaag). Eenmaal `checked_at` gezet (match of niet), geen automatische herverificatie in deze iteratie (ponytail-vereenvoudiging, zie spec).
- Dit repo heeft geen testdatabase-isolatie — nieuwe geautomatiseerde tests blijven beperkt tot pure, I/O-vrije functies. DB/route-gedrag wordt handmatig geverifieerd via een lokale dev-server in de werkboom.
- Geen lyrics in deze iteratie (zie spec, "Wat NIET in deze iteratie zit").

---

## Bestandenoverzicht

- Modify: `db.ts` — nieuwe tabellen `nas_artist_index`/`nas_album_index` + CRUD-functies.
- Modify: `src/services/catalogicClient.ts` — `lookupCatalogicArtist`, `lookupCatalogicAlbum`.
- Create: `src/server/routes/nas-library.ts` — vijf nieuwe routes (artists/albums/songs listing + artist/album enrich).
- Modify: `server.ts` — nieuwe router mounten.
- Create: `src/components/NasMusicLibrary.tsx` — nieuwe drie-niveaus-component.
- Modify: `src/components/PlaylistManager.tsx` — sub-tab-switcher tussen bestaande verkenner en nieuwe muziekbibliotheek.

---

### Task 1: `nas_artist_index`/`nas_album_index`-tabellen + CRUD

**Files:**
- Modify: `db.ts`

**Interfaces:**
- Produces:
  - `getDbNasArtistEntry(artistPath: string): any` — `SELECT * FROM nas_artist_index WHERE artist_path = ?`.
  - `upsertDbNasArtistEntry(entry: { artistPath: string; artistName: string; catalogicArtistId?: string | null; artworkUrl?: string | null; checked: boolean }): void` — `checked: true` zet `checked_at = Date.now()`, `false` laat 'm op `NULL`.
  - `getDbNasArtistsUnderShare(sharePath: string): any[]` — alle rijen waarvan `artist_path` direct onder `sharePath` valt (gebruikt voor batch-enrich-status, niet strikt nodig voor de basis-listing die van de schijf komt).
  - `getDbNasAlbumEntry(albumPath: string): any`, `upsertDbNasAlbumEntry(entry: { albumPath: string; artistPath: string; albumName: string; catalogicAlbumId?: string | null; artworkUrl?: string | null; checked: boolean }): void` — zelfde patroon, één niveau dieper.

- [ ] **Step 1: Tabellen toevoegen aan het `db.exec(...)`-blok**

In `db.ts`, in hetzelfde grote `db.exec(...)`-blok waar `nas_library_index` staat, voeg na die tabel toe:

```sql
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
```

- [ ] **Step 2: CRUD-functies toevoegen**

In `db.ts`, direct na de bestaande `getDbNasLibraryResults`-functie, voeg toe:

```ts
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
```

- [ ] **Step 2: Handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsx -e "
import { upsertDbNasArtistEntry, getDbNasArtistEntry } from './db.ts';
upsertDbNasArtistEntry({ artistPath: '/mnt/nas/Test Artist', artistName: 'Test Artist', catalogicArtistId: null, artworkUrl: null, checked: true });
console.log(getDbNasArtistEntry('/mnt/nas/Test Artist'));
"
```
Expected: een rij met `checked_at` gevuld (een timestamp), `catalogic_artist_id: null`.

- [ ] **Step 3: Commit**

```bash
git add db.ts
git commit -m "feat(nas): add nas_artist_index/nas_album_index tables for the music library view"
```

---

### Task 2: `lookupCatalogicArtist` + `lookupCatalogicAlbum`

**Files:**
- Modify: `src/services/catalogicClient.ts`
- Test: `tests/catalogic-client.test.ts` (uitbreiden)

**Interfaces:**
- Produces:
  - `lookupCatalogicArtist(name: string): Promise<{ artistId: string; name: string; artworkUrl: string | null } | null>`
  - `lookupCatalogicAlbum(title: string, artistCatalogicId: string): Promise<{ albumId: string; title: string; artworkUrl: string | null } | null>`

- [ ] **Step 1: `lookupCatalogicArtist` toevoegen**

In `src/services/catalogicClient.ts`, na de bestaande `lookupCatalogicSong`-functie:

```ts
interface MediaAssetHit {
  id: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  variant: string;
}

/**
 * Fetches the best available artwork URL for a Catalogic artist/album via
 * the media-assets list endpoint. Note: this endpoint's filter params are
 * `owner_type`/`owner_id` — NOT `resource_type`/`resource_id` (verified
 * directly against the live API; the wrong names are silently ignored and
 * the endpoint returns an unfiltered/wrong result instead of an error).
 */
async function fetchCatalogicArtwork(ownerType: 'artist' | 'album', ownerId: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${config.url}/v1/media-assets?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal, headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { data: MediaAssetHit[] };
    const assets = (body.data || []).filter((a) => a.kind === 'artwork');
    const best = assets.find((a) => a.variant === 'sq') || assets.find((a) => a.variant === 'thumb') || assets[0];
    return best ? `${config.url}/v1/media-assets/${best.id}/download` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicArtistMatch {
  artistId: string;
  name: string;
  artworkUrl: string | null;
}

interface ArtistSearchHit {
  type: 'artist';
  source: 'catalogic' | 'spotify';
  id?: string;
  name?: string;
}

/**
 * Best-effort artist lookup by exact (case-insensitive) name — no fallback
 * to "closest hit regardless of name", same discipline as the song-match
 * fix: a folder named after an artist that isn't in Catalogic must resolve
 * to null, not to some unrelated similarly-named artist.
 */
export async function lookupCatalogicArtist(name: string): Promise<CatalogicArtistMatch | null> {
  if (!config.enabled || !name.trim()) return null;
  const url = `${config.url}/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=3`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: ArtistSearchHit[] };
    const hits = (body.data || []).filter((h) => h.type === 'artist' && h.source === 'catalogic');
    const exact = hits.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    if (!exact?.id || !exact.name) return null;
    const artworkUrl = await fetchCatalogicArtwork('artist', exact.id);
    return { artistId: exact.id, name: exact.name, artworkUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicAlbumMatch {
  albumId: string;
  title: string;
  artworkUrl: string | null;
}

interface AlbumSearchHit {
  type: 'album';
  source: 'catalogic' | 'spotify';
  id?: string;
  title?: string;
  primary_artist_id?: string | null;
}

/**
 * Best-effort album lookup, disambiguated by `primary_artist_id` against
 * the already-resolved Catalogic artist id — an exact ID comparison, more
 * reliable than the fuzzy artist-name-substring check songs use.
 */
export async function lookupCatalogicAlbum(title: string, artistCatalogicId: string): Promise<CatalogicAlbumMatch | null> {
  if (!config.enabled || !title.trim() || !artistCatalogicId) return null;
  const url = `${config.url}/v1/search?q=${encodeURIComponent(title)}&type=album&limit=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: AlbumSearchHit[] };
    const hits = (body.data || []).filter((h) => h.type === 'album' && h.source === 'catalogic');
    const match = hits.find((h) => h.primary_artist_id === artistCatalogicId);
    if (!match?.id || !match.title) return null;
    const artworkUrl = await fetchCatalogicArtwork('album', match.id);
    return { albumId: match.id, title: match.title, artworkUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Unit-test voor de strikte naamsmatch toevoegen**

In `tests/catalogic-client.test.ts`, voeg toe (dit test alleen de pure matching-logica via een lokale mock-server, geen echte Catalogic-aanroep nodig — volg hetzelfde patroon als de bestaande tests in dit bestand als die al een mock-server-aanpak gebruiken; zo niet, is een eenvoudige assertie op het exportbestaan en de functiesignatuur voldoende, aangezien dit repo geen bredere HTTP-mocking-infrastructuur heeft):

```ts
import { lookupCatalogicArtist, lookupCatalogicAlbum } from '../src/services/catalogicClient.ts';

test('lookupCatalogicArtist and lookupCatalogicAlbum resolve to null when Catalogic is disabled', async () => {
  // configureCatalogic defaults to enabled:false at module load in a fresh
  // test process, so both must short-circuit without any network call.
  assert.equal(await lookupCatalogicArtist('Some Artist'), null);
  assert.equal(await lookupCatalogicAlbum('Some Album', 'fake-id'), null);
});
```

(Voeg de benodigde `import { test } from 'node:test'; import assert from 'node:assert/strict';` toe als die nog niet bovenaan het bestand staan — check het bestaande bestand eerst.)

- [ ] **Step 3: `npx tsc --noEmit` en tests**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
Expected: 0 fouten, alle tests slagen.

- [ ] **Step 4: Handmatig verifiëren tegen de echte Catalogic-server**

```bash
npx tsx -e "
import { configureCatalogic, lookupCatalogicArtist, lookupCatalogicAlbum } from './src/services/catalogicClient.ts';
configureCatalogic({ enabled: true, url: 'https://catalogic.doorkoppen.nl' });
(async () => {
  const artist = await lookupCatalogicArtist('ABBA');
  console.log('artist:', JSON.stringify(artist));
  if (artist) {
    const album = await lookupCatalogicAlbum('ABBA', artist.artistId);
    console.log('album:', JSON.stringify(album));
  }
})();
"
```
Expected: `artist` bevat een echte `artistId` + `artworkUrl`; `album` bevat een echte `albumId` + `artworkUrl` (het album heet "Abba", zelfde als de artiestnaam, al eerder geverifieerd tijdens het schrijven van de spec).

- [ ] **Step 5: Commit**

```bash
git add src/services/catalogicClient.ts tests/catalogic-client.test.ts
git commit -m "feat(nas): add lookupCatalogicArtist and lookupCatalogicAlbum"
```

---

### Task 3: Backend-routes — artiesten (lijst + verrijken)

**Files:**
- Create: `src/server/routes/nas-library.ts`
- Modify: `server.ts` (router mounten)

**Interfaces:**
- Consumes: `getDbNetworkShares` (bestaand, `db.ts`), `getDbNasArtistEntry`/`upsertDbNasArtistEntry` (Task 1), `lookupCatalogicArtist` (Task 2), `isAudioFile` (bestaand, `localTrackMetadata.ts`), `hubConfig` (bestaand, `state.ts`, voor `catalogicScanLookupEnabled`-gate, zelfde als de rest van de NAS-routes).
- Produces:
  - `GET /api/nas/library/artists?share=<mountPoint>` → `{ success: true, artists: { name: string; path: string; artworkUrl: string | null }[] }`
  - `POST /api/nas/library/enrich-artists` body `{ paths: string[] }` → `{ success: true }` (fire-and-forget qua Catalogic-aanroepen; de listing hierboven wordt bij een volgende aanroep bijgewerkt zodra de achtergrondverrijking klaar is — zelfde asynchrone patroon als `/api/nas/enrich`, maar dit endpoint geeft zelf geen bijgewerkte data terug omdat de frontend gewoon opnieuw `GET /artists` aanroept, net zoals `NasBrowser` dat vandaag ook al met de songs-enrich doet via de losse `tracks`-response — zie Task 6 voor de exacte frontend-aanroep die WEL de bijgewerkte data direct verwacht, dus dit endpoint retourneert toch de bijgewerkte artiestenlijst, zie Step 2 hieronder).

- [ ] **Step 1: Bestand aanmaken met de artiesten-route**

Nieuw bestand `src/server/routes/nas-library.ts`:

```ts
// Muziekbibliotheek-weergave: artiest → album → song, met Catalogic-
// verrijking op artiest- en albumniveau. Zie
// docs/superpowers/specs/2026-08-22-nas-music-library-design.md.
// Songs-niveau hergebruikt resolveLocalTrack/de bestaande /api/nas/enrich
// ongewijzigd — dit bestand voegt alleen artiest- en albumniveau toe.
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  getDbNasArtistEntry,
  getDbNasAlbumEntry,
  getDbNetworkShares,
  upsertDbNasArtistEntry,
  upsertDbNasAlbumEntry,
} from '../../../db.ts';
import { isAudioFile } from '../../services/localTrackMetadata.ts';
import { lookupCatalogicArtist, lookupCatalogicAlbum } from '../../services/catalogicClient.ts';
import { hubConfig } from '../state.ts';

const router = express.Router();

router.get('/api/nas/library/artists', (req, res) => {
  const share = (req.query.share as string) || getDbNetworkShares()[0]?.mountPoint || '/mnt/nas';
  try {
    if (!fs.existsSync(share)) {
      return res.json({ success: true, artists: [] });
    }
    const entries = fs.readdirSync(share, { withFileTypes: true }).filter((e) => e.isDirectory());
    const artists = entries.map((e) => {
      const artistPath = path.join(share, e.name);
      const cached = getDbNasArtistEntry(artistPath);
      return { name: e.name, path: artistPath, artworkUrl: cached?.artwork_url || null };
    });
    res.json({ success: true, artists });
  } catch (e: any) {
    res.json({ success: false, error: e.message, artists: [] });
  }
});

router.post('/api/nas/library/enrich-artists', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, artists: {} });
  }
  try {
    const artistPaths = paths.slice(0, 100).filter((p: unknown) => typeof p === 'string');
    const CONCURRENCY = 4;
    const artists: Record<string, { artworkUrl: string | null }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < artistPaths.length) {
        const artistPath = artistPaths[cursor++];
        try {
          const existing = getDbNasArtistEntry(artistPath);
          if (existing?.checked_at) {
            artists[artistPath] = { artworkUrl: existing.artwork_url || null };
            continue;
          }
          const artistName = path.basename(artistPath);
          const match = await lookupCatalogicArtist(artistName);
          upsertDbNasArtistEntry({
            artistPath,
            artistName,
            catalogicArtistId: match?.artistId || null,
            artworkUrl: match?.artworkUrl || null,
            checked: true,
          });
          artists[artistPath] = { artworkUrl: match?.artworkUrl || null };
        } catch {
          // skip unreadable/unresolvable artist folder, caller keeps whatever it already had
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, artistPaths.length) }, worker));
    res.json({ success: true, artists });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

- [ ] **Step 2: Router mounten in `server.ts`**

In `server.ts`, naast de bestaande `import nasRouter from './src/server/routes/nas.ts';` (regel 30):

```ts
import nasLibraryRouter from './src/server/routes/nas-library.ts';
```

En naast `app.use(nasRouter);` (regel 107):

```ts
app.use(nasLibraryRouter);
```

- [ ] **Step 3: `npx tsc --noEmit` en handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run dev
```
In een tweede terminal:
```bash
curl -s "http://localhost:3000/api/nas/library/artists?share=/mnt/nas" | head -c 500
curl -s -X POST http://localhost:3000/api/nas/library/enrich-artists -H 'Content-Type: application/json' -H 'Authorization: Bearer <hub-api-key>' -d '{"paths":["/mnt/nas/ABBA"]}'
```
Expected: eerste aanroep toont artiestmappen met `artworkUrl: null` (nog niet verrijkt); tweede aanroep retourneert (als `catalogicScanLookupEnabled` aan staat) een echte `artworkUrl` voor ABBA.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/nas-library.ts server.ts
git commit -m "feat(nas): add artist-level library routes (list + enrich)"
```

---

### Task 4: Backend-routes — albums (hiërarchie-regel + verrijken)

**Files:**
- Modify: `src/server/routes/nas-library.ts`

**Interfaces:**
- Consumes: `getDbNasAlbumEntry`/`upsertDbNasAlbumEntry` (Task 1), `lookupCatalogicAlbum` (Task 2), `getDbNasArtistEntry` (Task 1, om de al-opgeloste artiest-id op te halen voor de disambiguatie).
- Produces:
  - `GET /api/nas/library/albums?artistPath=<path>` → `{ success: true, albums: { name: string; path: string; artworkUrl: string | null }[] }`
  - `POST /api/nas/library/enrich-albums` body `{ paths: string[]; artistPath: string }` → `{ success: true, albums: Record<string, {artworkUrl: string|null}> }`

- [ ] **Step 1: Albums-listing met de hiërarchie-regel**

In `src/server/routes/nas-library.ts`, vlak vóór `export default router;`:

```ts
/**
 * Applies the hierarchy rule from the design spec: audio files directly in
 * the artist folder → the folder itself is the one (synthetic) album;
 * otherwise each subfolder is an album, with any deeper nesting inside it
 * (discs, an organizational folder like `_FLAC`) flattened away — this
 * route only lists the album-level folders, it doesn't need to look inside
 * them (that's the songs route's job).
 */
router.get('/api/nas/library/albums', (req, res) => {
  const artistPath = req.query.artistPath as string;
  if (!artistPath) return res.status(400).json({ error: 'artistPath is verplicht' });

  try {
    if (!fs.existsSync(artistPath)) {
      return res.json({ success: true, albums: [] });
    }
    const entries = fs.readdirSync(artistPath, { withFileTypes: true });
    const hasDirectAudio = entries.some((e) => !e.isDirectory() && isAudioFile(e.name));

    if (hasDirectAudio) {
      const cached = getDbNasAlbumEntry(artistPath);
      return res.json({
        success: true,
        albums: [{ name: path.basename(artistPath), path: artistPath, artworkUrl: cached?.artwork_url || null }],
      });
    }

    const albums = entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const albumPath = path.join(artistPath, e.name);
        const cached = getDbNasAlbumEntry(albumPath);
        return { name: e.name, path: albumPath, artworkUrl: cached?.artwork_url || null };
      });
    res.json({ success: true, albums });
  } catch (e: any) {
    res.json({ success: false, error: e.message, albums: [] });
  }
});

router.post('/api/nas/library/enrich-albums', async (req, res) => {
  const { paths, artistPath } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0 || !artistPath) {
    return res.status(400).json({ error: 'paths (array) en artistPath zijn verplicht' });
  }
  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, albums: {} });
  }
  try {
    const artistEntry = getDbNasArtistEntry(artistPath);
    const artistCatalogicId = artistEntry?.catalogic_artist_id;
    if (!artistCatalogicId) {
      // Artist itself never resolved — nothing to disambiguate albums
      // against, so there's genuinely no safe match to attempt.
      return res.json({ success: true, albums: {} });
    }

    const albumPaths = paths.slice(0, 100).filter((p: unknown) => typeof p === 'string');
    const CONCURRENCY = 4;
    const albums: Record<string, { artworkUrl: string | null }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < albumPaths.length) {
        const albumPath = albumPaths[cursor++];
        try {
          const existing = getDbNasAlbumEntry(albumPath);
          if (existing?.checked_at) {
            albums[albumPath] = { artworkUrl: existing.artwork_url || null };
            continue;
          }

          // No album subfolder (the "album" IS the artist folder, per the
          // hierarchy rule's direct-audio case) — its basename would just
          // repeat the artist name, a meaningless album search query. There's
          // no real album to disambiguate here, so just reuse the artist's
          // own artwork instead of searching Catalogic for a nonsensical
          // "album" titled after the artist.
          if (albumPath === artistPath) {
            upsertDbNasAlbumEntry({
              albumPath,
              artistPath,
              albumName: path.basename(albumPath),
              catalogicAlbumId: null,
              artworkUrl: artistEntry?.artwork_url || null,
              checked: true,
            });
            albums[albumPath] = { artworkUrl: artistEntry?.artwork_url || null };
            continue;
          }

          const albumName = path.basename(albumPath);
          const match = await lookupCatalogicAlbum(albumName, artistCatalogicId);
          upsertDbNasAlbumEntry({
            albumPath,
            artistPath,
            albumName,
            catalogicAlbumId: match?.albumId || null,
            artworkUrl: match?.artworkUrl || null,
            checked: true,
          });
          albums[albumPath] = { artworkUrl: match?.artworkUrl || null };
        } catch {
          // skip unreadable/unresolvable album folder
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, albumPaths.length) }, worker));
    res.json({ success: true, albums });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: `npx tsc --noEmit` en handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run dev
```
```bash
curl -s "http://localhost:3000/api/nas/library/albums?artistPath=/mnt/nas/ABBA" | head -c 500
curl -s -X POST http://localhost:3000/api/nas/library/enrich-albums -H 'Content-Type: application/json' -H 'Authorization: Bearer <hub-api-key>' -d '{"paths":["/mnt/nas/ABBA/ABBA"],"artistPath":"/mnt/nas/ABBA"}'
```
Expected: albums-listing toont "ABBA" als enige album (submap onder de artiestmap); enrich-albums retourneert (als de artiest al eerder als artiest is verrijkt, dus een `catalogic_artist_id` heeft) een echte albumhoes.

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/nas-library.ts
git commit -m "feat(nas): add album-level library routes (hierarchy rule + enrich)"
```

---

### Task 5: Backend-route — songs binnen een album

**Files:**
- Modify: `src/server/routes/nas-library.ts`

**Interfaces:**
- Consumes: `resolveLocalTrack` (bestaand, `nasLibraryScan.ts`, ONGEWIJZIGD hergebruikt).
- Produces: `GET /api/nas/library/songs?albumPath=<path>` → `{ success: true, songs: (Track & { path: string; playable: boolean })[] }`.

- [ ] **Step 1: Songs-route toevoegen**

In `src/server/routes/nas-library.ts`, voeg toe aan de imports:

```ts
import { resolveLocalTrack } from '../../services/nasLibraryScan.ts';
```

En vlak vóór `export default router;`:

```ts
/**
 * Recursively walks the album folder (flattening any disc/organizational
 * subfolders per the hierarchy rule) and resolves each file the same way
 * the raw file browser does — no new song-matching logic, this just picks
 * a different starting point for the walk.
 */
function walkAudioFilesFlat(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAudioFilesFlat(full));
    else if (isAudioFile(entry.name)) out.push(full);
  }
  return out;
}

router.get('/api/nas/library/songs', async (req, res) => {
  const albumPath = req.query.albumPath as string;
  if (!albumPath) return res.status(400).json({ error: 'albumPath is verplicht' });

  try {
    if (!fs.existsSync(albumPath)) {
      return res.json({ success: true, songs: [] });
    }
    const filePaths = walkAudioFilesFlat(albumPath);
    const rawSongs = await Promise.all(
      filePaths.map(async (filePath) => {
        const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
        return { ...track, path: filePath };
      }),
    );
    const songs = rawSongs.filter((s) => s.playable !== false);
    res.json({ success: true, songs });
  } catch (e: any) {
    res.json({ success: false, error: e.message, songs: [] });
  }
});
```

- [ ] **Step 2: `npx tsc --noEmit`, tests, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
```bash
npm run dev
curl -s "http://localhost:3000/api/nas/library/songs?albumPath=/mnt/nas/ABBA/ABBA" | head -c 800
```
Expected: 0 tsc-fouten, 11/11 tests slagen (dit raakt geen bestaande testbestanden), en de songs-route toont de losse ABBA-nummers met titel/artiest/album/duur/hoes — zelfde velden als de bestaande `/api/nas/browse`.

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/nas-library.ts
git commit -m "feat(nas): add song-level library route (reuses resolveLocalTrack)"
```

---

### Task 6: Frontend — `NasMusicLibrary.tsx` + tab-integratie

**Files:**
- Create: `src/components/NasMusicLibrary.tsx`
- Modify: `src/components/PlaylistManager.tsx`

**Interfaces:**
- Consumes: de vijf routes uit Tasks 3-5, `Track`-type (bestaand), `Button`/`Card` uit `./ui` (bestaand).
- Produces: `NasMusicLibrary`-component met dezelfde props-vorm als `NasBrowser` (`onAddToQueue`, optioneel `onPlaylistCreated`), zodat het op dezelfde manier in `PlaylistManager.tsx` gemount kan worden.

- [ ] **Step 1: `NasMusicLibrary.tsx` aanmaken**

```tsx
import React, { useEffect, useState } from 'react';
import { ChevronLeft, Disc3, Music, Play, Plus, User } from 'lucide-react';
import { Track } from '../types';
import { Button, Card } from './ui';

interface LibraryArtist {
  name: string;
  path: string;
  artworkUrl: string | null;
}
interface LibraryAlbum {
  name: string;
  path: string;
  artworkUrl: string | null;
}
interface LibrarySong {
  path: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  uri: string;
  playable: boolean;
}

interface NasMusicLibraryProps {
  onAddToQueue: (track: Track) => void;
}

const PLACEHOLDER_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

/**
 * Artiest → album → song weergave van de NAS-bibliotheek — los van de rauwe
 * bestandenverkenner (NasBrowser), zie
 * docs/superpowers/specs/2026-08-22-nas-music-library-design.md. Zelfde
 * "snel tonen, dan los verrijken"-principe als NasBrowser, nu op drie
 * niveaus.
 */
export const NasMusicLibrary: React.FC<NasMusicLibraryProps> = ({ onAddToQueue }) => {
  const [level, setLevel] = useState<'artists' | 'albums' | 'songs'>('artists');
  const [artists, setArtists] = useState<LibraryArtist[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [currentArtistPath, setCurrentArtistPath] = useState<string | null>(null);
  const [currentArtistName, setCurrentArtistName] = useState('');
  const [currentAlbumName, setCurrentAlbumName] = useState('');

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadArtists = async () => {
    try {
      const res = await fetch('/api/nas/library/artists').then((r) => r.json());
      if (res.artists) {
        setArtists(res.artists);
        const paths = res.artists.map((a: LibraryArtist) => a.path);
        if (paths.length > 0) {
          fetch('/api/nas/library/enrich-artists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.artists) return;
              setArtists((prev) =>
                prev.map((a) => (enrichRes.artists[a.path] ? { ...a, ...enrichRes.artists[a.path] } : a)),
              );
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const openArtist = async (artist: LibraryArtist) => {
    setCurrentArtistPath(artist.path);
    setCurrentArtistName(artist.name);
    setLevel('albums');
    try {
      const res = await fetch(`/api/nas/library/albums?artistPath=${encodeURIComponent(artist.path)}`).then((r) => r.json());
      if (res.albums) {
        setAlbums(res.albums);
        const paths = res.albums.map((a: LibraryAlbum) => a.path);
        if (paths.length > 0) {
          fetch('/api/nas/library/enrich-albums', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths, artistPath: artist.path }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.albums) return;
              setAlbums((prev) =>
                prev.map((a) => (enrichRes.albums[a.path] ? { ...a, ...enrichRes.albums[a.path] } : a)),
              );
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };

  const openAlbum = async (album: LibraryAlbum) => {
    setCurrentAlbumName(album.name);
    setLevel('songs');
    try {
      const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
      if (res.songs) setSongs(res.songs);
    } catch (e) {}
  };

  const handlePlaySong = async (song: LibrarySong) => {
    try {
      await fetch('/api/nas/play-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: song.path, name: song.title }),
      });
    } catch (e) {}
  };

  const handleQueueSong = (song: LibrarySong) => {
    onAddToQueue({
      id: 'local-' + Date.now(),
      title: song.title,
      artist: song.artist,
      album: song.album,
      coverUrl: song.coverUrl || PLACEHOLDER_COVER,
      durationMs: song.durationMs || 240000,
      uri: song.uri,
      bitrate: song.bitrate,
      sampleRate: song.sampleRate,
      bitDepth: song.bitDepth,
      dominantColor: '#0ea5e9',
    });
  };

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="flex items-center" style={{ gap: 10, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          {level !== 'artists' && (
            <button
              onClick={() => (level === 'songs' ? setLevel('albums') : setLevel('artists'))}
              style={{ padding: 4, color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <Disc3 size={18} style={{ color: 'var(--accent)' }} />
          <div>
            <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Muziekbibliotheek</div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
              {level === 'artists' ? 'Alle artiesten' : level === 'albums' ? currentArtistName : `${currentArtistName} — ${currentAlbumName}`}
            </p>
          </div>
        </div>

        {level === 'artists' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" style={{ gap: 14 }}>
            {artists.map((artist) => (
              <div
                key={artist.path}
                onClick={() => openArtist(artist)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <div style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {artist.artworkUrl ? (
                    <img src={artist.artworkUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={28} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
                  {artist.name}
                </span>
              </div>
            ))}
            {artists.length === 0 && (
              <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                Geen artiesten gevonden. Koppel je NAS schijf bij Instellingen → Netwerkschijf (NAS/SMB).
              </p>
            )}
          </div>
        )}

        {level === 'albums' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" style={{ gap: 14 }}>
            {albums.map((album) => (
              <div
                key={album.path}
                onClick={() => openAlbum(album)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {album.artworkUrl ? (
                    <img src={album.artworkUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Music size={22} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-primary)', maxWidth: '100%', textAlign: 'center' }}>
                  {album.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {level === 'songs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {songs.map((song) => (
              <div
                key={song.path}
                className="flex items-center justify-between min-w-0"
                style={{ gap: 10, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)' }}
              >
                <div className="flex items-center min-w-0" style={{ gap: 9 }}>
                  {song.coverUrl ? (
                    <img src={song.coverUrl} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Music size={14} style={{ color: 'var(--status-success)' }} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate" style={{ font: 'var(--text-body)', fontSize: 12.5, color: 'var(--text-primary)' }}>
                      {song.title}
                    </div>
                    <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                      {song.artist} · {song.bitrate ? `${song.bitrate}kbps` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
                  <button
                    onClick={() => handlePlaySong(song)}
                    title="Speel af op Pi DAC"
                    style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)', color: 'var(--on-accent)' }}
                  >
                    <Play size={12} fill="currentColor" style={{ marginLeft: 1 }} />
                  </button>
                  <button onClick={() => handleQueueSong(song)} title="Voeg toe aan wachtrij" style={{ color: 'var(--accent)', padding: 4 }}>
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
```

- [ ] **Step 2: Sub-tab-switcher in `PlaylistManager.tsx`**

In `src/components/PlaylistManager.tsx`, voeg de import toe naast de bestaande `NasBrowser`-import (regel 19):

```tsx
import { NasMusicLibrary } from './NasMusicLibrary';
```

Voeg lokale state toe voor de sub-tab (bij de andere `useState`-declaraties in deze component, exacte plek maakt niet uit zolang het binnen de component staat):

```tsx
const [nasSubView, setNasSubView] = useState<'library' | 'files'>(
  () => (localStorage.getItem('nas-sub-view') as 'library' | 'files') || 'library',
);
```

Vervang de bestaande `<NasBrowser onAddToQueue={onAddToQueue} onPlaylistCreated={fetchUserSpotifyPlaylists} />`-regel (regel 1154) door:

```tsx
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
  <NasMusicLibrary onAddToQueue={onAddToQueue} />
) : (
  <NasBrowser onAddToQueue={onAddToQueue} onPlaylistCreated={fetchUserSpotifyPlaylists} />
)}
```

- [ ] **Step 3: `npx tsc --noEmit`, build, en handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Open de app in de browser, ga naar Bronnen → Lokale & NAS Muziek, controleer dat de sub-tab-schakelaar "Muziekbibliotheek"/"Bestanden" verschijnt, dat de artiestengrid laadt en na een moment artwork toont voor bekende artiesten (bijv. ABBA), dat klikken op een artiest naar de albumgrid navigeert, en dat klikken op een album de songlijst toont met werkende afspelen/wachtrij-knoppen.

- [ ] **Step 4: Commit**

```bash
git add src/components/NasMusicLibrary.tsx src/components/PlaylistManager.tsx
git commit -m "feat(nas): add the artist/album/song music library view"
```

---

## Self-Review

**Spec coverage:**
- Hiërarchie-regel (top-level = artiest, direct-audio-of-submappen = album, platgetrokken diepere nesting) → Task 4. ✅
- Nieuwe Catalogic-functies (strikte artiestmatch, ID-gebaseerde albumdisambiguatie, correcte `owner_type`/`owner_id`-parameters) → Task 2. ✅
- Nieuwe opslag (`nas_artist_index`/`nas_album_index`, `checked_at`-discriminator) → Task 1. ✅
- Nieuwe routes (artists/albums/songs, listing + verrijken) → Tasks 3-5. ✅
- Songs hergebruiken `resolveLocalTrack` ongewijzigd → Task 5, expliciet geen nieuwe matchlogica. ✅
- Nieuwe frontend-tab naast de bestaande verkenner → Task 6. ✅
- "Wat niet in deze iteratie zit" (geen lyrics, geen wijziging aan de rauwe verkenner, geen automatische herverificatie) → geen enkele taak raakt deze. ✅

**Placeholder scan:** geen "TBD"/"later"/"voeg foutafhandeling toe" — elke stap bevat volledige code of een concrete, uitvoerbare verificatie-opdracht.

**Type consistency:** `upsertDbNasArtistEntry`/`upsertDbNasAlbumEntry`'s `checked: boolean`-parameter (Task 1) wordt in Task 3/4 consistent aangeroepen met `checked: true` na een geprobeerde lookup. `lookupCatalogicArtist`/`lookupCatalogicAlbum`'s retourvorm (Task 2) wordt in Task 3/4 exact zo gebruikt (`match?.artistId`/`match?.albumId`/`match?.artworkUrl`). `resolveLocalTrack`'s bestaande signatuur (`Track & { playable, fromCache, catalogicSongId }`) wordt in Task 5 correct hergebruikt zonder wijziging. `NasMusicLibrary`'s props-vorm (`onAddToQueue`) sluit aan op hoe `NasBrowser` al in `PlaylistManager.tsx` gebruikt wordt (Task 6).
