# NAS-verkenner opschonen, wachtrij bedienen, playlists beheren, Catalogic on-demand aanmaken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systeemmappen (`@eaDir` e.d.) uit de NAS-verkenner filteren, de
app-shell zo herzien dat alleen het inhoudsgebied scrolt, de wachtrij
bedienbaar maken (starten vanuit de Wachtrij-tab, volgorde wijzigen, los
verwijderen), handmatig playlists kunnen samenstellen (nieuwe playlist,
nummers toevoegen/verwijderen/herordenen), en niet-gematchte
artiesten/albums/songs op verzoek via Catalogic laten aanmaken (Spotify-
backed, alleen op expliciete klik).

**Architecture:** Zeven grotendeels onafhankelijke taken, verspreid over
bestaande bestanden. Twee ontdekkingen tijdens het schrijven van dit plan
verkleinen de scope aanzienlijk t.o.v. het ontwerpdocument: (1) de
playlist-CRUD-backend en de App.tsx-handlers ernaartoe bestaan al en zijn
zelfs al gedeeltelijk aangesloten (`onCreatePlaylist`/`onAddTrackToPlaylist`
worden al doorgegeven aan `PlaylistManager` maar nergens vandaan
aangeroepen) — dit plan hoeft dus alleen de ontbrekende UI-knoppen toe te
voegen, niet de backend-plumbing; (2) "Mijn NAS afspeellijsten"
(`PlaylistManager.tsx:1071-1156`) toont al elke lokale playlist met
play/uitklappen/verwijderen en per-nummer-verwijderen — er ontbreekt alleen
een "nieuwe playlist"-knop, herorden-knoppen, en een manier om een nummer
vanuit de bibliotheekweergave aan een playlist toe te voegen.

**Tech Stack:** Express + better-sqlite3 (backend), React + TypeScript
(frontend) — zelfde stack als de rest van deze codebase, geen nieuwe
dependencies.

**Spec:** docs/superpowers/specs/2026-08-23-nas-browse-queue-playlist-design.md

## Global Constraints

- Systeemmap-filtering (`isSystemDirectory`) is een blocklist, geen
  allowlist — een normale artiest/album/songmap mag nooit per ongeluk
  worden uitgesloten. Alleen bekende NAS-systeemmapnamen plus alles wat
  met een punt begint.
- De automatische Catalogic-matchpaden (volledige scan, `/api/nas/enrich`,
  artiest/album-verrijking bij bladeren) blijven ONGEWIJZIGD match-only —
  dit plan voegt alleen een LOS, expliciet per-item aanmaak-pad toe, nooit
  automatisch.
- Elke nieuwe route die een caller-supplied NAS-pad ontvangt valideert via
  `validateWithinNasShares`/`getEffectiveNasShares`
  (`src/services/nasPathGuard.ts`) vóór enige fs/DB-toegang — zelfde
  patroon als alle bestaande routes in `nas-library.ts`/`nas.ts`.
- Queue/playlist-mutatieroutes gebruiken `requireAudioPermission('audio:control')`
  net als de al-bestaande `/api/queue/*`/`/api/playlists/*`-routes in
  dezelfde bestanden — geen nieuwe/afwijkende auth-aanpak.
- Dit repo heeft geen testdatabase-isolatie — nieuwe geautomatiseerde
  tests blijven beperkt tot pure, I/O-vrije functies (`isSystemDirectory`
  is zo'n functie en verdient een echte unit-test — de rest van dit plan
  wordt handmatig geverifieerd via een lokale dev-server, net als de twee
  eerdere NAS-batches deze sessie).
- Node ABI: elke npm/node/tsc-opdracht in dit repo vereist
  `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` (Homebrew
  Node kan `better-sqlite3`'s binary niet laden). `npm run build` moet
  vóór `npm test` draaien zodra een backend-route wijzigt — de smoke-tests
  starten `dist/server.cjs` als subprocess. Check `lsof -nP -iTCP:3099
  -sTCP:LISTEN` vóór elke testrun; een achtergebleven zombie-proces van
  een eerdere run heeft al eens echte test-fails gemaskeerd in dit repo.

---

### Task 1: Systeemmappen filteren (`@eaDir` e.d.)

**Files:**
- Modify: `src/services/localTrackMetadata.ts`
- Modify: `src/server/routes/nas.ts`
- Modify: `src/server/routes/nas-library.ts`
- Modify: `src/services/nasLibraryScan.ts`
- Test: `tests/local-track-metadata.test.ts` (nieuw bestand, of toevoegen
  aan een bestaand testbestand voor dit servicebestand als dat al bestaat
  — controleer eerst)

**Interfaces:**
- Produces: `isSystemDirectory(name: string): boolean` in
  `localTrackMetadata.ts`, geëxporteerd naast het bestaande `isAudioFile`.

- [ ] **Step 1: `isSystemDirectory` toevoegen + test**

In `src/services/localTrackMetadata.ts`, naast de bestaande
`isAudioFile`-export:

```ts
const SYSTEM_DIR_NAMES = new Set([
  '@eaDir',    // Synology thumbnail-/metadatacache, per map
  '@tmp',      // Synology tijdelijke map tijdens bestandsbewerkingen
  '#recycle',  // Synology prullenbak (netwerkgedeeld zichtbaar)
  '#snapshot', // Synology snapshot-map
  '.streams',  // QNAP thumbnail-/streamingcache
  '@Recycle',  // QNAP prullenbak
]);

/**
 * Herkent NAS-systeemmappen (Synology/QNAP thumbnailcaches, prullenbakken)
 * die nooit als artiest/album/songmap bedoeld zijn — blocklist plus "alles
 * wat met een punt begint" (verborgen mappen, geen enkele echte
 * artiest/album heeft een naam die met een punt start).
 */
export function isSystemDirectory(name: string): boolean {
  return SYSTEM_DIR_NAMES.has(name) || name.startsWith('.');
}
```

Zoek eerst of er al een testbestand voor `localTrackMetadata.ts` bestaat
(`ls tests/ | grep -i track` of vergelijkbaar). Zo ja: voeg de test daarin
toe. Zo niet: maak `tests/local-track-metadata.test.ts` aan met minimaal:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemDirectory } from '../src/services/localTrackMetadata.ts';

test('isSystemDirectory recognizes known NAS system folders', () => {
  assert.equal(isSystemDirectory('@eaDir'), true);
  assert.equal(isSystemDirectory('#recycle'), true);
  assert.equal(isSystemDirectory('.hidden-folder'), true);
});

test('isSystemDirectory does not flag a real artist/album folder name', () => {
  assert.equal(isSystemDirectory('ABBA'), false);
  assert.equal(isSystemDirectory('Massive Attack - Mezzanine'), false);
  assert.equal(isSystemDirectory('2004 - Greatest Hits'), false);
});
```

- [ ] **Step 2: Toepassen in `nas.ts`'s `GET /api/nas/browse`**

De regel die de listing filtert (huidig: `const files = rawFiles.filter((f) => f.isDir || !f.isAudio || f.playable !== false);`
— zoek de exacte huidige plek, dit filter zit ná de `Promise.all`-map)
uitbreiden zodat een systeemmap er ook uit valt. Voeg bovenaan het bestand
de import toe:

```ts
import { isAudioFile, isSystemDirectory } from '../../services/localTrackMetadata.ts';
```

En pas de bestaande filter-regel aan naar (exacte plek: waar `rawFiles`
tot `files` wordt gefilterd):

```ts
    const files = rawFiles.filter((f) => (f.isDir ? !isSystemDirectory(f.name) : !f.isAudio || f.playable !== false));
```

- [ ] **Step 3: Toepassen in `nas-library.ts`**

Import toevoegen: `isSystemDirectory` naast de bestaande `isAudioFile`-import.

`GET /api/nas/library/artists` (de `fs.readdirSync(share, {
withFileTypes: true }).filter((e) => e.isDirectory())`-regel) wordt:

```ts
    const entries = fs.readdirSync(share, { withFileTypes: true }).filter((e) => e.isDirectory() && !isSystemDirectory(e.name));
```

`GET /api/nas/library/albums` (de `entries.filter((e) => e.isDirectory())`-regel,
in het niet-`hasDirectAudio`-pad) wordt:

```ts
    const albums = entries
      .filter((e) => e.isDirectory() && !isSystemDirectory(e.name))
      .map((e) => {
```

(rest van die functie ongewijzigd — alleen de `.filter(...)`-regel zelf
verandert, de `.map(...)` erna blijft exact zoals 'ie is.)

`walkAudioFilesFlat` (de recursieve functie onderin het bestand) wordt:

```ts
function walkAudioFilesFlat(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && isSystemDirectory(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAudioFilesFlat(full));
    else if (isAudioFile(entry.name)) out.push(full);
  }
  return out;
}
```

- [ ] **Step 4: Toepassen in `nasLibraryScan.ts`**

Zoek de recursieve `walkAudioFiles`-functie (analoog aan
`walkAudioFilesFlat` hierboven, gebruikt door de volledige-bibliotheekscan)
en pas 'm op dezelfde manier aan: importeer `isSystemDirectory` naast de
bestaande `isAudioFile`-import, en sla een `entry.isDirectory() &&
isSystemDirectory(entry.name)`-geval over vóór de recursieve aanroep —
zelfde `continue`-toevoeging als Step 3's `walkAudioFilesFlat`-wijziging.
Lees de functie eerst om de exacte huidige vorm te bevestigen (deze kan
qua variabelenamen licht afwijken van `walkAudioFilesFlat`) voordat je de
wijziging toepast.

- [ ] **Step 5: `npx tsc --noEmit`, tests, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm test
```
Verwacht: 0 tsc-fouten, de nieuwe `isSystemDirectory`-tests slagen, en de
bestaande testsuite blijft groen (12/12 + de nieuwe tests). Handmatig: zet
een testmap `/tmp/nas-test/@eaDir` (met een willekeurig bestand erin) naast
een echte artiestmap neer, herstart de dev-server, en bevestig dat
`GET /api/nas/library/artists?share=/tmp/nas-test` géén `@eaDir`-entry
teruggeeft, en dat `GET /api/nas/browse?path=/tmp/nas-test` 'm ook niet
toont.

- [ ] **Step 6: Commit**

```bash
git add src/services/localTrackMetadata.ts src/server/routes/nas.ts src/server/routes/nas-library.ts src/services/nasLibraryScan.ts tests/
git commit -m "feat(nas): filter NAS system folders (@eaDir etc.) from browse/library/scan"
```

---

### Task 2: Vaste app-shell — alleen het inhoudsgebied scrolt

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: geen nieuwe exports — puur layout/CSS-wijziging van de
  bestaande render-structuur.

- [ ] **Step 1: Layout herzien**

Lees eerst de huidige structuur rond regel 879-935 van `src/App.tsx` (de
exacte regelnummers kunnen licht zijn opgeschoven sinds dit plan
geschreven is — zoek op de tekst `min-h-screen flex flex-col` om de juiste
plek te vinden). De buitenste `<div className="min-h-screen flex flex-col ...">`
en de daaropvolgende geneste `<div>`'s tot en met `<main>` worden:

```tsx
    <div
      className="flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200"
      style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', height: '100vh', overflow: 'hidden' }}
    >
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenThemeModal={() => setIsThemeModalOpen(true)}
          systemStats={playback.systemStats}
        />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Content Header */}
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '16px 32px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              flexShrink: 0,
            }}
          >
```

(De inhoud van de `<header>` zelf — de tabtitel-span en de
WebSocket-statusindicator — blijft volledig ongewijzigd, alleen
`flexShrink: 0` wordt toegevoegd aan de bestaande `style`-object.)

Direct ná de sluitende `</header>`, de bestaande `<main>`-regel:

```tsx
          {/* Main Content Area with Dynamic Views */}
          <main className="w-full space-y-6" style={{ maxWidth: 1080, padding: '28px 32px 60px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
```

(was: `<main className="w-full space-y-6" style={{ maxWidth: 1080, padding: '28px 32px 60px' }}>`
— alleen `overflowY: 'auto', flex: 1, minHeight: 0` toegevoegd aan de
bestaande `style`-object, de `className` en overige stijl-eigenschappen
ongewijzigd.)

Al het bestaande JSX ná dit punt (elke `{activeTab === '...' && (...)}`-blok,
tot en met de sluitende `</main>`) blijft **volledig ongewijzigd** —
alleen de omringende container-structuur en de bijbehorende
sluit-`</div>`-tags (één extra sluit-`</div>` nodig voor de nieuwe
`flexDirection: 'column'`-wrapper rond header+main) veranderen. Zoek de
bestaande sluitstructuur (de laatste paar `</div>`'s vóór het einde van de
component) en tel de geneste divs zorgvuldig na — dit is de plek waar een
implementatiefout het makkelijkst sluipt.

- [ ] **Step 2: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Open de app in een browser (als beschikbaar in de uitvoeromgeving — zo
niet, meld dit expliciet in plaats van een visuele check te claimen).
Verwacht: sidebar en header blijven zichtbaar/vast terwijl je in een lang
tabblad (bijv. Muziekbibliotheek met veel artiesten) naar beneden scrolt —
alleen het midden-content-gebied scrolt, de rest van de pagina blijft
stilstaan. Controleer ook een kort tabblad (bijv. Instellingen) — daar
mag helemaal niet gescrold hoeven worden, precies zoals nu.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix(ui): fixed app shell — only the content area scrolls, not the whole page"
```

---

### Task 3: Backend — wachtrij- en playlist-herordenen/verwijderen

**Files:**
- Modify: `src/server/routes/playback.ts`
- Modify: `src/server/routes/playlists.ts`

**Interfaces:**
- Produces:
  - `POST /api/queue/reorder` body `{ trackId: string; toIndex: number }` → `{ success: true, queue: Track[] }`
  - `POST /api/queue/remove` body `{ trackId: string }` → `{ success: true, queue: Track[] }`
  - `POST /api/playlists/:id/tracks/reorder` body `{ trackId: string; toIndex: number }` → `{ success: true, playlist: Playlist }`

- [ ] **Step 1: Queue-routes toevoegen**

In `src/server/routes/playback.ts`, direct vóór de bestaande
`router.delete('/api/queue/clear', ...)`-route:

```ts
router.post('/api/queue/reorder', requireAudioPermission('audio:control'), (req, res) => {
  const { trackId, toIndex } = req.body || {};
  if (typeof trackId !== 'string' || typeof toIndex !== 'number') {
    return res.status(400).json({ error: 'trackId (string) en toIndex (getal) zijn verplicht' });
  }
  const queue = playbackState.queue;
  const fromIndex = queue.findIndex((t) => t.id === trackId);
  if (fromIndex === -1 || toIndex < 0 || toIndex >= queue.length) {
    return res.status(400).json({ error: 'track niet gevonden of doelindex buiten bereik' });
  }
  const [moved] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, moved);
  broadcastWebSocket({ event: 'queue_update', timestamp: Date.now(), data: { queue } });
  res.json({ success: true, queue });
});

router.post('/api/queue/remove', requireAudioPermission('audio:control'), (req, res) => {
  const { trackId } = req.body || {};
  const idx = typeof trackId === 'string' ? playbackState.queue.findIndex((t) => t.id === trackId) : -1;
  if (idx === -1) {
    return res.status(400).json({ error: 'track niet gevonden in wachtrij' });
  }
  playbackState.queue.splice(idx, 1);
  broadcastWebSocket({ event: 'queue_update', timestamp: Date.now(), data: { queue: playbackState.queue } });
  res.json({ success: true, queue: playbackState.queue });
});
```

- [ ] **Step 2: Playlist-reorder-route toevoegen**

In `src/server/routes/playlists.ts`, direct vóór de bestaande
`router.delete('/api/playlists/:id', ...)`-route:

```ts
router.post('/api/playlists/:id/tracks/reorder', requireAudioPermission('audio:control'), (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  const { trackId, toIndex } = req.body || {};
  const fromIndex = typeof trackId === 'string' ? playlist.tracks.findIndex((t: any) => t.id === trackId) : -1;
  if (fromIndex === -1 || typeof toIndex !== 'number' || toIndex < 0 || toIndex >= playlist.tracks.length) {
    return res.status(400).json({ error: 'track niet gevonden of doelindex buiten bereik' });
  }
  const [moved] = playlist.tracks.splice(fromIndex, 1);
  playlist.tracks.splice(toIndex, 0, moved);
  saveDbImportedPlaylist(playlist);
  res.json({ success: true, playlist });
});
```

- [ ] **Step 3: `npx tsc --noEmit`, tests, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm test
npm run dev
```
```bash
curl -s -X POST http://localhost:3000/api/queue/reorder -H 'Content-Type: application/json' -d '{"trackId":"x","toIndex":0}'
curl -s -X POST http://localhost:3000/api/playlists/nope/tracks/reorder -H 'Content-Type: application/json' -d '{"trackId":"x","toIndex":0}'
```
Verwacht: 0 tsc-fouten, 12/12+ tests slagen (ongewijzigd door dit backend-only
werk), beide curl-aanroepen geven `401` (geen credential meegegeven —
bevestigt dat `requireAudioPermission` actief is) of, met een geldige
sessie/API-key, een `400`/`404` voor de niet-bestaande track/playlist
(bevestigt dat de validatielogica werkt zonder te crashen).

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/playback.ts src/server/routes/playlists.ts
git commit -m "feat(queue,playlists): add reorder/remove routes"
```

---

### Task 4: Frontend — Wachtrij-tab bedienbaar maken

**Files:**
- Modify: `src/components/PlaylistManager.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `POST /api/queue/reorder`, `POST /api/queue/remove` (Task 3).
- Produces: `PlaylistManagerProps` krijgt een nieuwe optionele
  `onSelectTrackFromQueue?: (track: Track) => void`-prop (hergebruikt de
  al-bestaande `App.tsx`-functie, niet duplicereren).

- [ ] **Step 1: `onSelectTrackFromQueue` doorgeven**

In `src/App.tsx`, de bestaande `<PlaylistManager ... />`-aanroep (rond
regel 980) krijgt een extra prop:

```tsx
          <PlaylistManager
            playlists={playlists}
            currentPlaylistId={playback.currentPlaylistId}
            queue={playback.queue}
            onPlayPlaylist={handlePlayPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onAddTrackToPlaylist={handleAddTrackToPlaylist}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onAddToQueue={handleAddToQueue}
            onClearQueue={handleClearQueue}
            onSelectTrackFromQueue={handleSelectTrackFromQueue}
            onConfigureProfile={(plId) => {
              setActiveTab('advanced-audio');
            }}
          />
```

(Enige wijziging: de nieuwe `onSelectTrackFromQueue={handleSelectTrackFromQueue}`-regel
— `handleSelectTrackFromQueue` bestaat al in dit bestand, rond regel 725,
wordt nu gewoon aan een tweede component doorgegeven.)

In `src/components/PlaylistManager.tsx`, `PlaylistManagerProps` (rond
regel 33-44) krijgt de nieuwe prop:

```ts
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
```

En het bestaande destructuring-blok (rond regel 84) krijgt
`onSelectTrackFromQueue` erbij, in dezelfde stijl als de andere props.

- [ ] **Step 2: Queue-rijen klikbaar/herordenbaar/verwijderbaar maken**

De bestaande Wachtrij-tab (`activeMediaSource === 'queue'`-blok, de
`queue.map((track, idx) => (...))`-lus rond regel 1206-1236) wordt:

```tsx
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
```

Twee nieuwe handlerfuncties, in dit bestand naast de andere
`handle*`-functies (bijv. bij `handleDeleteLocalPlaylist`):

```ts
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
```

(Beide roepen geen lokale state-update aan — de wachtrij komt binnen via
de `queue`-prop, die door `App.tsx` bijgewerkt wordt zodra het
WebSocket-`queue_update`-event binnenkomt, zelfde patroon als de
bestaande `onClearQueue`. Controleer dat `App.tsx` al een handler voor
`queue_update`-WebSocket-events heeft die `playback.queue` bijwerkt — zo
niet, meld dit als een `NEEDS_CONTEXT`, want dan moet die WebSocket-listener
eerst uitgebreid worden voordat deze taak z'n doel bereikt.)

Controleer dat `ChevronUp`/`ChevronDown`/`Trash2` al geïmporteerd zijn uit
`lucide-react` in dit bestand (zeer waarschijnlijk wel, ze worden al elders
in dit bestand gebruikt — bijv. `ChevronUp`/`ChevronDown` bij
`expandedLocalPlaylistId`) — zo niet, toevoegen aan de bestaande
`lucide-react`-importregel.

- [ ] **Step 3: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Verwacht (visueel indien mogelijk, anders code-lezen + tsc/build):
klikken op een wachtrij-rij (niet op de knoppen) start die track;
omhoog/omlaag-knoppen wisselen de positie in de lijst; de eerste rij se
omhoog-knop en de laatste rij se omlaag-knop zijn uitgeschakeld (visueel
gedimd); de verwijderknop haalt een rij uit de wachtrij zonder 'm af te
spelen.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaylistManager.tsx src/App.tsx
git commit -m "feat(queue): make the Wachtrij tab playable, reorderable, removable"
```

---

### Task 5: Frontend — playlists handmatig aanmaken, herordenen, nummers toevoegen

**Files:**
- Modify: `src/components/PlaylistManager.tsx`
- Modify: `src/components/NasMusicLibrary.tsx`

**Interfaces:**
- Consumes: `onCreatePlaylist`, `onAddTrackToPlaylist` (al bestaande
  props, nu voor het eerst daadwerkelijk aangeroepen vanuit de UI),
  `POST /api/playlists/:id/tracks/reorder` (Task 3).
- Produces: `NasMusicLibraryProps` krijgt twee nieuwe optionele props:
  `playlists?: { id: string; name: string }[]` en
  `onAddTrackToPlaylist?: (playlistId: string, track: Track) => void`.

- [ ] **Step 1: "Nieuwe playlist"-knop**

In `src/components/PlaylistManager.tsx`, de kop van de "Mijn NAS
afspeellijsten"-kaart (rond regel 1071-1075, de `<div>` met
`ListMusic`-icoon en `sectionLabelStyle`-span) wordt uitgebreid met een
knop ernaast:

```tsx
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
                  const res = await fetch('/api/playlists').then((r) => r.json());
                  if (res.playlists) setLocalPlaylists(res.playlists);
                }}
              >
                Nieuwe playlist
              </Button>
            </div>
```

(Vervangt de bestaande kop-`<div>` volledig — de rest van de kaart
eronder blijft ongewijzigd. Controleer of `Plus` al uit `lucide-react`
geïmporteerd is in dit bestand — zeer waarschijnlijk wel, gebruikt in
meerdere andere knoppen — zo niet toevoegen.)

- [ ] **Step 2: Herorden-knoppen binnen een uitgeklapte playlist**

De bestaande `pl.tracks.map((track) => (...))`-lus (rond regel
1132-1148, binnen `{isExpanded && (...)}`) wordt:

```tsx
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
```

Nieuwe handlerfunctie naast `handleRemoveLocalTrack`:

```ts
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
```

- [ ] **Step 3: "Toevoegen aan playlist" op songrijen in de muziekbibliotheek**

In `src/components/NasMusicLibrary.tsx`, `NasMusicLibraryProps` krijgt
twee nieuwe optionele props:

```ts
interface NasMusicLibraryProps {
  onAddToQueue: (track: Track) => void;
  playlists?: { id: string; name: string }[];
  onAddTrackToPlaylist?: (playlistId: string, track: Track) => void;
}
```

En de component-declaratie:

```ts
export const NasMusicLibrary: React.FC<NasMusicLibraryProps> = ({ onAddToQueue, playlists, onAddTrackToPlaylist }) => {
```

In de songrij (de `visibleSongs.map((song) => (...))`-lus, de knoppenrij
met Play/Plus), een derde knop toevoegen die — als er playlists zijn —
een simpele `<select>` toont waarmee direct een playlist gekozen wordt (geen
apart dropdown-component nodig, de kleinste werkende versie):

```tsx
                  {playlists && playlists.length > 0 && onAddTrackToPlaylist && (
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        onAddTrackToPlaylist(e.target.value, {
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
                        e.target.value = '';
                      }}
                      title="Toevoegen aan playlist"
                      value=""
                      style={{ font: 'var(--text-mono-sm)', fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '2px 4px', maxWidth: 90 }}
                    >
                      <option value="">+ Playlist</option>
                      {playlists.map((pl) => (
                        <option key={pl.id} value={pl.id}>{pl.name}</option>
                      ))}
                    </select>
                  )}
```

(Deze `<select>` invoegen direct ná de bestaande "Voeg toe aan
wachtrij"-knop, binnen dezelfde knoppenrij-`<div>` die al
`onClick={(e) => e.stopPropagation()}` heeft van de eerdere
detailweergave-taak — de nieuwe `<select>` erft die al, maar heeft ook
zijn eigen `stopPropagation` nodig op de `onClick` omdat een `<select>`
zijn eigen click-gedrag heeft dat anders alsnog kan doorborrelen op sommige
browsers; dit is expres dubbel-beveiligd.)

De bouwlogica voor het `Track`-object is exact hetzelfde patroon als de
bestaande `handleQueueSong`-functie in dit bestand — hergebruik die
functie in plaats van 'm te dupliceren als dat eenvoudiger is
(`onAddTrackToPlaylist(playlistId, { ...zelfde object dat handleQueueSong al bouwt... })`);
kijk naar de exacte huidige vorm van `handleQueueSong` voordat je dit
schrijft en pas het bovenstaande aan als de velden daar afwijken van wat
hierboven staat.

- [ ] **Step 4: Props doorgeven vanuit `PlaylistManager.tsx`**

De bestaande `<NasMusicLibrary onAddToQueue={onAddToQueue} />`-aanroep
(rond regel 1173) wordt:

```tsx
            <NasMusicLibrary
              onAddToQueue={onAddToQueue}
              playlists={localPlaylists.map((pl) => ({ id: pl.id, name: pl.name }))}
              onAddTrackToPlaylist={onAddTrackToPlaylist}
            />
```

- [ ] **Step 5: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Verwacht (visueel indien mogelijk, anders code-lezen + tsc/build): "Nieuwe
playlist"-knop maakt een lege playlist aan die meteen in de lijst
verschijnt; binnen een uitgeklapte playlist wisselen omhoog/omlaag-knoppen
de volgorde; in de muziekbibliotheek verschijnt een klein
playlist-keuzemenu per songrij zodra er minstens één playlist bestaat, en
kiezen voegt de song toe (zichtbaar via het bijgewerkte `trackCount` in de
playlistkaart).

- [ ] **Step 6: Commit**

```bash
git add src/components/PlaylistManager.tsx src/components/NasMusicLibrary.tsx
git commit -m "feat(playlists): manual create/reorder, add tracks from the music library"
```

---

### Task 6: Backend — Catalogic on-demand aanmaken (Spotify-backed)

**Files:**
- Modify: `src/services/catalogicClient.ts`
- Modify: `src/server/routes/nas-library.ts`

**Interfaces:**
- Consumes: `readLocalTags` (bestaand, `localTrackMetadata.ts`),
  `fetchCatalogicArtwork` (bestaand, intern in `catalogicClient.ts` —
  controleer of 'ie al geëxporteerd is; zo niet, exporteren voor
  hergebruik hier).
- Produces: `lookupOrCreateCatalogicSong(title, artist): Promise<CatalogicCreatedSong | undefined>`,
  `POST /api/nas/library/create-from-catalogic` body `{ path: string }` →
  `{ success: true, song: {...}, artistArtworkUrl: string|null, albumArtworkUrl: string|null }`.

- [ ] **Step 1: `lookupOrCreateCatalogicSong` toevoegen**

Aan het einde van `src/services/catalogicClient.ts`:

```ts
export interface CatalogicCreatedSong {
  songId: string;
  artistId: string | null;
  albumId: string | null;
  source: 'catalogic' | 'spotify';
}

/**
 * Onderscheidt zich van lookupCatalogicSong: dit MAG een nieuwe song (en
 * de bijbehorende artiest/album) aanmaken via Spotify als Catalogic 'm nog
 * niet kent (GET /v1/songs/lookup?create_if_missing=true, geverifieerd
 * tegen de live routebroncode — catalogic/src/routes/songs-lookup.ts).
 * Alleen aanroepen vanuit een expliciete gebruikersactie (een klik op
 * "aanmaken"), nooit vanuit automatische achtergrond-matching — zie het
 * ontwerpdocument voor de afweging.
 */
export async function lookupOrCreateCatalogicSong(title: string, artist: string): Promise<CatalogicCreatedSong | undefined> {
  if (!config.enabled || !title.trim() || !artist.trim()) return undefined;
  const url = `${config.url}/v1/songs/lookup?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&create_if_missing=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { source: 'catalogic' | 'spotify'; song: { id: string; primaryArtistId: string | null; primaryAlbumId: string | null } };
    return { songId: body.song.id, artistId: body.song.primaryArtistId, albumId: body.song.primaryAlbumId, source: body.source };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
```

Controleer of `fetchCatalogicArtwork` momenteel `function
fetchCatalogicArtwork(...)` (niet-geëxporteerd) of `export async function
fetchCatalogicArtwork(...)` is. Als 'ie niet geëxporteerd is, voeg
`export` toe aan de bestaande functiedeclaratie (geen andere wijziging aan
die functie) — Step 2 hieronder heeft 'm nodig.

- [ ] **Step 2: `POST /api/nas/library/create-from-catalogic` toevoegen**

Importuitbreiding bovenaan `src/server/routes/nas-library.ts`:

```ts
import { lookupCatalogicArtist, lookupCatalogicAlbum, lookupCatalogicLyrics, lookupOrCreateCatalogicSong, fetchCatalogicArtwork } from '../../services/catalogicClient.ts';
import { readLocalTags } from '../../services/localTrackMetadata.ts';
```

(Controleer of `readLocalTags` de exacte functienaam is in
`localTrackMetadata.ts` — pas aan indien anders.)

Nieuwe route, vlak vóór `export default router;`:

```ts
router.post('/api/nas/library/create-from-catalogic', async (req, res) => {
  const filePath = validateWithinNasShares(req.body?.path);
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'invalid path' });
  }
  try {
    const tags = await readLocalTags(filePath);
    const title = tags?.title || path.basename(filePath, path.extname(filePath));
    const artist = tags?.artist;
    if (!artist) {
      return res.json({ success: false, error: 'geen artiestnaam bekend voor dit bestand' });
    }
    const created = await lookupOrCreateCatalogicSong(title, artist);
    if (!created) {
      return res.json({ success: false, error: 'Catalogic niet bereikbaar of geen resultaat' });
    }

    upsertDbNasLibraryEntry({
      filePath,
      title,
      artist,
      album: tags?.album || '',
      fileSize: 0,
      mtimeMs: 0,
      catalogicSongId: created.songId,
      matchConfidence: 'created',
    });

    let artistArtworkUrl: string | null = null;
    let albumArtworkUrl: string | null = null;
    if (created.artistId) {
      artistArtworkUrl = await fetchCatalogicArtwork('artist', created.artistId);
    }
    if (created.albumId) {
      albumArtworkUrl = await fetchCatalogicArtwork('album', created.albumId);
    }

    res.json({ success: true, song: created, artistArtworkUrl, albumArtworkUrl });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
```

**Let op**: `upsertDbNasLibraryEntry` vereist normaliter een echte
`fileSize`/`mtimeMs` (voor de wijzigingsdetectie bij een volgende scan) —
hier `0` meegeven is een bewuste, kleine afwijking (dit pad wordt
opgeroepen buiten de normale scan/browse-flow om, puur om de
`catalogic_song_id` vast te leggen). Een latere browse/scan van hetzelfde
bestand overschrijft deze rij toch met de echte `fileSize`/`mtimeMs` zodra
`resolveLocalTrack` 'm weer tegenkomt, dus dit veroorzaakt geen blijvend
probleem — alleen worden `fileSize`/`mtimeMs` tijdelijk `0` totdat dat
gebeurt. Als tijdens implementatie blijkt dat `upsertDbNasLibraryEntry`
hier problemen mee geeft (bijv. een niet-nullable check), gebruik dan
`fs.statSync(filePath)` om de echte waarden op te halen in plaats van `0`
mee te geven — geef in het rapport aan welke van de twee benaderingen
uiteindelijk gebruikt is.

- [ ] **Step 3: `npx tsc --noEmit`, tests, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm test
npm run dev
```
```bash
curl -s -X POST http://localhost:3000/api/nas/library/create-from-catalogic -H 'Content-Type: application/json' -d '{"path":"/etc"}'
```
Verwacht: 0 tsc-fouten, 12/12+ tests slagen; de curl-aanroep met `/etc`
geeft een `400 invalid path` terug (path-validatie werkt), en de
server blijft daarna gewoon bereikbaar (`curl .../api/status` → 200).

- [ ] **Step 4: Commit**

```bash
git add src/services/catalogicClient.ts src/server/routes/nas-library.ts
git commit -m "feat(nas): add on-demand Catalogic song/artist/album creation route"
```

---

### Task 7: Frontend — "Vraag Catalogic dit aan te maken"-knop

**Files:**
- Modify: `src/components/NasMusicLibrary.tsx`

**Interfaces:**
- Consumes: `POST /api/nas/library/create-from-catalogic` (Task 6).
- Produces: geen nieuwe exports — interne UI-toevoeging.

- [ ] **Step 1: Knop toevoegen aan het song-detailpaneel**

In de bestaande detailmodal (het `{selectedSong && (...)}`-blok, de
pill-rij met "Lyrics"/"Catalogic-match"), een derde conditionele knop
toevoegen die alleen verschijnt als de song NOG NIET gematcht is
(`!selectedSong.catalogicSongId`):

```tsx
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {selectedSong.hasLyrics && <Pill label="Lyrics" onClick={() => openLyrics(selectedSong)} />}
                {selectedSong.catalogicSongId && <Pill label="Catalogic-match" />}
                {!selectedSong.catalogicSongId && (
                  <Pill
                    label={creatingCatalogicEntry ? 'Bezig…' : 'Vraag Catalogic dit aan te maken'}
                    onClick={creatingCatalogicEntry ? undefined : () => handleCreateFromCatalogic(selectedSong)}
                  />
                )}
              </div>
```

Nieuwe state (bij de andere `useState`-declaraties):

```ts
  const [creatingCatalogicEntry, setCreatingCatalogicEntry] = useState(false);
```

Nieuwe handlerfunctie (vóór de `return`):

```ts
  const handleCreateFromCatalogic = async (song: LibrarySong) => {
    setCreatingCatalogicEntry(true);
    try {
      const res = await fetch('/api/nas/library/create-from-catalogic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: song.path }),
      }).then((r) => r.json());
      if (res.success) {
        setSongs((prev) => prev.map((s) => (s.path === song.path ? { ...s, catalogicSongId: res.song.songId } : s)));
        setSelectedSong((prev) => (prev && prev.path === song.path ? { ...prev, catalogicSongId: res.song.songId } : prev));
        // Herlaad de albumlijst zodat een nieuw-aangemaakte albumhoes
        // meteen zichtbaar wordt, zonder losse per-veld state-merging te
        // hoeven bouwen — zelfde pragmatische aanpak als elders in dit
        // bestand na een muterende actie.
        if (currentArtistPath) {
          const albumsRes = await fetch(`/api/nas/library/albums?artistPath=${encodeURIComponent(currentArtistPath)}`).then((r) => r.json());
          if (albumsRes.albums) setAlbums(albumsRes.albums);
        }
      } else {
        alert(res.error || 'Aanmaken via Catalogic is niet gelukt.');
      }
    } catch (e) {
      alert('Aanmaken via Catalogic is niet gelukt.');
    } finally {
      setCreatingCatalogicEntry(false);
    }
  };
```

(`currentArtistPath` bestaat al als state in dit bestand — gebruikt om de
albumlijst van de huidige artiest opnieuw op te halen na een succesvolle
aanmaak, zodat een eventuele nieuwe albumhoes verschijnt. De artiestenlijst
zelf wordt hier bewust niet herladen — dat zou de gebruiker uit de huidige
album/song-navigatie terugzetten naar het artiestenoverzicht, wat een
storender ervaring is dan een albumhoes die pas bij de volgende keer
terugkomen naar dit scherm verschijnt.)

- [ ] **Step 2: `npx tsc --noEmit`, build, handmatig verifiëren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
npx tsc --noEmit
npm run build
npm run dev
```
Verwacht (visueel indien mogelijk, anders code-lezen + tsc/build): een
niet-gematchte song se detailpaneel toont "Vraag Catalogic dit aan te
maken"; klikken toont "Bezig…" en daarna verdwijnt de knop zodra de song
gematcht is (vervangen door de normale "Catalogic-match"-pill bij een
volgende keer openen van het paneel).

- [ ] **Step 3: Commit**

```bash
git add src/components/NasMusicLibrary.tsx
git commit -m "feat(nas): add manual 'ask Catalogic to create this' action for unmatched songs"
```

---

## Self-Review

**Spec coverage:**
- §1 Systeemmappen filteren → Task 1. ✅
- §2 Vaste app-shell → Task 2. ✅
- §3 Wachtrij starten/herordenen/verwijderen → Tasks 3 (backend), 4 (frontend). ✅
- §4 Playlists handmatig beheren → Tasks 3 (backend reorder), 5 (frontend — grotendeels hergebruik van al-bestaande, ongebruikte backend-plumbing, zoals vastgesteld tijdens het schrijven van dit plan). ✅
- §5 Catalogic on-demand aanmaken → Tasks 6 (backend), 7 (frontend). ✅

**Placeholder scan:** geen "TBD"/"later"/"voeg foutafhandeling toe" —
elke stap bevat volledige code of een concrete, uitvoerbare
verificatie-opdracht. Task 2 en Task 6 bevatten expliciete
"lees eerst de huidige code, want de exacte vorm kan iets afwijken"-instructies
in plaats van aangenomen regelnummers — dat is bewust (beide taken raken
code die sinds het schrijven van dit plan al een keer gewijzigd kan zijn),
geen placeholder.

**Type consistency:** `isSystemDirectory` (Task 1) wordt in Tasks 1 zelf
op vier plekken consistent aangeroepen. `POST /api/queue/reorder`/`remove`
(Task 3) en hun frontend-aanroepen (Task 4) gebruiken hetzelfde
`{trackId, toIndex}`/`{trackId}`-lichaam. `POST
/api/playlists/:id/tracks/reorder` (Task 3) en zijn frontend-aanroep
(Task 5) idem. `lookupOrCreateCatalogicSong`'s returnvorm (Task 6,
`CatalogicCreatedSong | undefined`) wordt in Task 6's eigen route correct
behandeld (`undefined` → foutrespons, niet cachen als "geen match" — er
wordt hier ook geen `checked_at`-stijl cache geschreven voor dit pad, dus
die valkuil is hier niet van toepassing). `LibrarySong.catalogicSongId`
(al aanwezig van een eerdere batch) wordt in Task 7 correct gebruikt om te
bepalen of de aanmaak-knop getoond wordt.
