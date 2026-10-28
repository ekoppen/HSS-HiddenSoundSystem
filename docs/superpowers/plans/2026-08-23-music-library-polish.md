# Muziekbibliotheek Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NAS-share overzicht in Instellingen, songs die de albumhoes erven, zoeken binnen de bibliotheek, een song-detailweergave, een uitbreidbaar lyrics-pill-systeem via Catalogic, een instelbare artwork-tegelgrootte, en state-persistentie voor het hoofdtabblad.

**Architecture:** Zeven kleine, grotendeels onafhankelijke uitbreidingen op de al-geshipte Muziekbibliotheek-feature. Backend-taken (DB-kolommen, een nieuwe Catalogic-clientfunctie, drie nieuwe/aangepaste routes) gaan eerst; de frontend-taken bouwen daarna voort op wat al bestaat in `NasMusicLibrary.tsx`/`AuthAndApiKeysView.tsx`.

**Tech Stack:** Express + better-sqlite3 (backend), React + TypeScript (frontend) — zelfde stack als de rest van deze codebase, geen nieuwe dependencies.

**Spec:** docs/superpowers/specs/2026-08-23-music-library-polish-design.md

## Global Constraints

- Songs-niveau matching blijft ongewijzigd qua matchlogica — de nieuwe song-matching (via hergebruik van `/api/nas/enrich`) roept alleen de al-bestaande route aan, er komt geen nieuwe matchcode.
- `checked_at`/`lyrics_checked_at IS NULL` betekent altijd "nog nooit opgezocht" — nooit gelijkstellen aan "definitief geen match/lyrics" (zelfde discriminator-principe als overal elders in deze feature).
- Catalogic-aanroepen blijven best-effort: nooit throwen, `undefined` bij een transiente fout (HTTP-fout/timeout/netwerk), NIET gelijk aan `null`/lege array (= echt geen resultaat) — zelfde onderscheid als de recente artist/album-lookupfix.
- Elke nieuwe route die een caller-supplied pad naar de filesystem of DB stuurt, valideert eerst met `validateWithinNasShares`/`getEffectiveNasShares` uit `src/services/nasPathGuard.ts` — geen nieuwe ad-hoc validatie uitvinden.
- Dit repo heeft geen testdatabase-isolatie — nieuwe geautomatiseerde tests blijven beperkt tot pure, I/O-vrije functies. DB/route-gedrag wordt handmatig geverifieerd via een lokale dev-server in de werkboom (Node ABI: `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` vóór elke npm/node/tsc-opdracht).
- Geen wijziging aan `resolveLocalTrack`'s bestaande contract — nieuwe data (lyrics-status) wordt apart uit de DB gelezen in de route, niet toegevoegd aan die functie's returnwaarde.

---

### Task 1: DB — kolommen, bestandsteller-query, lyrics-status-update

**Files:**
- Modify: `db.ts`

**Interfaces:**
- Produces: `getDbNasLibraryFileCountForShare(shareId: string): number`, `updateDbNasLibraryLyricsStatus(filePath: string, hasLyrics: boolean): void`, nieuwe kolommen `has_lyrics INTEGER`/`lyrics_checked_at INTEGER` op `nas_library_index`.

- [ ] **Step 1: Migratie-kolommen toevoegen**

In `db.ts`, direct ná de bestaande `duration_ms`-migratie (regel 180-182):

```ts
try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN has_lyrics INTEGER').run();
} catch (e) {}

try {
  db.prepare('ALTER TABLE nas_library_index ADD COLUMN lyrics_checked_at INTEGER').run();
} catch (e) {}
```

- [ ] **Step 2: Nieuwe functies toevoegen**

In `db.ts`, direct ná `getDbNasLibraryResults` (regel 587, vóór de "Artiest-niveau cache"-comment):

```ts
export function getDbNasLibraryFileCountForShare(shareId: string): number {
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM nas_library_index WHERE share_id = ?').get(shareId) as any;
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
```

- [ ] **Step 3: `npx tsc --noEmit` en handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/hss/hss.db');
console.log(db.prepare(\"PRAGMA table_info(nas_library_index)\").all().map(c => c.name));
"
```
Verwacht: `tsc` geeft geen fouten; de kolomlijst bevat `has_lyrics` en `lyrics_checked_at`. (De migratie draait pas als de server ooit gestart is met deze code — start dus eerst kort `npm run dev` of `node dist/server.cjs` om de migratie te laten lopen vóór je de kolomlijst opvraagt, en stop de server daarna weer.)

- [ ] **Step 4: Commit**

```bash
git add db.ts
git commit -m "feat(nas): add lyrics-status columns and file-count/lyrics-update helpers"
```

---

### Task 2: Backend — bestandsteller op `GET /api/nas/shares`

**Files:**
- Modify: `src/server/routes/nas.ts`

**Interfaces:**
- Consumes: `getDbNasLibraryFileCountForShare` (Task 1).
- Produces: `GET /api/nas/shares` retourneert nu ook `fileCount: number` per share.

- [ ] **Step 1: Route uitbreiden**

In `src/server/routes/nas.ts`, de import op regel 9 uitbreiden:

```ts
import { getDbConfig, getDbImportedPlaylists, getDbNasLibraryFileCountForShare, getDbNetworkShares, saveDbImportedPlaylist, saveDbNetworkShare } from '../../../db.ts';
```

En de bestaande route (regel 15-21) vervangen door:

```ts
router.get('/api/nas/shares', (req, res) => {
  // GET, deliberately left open for read-browsing (see the mutation-only
  // auth gate above) — but that means the stored SMB/NFS password must
  // never round-trip here in full; nothing in the UI reads it back anyway.
  const shares = getDbNetworkShares().map((s) => ({
    ...s,
    password: s.password ? '••••••••' : '',
    fileCount: getDbNasLibraryFileCountForShare(s.id),
  }));
  res.json({ success: true, shares });
});
```

- [ ] **Step 2: `npx tsc --noEmit`, tests, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
npm run build
npm run dev
```
```bash
curl -s "http://localhost:3000/api/nas/shares" | head -c 800
```
Verwacht: 0 tsc-fouten, 12/12 tests slagen, elke share in de JSON-respons heeft een `fileCount`-veld (0 als er geen shares geconfigureerd zijn, of het werkelijke aantal na een eerdere scan/browse).

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/nas.ts
git commit -m "feat(nas): expose per-share file count on GET /api/nas/shares"
```

---

### Task 3: Frontend — NAS-overzicht in Instellingen

**Files:**
- Modify: `src/components/AuthAndApiKeysView.tsx`

**Interfaces:**
- Consumes: `GET /api/nas/shares` (Task 2), inclusief `fileCount`.
- Produces: nieuwe kaart met de shareslijst, geen nieuwe props/exports (puur interne component-state).

- [ ] **Step 1: State en fetch toevoegen**

In `AuthAndApiKeysView.tsx`, bij de andere `useState`-declaraties in deze component (zoek naar de bestaande `scanStatus`/`scanResults`-state, zelfde buurt):

```ts
const [nasShares, setNasShares] = useState<any[]>([]);

const loadNasShares = async () => {
  try {
    const res = await fetch('/api/nas/shares').then((r) => r.json());
    if (res.shares) setNasShares(res.shares);
  } catch (e) {}
};
```

Bij de bestaande `useEffect` die draait wanneer `activeSubTab === 'nas'` wordt (of, als die niet bestaat, een nieuwe toevoegen naast de andere effects in deze component):

```ts
useEffect(() => {
  if (activeSubTab === 'nas') loadNasShares();
}, [activeSubTab]);
```

- [ ] **Step 2: Kaart toevoegen**

In `AuthAndApiKeysView.tsx`, direct vóór de bestaande mount-form-kaart (regel 1397-1398, `{activeSubTab === 'nas' && (<Card padding={0} style={{ marginTop: 20 }}>`), een nieuwe kaart invoegen:

```tsx
{activeSubTab === 'nas' && nasShares.length > 0 && (
  <Card padding={0} style={{ marginTop: 20 }}>
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ font: 'var(--text-title)', color: 'var(--text-primary)', margin: 0 }}>Gekoppelde netwerkschijven</h3>
      {nasShares.map((share: any) => (
        <div
          key={share.id}
          style={{
            padding: 14,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div className="min-w-0">
            <div style={{ font: 'var(--text-body)', color: 'var(--text-primary)', fontWeight: 600 }}>{share.name}</div>
            <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
              {String(share.shareType).toUpperCase()} · {share.host} · {share.mountPoint}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--status-success)', fontWeight: 600 }}>{share.status}</div>
            <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
              {share.fileCount > 0 ? `${share.fileCount} bestanden geïndexeerd` : 'Nog niet gescand'}
            </div>
          </div>
        </div>
      ))}
    </div>
  </Card>
)}
```

- [ ] **Step 2: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Open de app, ga naar Instellingen → Netwerkschijf (NAS/SMB). Als er (nog) geen share geconfigureerd is verschijnt de kaart niet (leeg `nasShares`-array); koppel een testshare of controleer met een handmatig geseede `network_shares`-rij dat de kaart verschijnt met naam/protocol/host/status/bestandsaantal.

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthAndApiKeysView.tsx
git commit -m "feat(nas): show configured NAS shares with file count in Settings"
```

---

### Task 4: Backend — Catalogic lyrics-clientfunctie

**Files:**
- Modify: `src/services/catalogicClient.ts`

**Interfaces:**
- Produces: `lookupCatalogicLyrics(songId: string): Promise<CatalogicLyrics[] | undefined>`, `interface CatalogicLyrics`.

- [ ] **Step 1: Functie toevoegen**

In `catalogicClient.ts`, aan het einde van het bestand (ná de bestaande `lookupCatalogicAlbum`-functie, of ná de laatste export als de structuur anders is — volg de bestaande volgorde: interface, dan functie, zelfde stijl als `lookupCatalogicArtist`/`lookupCatalogicAlbum`):

```ts
export interface CatalogicLyrics {
  id: string;
  locale: string;
  format: 'plain' | 'lrc';
  text: string;
}

/**
 * Best-effort lyrics lookup for an already-matched Catalogic song — GET
 * /v1/songs/:songId/lyrics is publicly readable (no scope required, unlike
 * the PUT/DELETE variants), verified directly against the live route
 * source (catalogic/src/routes/lyrics.ts). Returns `undefined` on a
 * transient failure (HTTP error, timeout, network down) — NOT the same as
 * a genuine "no lyrics for this song" (an empty array), same error/no-match
 * discipline as lookupCatalogicArtist/lookupCatalogicAlbum: a temporary
 * Catalogic outage must never permanently cache "no lyrics".
 */
export async function lookupCatalogicLyrics(songId: string): Promise<CatalogicLyrics[] | undefined> {
  if (!config.enabled || !songId) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.url}/v1/songs/${encodeURIComponent(songId)}/lyrics`, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data: CatalogicLyrics[] };
    return body.data || [];
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: `npx tsc --noEmit`, tests, handmatig verifiëren tegen de live Catalogic-server**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
```
Handmatige verificatie (geen songId bij de hand in dit dev-environment is prima — controleer in ieder geval de foutafhandeling, via een kort `tsx`-scriptje omdat een `.ts`-bestand niet direct met `node -e`/`require` te laden is):
```bash
npx tsx -e "
import('./src/services/catalogicClient.ts').then(async (m) => {
  const result = await m.lookupCatalogicLyrics('00000000-0000-0000-0000-000000000000');
  console.log('result for a definitely-nonexistent songId:', result);
});
"
```
Verwacht (met Catalogic bereikbaar en `config.enabled`): een lege array `[]` voor een niet-bestaand UUID (Catalogic's route parst het UUID-formaat correct maar vindt niets), NIET `undefined` (dat zou een echte transiente fout betekenen — als je dat ziet, controleer of de Catalogic-server/URL/API-key in de lokale instellingen kloppen). Met Catalogic uitgeschakeld (`config.enabled === false`): direct `undefined`, zonder netwerkaanroep.

- [ ] **Step 3: Commit**

```bash
git add src/services/catalogicClient.ts
git commit -m "feat(nas): add lookupCatalogicLyrics client function"
```

---

### Task 5: Backend — lyrics-routes en `hasLyrics` op de songs-route

**Files:**
- Modify: `src/server/routes/nas-library.ts`

**Interfaces:**
- Consumes: `updateDbNasLibraryLyricsStatus`, `getDbNasLibraryEntry` (Task 1 / bestaand in `db.ts`), `lookupCatalogicLyrics` (Task 4).
- Produces:
  - `GET /api/nas/library/songs` — response-items krijgen er `hasLyrics: boolean | null` bij (naast de bestaande velden).
  - `POST /api/nas/library/enrich-lyrics` body `{ paths: string[] }` → `{ success: true, songs: Record<string, {hasLyrics: boolean}> }`.
  - `GET /api/nas/library/lyrics?path=<filePath>` → `{ success: true, lyrics: CatalogicLyrics[] }` (of `{ success: false, error }`).

- [ ] **Step 1: Imports uitbreiden**

In `src/server/routes/nas-library.ts`, de bestaande imports uitbreiden:

```ts
import {
  getDbNasArtistEntry,
  getDbNasAlbumEntry,
  getDbNasLibraryEntry,
  updateDbNasLibraryLyricsStatus,
  upsertDbNasArtistEntry,
  upsertDbNasAlbumEntry,
} from '../../../db.ts';
import { isAudioFile } from '../../services/localTrackMetadata.ts';
import { resolveLocalTrack } from '../../services/nasLibraryScan.ts';
import { lookupCatalogicArtist, lookupCatalogicAlbum, lookupCatalogicLyrics } from '../../services/catalogicClient.ts';
```

- [ ] **Step 2: `GET /api/nas/library/songs` uitbreiden met `hasLyrics`**

De bestaande worker in deze route (binnen `router.get('/api/nas/library/songs', ...)`) aanpassen:

```ts
    async function worker() {
      while (cursor < filePaths.length) {
        const i = cursor++;
        const track = await resolveLocalTrack(filePaths[i], { allowCatalogicLookup: false });
        const dbEntry = getDbNasLibraryEntry(filePaths[i]) as any;
        const hasLyrics = dbEntry?.has_lyrics === 1 ? true : dbEntry?.has_lyrics === 0 ? false : null;
        rawSongs[i] = { ...track, path: filePaths[i], hasLyrics };
      }
    }
```

(Dit vervangt alleen de `worker`-functiebody van die route — de rest van `GET /api/nas/library/songs` blijft ongewijzigd: validatie, `walkAudioFilesFlat`, sortering, concurrency-cap, filter op `playable`.)

- [ ] **Step 3: `POST /api/nas/library/enrich-lyrics` en `GET /api/nas/library/lyrics` toevoegen**

Vlak vóór `export default router;`:

```ts
router.post('/api/nas/library/enrich-lyrics', async (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths (array) is verplicht' });
  }
  if (!hubConfig.catalogicScanLookupEnabled) {
    return res.json({ success: true, songs: {} });
  }
  try {
    const shares = getEffectiveNasShares();
    const filePaths = paths
      .filter((p: unknown) => validateWithinNasShares(p, shares) !== null)
      .filter((p: string) => {
        const entry = getDbNasLibraryEntry(p) as any;
        return !!entry?.catalogic_song_id && entry?.lyrics_checked_at == null;
      })
      .slice(0, 100);
    const CONCURRENCY = 4;
    const songs: Record<string, { hasLyrics: boolean }> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < filePaths.length) {
        const filePath = filePaths[cursor++];
        try {
          const entry = getDbNasLibraryEntry(filePath) as any;
          const lyrics = await lookupCatalogicLyrics(entry.catalogic_song_id);
          if (lyrics === undefined) continue; // transient Catalogic failure — leave unchecked, retry on a later enrich pass
          const hasLyrics = lyrics.length > 0;
          updateDbNasLibraryLyricsStatus(filePath, hasLyrics);
          songs[filePath] = { hasLyrics };
        } catch {
          // skip unreadable/unresolvable entry
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker));
    res.json({ success: true, songs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/nas/library/lyrics', async (req, res) => {
  const filePath = validateWithinNasShares(req.query.path);
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'invalid path', lyrics: [] });
  }
  try {
    const entry = getDbNasLibraryEntry(filePath) as any;
    if (!entry?.catalogic_song_id) {
      return res.json({ success: true, lyrics: [] });
    }
    const lyrics = await lookupCatalogicLyrics(entry.catalogic_song_id);
    res.json({ success: true, lyrics: lyrics ?? [] });
  } catch (e: any) {
    res.json({ success: false, error: e.message, lyrics: [] });
  }
});
```

- [ ] **Step 4: `npx tsc --noEmit`, tests, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm test
npm run build
npm run dev
```
```bash
curl -s "http://localhost:3000/api/nas/library/songs?albumPath=/tmp/nas-test/ABBA" | head -c 600
curl -s -X POST http://localhost:3000/api/nas/library/enrich-lyrics -H 'Content-Type: application/json' -d '{"paths":[]}'
curl -s "http://localhost:3000/api/nas/library/lyrics?path=/etc"
```
Verwacht: 0 tsc-fouten, 12/12 tests slagen; songs-respons bevat `hasLyrics` (null als er nog geen `nas_library_index`-rij is, anders true/false); een lege `paths`-array op enrich-lyrics geeft een 400; `path=/etc` op de lyrics-route geeft een 400 `invalid path` (path-validatie, zelfde als alle andere routes in dit bestand).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/nas-library.ts
git commit -m "feat(nas): add lyrics enrich/fetch routes, expose hasLyrics on songs"
```

---

### Task 6: Frontend — albumhoes-fallback, zoeken, tegelgrootte, state-persistentie

**Files:**
- Modify: `src/components/NasMusicLibrary.tsx`

**Interfaces:**
- Consumes: niets nieuws van eerdere taken — puur frontend-state en presentatie op de al-bestaande `artists`/`albums`/`songs`-data.
- Produces: geen nieuwe exports, alleen interne gedrag/UI-aanpassingen.

- [ ] **Step 1: Albumhoes-fallback voor songs**

`openAlbum` vervangen door:

```ts
  const openAlbum = async (album: LibraryAlbum) => {
    setCurrentAlbumName(album.name);
    setSearchQuery('');
    setLevel('songs');
    try {
      const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
      if (res.songs) {
        setSongs(
          res.songs.map((s: LibrarySong) => ({
            ...s,
            coverUrl: s.coverUrl && s.coverUrl !== PLACEHOLDER_COVER ? s.coverUrl : album.artworkUrl || s.coverUrl,
          })),
        );
      }
    } catch (e) {}
  };
```

- [ ] **Step 2: Zoekveld toevoegen**

Nieuwe state, direct bij de andere `useState`-declaraties:

```ts
  const [searchQuery, setSearchQuery] = useState('');
  const [tileSize, setTileSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem('nas-library-tile-size'));
    return stored >= 80 && stored <= 200 ? stored : 120;
  });
```

`openArtist` en de terug-knop (`onClick={() => (level === 'songs' ? setLevel('albums') : setLevel('artists'))}`) legen ook `searchQuery`:

```ts
  const openArtist = async (artist: LibraryArtist) => {
    setCurrentArtistPath(artist.path);
    setCurrentArtistName(artist.name);
    setSearchQuery('');
    setLevel('albums');
    // ...rest ongewijzigd...
```

```tsx
            <button
              onClick={() => {
                setSearchQuery('');
                setLevel(level === 'songs' ? 'albums' : 'artists');
              }}
              style={{ padding: 4, color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={18} />
            </button>
```

Berekende, gefilterde lijsten (vlak vóór de `return`):

```ts
  const visibleArtists = artists.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const visibleAlbums = albums.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const visibleSongs = songs.filter(
    (s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()) || s.artist.toLowerCase().includes(searchQuery.toLowerCase()),
  );
```

In de header (ná de titel/subtitel-`div`, binnen dezelfde flex-rij), een zoekveld en de tegelgrootte-slider toevoegen — en de bestaande grids gebruiken voortaan `visibleArtists`/`visibleAlbums`/`visibleSongs` in plaats van `artists`/`albums`/`songs`, en `gridTemplateColumns` in plaats van de vaste Tailwind-kolomklassen:

```tsx
        <div className="flex items-center" style={{ gap: 10, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          {level !== 'artists' && (
            <button
              onClick={() => {
                setSearchQuery('');
                setLevel(level === 'songs' ? 'albums' : 'artists');
              }}
              style={{ padding: 4, color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <Disc3 size={18} style={{ color: 'var(--accent)' }} />
          <div className="min-w-0" style={{ flex: 1 }}>
            <div style={{ font: 'var(--text-subtitle)', color: 'var(--text-primary)' }}>Muziekbibliotheek</div>
            <p style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
              {level === 'artists' ? 'Alle artiesten' : level === 'albums' ? currentArtistName : `${currentArtistName} — ${currentAlbumName}`}
            </p>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={level === 'artists' ? 'Zoek artiest…' : level === 'albums' ? 'Zoek album…' : 'Zoek nummer…'}
            style={{
              width: 180,
              padding: '7px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-inset)',
              color: 'var(--text-primary)',
              font: 'var(--text-mono-sm)',
            }}
          />
          {level !== 'songs' && (
            <input
              type="range"
              min={80}
              max={200}
              step={10}
              value={tileSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTileSize(v);
                localStorage.setItem('nas-library-tile-size', String(v));
              }}
              title="Grootte van de tegels"
              style={{ width: 100 }}
            />
          )}
        </div>
```

De artiesten- en albumgrid-`div`'s (`className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"`) vervangen door:

```tsx
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`, gap: 14 }}>
```

(twee plekken: de artiestengrid en de albumgrid — beide dezelfde vervanging, `visibleArtists`/`visibleAlbums` gebruiken in plaats van `artists`/`albums` in de `.map(...)`-aanroepen eronder). De songlijst gebruikt `visibleSongs` in plaats van `songs` in zijn `.map(...)` (blijft een `flexDirection: 'column'`-lijst, geen grid).

- [ ] **Step 3: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Open de app, ga naar Muziekbibliotheek. Controleer: typen in het zoekveld filtert de zichtbare artiesten/albums/songs live; de slider past de tegelgrootte van de artiesten- en albumgrid aan en onthoudt die waarde na een refresh; songs zonder eigen hoes tonen de albumhoes in plaats van de placeholder (open een album waarvan de hoes al bekend is en waarvan minstens één nummer geen eigen ingebedde art heeft).

- [ ] **Step 4: Commit**

```bash
git add src/components/NasMusicLibrary.tsx
git commit -m "feat(nas): album-artwork fallback for songs, in-library search, tile-size slider"
```

---

### Task 7: Frontend — song-matching, lyrics-pill, song-detailweergave

**Files:**
- Modify: `src/components/NasMusicLibrary.tsx`

**Interfaces:**
- Consumes: `/api/nas/enrich` (bestaand, `nas.ts`), `POST /api/nas/library/enrich-lyrics`, `GET /api/nas/library/lyrics` (Task 5).
- Produces: geen nieuwe exports — de detailweergave en pill-UI zijn interne state/JSX van dit component.

- [ ] **Step 1: `LibrarySong` uitbreiden**

```ts
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
  catalogicSongId?: string | null;
  hasLyrics?: boolean | null;
}
```

- [ ] **Step 2: Song-matching + lyrics-enrich na het laden van songs**

`openAlbum` (uit Task 6) verder uitbreiden — ná de `setSongs(...)`-aanroep, binnen dezelfde `try`:

```ts
  const openAlbum = async (album: LibraryAlbum) => {
    setCurrentAlbumName(album.name);
    setSearchQuery('');
    setLevel('songs');
    try {
      const res = await fetch(`/api/nas/library/songs?albumPath=${encodeURIComponent(album.path)}`).then((r) => r.json());
      if (res.songs) {
        const mapped = res.songs.map((s: LibrarySong) => ({
          ...s,
          coverUrl: s.coverUrl && s.coverUrl !== PLACEHOLDER_COVER ? s.coverUrl : album.artworkUrl || s.coverUrl,
        }));
        setSongs(mapped);

        const paths = mapped.map((s: LibrarySong) => s.path);
        if (paths.length > 0) {
          fetch('/api/nas/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
          })
            .then((r) => r.json())
            .then((enrichRes) => {
              if (!enrichRes.tracks) return;
              setSongs((prev) =>
                prev.map((s) =>
                  enrichRes.tracks[s.path] ? { ...s, catalogicSongId: enrichRes.tracks[s.path].catalogicSongId } : s,
                ),
              );
              const matchedPaths = paths.filter((p: string) => enrichRes.tracks[p]?.catalogicSongId);
              if (matchedPaths.length > 0) {
                fetch('/api/nas/library/enrich-lyrics', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ paths: matchedPaths }),
                })
                  .then((r) => r.json())
                  .then((lyricsRes) => {
                    if (!lyricsRes.songs) return;
                    setSongs((prev) =>
                      prev.map((s) => (lyricsRes.songs[s.path] ? { ...s, hasLyrics: lyricsRes.songs[s.path].hasLyrics } : s)),
                    );
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {}
  };
```

- [ ] **Step 3: Detailweergave-state en pill-component**

Nieuwe state, bij de andere `useState`-declaraties:

```ts
  const [selectedSong, setSelectedSong] = useState<LibrarySong | null>(null);
  const [lyricsText, setLyricsText] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
```

Nieuwe helperfunctie in het component (vóór de `return`):

```ts
  const openLyrics = async (song: LibrarySong) => {
    setLyricsLoading(true);
    setLyricsText(null);
    try {
      const res = await fetch(`/api/nas/library/lyrics?path=${encodeURIComponent(song.path)}`).then((r) => r.json());
      const first = res.lyrics?.[0];
      setLyricsText(first ? first.text : 'Geen lyrics gevonden.');
    } catch (e) {
      setLyricsText('Kon lyrics niet ophalen.');
    } finally {
      setLyricsLoading(false);
    }
  };
```

Nieuwe `Pill`-component, buiten `NasMusicLibrary` (aan het einde van het bestand, of vlak erboven — module-level, niet binnen de component):

```tsx
function Pill({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px',
        borderRadius: 999,
        font: 'var(--text-mono-sm)',
        fontSize: 11,
        fontWeight: 600,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Songrij klikbaar maken + detailmodal renderen**

De songrij-`div` (binnen `{level === 'songs' && (...)}`, `.map((song) => (...))`) krijgt een `onClick` op de buitenste `div` die het detailpaneel opent — de bestaande play/queue-knoppen roepen `e.stopPropagation()` aan zodat een klik daarop niet ook de modal opent:

```tsx
              <div
                key={song.path}
                className="flex items-center justify-between min-w-0"
                onClick={() => setSelectedSong(song)}
                style={{ gap: 10, padding: 12, background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
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
                  {song.hasLyrics && <Pill label="Lyrics" />}
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
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
```

Detailmodal, direct vóór de sluitende `</Card>` van het component (dus als broer van de `{level === 'artists' && ...}`/`{level === 'albums' && ...}`/`{level === 'songs' && ...}`-blokken, binnen dezelfde buitenste `<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>`):

```tsx
        {selectedSong && (
          <div
            onClick={() => {
              setSelectedSong(null);
              setLyricsText(null);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                padding: 24,
                maxWidth: 420,
                width: '100%',
                maxHeight: '80vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div className="flex items-center" style={{ gap: 14 }}>
                <img
                  src={selectedSong.coverUrl || PLACEHOLDER_COVER}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }}
                />
                <div className="min-w-0">
                  <div style={{ font: 'var(--text-title)', color: 'var(--text-primary)' }}>{selectedSong.title}</div>
                  <div className="truncate" style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>
                    {selectedSong.artist} — {selectedSong.album}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {selectedSong.hasLyrics && <Pill label="Lyrics" onClick={() => openLyrics(selectedSong)} />}
                {selectedSong.catalogicSongId && <Pill label="Catalogic-match" />}
              </div>

              <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>Duur: {Math.round((selectedSong.durationMs || 0) / 1000)}s</div>
                {selectedSong.bitrate && <div>Bitrate: {selectedSong.bitrate}kbps</div>}
                {selectedSong.sampleRate && <div>Sample rate: {selectedSong.sampleRate}Hz</div>}
                {selectedSong.bitDepth && <div>Bit depth: {selectedSong.bitDepth}bit</div>}
              </div>

              <div className="flex" style={{ gap: 8 }}>
                <Button onClick={() => handlePlaySong(selectedSong)} icon={<Play size={13} />}>Afspelen</Button>
                <Button variant="secondary" onClick={() => handleQueueSong(selectedSong)} icon={<Plus size={13} />}>Aan wachtrij toevoegen</Button>
              </div>

              {lyricsLoading && (
                <div style={{ font: 'var(--text-mono-sm)', color: 'var(--text-muted)' }}>Lyrics laden…</div>
              )}
              {lyricsText && (
                <div
                  style={{
                    font: 'var(--text-mono-sm)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    padding: 12,
                    background: 'var(--bg-inset)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {lyricsText}
                </div>
              )}
            </div>
          </div>
        )}
```

`Button` moet dan wél weer geïmporteerd worden uit `./ui` (Task 6 raakt dit niet aan, maar de detailmodal gebruikt 'm nu wel) — de import op regel 4 wordt:

```ts
import { Button, Card } from './ui';
```

- [ ] **Step 5: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Open de app, ga naar Muziekbibliotheek, open een artiest → album. Controleer: songs krijgen na een moment (ná de `/api/nas/enrich`-aanroep) een "Lyrics"-pill als Catalogic een match met lyrics heeft; klikken op een songrij (niet op de play/queue-knoppen) opent het detailpaneel met titel/artiest/album/duur/bitrate/sample rate/bit depth en de pill-rij; klikken op de Lyrics-pill in het paneel haalt en toont de tekst; klikken buiten het paneel sluit het.

- [ ] **Step 6: Commit**

```bash
git add src/components/NasMusicLibrary.tsx
git commit -m "feat(nas): song-level Catalogic matching, lyrics pill, song detail view"
```

---

## Self-Review

**Spec coverage:**
- §1 NAS-overzicht → Tasks 1-3. ✅
- §2 Albumhoes-fallback → Task 6. ✅
- §3 Zoeken → Task 6. ✅
- §4 Song-detailweergave → Task 7. ✅
- §5 Lyrics-pills (matching hergebruikt `/api/nas/enrich`, nieuwe Catalogic-capability, `checked_at`-achtige cache, uitbreidbaar pill-systeem) → Tasks 4, 5, 7. ✅
- §6 Tegelgrootte → Task 6. ✅
- §7 State-persistentie hoofdtabblad → al werkend (`PlaylistManager.tsx`'s bestaande `nas-sub-view`-key) — geen aparte taak nodig, alleen Task 6's `nas-library-tile-size`-key volgt hetzelfde patroon voor de nieuwe tegelgrootte-instelling.

**Placeholder scan:** geen "TBD"/"later"/"voeg foutafhandeling toe" — elke stap bevat volledige code of een concrete, uitvoerbare verificatie-opdracht. (Task 7 Step 1 had bij het schrijven een gedupliceerde `bitDepth`-regel — gecorrigeerd tijdens deze self-review, vóór het committen van het plan.)

**Type consistency:** `updateDbNasLibraryLyricsStatus`/`getDbNasLibraryFileCountForShare` (Task 1) worden in Tasks 2 en 5 met exact dezelfde signatuur aangeroepen. `lookupCatalogicLyrics`'s returnvorm (Task 4, `CatalogicLyrics[] | undefined`) wordt in Task 5 correct behandeld (`undefined` = transiente fout, niet cachen; lege array = echt geen lyrics, wél cachen). `LibrarySong.hasLyrics`/`catalogicSongId` (Task 7) matchen wat `GET /api/nas/library/songs` (Task 5) daadwerkelijk teruggeeft. `enrich-lyrics`'s request-vorm (`{paths: string[]}`) en respons-vorm (`{songs: Record<string, {hasLyrics}>}`) zijn consistent tussen Task 5 (backend) en Task 7 (frontend-aanroep).
