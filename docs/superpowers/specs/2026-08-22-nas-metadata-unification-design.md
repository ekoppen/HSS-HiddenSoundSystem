# NAS-metadata: één bron van waarheid (nas_library_index) i.p.v. twee losse caches

Datum: 2026-08-22

## Aanleiding

Tijdens live debuggen van de Catalogic-koppeling (zie
`2026-08-22-nas-catalogic-backlog-design.md`) bleek dat een verkeerde
albumhoes (Elvis Costello i.p.v. ABBA) permanent bleef hangen, ook na een
nieuwe scan, ook na een codefix van de onderliggende matching-bug. Oorzaak:
HSS heeft momenteel **twee gescheiden, niet-communicerende opslagplekken**
voor NAS-bestandsmetadata:

1. **`nas_library_index`** — gevuld door de bibliotheek-scan
   (`nasLibraryScan.ts`). Heeft wél wijzigingsdetectie (`file_size`/
   `mtime_ms`-vergelijking, slaat ongewijzigde bestanden over), maar wordt
   **nergens gebruikt om iets te tonen** in de bestandenverkenner.
2. **`artwork_cache`** (gedeeld met Spotify) — hier haalt de verkenner
   titel/artiest/albumhoes daadwerkelijk vandaan. Gevuld lazy, de eerste
   keer dat een bestand gebrowset/afgespeeld wordt. **Geen enkele
   houdbaarheidscheck**: eenmaal gecached, blijft het voor altijd staan,
   ook als het fout was of het bestand verandert.

Dit ontwerp voegt beide samen tot één systeem, met de wijzigingsdetectie die
`nas_library_index` al had, overal toegepast — precies de vraag die de
gebruiker stelde: "verwerkt HiddenSound de gegevens naar de eigen db bij
het scannen, en overschrijft pas bij wijzigingen?"

## Doel

- Eén bron van waarheid: `nas_library_index`.
- Wijzigingsdetectie (grootte/mtime) geldt overal, niet alleen tijdens een
  volledige scan.
- Browsen/afspelen van een bestand dat nog nooit gezien is, schrijft dat
  bestand meteen weg (lazy write-on-first-encounter) — een volledige scan
  is daarna alleen nog nodig om bestanden te vinden die nooit bekeken zijn.
- `artwork_cache` (en zijn Spotify-gebruik in `spotify.ts`) blijft
  volledig ongemoeid — die tabel is gedeeld en dit ontwerp raakt alleen het
  NAS-gebruik ervan.

## Bestaande bouwstenen die hergebruikt worden

- `nas_library_index`-schema en `upsertDbNasLibraryEntry`/
  `getDbNasLibraryEntry` (db.ts) — al aanwezig, krijgt één nieuwe kolom.
- De wijzigingsdetectie-logica (`file_size`/`mtime_ms`-vergelijking, plus
  de eerdere fix die een `playable=0`-rij altijd opnieuw probeert) — leeft
  al in `nasLibraryScan.ts`'s scan-worker, wordt gegeneraliseerd.
- `readLocalTags`/`isAudioFile` (`localTrackMetadata.ts`) — puur,
  netwerkloos, blijven ongewijzigd herbruikt.
- `lookupCatalogicSong` (`catalogicClient.ts`) — ongewijzigd herbruikt.

## Nieuwe gedeelde functie

`resolveLocalTrack(filePath: string, opts: { allowCatalogicLookup: boolean }): Promise<Track & { playable: boolean }>`,
in `src/services/nasLibraryScan.ts` (zelfde bestand als de bestaande
wijzigingsdetectie en `upsertDbNasLibraryEntry`-aanroepen — "bestanden die
samen wijzigen, wonen samen"):

1. `fs.statSync(filePath)` → grootte + mtime.
2. `getDbNasLibraryEntry(filePath)` opvragen. Bestaat de rij, is
   `playable !== 0`, en zijn grootte/mtime ongewijzigd? → bouw een `Track`
   direct uit die rij, geen herlezing, geen netwerk.
3. Anders (nieuw bestand, gewijzigd bestand, of eerder als onspeelbaar
   gemarkeerd): `readLocalTags(filePath)`; als
   `opts.allowCatalogicLookup`, ook `lookupCatalogicSong(tags.title,
   tags.artist)` voor canonieke albumhoes/duur; `upsertDbNasLibraryEntry`
   met alles (title/artist/album/fileSize/mtimeMs/playable/
   catalogicSongId/matchConfidence/artworkUrl/durationMs); bouw en
   retourneer de resulterende `Track`.

Fallback-cover blijft de bestaande placeholder-URL wanneer er geen
Catalogic-match is; `Track`-velden (bitrate/sampleRate/bitDepth/uri) worden
op dezelfde manier afgeleid uit het bestandspad als nu al gebeurt in
`toTrack()` (hi-res-extensies-lijst ongewijzigd).

## Routewijzigingen (`src/server/routes/nas.ts`)

Alle vijf plekken die nu `peekLocalTrack`/`buildLocalTrack`/
`enrichLocalFiles` gebruiken, gaan naar `resolveLocalTrack`:

- `GET /api/nas/browse`: per bestand `resolveLocalTrack(filePath, {
  allowCatalogicLookup: false })` — snel, geen netwerk, zelfde
  ontwerpprincipe als nu (browse blijft snel, verrijking gebeurt erna).
  De aparte live-`getDbNasLibraryEntry`-plus-`peekLocalTrack.playable`-
  samenvoeglogica die in een eerdere taak is toegevoegd (voor de
  playable-filter) vervalt: `resolveLocalTrack` regelt die
  DB-versus-live-afweging nu intern, op één plek.
- `POST /api/nas/enrich`: concurrency-4-worker-loop (ongewijzigd patroon)
  roept nu `resolveLocalTrack(filePath, { allowCatalogicLookup: true })`
  per pad aan i.p.v. `enrichLocalFiles`.
- `POST /api/nas/play-file`: `resolveLocalTrack(filePath, {
  allowCatalogicLookup: true })` i.p.v. `buildLocalTrack(filePath, true)`.
- `POST /api/nas/play-folder`: eerste track krijgt
  `allowCatalogicLookup: true`, de rest `false` — zelfde bestaande
  afweging (alleen het nummer dat NU gaat spelen krijgt de langzamere
  netwerkaanroep), nu via `resolveLocalTrack` i.p.v. `buildLocalTrack`.
- `POST /api/nas/create-playlist`: `resolveLocalTrack(filePath, {
  allowCatalogicLookup: false })` i.p.v. `peekLocalTrack`.

## Scanwijziging (`src/services/nasLibraryScan.ts`)

`startNasLibraryScan`'s worker-loop wordt een dunne wrapper: voor elk
gewandeld bestand gewoon `resolveLocalTrack(filePath, {
allowCatalogicLookup: opts.allowCatalogicLookup })` aanroepen. De eigen
stat/tag-lezen/lookup/upsert-logica die de scan nu dupliceert, vervalt —
één implementatie van "controleer wijziging, lees zo nodig opnieuw,
schrijf weg" voor scan, browse, afspelen en verrijken samen.

`status`-tellers (`filesScanned`, `filesSkippedUnchanged`, `matched`,
`unmatched`) blijven bestaan en worden afgeleid uit wat `resolveLocalTrack`
teruggeeft (of het een cache-hit was, en of `catalogicSongId` gezet is) —
géén gedragswijziging aan de statusrapportage zelf, alleen de interne
implementatie verschuift.

## DB-migratie (`db.ts`)

`nas_library_index` krijgt een `duration_ms INTEGER`-kolom (zelfde
ALTER-TABLE-patroon als eerder bij `playable`: kolom in de
`CREATE TABLE IF NOT EXISTS`, plus een try/catch-`ALTER TABLE` erna voor
bestaande installs). Nodig omdat duur nu alleen in `artwork_cache` leefde
en straks nodig is om een volledige `Track` uit een `nas_library_index`-rij
te bouwen. `upsertDbNasLibraryEntry` krijgt een `durationMs?: number`
parameter (default: bestaande `240000`-fallback wanneer niet meegegeven,
zelfde patroon als de rest van het bestand).

Bestaande rijen (van vóór deze migratie) krijgen `duration_ms = NULL` tot
de eerstvolgende `resolveLocalTrack`-aanroep ze verversat; Track-opbouw
valt in dat geval terug op de bestaande `240000`-standaardwaarde — geen
zichtbare regressie, gewoon een tijdelijke placeholder-duur totdat het
bestand opnieuw geresolved wordt (wat vanzelf gebeurt zodra het gebrowset
of afgespeeld wordt).

## Opschoning (`src/services/localTrackMetadata.ts`)

Krimpt tot alleen `isAudioFile` + `readLocalTags` (beide puur, geen
cache/netwerk, blijven ongewijzigd herbruikt door `resolveLocalTrack` en
elders). Vervalt: `peekLocalTrack`, `buildLocalTrack`, `enrichLocalFiles`,
`fromCache`, `cacheKeyFor`, `toTrack` (verhuist naar de nieuwe functie),
en de `getCachedArtwork`/`setCachedArtwork`-import (blijft elders bestaan
voor Spotify, alleen dit bestand heeft ze niet meer nodig).

## Wat NIET verandert

- `artwork_cache`-tabel zelf en zijn Spotify-gebruik (`src/server/routes/
  spotify.ts`) — volledig ongemoeid.
- De bestaande, recent gefixte `playable`-heronderzoek-regel ("een rij met
  `playable=0` wordt altijd opnieuw geprobeerd") — wordt hergebruikt in
  `resolveLocalTrack`'s stap 2, niet opnieuw uitgevonden.
- Het bestaande onderscheid tussen "snelle, netwerkloze browse" en
  "trage, verrijkte enrich/afspelen" — blijft bestaan, alleen via één
  functie i.p.v. twee aparte cache-systemen.
- Geen wijziging aan hoe Catalogic zelf matcht (`lookupCatalogicSong`,
  recent gefixt voor het artiest-mismatch-probleem) — dat ontwerp staat
  los van deze opslag-unificatie.

## Buiten scope

- Geen retroactieve backfill van `duration_ms` voor bestaande rijen bij de
  migratie zelf — vult zichzelf lazy bij het eerstvolgende resolve, zoals
  hierboven beschreven.
- Geen opruiming van de nu ongebruikte `nas:`-rijen die nog in
  `artwork_cache` zouden kunnen staan (al leeggemaakt tijdens de recente
  productie-cache-schoonmaak) — die tabel blijft sowieso bestaan voor
  Spotify, dus dode `nas:`-rijen zijn onschadelijk en hoeven niet actief
  verwijderd te worden.
