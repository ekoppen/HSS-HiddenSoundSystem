# NAS-verkenner opschonen, wachtrij bedienen, playlists beheren, Catalogic on-demand aanmaken

Datum: 2026-08-23

## Aanleiding

Vijf punten, verzameld via directe feedback op de net gedeployde
muziekbibliotheek, en verder onderzocht voordat dit ontwerp geschreven
is (autonoom uitgevoerd — gebruiker heeft expliciet gedelegeerd:
"ga door en maak het zoals je denkt dat goed is"):

1. Systeemmappen als `@eaDir` (Synology-thumbnailcache) verschijnen als
   nep-artiesten/albums/bestanden in zowel de rauwe verkenner als de
   muziekbibliotheek — nergens wordt op mapnaam gefilterd.
2. De hele pagina scrolt (sidebar en header schuiven mee) zodra een
   tabblad hoger is dan het scherm — er is geen vaste app-shell met een
   los scrollend inhoudsgebied.
3. De wachtrij ("Wachtrij"-tab) is puur lezen: geen volgorde wijzigen,
   geen los nummer verwijderen, en de enige manier om 'm te starten zit
   verstopt in een 3-item-preview op het Now Playing-scherm, niet in de
   Wachtrij-tab zelf.
4. Handmatig playlists samenstellen (nummers één voor één toevoegen,
   volgorde bepalen, weer verwijderen) kan niet vanuit de HSS-UI — wel
   bestaat de volledige backend-CRUD hiervoor al (`src/server/routes/playlists.ts`),
   kennelijk gebouwd voor externe apps (zoals gebruikers eigen "Listener"-app,
   die dezelfde API al gebruikt) maar nooit in HSS zelf ontsloten.
5. Artiesten/albums/songs die Catalogic nog niet kent, blijven voor
   altijd ongematcht — HSS's lookup-functies zoeken alleen in Catalogic's
   bestaande catalogus (`GET /v1/search`), nooit met een aanmaak-fallback.
   Catalogic heeft die aanmaak-fallback wel (`GET /v1/songs/lookup?create_if_missing=true`,
   haalt de track op via Spotify en maakt song+artiest+album aan) — de
   gebruikers eigen "Listener"-app gebruikt dit exact zo al in productie.

## Beslissing over punt 5 (herziet een eerdere, bewuste keuze)

Eerder deze sessie is expliciet gekozen: de bibliotheekscan-backlog mag
Catalogic **alleen laten matchen, nooit laten aanmaken** — automatische,
achtergrond-matching van ruwe bestandsnamen/mapnamen zou de gedeelde
catalogus met giswerk kunnen vervuilen. Die zorg staat nog steeds
overeind voor **automatische** matching (de volledige-bibliotheekscan,
`/api/nas/enrich`, de artiest/album-verrijking bij bladeren) — die
blijven ongewijzigd match-only.

Wat nu wél toegevoegd wordt is een **losse, expliciete, per-item actie**:
een knop bij een niet-gematchte artiest/album/song in de
muziekbibliotheek-UI — "Vraag Catalogic dit aan te maken". Dit is
precies het gebruik waarvoor Catalogic's eigen route bedoeld is: de
routedocumentatie zelf zegt letterlijk dat `/lookup` (met
`create_if_missing`) bedoeld is voor aanroepen met "echte gebruikersintentie",
in tegenstelling tot de achtergrond-matcher (`matchSongByTitleArtist`,
gedeeld met de backlog-job) die *nooit* mag aanmaken op een gok. Een
expliciete klik van de gebruiker op één specifiek, zichtbaar item is
precies dat soort intentie. Dit is dus geen ongedaanmaking van de
eerdere keuze, maar een aparte, bewust begrensde aanvulling ernaast.

## 1. Systeemmappen filteren

Nieuwe gedeelde helper, naast `isAudioFile` in
`src/services/localTrackMetadata.ts`:

```ts
const SYSTEM_DIR_NAMES = new Set([
  '@eaDir',       // Synology thumbnail-/metadatacache, per map
  '@tmp',         // Synology tijdelijke map tijdens bestandsbewerkingen
  '#recycle',     // Synology prullenbak (netwerkgedeeld zichtbaar)
  '#snapshot',    // Synology snapshot-map
  '.streams',     // QNAP thumbnail-/streamingcache
  '@Recycle',     // QNAP prullenbak
  '.DS_Store',    // macOS (bestand, geen map, maar toch uitsluiten voor de zekerheid)
]);

export function isSystemDirectory(name: string): boolean {
  return SYSTEM_DIR_NAMES.has(name) || name.startsWith('.');
}
```

(De laatste regel — alles wat met een punt begint — vangt ook overige
verborgen mappen op zonder elke NAS-leverancier apart te hoeven kennen;
een normale artiest/album/songmap begint nooit met een punt.)

Toepassen op elke plek die nu al `.isDirectory()` filtert zonder
naamcontrole:

- `src/server/routes/nas.ts`: `GET /api/nas/browse` (regel ~140-141,
  filtert de hele listing, niet alleen mappen — audio wordt al apart
  herkend, dus hier alleen mappen met `isSystemDirectory` uitsluiten).
  `POST /api/nas/play-folder`/`POST /api/nas/create-playlist` hoeven
  niet aangepast — die zijn niet-recursief en filteren toch al op
  losse audiobestanden binnen de opgegeven map (`!item.isDirectory() &&
  isAudioFile(item.name)`), dus een `@eaDir`-submap wordt daar sowieso
  nooit ingelopen.
- `src/server/routes/nas-library.ts`: `GET /api/nas/library/artists`
  (regel 35, top-level mapfilter — hier is de impact het grootst, een
  `@eaDir` op share-root-niveau verschijnt nu als nep-artiest), `GET
  /api/nas/library/albums` (regel 122, submappen-als-albums-filter), en
  `walkAudioFilesFlat` (regel ~222-228, sla een systeemmap over in
  plaats van erin te recursen).
- `src/services/nasLibraryScan.ts`: de recursieve `walkAudioFiles`
  (regel ~100-106) — zelfde reden, voorkomt dat de volledige scan tijd
  verspilt aan het inlopen van elke `@eaDir`.

## 2. Vaste app-shell, alleen het inhoudsgebied scrolt

`src/App.tsx`'s hoofdstructuur (rond regel 880-935) wordt herzien van
"hele document scrolt" naar "sidebar en header blijven vast, alleen
`<main>` scrolt":

```tsx
<div
  className="flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200"
  style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', height: '100vh', overflow: 'hidden' }}
>
  <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
    <Sidebar ... />
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ ...bestaande stijl..., flexShrink: 0 }}>
        ...
      </header>
      <main className="w-full space-y-6" style={{ maxWidth: 1080, padding: '28px 32px 60px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        ...bestaande tab-content, ongewijzigd...
      </main>
    </div>
  </div>
</div>
```

Kernwijziging: `min-h-screen` → `height: '100vh', overflow: 'hidden'` op
de buitenste div, `minHeight: 0` op elke geneste flex-container
(noodzakelijk in CSS flexbox om een kind daadwerkelijk te laten krimpen
in plaats van zijn inhoud te laten overflowen naar de pagina), en
`overflowY: 'auto', flex: 1` op `<main>` zelf. `Sidebar` en `header`
blijven ongewijzigd in opmaak, ze krijgen alleen `flexShrink: 0`
respectievelijk staan al buiten het scrollende gedeelte.

Geen wijziging aan losse tab-componenten nodig — ze renderen precies
zoals nu, alleen het buitenste scroll-gedrag verandert.

## 3. Wachtrij: starten vanuit de Wachtrij-tab, volgorde wijzigen, los verwijderen

**Bestaand, hergebruikt**: `POST /api/queue/play` (al aanwezig,
`playback.ts:238` — body `{ trackId }`, zoekt de track op in
`playbackState.queue` via `findIndex`, haalt 'm uit de wachtrij en
speelt 'm af) en `App.tsx:725`'s `handleSelectTrackFromQueue` (nu alleen
doorgegeven aan `NowPlaying`'s 3-item-preview). Simpelweg diezelfde
al-bestaande handler ook doorgeven aan de volledige Wachtrij-tab-lijst
(`PlaylistManager.tsx`, regel ~1180-1249) lost het "waar start ik de
wachtrij"-probleem al grotendeels op zonder nieuwe backend-code — de
functie hoeft niet gedupliceerd te worden, alleen als prop doorgegeven
aan `PlaylistManager` net zoals 'ie al aan `NowPlaying` doorgegeven
wordt.

**Nieuw — twee backend-routes** in `src/server/routes/playback.ts`
(naast de bestaande `add`/`play`/`clear` op regel 221, 238, 269 — zelfde
`requireAudioPermission('audio:control')`-gate en
`broadcastWebSocket({ event: 'queue_update', ... })`-patroon als de
bestaande `clear`-route op regel 269, voor consistentie met hoe deze
drie routes al werken; en trackId-gebaseerd net als de bestaande `play`-route,
niet index-gebaseerd, om dezelfde "zoek de eerste track met dit id"-conventie
te volgen die `/play` al gebruikt):

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
  const idx = playbackState.queue.findIndex((t) => t.id === trackId);
  if (typeof trackId !== 'string' || idx === -1) {
    return res.status(400).json({ error: 'track niet gevonden in wachtrij' });
  }
  playbackState.queue.splice(idx, 1);
  broadcastWebSocket({ event: 'queue_update', timestamp: Date.now(), data: { queue: playbackState.queue } });
  res.json({ success: true, queue: playbackState.queue });
});
```

**Frontend** (`PlaylistManager.tsx`'s Wachtrij-tab): elke rij krijgt
- een klik (niet op de knoppen) → dezelfde `onSelectTrackFromQueue`-prop
  die `NowPlaying` al gebruikt, nu ook doorgegeven aan
  `PlaylistManager`;
- omhoog/omlaag-knoppen (geen drag-and-drop — er bestaat nergens in deze
  codebase al een drag-patroon, en twee kleine knoppen per rij is de
  luie, robuuste versie die op een touchscreen/kiosk ook gewoon werkt)
  die `POST /api/queue/reorder` aanroepen met het track-id en de
  doel-index (huidige index ± 1);
- een verwijderknop per rij → `POST /api/queue/remove` met het
  track-id.

## 4. Playlists handmatig beheren (backend bestaat al, alleen UI ontbreekt)

`src/server/routes/playlists.ts` heeft al volledige CRUD, en — belangrijk
detail, geverifieerd tegen de broncode — dit is GEEN los systeem naast
de "maak playlist van map"-actie: beide gebruiken dezelfde
`saveDbImportedPlaylist`/`getDbImportedPlaylists`/`deleteDbImportedPlaylist`-functies
en dezelfde opslag (`db.ts:713-774`). `POST /api/playlists`
(aanmaken, lege `tracks`-array als geen `tracks` wordt meegegeven),
`POST /api/playlists/:id/tracks` (body `{ track }`, pusht 'm op de
bestaande array en herschrijft de hele playlist), `DELETE
/api/playlists/:id/tracks/:trackId` (filtert 'm eruit, herschrijft),
`DELETE /api/playlists/:id`. Alleen `GET /api/playlists` wordt
momenteel ergens in HSS zelf aangeroepen (`NestHubCastView.tsx:465`,
alleen-lezen).

`playlist.tracks` is gewoon een array op het opgeslagen object — geen
aparte volgorde-kolom — dus "volgorde wijzigen" is net zo simpel als de
array herschikken en opnieuw opslaan. Nieuwe route, zelfde
`splice`-patroon als `/api/queue/reorder` (§3):

```ts
router.post('/api/playlists/:id/tracks/reorder', requireAudioPermission('audio:control'), (req, res) => {
  const playlist = getDbImportedPlaylists().find((p) => p.id === req.params.id);
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  const { trackId, toIndex } = req.body || {};
  const fromIndex = playlist.tracks.findIndex((t: any) => t.id === trackId);
  if (typeof toIndex !== 'number' || fromIndex === -1 || toIndex < 0 || toIndex >= playlist.tracks.length) {
    return res.status(400).json({ error: 'track niet gevonden of doelindex buiten bereik' });
  }
  const [moved] = playlist.tracks.splice(fromIndex, 1);
  playlist.tracks.splice(toIndex, 0, moved);
  saveDbImportedPlaylist(playlist);
  res.json({ success: true, playlist });
});
```

Nieuw frontend-gedeelte in `PlaylistManager.tsx` (of een nieuw
`ManualPlaylists.tsx`-subcomponent, zelfde afweging als de
Muziekbibliotheek destijds — apart bestand omdat het een eigen,
losstaand stuk state/UI is):

- "Nieuwe playlist"-knop → naam-prompt → `POST /api/playlists`.
- Per playlist: een songlijst met omhoog/omlaag-knoppen (→
  `POST /api/playlists/:id/tracks/reorder`, hierboven), een
  verwijderknop per nummer (`DELETE /api/playlists/:id/tracks/:trackId`)
  en een playlist-verwijderknop (`DELETE /api/playlists/:id`).
- "Toevoegen aan playlist"-knop op bestaande songrijen (de
  muziekbibliotheek se songlijst, `NasMusicLibrary.tsx`, en de rauwe
  verkenner) — een dropdown/kleine kiezer met de bestaande playlists,
  roept `POST /api/playlists/:id/tracks` aan met de aangeklikte song.

## 5. Catalogic on-demand laten aanmaken (per item, expliciete actie)

**Nieuwe `catalogicClient.ts`-functie**, naast de bestaande
`lookupCatalogicArtist`/`lookupCatalogicAlbum`/andere lookups — zelfde
best-effort-stijl, maar met `create_if_missing=true`:

```ts
export interface CatalogicCreatedSong {
  songId: string;
  artistId: string | null;
  albumId: string | null;
  source: 'catalogic' | 'spotify';
}

/**
 * Onderscheidt zich van lookupCatalogicSong: dit MAG een nieuwe song
 * (en de bijbehorende artiest/album) aanmaken via Spotify als Catalogic
 * 'm nog niet kent — alleen aanroepen vanuit een expliciete
 * gebruikersactie (een klik op "aanmaken"), nooit vanuit automatische
 * achtergrond-matching. Zie het ontwerpdocument voor de afweging.
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

**Nieuwe route** `POST /api/nas/library/create-from-catalogic` in
`nas-library.ts` — body `{ path: string }` (een songbestand-pad,
gevalideerd via `validateWithinNasShares` zoals elke andere route in dit
bestand):

1. Lokale tags lezen (`readLocalTags`, bestaand in
   `localTrackMetadata.ts`) voor titel/artiest.
2. `lookupOrCreateCatalogicSong(title, artist)` aanroepen.
3. Bij succes: `nas_library_index`-rij bijwerken met de nieuwe
   `catalogic_song_id`/`match_confidence: 'created'` (nieuwe waarde,
   onderscheidt zich van een gewone match zodat de UI eventueel ooit een
   "via Spotify aangemaakt"-indicator kan tonen — niet verplicht in deze
   iteratie).
4. **Cruciaal**: de bijbehorende `nas_artist_index`/`nas_album_index`-rijen
   (indien aanwezig, `checked_at IS NOT NULL` van een eerdere
   "geen match"-poging) forceren te verversen — anders blijft de
   artiest/albumhoes leeg terwijl de song zelf nu wel gematcht is. Dit
   is de enige plek in deze hele feature waar een `checked_at`-cache
   bewust wordt overschreven in plaats van met rust gelaten — gerichte
   uitzondering voor exact dit scenario (een expliciete
   aanmaak-actie heeft de garantie dat de artiest/album nu een geldige
   Catalogic-id heeft, via `lookupOrCreateCatalogicSong`'s
   `artistId`/`albumId`), niet een generieke her-verificatiepolicy.
   Roept `lookupCatalogicArtist`/`lookupCatalogicAlbum` opnieuw aan (of,
   goedkoper: schrijft direct `catalogic_artist_id`/`catalogic_album_id`
   plus haalt de artwork op via `fetchCatalogicArtwork` met de
   `artistId`/`albumId` die net teruggekomen zijn — geen tweede
   zoekopdracht nodig, de ID's zijn al bekend).

**Frontend**: in `NasMusicLibrary.tsx`, op een niet-gematchte song (geen
`catalogicSongId`) in de songlijst/detailweergave, een knop "Vraag
Catalogic dit aan te maken" — bij succes de artiest-/album-/songlijsten
in de huidige view verversen (opnieuw `loadArtists`/`openArtist`/
`openAlbum` aanroepen, simpelste manier om de nieuw-opgehaalde artwork
meteen te tonen zonder losse per-veld state-merging te bouwen).

## Wat NIET in deze iteratie zit

- Geen wijziging aan de automatische matchpaden (volledige scan,
  `/api/nas/enrich`, artiest/album-verrijking bij bladeren) — die
  blijven allemaal match-only, zoals eerder bewust gekozen.
- Geen drag-and-drop voor wachtrij/playlist-volgorde — omhoog/omlaag-
  knoppen zijn de luie, robuuste versie.
- Geen "aanmaken" voor artiesten/albums los van een song — Catalogic
  se eigen aanmaak-mechanisme werkt alleen via song-lookup (een
  song-aanmaak cascadeert naar artiest+album, er bestaat geen losse
  artiest/album-aanmaakroute in Catalogic).
- Geen automatische her-verificatie van eerder "geen match"-gecachete
  artiesten/albums — alleen de gerichte uitzondering in §5 wanneer een
  song-aanmaakactie een geldige artiest-/album-ID teruggeeft.
