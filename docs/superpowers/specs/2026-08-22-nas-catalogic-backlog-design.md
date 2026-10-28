# NAS-sectie: onspeelbare bestanden filteren, scan-bij-koppelen, Catalogic-backlog + callback, meerdere views

Datum: 2026-08-22
Repos: `Raspberry-Pi-Soloist-HiFi-Hub` (HSS, primair) + `catalogic` (companion, zie §3)

## Doel

De bestaande NAS-sectie (`NasBrowser.tsx`, `src/services/nasLibraryScan.ts`,
`src/services/catalogicClient.ts`, `src/server/routes/nas.ts`) uitbreiden met
vier los van elkaar bruikbare verbeteringen:

1. Bestanden die niet afgespeeld kunnen worden, verbergen in de verkenner.
2. Automatisch scannen zodra een NAS-share gekoppeld wordt.
3. Onopgeloste matches als backlog aan Catalogic aanbieden, en een callback
   ontvangen zodra Catalogic weer iets gevonden heeft — in plaats van alleen
   maar handmatig herscannen.
4. Tabel-, detail- en icoonweergave voor de bestandenlijst.

## Bestaande bouwstenen (hergebruikt, niet opnieuw uitgevonden)

- **HSS**: `nas_library_index` (SQLite, met `file_size`/`mtime_ms` om
  ongewijzigde bestanden over te slaan), `startNasLibraryScan()` (hele
  bibliotheek, concurrency 4), `lookupCatalogicSong()` (read-only
  `GET /v1/search`), generieke `config`-tabel (`getDbConfig`/`setDbConfig`) voor
  instellingen zoals `catalogicApiKey`.
- **Catalogic**: generiek job-systeem (`enqueueJob`/`registerJobKind`, met
  dedupe/retry/backoff al ingebouwd), generiek webhook-abonnement-systeem
  (`POST /webhooks` → HMAC-SHA256-signed delivery met retries,
  `src/events/webhook-worker.ts`), `GET /v1/songs/lookup` (title/artist-fuzzy
  match + optioneel `create_if_missing` via Spotify, vuurt `song.created` op
  `eventBus`), `external_ids`-tabel voor cross-app id-koppeling.

Sectie 3 hieronder voegt op de Catalogic-kant precies één job-soort en één
route toe — verder wordt alles hergebruikt.

## 1. Onspeelbare bestanden verbergen

**Signaal**: `readLocalTags()` (`src/services/localTrackMetadata.ts`) roept al
`mm.parseFile()` aan en vangt exceptions op in een fallback (bestandsnaam als
titel). Die fallback-poging *is* het "kon niet gelezen worden"-signaal — nu
alleen nog niet zichtbaar voor de caller.

**Wijzigingen**:
- `readLocalTags()` retourneert een extra veld `playable: boolean` (`false`
  wanneer `mm.parseFile` een exception gooide).
- `nas_library_index` krijgt een kolom `playable INTEGER NOT NULL DEFAULT 1`;
  `nasLibraryScan.ts` zet 'm bij elke (her)scan.
- `GET /api/nas/browse`: voor bestanden binnen een gescand share wordt de
  gecachte `playable`-vlag gebruikt (snel, geen extra I/O); voor bestanden
  buiten elk gescand share (share nog nooit gescand) valt het terug op een
  live `readLocalTags()`-probe per bestand — zelfde kostenprofiel als de
  bestaande `peekLocalTrack`-aanroep in diezelfde route.
- Bestanden met `playable === false` worden uit de `files`-array van de
  response gefilterd (net als niet-audio bestanden nu al impliciet worden
  weggelaten in `NasBrowser.tsx`), zodat de client niets hoeft te filteren.

**Randgeval**: een map die alleen onspeelbare bestanden bevat toont dezelfde
lege-mapmelding als nu al bestaat voor een lege map.

## 2. Scan bij koppelen

In `POST /api/nas/mount` (`src/server/routes/nas.ts`) wordt de mount vandaag
al asynchroon uitgevoerd via `execFile('sudo', mountArgs, …, callback)`. In
die callback, alleen bij succes (`!err`), wordt nu ook
`startNasLibraryScan({ allowCatalogicLookup: hubConfig.catalogicScanLookupEnabled, onProgress: … })`
aangeroepen — dezelfde functie die de handmatige "Bibliotheek scannen"-knop
al gebruikt. Geen aparte code-path: incrementeel, dus een share die al eerder
gescand is (zelfde mount-point, ongewijzigde bestanden) kost nauwelijks iets
extra.

`allowCatalogicLookup` respecteert de bestaande `catalogicScanLookupEnabled`
instelling (zoals besproken) — geen verrassend netwerkverkeer als iemand
Catalogic-matching bewust uit heeft gezet.

Als er al een scan loopt (`startNasLibraryScan` retourneert `false`) wordt dat
genegeerd — de lopende scan dekt de nieuwe share toch al, aangezien
`startNasLibraryScan` altijd alle geconfigureerde shares walkt.

## 3. Backlog + callback (HSS ⇄ Catalogic)

### Probleem met de huidige aanpak

`nasLibraryScan.ts` slaat een bestand over (`filesSkippedUnchanged`) zodra
`file_size`/`mtime_ms` ongewijzigd zijn — *ook* als het bestand destijds
onopgelost bleef. Onopgeloste bestanden worden dus nooit meer opnieuw
geprobeerd, tenzij het bestand zelf wijzigt. Losse `/v1/search`-aanroepen per
bestand tijdens de scan zijn bovendien synchroon en beperkt tot Catalogic's
*bestaande* catalogus (geen `create_if_missing`), dus een NAS-track die nog
nergens in Catalogic voorkomt blijft voor altijd onopgelost.

### Aanpak: hergebruik Catalogic's job-queue + webhook-systeem

**Catalogic** (nieuw, klein, additief):
- Eén herbruikbare functie geëxtraheerd uit `songs-lookup.ts`
  (`resolveOrCreateSong({ title, artist, ... })`) — dezelfde logica als
  `GET /v1/songs/lookup` gebruikt nu al (external-id → ISRC → title/artist
  fuzzy → Spotify create-if-missing → `song.created` event), alleen
  aanroepbaar vanuit een job-handler i.p.v. alleen vanuit de route-handler.
- Nieuwe job-soort `songs.resolve_backlog_item` in `JOB_KINDS`
  (concurrency 2, retryBackoffSec 30, maxAttempts 5 — zelfde orde van grootte
  als de bestaande Spotify-jobs). Handler roept `resolveOrCreateSong()` aan
  en koppelt, bij succes, het meegegeven `external_id` onder een nieuwe
  provider `"hifi_hub"` aan de gevonden/aangemaakte song via de bestaande
  `upsertExternalId()`-helper.
- Nieuwe route `POST /v1/songs/backlog`, scope `songs:backlog` (zelfde
  auth-patroon als de andere schrijf-routes): body
  `{ items: [{ external_id: string, title: string, artist?: string }] }`
  (max 500 per aanroep), enqueue't één `songs.resolve_backlog_item`-job per
  item met `dedupe: true` op `external_id` (voorkomt dubbele jobs als HSS
  dezelfde onopgeloste track twee scans op rij aanbiedt). Retourneert
  `{ enqueued: number }`.
- Geen nieuw event-type nodig: `song.created` vuurt al bij elke resolutie via
  Spotify create-if-missing. Voor een match tegen een *bestaande* Catalogic-
  song (geen create) wordt hetzelfde event alsnog gepubliceerd puur als
  signaal "er is weer iets opgelost" — de payload wordt door HSS toch niet
  geïnterpreteerd (zie hieronder), dus semantische zuiverheid van het
  event-type is hier niet kritisch.

**HSS** (`catalogicClient.ts`, `nasLibraryScan.ts`, `nas.ts`, `db.ts`):
- `catalogicClient.ts` krijgt twee nieuwe functies:
  - `submitCatalogicBacklog(items)` — `POST {url}/v1/songs/backlog`,
    best-effort (net als `lookupCatalogicSong`: falen betekent gewoon "backlog
    blijft lokaal onopgelost tot volgende scan", geen retry-logica aan
    HSS-kant nodig, dat lost Catalogic's job-queue al op).
  - `registerCatalogicWebhook(callbackUrl)` — `POST {url}/webhooks`
    (`target_url: callbackUrl, events: ["song.created"]`), retourneert het
    `secret`. Wordt idempotent aangeroepen (opnieuw registreren bij een
    ontbrekend opgeslagen secret) vanuit `server.ts` bij opstarten, alleen als
    `hubConfig.catalogicEnabled` aan staat en er nog geen secret in `config`
    staat onder key `catalogic_webhook_secret`.
- Na een scan (`nasLibraryScan.ts`, in de `finally`-tak): verzamel alle
  bestanden met `catalogicSongId === null` uit deze scanrun en roep
  `submitCatalogicBacklog()` aan met `{ external_id: sha1(filePath), title,
  artist }` per stuk (hergebruikt hetzelfde soort hash als
  `idFor()`/`cacheKeyFor()` elders in de codebase).
- Nieuwe route `POST /api/catalogic/webhook` in `nas.ts`: verifieert de
  `X-Catalogic-Signature: sha256=<hex>` header (HMAC-SHA256 met het
  opgeslagen secret over de raw request body — zelfde constructie als
  Catalogic's `webhook-worker.ts` gebruikt om te versturen) met
  `crypto.timingSafeEqual`. Bij een geldige signature: triggert een lichte
  `reconcileNasBacklog()`-functie (nieuw, in `nasLibraryScan.ts`) die alle
  `nas_library_index`-rijen met `catalogic_song_id IS NULL` opnieuw langs
  `lookupCatalogicSong()` haalt, matches wegschrijft, en bij wijzigingen een
  `nas_scan_progress`-achtig websocket-event (`nas_backlog_reconciled`)
  broadcast zodat `NasBrowser` het artwork kan verversen zonder handmatige
  herscan. Ongeldige/ontbrekende signature → 401, geen verdere actie.
  Endpoint reageert altijd binnen enkele ms met 200 (reconcile draait
  fire-and-forget op de achtergrond) zodat Catalogic's leveringspoging niet
  op een trage HSS-reconcile hoeft te wachten.

### Data model

- HSS: `config` key `catalogic_webhook_secret` (nieuw, via bestaand
  `getDbConfig`/`setDbConfig`-patroon — geen nieuwe tabel nodig).
- Catalogic: geen schemawijziging — `external_ids` en de generieke
  job/webhook-tabellen bestaan al.

### Foutafhandeling

- Catalogic onbereikbaar tijdens `submitCatalogicBacklog`: best-effort, faalt
  stil, bestand blijft in `nas_library_index` als onopgelost tot de
  eerstvolgende scan het opnieuw aanbiedt.
- Catalogic onbereikbaar tijdens webhook-registratie: idem, wordt bij de
  volgende serverstart opnieuw geprobeerd (geen secret opgeslagen → opnieuw
  registreren).
- HSS onbereikbaar wanneer Catalogic een webhook probeert te leveren:
  Catalogic's bestaande exponential-backoff-retry (`webhook-worker.ts`,
  al ingebouwd) vangt dit op; geen HSS-werk nodig.
- Vervalste/ontbrekende signature op `/api/catalogic/webhook`: 401, geen
  reconcile.

## 4. Tabel-, detail- en icoonweergave

`NasBrowser.tsx` krijgt een view-switcher (3 knoppen met lucide-iconen,
naast de bestaande actieknoppen). Gekozen view opgeslagen in
`localStorage` (`nas-browser-view`, default `detail`). Alle drie renderen
dezelfde `nasFiles`-state, alleen het layout-component verschilt:

- **Detail** (huidige layout, ongewijzigd): kaart per bestand met cover,
  titel/artiest, hi-res badge, play/queue-knoppen.
- **Tabel**: compacte rijen (naam · artiest · album · duur), sorteerbaar op
  kolomkop, play/queue als icoon-knoppen aan het einde van de rij. Geen
  album-art thumbnail (of een 20px variant), voor maximale dichtheid.
- **Icoon**: grid van vierkante cover-art tegels (Finder-stijl), titel als
  onderschrift, klik = play, rechtsklik/hover toont queue-knop.

Mappen worden in alle drie de views hetzelfde behandeld als nu (klikbaar,
navigeert de browser).

## Buiten scope

- Geen UI in HSS om de Catalogic-webhook-registratie handmatig te triggeren
  of het secret te tonen/roteren — alleen automatisch bij opstarten. Kan
  later als er behoefte aan is.
- Geen bulk-retry-knop in de UI voor "probeer backlog nu" — de webhook +
  reguliere scans dekken dit. Toe te voegen wanneer iemand het mist.
- Catalogic's kant van dit ontwerp wordt in een apart implementatieplan in
  de `catalogic`-repo uitgevoerd (ander project, andere sessie/branch) — deze
  spec beschrijft het contract waar beide kanten zich aan houden.
