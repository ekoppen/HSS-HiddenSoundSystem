# Muziekbibliotheek-weergave: artiest → album → song

Datum: 2026-08-22

## Aanleiding

De bestaande NAS-bestandenverkenner toont een rauwe mapstructuur (kruimelpad,
tabel/detail/icoon-weergave op willekeurige mapdiepte). De gebruiker wil er
een tweede, muziekbibliotheek-bewuste weergave naast: eerst artiesten (met
foto), dan albums van die artiest (met hoes), dan de losse nummers (met
details). De bestaande rauwe verkenner blijft ongewijzigd bestaan als aparte
tab.

## Doel

- Nieuwe tab "Muziekbibliotheek" naast de bestaande "Bestanden"-verkenner.
- Drie geneste grids: artiesten (foto) → albums van een artiest (hoes) →
  songs van een album (details: titel/artiest/album/duur/bitrate/
  matchstatus/hoes; lyrics expliciet niet in deze iteratie).
- Zelfde architectuurprincipe als de bestaande verkenner: structuur komt
  live van de schijf (snel, geen wachten op een volledige scan), Catalogic-
  verrijking (foto/hoes) is los-gekoppeld en asynchroon.

## Hiërarchie-regel (gevalideerd tegen de echte bibliotheek — 12.326 bestanden)

Steekproef van de volledige, huidige bibliotheek naar mapdiepte vanaf de
share-root:

| Diepte | Aantal bestanden | Patroon | Voorbeeld |
|---|---|---|---|
| 1 | 118 | artiest/song (geen albummap) | `Dire Straits/01 - Calling Elvis.flac` |
| 2 | 9.882 | artiest/album/song (meerderheid) | `ABBA/ABBA/01 Mamma Mia.mp3` |
| 3 | 1.701 | artiest/album/disc/song | `Iggy Pop/.../Disc One/01-...flac` |
| 4 | 625 | artiest/tussenmap/album/disc/song | `Jackson Browne/_FLAC/2004 - .../CD1/...` |

Een harde "altijd 3 niveaus"-aanname zou ~20% van de bibliotheek fout
classificeren. Gekozen regel (dekt alle vier patronen):

1. **Artiest** = elke top-level map direct onder een share's koppelpunt.
2. **Album**, binnen een artiestmap:
   - Staan er audiobestanden **direct** in de artiestmap (diepte 1)? Dan is
     de artiestmap zelf ook meteen het enige album (songs direct getoond,
     geen aparte albumstap).
   - Anders: elke submap is een album. Bevat een albummap zelf weer
     submappen (disc 1/2, een tussenmap als `_FLAC`)? Die worden **plat
     getrokken**: alle audiobestanden ongeacht mapdiepte binnen die
     albummap tellen als songs van dat ene album (recursieve bestandenwalk
     vanaf de albummap, net als de bestaande `walkAudioFiles`-functie in
     `nasLibraryScan.ts` al doet voor de volledige scan).

## Wat hergebruikt wordt

- `resolveLocalTrack(filePath, opts)` (bestaand, `nasLibraryScan.ts`) — voor
  elk song-niveau nummer, ongewijzigd. Dit ontwerp voegt geen nieuwe
  song-matchlogica toe.
- `isAudioFile` (bestaand, `localTrackMetadata.ts`).
- Het bestaande "snel browsen, dan los verrijken"-patroon (zoals
  `/api/nas/browse` + `/api/nas/enrich` nu al doen) — hetzelfde principe,
  toegepast op artiest- en albumniveau.
- `catalogicClient.ts`'s bestaande `config`/`LOOKUP_TIMEOUT_MS`/
  best-effort-stijl (nooit throwen, best-effort resultaat).

## Nieuwe Catalogic-clientfuncties (`catalogicClient.ts`)

Beide geverifieerd tegen de live Catalogic-API vóór het schrijven van dit
ontwerp (niet aangenomen):

```ts
export interface CatalogicArtistMatch {
  artistId: string;
  name: string;
  artworkUrl: string | null;
}

export async function lookupCatalogicArtist(name: string): Promise<CatalogicArtistMatch | null>
```
- `GET /v1/search?q=<name>&type=artist&limit=3`, filter op `source ===
  'catalogic'`.
- **Strikte match vereist** (zelfde les als de songmatch-bugfix van
  vandaag): alleen accepteren bij een exacte, case-insensitieve
  naamsgelijkheid — geen "beste van de eerste 3 hits ongeacht naam"-
  fallback. Geen exacte match → `null` (geen gok).
- Bij een match: `GET /v1/media-assets?owner_type=artist&owner_id=<id>`
  (let op: `owner_type`/`owner_id`, NIET `resource_type`/`resource_id` —
  expliciet geverifieerd, de laatste twee worden stilzwijgend genegeerd
  door Catalogic's route en leveren dan het verkeerde/hele resultaat).
  Kies de `'sq'`-variant (512×512, geschikt voor een grid-tegel); val terug
  op `'thumb'` of het eerste beschikbare `artwork`-item als `'sq'`
  ontbreekt. URL: `${config.url}/v1/media-assets/${asset.id}/download`.

```ts
export interface CatalogicAlbumMatch {
  albumId: string;
  title: string;
  artworkUrl: string | null;
}

export async function lookupCatalogicAlbum(title: string, artistCatalogicId: string): Promise<CatalogicAlbumMatch | null>
```
- `GET /v1/search?q=<title>&type=album&limit=5`, filter op `source ===
  'catalogic'`.
- **Disambiguatie via `primary_artist_id`**, niet via naamsvergelijking:
  accepteer alleen een hit waarvan `primary_artist_id === artistCatalogicId`
  (de al-opgeloste artiest-id van `lookupCatalogicArtist`) — een exacte
  ID-vergelijking, betrouwbaarder dan de fuzzy artiest-naam-substring-check
  die songs gebruiken (die had immers vandaag al een keer een verkeerde
  match doorgelaten). Geen enkele hit met matchende `primary_artist_id` →
  `null`.
- Bij een match: zelfde media-assets-aanroep als hierboven, met
  `owner_type=album`.

Beide functies volgen het bestaande best-effort-patroon (try/catch/finally,
`AbortController` + `LOOKUP_TIMEOUT_MS`, nooit throwen, `config.enabled`
eerst checken).

## Nieuwe opslag

Twee nieuwe tabellen in `db.ts`, analoog aan `nas_library_index` maar
zonder de bestands-specifieke `file_size`/`mtime_ms`-wijzigingsdetectie —
een map heeft geen betrouwbaar enkel wijzigingssignaal zoals een bestand
dat wel heeft (mtime van een map verandert inconsistent tussen
SMB/NFS-implementaties). Ponytail-vereenvoudiging: eenmaal opgezocht =
permanent (geen automatische herverificatie); een toekomstige "ververs
artwork"-actie kan dit expliciet forceren als dat ooit nodig blijkt.

```sql
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

`checked_at IS NULL` = nog nooit opgezocht (zelfde discriminator-principe
als vandaag's `match_confidence`-fix: een rij die nog nooit gecontroleerd
is, mag nooit stilzwijgend als "definitief geen match" behandeld worden).
Zodra een lookup is geprobeerd (match of niet), wordt `checked_at`
gevuld — dat maakt de rij "klaar", ongeacht of er een match was.

## Nieuwe routes (`src/server/routes/nas.ts` of een nieuw `nas-library.ts`-bestand)

- `GET /api/nas/library/artists?share=<mountPoint>` — lijst top-level mappen
  onder het share-koppelpunt (naam + pad), snel, geen netwerk. Voor elke map
  ook `nas_artist_index`-rij opzoeken (indien aanwezig) voor `artworkUrl`.
- `POST /api/nas/library/enrich-artists` — body `{ paths: string[] }`,
  zelfde concurrency-4-worker-patroon als `/api/nas/enrich`: voor elke
  artiestmap met `checked_at IS NULL`, `lookupCatalogicArtist` aanroepen en
  wegschrijven.
- `GET /api/nas/library/albums?artistPath=<path>` — past de hiërarchie-regel
  toe (audio direct in de map → één synthetisch album; anders één album per
  submap, met platgetrokken diepere submappen).
- `POST /api/nas/library/enrich-albums` — zelfde patroon, met de artiest-id
  (uit `nas_artist_index`) als disambiguatie-parameter voor
  `lookupCatalogicAlbum`.
- `GET /api/nas/library/songs?albumPath=<path>` — recursieve bestandenwalk
  binnen de albummap (platgetrokken discs), per bestand `resolveLocalTrack`
  (bestaand, ongewijzigd) met `allowCatalogicLookup: false` — zelfde
  "snel browsen, dan verrijken"-principe, verrijking loopt via de
  bestaande `/api/nas/enrich`-route (die werkt al op bestandsniveau, hoeft
  niet aangepast).

## Nieuwe frontend

Nieuwe tab "Muziekbibliotheek" naast de bestaande "Bestanden"-verkenner
(zelfde niveau als de huidige tabbladkeuze in de Bronnen-sectie). Nieuw
component (bijv. `NasMusicLibrary.tsx`), met interne state voor welk niveau
getoond wordt (artiesten/albums/songs) en het huidige pad — zelfde
lazy-enrich-na-render-patroon als `NasBrowser.tsx` (fetch lijst, toon
meteen, vuur daarna een enrich-aanroep af die de tegels bijwerkt zodra
artwork binnenkomt).

## Wat NIET in deze iteratie zit

- Lyrics ophalen/tonen — Catalogic's lyrics-verrijking is opt-in en dun
  bevolkt; songdetail toont voorlopig alleen wat al beschikbaar is
  (titel/artiest/album/duur/bitrate/matchstatus/hoes). Aparte latere stap.
- De bestaande rauwe bestandenverkenner wijzigt niet — blijft volledig
  functioneel voor mappen die niet in het artiest/album/song-patroon passen
  of voor gebruikers die de rauwe weergave verkiezen.
- Geen automatische herverificatie van artiest/album-matches (zie
  ponytail-notitie hierboven) — alleen songs behouden hun bestaande
  bestandsgebaseerde wijzigingsdetectie.
- Geen wijziging aan hoe songs zelf matchen (`resolveLocalTrack`,
  `lookupCatalogicSong`) — dit ontwerp voegt alleen een artiest- en
  albumniveau ERBOVENOP toe.
