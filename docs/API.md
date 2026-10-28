# 📡 HSS HiddenSoundSystem API Documentatie

Dit document beschrijft alle beschikbare REST API endpoints en WebSocket events van HSS HiddenSoundSystem.
Alle endpoints zijn geverifieerd tegen de daadwerkelijke routes in `server.ts`.

---

## 🎧 1. Playback

### `GET /api/status`
Geeft de volledige actuele staat terug: `playback` (inclusief `currentTrack`, `positionMs`, `durationMs`,
`volume`, `spectrum`, `dacConfig`, `systemStats`, `spotifyConnected`), plus `wsConnected`-achtige metadata.
Dit is de call die de frontend bij het opstarten gebruikt om zijn state te initialiseren.

### `POST /api/playback/play`
Hervat het afspelen van de huidige track.

### `POST /api/playback/pause`
Pauzeert het afspelen.

### `POST /api/playback/toggle`
Wisselt tussen afspelen/pauzeren.

### `POST /api/playback/next` / `POST /api/playback/previous`
Springt naar het volgende/vorige nummer in de wachtrij (of, zonder wachtrij, een willekeurige track
uit de demo-catalogus als er geen actieve Spotify-sessie is).

### `POST /api/playback/seek`
```json
{ "positionMs": 45000 }
```

### `POST /api/playback/shuffle`
```json
{ "shuffle": true }
```

### `POST /api/playback/repeat`
```json
{ "repeat": "off" | "track" | "context" }
```

### `POST /api/volume`
Stelt volume, mute en/of balans in — synchroniseert direct met de ALSA hardware mixer, geldt dus voor
elke bron (Spotify Connect incluis). Balans (`-50`..`50`) is een dB-verzwakking op het stille kanaal, niet
een schaling van het volumepercentage — die twee lopen op echte hardware verre van gelijk op (amixer's
percentage bleek zwaar logaritmisch, niet lineair in geluidssterkte), dus een simpele percentage-schaling
sneed veel te hard door bij een gematigde balansinstelling.
```json
{ "volume": 75, "isMuted": false, "balance": -10 }
```

---

## 🎛️ 2. Audio Devices, DAC & Equalizer

### `GET /api/audio/devices`
Lijst van beschikbare I2S DAC HATs / USB-audiokaarten, plus de actief geselecteerde.

### `POST /api/audio/output`
Wisselt de actieve audio-uitgang (DAC HAT of USB-kaart).
```json
{ "deviceId": "hifiberry-dacplus" }
```

### `POST /api/audio/dac-config`
Update DAC-instellingen (volume in dB, balans, resampling, buffer/period time, etc).
```json
{ "volumeDb": -6.0, "balance": 0, "resamplingQuality": "soxr_high" }
```

### `POST /api/audio/equalizer`
Update de 10-bands DSP-equalizer — toegepast via `libasound2-plugin-equal` in de gedeelde ALSA
`default`-route (zie README, "Bit-Perfect Routing"), dus hoorbaar op elke bron, niet alleen NAS/webradio.
```json
{ "enabled": true, "bands": [{ "freq": 31, "gain": 2 }], "activePresetId": "audiophile_flat" }
```

### `GET /api/audio/eq-presets` / `POST /api/audio/eq-presets` / `DELETE /api/audio/eq-presets/:id`
Beheer van EQ-presets (ingebouwd + zelf aangemaakte).

### `POST /api/audio/eq-presets/:id/apply`
Past een preset direct toe op de actieve equalizer.

### `GET /api/audio/advanced` / `POST /api/audio/advanced`
Gecombineerd endpoint voor crossfade (`crossfadeEnabled`, `crossfadeDurationSec`, `crossfadeCurve`),
gapless playback (`gaplessPlayback`, `gaplessBufferPreloadMs`), resampling/dither en audio-profiel-scope
(`profileScope: "global" | "playlist_specific"`, `associatedPlaylistId`). Er zijn geen losse
`/api/audio/crossfade`, `/api/audio/gapless` of `/api/audio/profiles` endpoints — dit ene endpoint dekt
alle drie.
```json
{ "crossfadeEnabled": true, "crossfadeDurationSec": 4, "crossfadeCurve": "equal_power" }
```

### `POST /api/system/test-audio`
Speelt een 1kHz testtoon af via de actieve ALSA hardware-uitgang.

---

## 🟢 3. Spotify Connect & Playlists

### Inloggen bij Spotify (OAuth) — eenmalig via een SSH-tunnel

`GET /api/spotify/auth/login` start een echte Spotify Authorization Code-inlog (niet te verwarren met
Spotify *Connect*, dat is losstaand en draait via de `librespot` daemon). Dit geeft toegang tot `/me/playlists`
("Mijn Spotify account playlists" in de Bronnen-tab) en tot het direct afspelen van een track/album/playlist
via de Web API (`POST /api/spotify/play`, target = het `librespot`-apparaat).

Spotify accepteert sinds 2025 alleen een `redirect_uri` die `https://` is, óf de letterlijke loopback
`http://127.0.0.1:<poort>/...` — nooit een LAN-IP zoals `192.168.x.x`. Draait de Hub (zoals hier) alleen op
een LAN-IP zonder publiek domein/HTTPS, dan moet de eerste keer inloggen via een SSH-tunnel naar loopback:

1. Op je eigen machine: `ssh -L 3000:localhost:3000 <user>@<pi-ip>`
2. Open `http://127.0.0.1:3000` (via de tunnel) → Instellingen → Spotify
3. Zet in het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → je app → Settings →
   Redirect URIs exact: `http://127.0.0.1:3000/api/spotify/auth/callback`
4. Klik "Inloggen bij Spotify" — de redirect matcht nu en de login voltooit

Het refresh-token wordt server-side bewaard (SQLite, tabel `spotify_account`) en automatisch ververst — de
tunnel is dus alleen nodig bij de allereerste login (of na expliciet uitloggen/intrekken). Daarna werkt alles
gewoon via het LAN-IP. Staat de Hub wél achter een echt HTTPS-domein, dan werkt inloggen direct zonder tunnel.

### `POST /api/spotify/event`
Webhook endpoint voor `librespot` event hooks (`started`, `playing`, `track_changed`, `paused`,
`stopped`/`kicked`/`closed`/`session_cleared`, `volume_set`). Dit endpoint stuurt ook `spotifyConnected`
aan — `true` zodra er een track binnenkomt, blijft `true` tijdens pauze, en gaat pas naar `false` bij een
echte disconnect (en dan alleen als Spotify op dat moment ook daadwerkelijk de actieve bron is — een
lopende NAS/radio-sessie wordt niet overschreven door een verdwaald Spotify-disconnect-event).

### `GET /api/spotify/search?q=` / `GET /api/spotify/featured` / `GET /api/spotify/artwork`
Live zoeken (tracks, albums én playlists), featured playlists en hi-res artwork-lookup.

### `GET /api/spotify/user-playlists` / `GET /api/spotify/playlist/:id`
Alle playlists van de ingelogde gebruiker (`/me/playlists`, vereist OAuth-login hierboven) plus elke
NAS-afspeellijst — die laatste zijn app-eigen en gelden alleen voor lokale/NAS-bestanden.

### `POST /api/spotify/import-playlist`
```json
{ "urlOrId": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" }
```
Werkt ook zonder OAuth-login (leest publieke playlists via de embed-pagina), voor het los toevoegen van
iemand anders' playlist.

### `POST /api/spotify/play`
```json
{ "uri": "spotify:track:..." }
```
Start echte afspeel via de Web API op het `librespot`-apparaat. Vereist OAuth-login én dat `librespot`
op dat moment als Spotify Connect-apparaat zichtbaar is.

### `GET /api/spotify/account` / `POST /api/spotify/test` / `POST /api/spotify/logout` / `POST /api/spotify/lookup`
Account-status (incl. `loginUrl`), verbindingstest, uitloggen (wist de opgeslagen tokens) en losse
track/album-lookups.

---

## 📻 4. Web Radio

### `GET /api/radio/stations` — opgeslagen zenders · `GET /api/radio/search?q=` — 40.000+ live doorzoeken via Radio-Browser
### `POST /api/radio/stations` / `DELETE /api/radio/stations/:id` — zender opslaan/verwijderen
### `POST /api/radio/play`
Start een stream direct op de Pi-uitgang. Radio heeft geen vaste duur — `durationMs` blijft `0` en wordt
door de server nooit als "track afgelopen" geïnterpreteerd. `title`/`artist` starten als zendernaam/genre
(`album` wordt de zendernaam) — stuurt de stream een ICY `StreamTitle`-tag mee, dan vervangt de
progress-ticker (elke 1s, `mpv`'s `metadata`-property, niet een los `icy-title`-property — die bestaat
niet) title/artist door het echte nummer zodra het verandert, met een `track_change`-broadcast.
```json
{ "url": "https://icecast.omroep.nl/radio2-bb-aac", "name": "NPO Radio 2", "genre": "Pop / Rock" }
```

---

## ❤️ 4b. Favorieten (het hartje)

Bewaart het nummer dat op dít moment speelt, ongeacht de bron: Spotify, NAS, webradio (uit de ICY-tag) of
de herkende platenspeler/CD. De aanroeper stuurt geen nummer mee — de server weet zelf wat er klinkt en
waar het vandaan komt.

Een nummer wordt geïdentificeerd op genormaliseerde artiest+titel (`src/services/likedTracks.ts`), niet op
`uri`: hetzelfde nummer op de radio en later op Spotify is één regel, geen twee. Bij radio wordt de `uri`
bewust niet bewaard — dat is de stream, niet het nummer — maar de zendernaam wél (`sourceDetail`).

### `GET /api/likes`
Alle favorieten, nieuwste eerst. Openbaar leesbaar, net als `GET /api/status`.
```json
{ "success": true, "likes": [ { "likeKey": "the beatles|hey jude", "title": "Hey Jude", "artist": "The Beatles",
  "source": "radio", "sourceDetail": "NPO Radio 2", "spotifyId": null, "uri": null, "likedAt": 1788700000000 } ] }
```

### `POST /api/likes` — vereist `audio:control`
Geen body. Bewaart wat er speelt; 400 als er niets bruikbaars klinkt (een stream die nog alleen zijn eigen
zendernaam meldt telt niet als nummer). Broadcast `likes_updated` met de volledige lijst, zodat elk scherm
— web, kiosk, cast — het hartje op hetzelfde moment invult.

Staat de Listener-koppeling aan (`listenerPushLikes`), dan gaat het nummer daarna ook naar
`POST {listenerUrl}/api/integration/songs` met header `x-integration-key`. Dat gebeurt fire-and-forget: is
Listener traag of plat, dan blijft de favoriet lokaal gewoon staan en verschijnt er een systeemmelding.

Listener filet dat nummer zelf in de collectie die dezelfde naam draagt als de gebruikte API-sleutel
(sleutel "HSS tuinhuis" → collectie "HSS tuinhuis"). Bestaat die collectie daar niet, dan blijft het bij de
catalogus — HSS kent geen collectie-ids en maakt er nooit een aan.

### `DELETE /api/likes/:likeKey` — vereist `audio:control`
Verwijdert één favoriet (`likeKey` URL-encoded). Broadcast dezelfde `likes_updated`.

---

## 📻📝 4c. Radiogeschiedenis (optioneel)

Los van favorieten hierboven: houdt — mits aangezet — bij wát er wanneer op wélk radiostation voorbijkwam,
niet alleen wat je bewaarde. Identificatie loopt via dezelfde ICY `StreamTitle`-tag als sectie 4 hierboven
(geen aparte "herkenning" nodig, dat is alleen voor de platenspeler/CD via de USB-microfoon, zie §5b) — zodra
`state.ts`'s progress-ticker een nieuwe tag ziet, wordt die (als hij een echt nummer bevat) gelogd.

**Station-sweeps/jingles worden eruit gefilterd**: een ICY-tag die shouting_snake_case tekst bevat (bv.
`PINGUIN_CLASSICS_SWEEP_06`, live bevestigd op Pinguin Classics) wordt herkend als stationsruis
(`looksLikeStationJingle` in `src/services/localPlayer.ts`) — die overschrijft dan ook het scherm niet, in
plaats van kort de titel/artiest te vervangen door onzin.

### `GET /api/radio/log?limit=&offset=`
Openbaar leesbaar, nieuwste eerst. `limit` (default 20, max 100) en `offset` voor paginering — geen aparte
COUNT-query, dus of er een volgende pagina is blijkt uit "kreeg ik een volle pagina terug".
```json
{ "success": true, "entries": [ { "id": 4, "station": "Pinguin Classics", "title": "Androgynous",
  "artist": "The Replacements", "artworkUrl": null, "playedAt": 1789219100514 } ] }
```

### `DELETE /api/radio/log` — vereist `audio:control`
Wist de hele geschiedenis.

### Instellingen (`GET/POST /api/config`, zie §7)
- `radioLogEnabled` — aan/uit voor het bijhouden zelf. Standaard uit.
- `listenerPushRadioLog` — "auto-modus": stuurt elk gelogd nummer ook fire-and-forget naar Listener, exact
  hetzelfde pad als `listenerPushLikes` bij het hartje (`pushLikeToListener`). Alleen zichtbaar/zinvol als
  `radioLogEnabled` aanstaat; de lokale log blijft hoe dan ook bestaan, ongeacht of Listener bereikbaar is —
  zie de architectuurkeuze in `ARCHITECTURE.md`.

### Albumart via Catalogic (alleen-lezen, geen automatisch aanmaken)
Elk gelogd nummer krijgt een passieve `lookupCatalogicSong`-lookup (zelfde alleen-lezen aanroep als de
NAS-verrijking in §5) zodra `catalogicEnabled` aanstaat. Een match zet de albumart meteen op het scherm én in
de logregel. Kent Catalogic het nummer nog niet, dan wordt het — bewust géén automatische
`lookupOrCreateCatalogicSong`, zie de ontwerpregel in `ARCHITECTURE.md` — in de bestaande backlog-wachtrij
gezet (`submitCatalogicBacklog`, dezelfde die NAS al gebruikt). De al bestaande `song.created`-webhook
(`POST /api/catalogic/webhook`) triggert dan naast `reconcileNasBacklog` ook `reconcileRadioLogBacklog`, die
logregels zonder albumart opnieuw opzoekt zodra Catalogic ze via de backlog heeft opgelost.

---

## 📁 5. Netwerkschijven (NAS / NFS / SMB) & Lokale Bestanden

Elk audiobestand krijgt echte metadata (titel/artiest/album/duur) uit de ingebedde ID3/FLAC/etc.-tags via
`music-metadata`, met filename/mapnaam als fallback wanneer een bestand geen tags heeft. Resultaten worden
gecachet in de bestaande `artwork_cache` SQLite-tabel (sleutel `nas:<bestandspad>`), dus dit gebeurt maar
één keer per bestand.

Daadwerkelijke audio-uitvoer loopt via `mpv` (`src/services/localPlayer.ts`), aangestuurd over zijn JSON
IPC-socket — Spotify Connect heeft z'n eigen `librespot`-daemon die rechtstreeks naar ALSA streamt, maar NAS
en web radio hadden dat nooit en speelden voorheen alleen state af zonder geluid. `POST /api/playback/*`
(play/pause/seek/next/previous) stuurt automatisch de juiste kant op — `mpv` wanneer NAS/radio actief is,
`playerctl`/librespot anders. `mpv` moet geïnstalleerd zijn (`sudo apt-get install mpv`, al onderdeel van
`setup.sh`); ontbreekt het, dan blijft de rest van de app werken maar blijft NAS/radio geluidloos.

### `GET /api/nas/shares` / `POST /api/nas/mount` — gekoppelde shares beheren
In de UI staat het koppelformulier (protocol/host/pad/credentials) onder Instellingen → Netwerkschijf
(NAS/SMB) — bladeren/afspelen zelf gebeurt bij Bronnen of via de "Bron kiezen"-knop op het Afspeel- en
Cast-scherm (`src/components/SourcePicker.tsx`, `src/components/NasBrowser.tsx`).
### `GET /api/nas/browse?path=`
Bestanden/mappen doorbladeren. Audiobestanden komen terug met `title`/`artist`/`album`/`durationMs`/`coverUrl`
uit tags of cache — **geen** Catalogic-lookup hier, dat zou de lijst blokkeren voor grote mappen.

### `POST /api/nas/enrich`
Best-effort artwork/metadata-verrijking voor een set bestanden (max 200), bedoeld om ná `/api/nas/browse`
aan te roepen zodat de lijst zelf snel blijft. Doet per bestand (concurrency-gelimiteerd op 4) een Catalogic-
lookup op titel+artiest wanneer de Catalogic-koppeling aanstaat, en cachet het resultaat.
```json
{ "paths": ["/mnt/nas/Massive Attack/01 Teardrop.flac"] }
```
→ `{ "success": true, "tracks": { "<pad>": { "title": ..., "coverUrl": ..., ... } } }`

### `POST /api/nas/play-file`
Speelt een lokaal audiobestand direct af via ALSA — werkt altijd, ongeacht Spotify-verbindingsstatus. Doet
wél een live Catalogic-lookup (het is één bestand, geen blokkerende lijst).
```json
{ "filePath": "/mnt/nas/Pink Floyd/The Wall/01 - In The Flesh.flac" }
```

### `POST /api/nas/play-folder`
Volumio-stijl "speel deze map af" — queuet alle audiobestanden in de map (niet-recursief) en start de eerste.
```json
{ "dirPath": "/mnt/nas/Pink Floyd/The Wall" }
```

### `POST /api/nas/create-playlist` — permanente afspeellijst van een hele map (tags/cache, geen live Catalogic-call)

### Catalogic-koppeling (optioneel, alleen leesrichting)
Read-only integratie met [Catalogic](https://catalogic.doorkoppen.nl) voor canonieke albumhoezen/metadata bij
NAS-nummers — niets wordt teruggeschreven. Uit te zetten/configureren via `catalogicEnabled`, `catalogicUrl`,
`catalogicApiKey` op `GET/POST /api/config` (zie §7), of in de UI onder Instellingen → Catalogic koppeling.
Reads bij Catalogic zelf zijn publiek; een API-sleutel is alleen relevant voor eventuele toekomstige
schrijftoegang. Staat de koppeling uit, dan wordt Catalogic nooit benaderd en blijft alles bij tag-data.

---

## 🎙️ 5b. Muziekherkenning (Platenspeler/CD via USB-microfoon)

Herkent wat er op een fysieke bron (platenspeler, CD-speler) speelt via een USB-microfoon, zodat titel/artiest
ook op de Nest Hub te zien zijn. Dit app **speelt dit geluid niet af** — de bron gaat rechtstreeks naar een
versterker; dit is uitsluitend een "nu speelt"-weergave. Zie `src/services/audioRecognition.ts`.

Werking: goedkope stilte-probes van 2 seconden (RMS) houden bij of het stil is; zodra na een stilte het geluid
weer terugkomt (een echte trackwissel, binnen enkele seconden gedetecteerd) wordt een fragment opgenomen
(`arecord`) → fingerprinten (`fpcalc`/Chromaprint) → eerst lokaal vergelijken met eerder herkende fingerprints
(fuzzy match op bit-error-rate, gratis, werkt offline) → bij een cache-miss opzoeken via Shazam, dan AudD, dan
de gratis [AcoustID](https://acoustid.org) API → resultaat permanent gecachet in SQLite (`recognized_audio`),
zodat dezelfde plaatkant nooit twee keer wordt opgezocht.

### `GET /api/recognize/devices`
Lijst beschikbare ALSA capture-apparaten (`arecord -l`), voor de microfoon-keuze in Instellingen.

### `POST /api/recognize/listen/start`
```json
{ "source": "turntable" }
```
`source` is `"turntable"` of `"cd"`. Vereist een ingestelde microfoon (`recognitionMicDevice` via
`/api/config`). Start een doorlopende herkenningscyclus tot `/stop` wordt aangeroepen.

### `POST /api/recognize/listen/stop`
Stopt de herkenningscyclus en zet de externe bron weer op inactief.

### `GET /api/recognize/status`
Huidige `externalSource`-status (`active`, `sourceType`, `track`, `status`) plus of er een API-sleutel/microfoon
ingesteld is. Live updates komen ook binnen via de WebSocket (`external_source_update`, zie §8).

Instellingen (`acoustidApiKey`, `recognitionMicDevice`) via `GET/POST /api/config` (zie §7), of in de UI onder
Instellingen → Muziekherkenning (LP/CD).

---

## 📺 6. Cast & Smart Display (Google Nest Hub)

Naast casten naar een Nest Hub kan dezelfde kiosk-weergave ook rechtstreeks op een HDMI-scherm dat op de Pi
zelf is aangesloten getoond worden — zie sectie 7 voor de `/api/setup/kiosk-display*` endpoints.

### `GET /api/cast/devices`
Scant het lokale netwerk (via `avahi-browse`) naar Chromecast/Nest Hub-apparaten.

### `GET /api/cast/session` / `POST /api/cast/start` / `POST /api/cast/stop`
Huidige cast-sessie ophalen, casten starten (via `catt`) of stoppen.

`POST /api/cast/start` accepteert optioneel `{ deviceId?, deviceIp?, deviceName?, layout?, themeId? }`.
Alles wat je weglaat valt terug op wat is opgeslagen in de Cast-instellingen (`targetDeviceId`/
`targetDeviceIp`/`targetDeviceName`, `layout`, `themeId`) — dus met een device eenmaal gekozen in de app
kun je deze aanroepen met een lege body. Geen device opgegeven én geen standaard ingesteld → `400`.
`deviceName` gaat direct naar `catt -d` (herkent apparaatnamen zoals "Nest Hub Keuken" native, geen
IP-opzoeking nodig) — handig voor een externe trigger die zelf geen IP/ID wil onthouden.

**Voorbeeld: vanuit Home Assistant** (`configuration.yaml`), voor een knop/automatisering die "muziek via
de Hub aanzetten" doet — cast het huidige scherm naar je opgeslagen standaardapparaat:
```yaml
rest_command:
  hss_cast_start:
    url: "http://192.168.178.191:3000/api/cast/start"
    method: POST
    content_type: "application/json"
    payload: "{}"
```
Wil je vanuit HA een specifiek apparaat aansturen (bijv. bij meerdere Nest Hubs), geef `deviceName` mee:
```yaml
rest_command:
  hss_cast_keuken:
    url: "http://192.168.178.191:3000/api/cast/start"
    method: POST
    content_type: "application/json"
    payload: '{"deviceName": "Nest Hub Keuken"}'
```
Dit endpoint vereist geen API-sleutel — net als de rest van de playback/cast-routes staat het open op je
lokale netwerk, dus reikbaar voor Home Assistant zonder extra credentials.

### `GET /api/cast/settings` / `POST /api/cast/settings`
Het volledige `CastSettings`-object: welk device (`targetDeviceId`, plus `targetDeviceIp`/
`targetDeviceName` — nodig omdat `catt -d` een IP of naam verwacht, geen avahi-ID), welke `layout`
(`kiosk_touch` | `artwork_focus` | `audiophile_spectrum` | `ambient_clock` | `custom_design`), thema,
zichtbare elementen (`showControls`, `showSpectrum`, `showQueue`, `showSourceSwitcher`, `showClock`),
automatisering (`autoCastOnPlay`, `autoStopOnPause`, `autoStopDelaySec`, `autoStopReleasesDevice` — standby
tonen versus de Nest Hub echt vrijgeven), en de volledige visuele configuratie voor de `custom_design`-layout
("Eigen ontwerp").

Vijf onafhankelijke elementen — albumhoes, tekst, klok, spectrum, bedieningsknoppen — hebben elk hun
eigen positionering: `{element}AnchorH` (`left`|`center`|`right`), `{element}AnchorV`
(`top`|`center`|`bottom`), `{element}OffsetX`/`{element}OffsetY` (px, fijnafstemming vanaf dat
ankerpunt) en `{element}ZIndex`. Een element kiest dus eerst welke rand/hoek van het scherm het dichtst
bij zijn bedoelde plek ligt, en verschuift daar vervolgens vanaf — zo houdt het altijd bewegingsruimte in
de gewenste richting, in plaats van vanaf een gedeelde flow-positie te moeten starten.

Overige velden per element:
- **Achtergrond**: `bgStyle` (`solid` | `glow` | `gradient` | `album_art` | `custom_image`),
  `bgOpacity`/`bgBlur`/`bgOverlayOpacity`, `customBgImageUrl`.
- **Albumhoes**: `artDisplayMode` (`flat` | `vinyl` | `cd` | `auto` — auto volgt de actieve bron:
  platenspeler/cd tonen hun echte medium, verder plat), met eigen grootte per medium
  (`flatArtSize`/`vinylArtSize`/`cdArtSize`), vulling en middengaatje voor vinyl/cd
  (`vinylFillPct`/`cdFillPct`/`vinylHoleSizePct`/`cdHoleSizePct`), plus `artRadius`, `artShadow`,
  `discSpin`.
- **Tekst**: `align` (text-align en interne uitlijning van spectrum/knoppen — los van positionering),
  `titleSize`, `artistSize`.
- **Klok**: `clockStyle` (`small` | `large` — het visuele sjabloon, los van het ankerpunt), `clockSize`,
  `clockColor`, `clockShadow`.
- **Spectrum**: `spectrumWidth`, `spectrumHeight`, `spectrumOpacity`.
- **Bedieningsknoppen**: `controlsSize` (iconformaat; padding schaalt mee).
- **Volume**: `volumeSize` (breedte van de volumebalk, los instelbaar van de rest).

**Standby-scherm** — een eigen, volledig van de normale weergave losstaande styling (alleen `clockSize`/
`clockColor` blijven gedeeld), getoond zodra `autoStopOnPause` actief wordt (zie sectie 7,
`POST /api/volume` e.a. — de idle-detectie zit server-side, niet in deze instellingen):
`standbyBgStyle` (`solid` | `glow` | `gradient` | `album_art` | `custom_image`),
`standbyCustomBgImageUrl`, `standbyBgOpacity`/`standbyBgBlur`/`standbyBgOverlayOpacity`,
`standbyFontFamily`, `standbyUseCustomAccent`/`standbyAccentColor`, `standbyShowTrack` (laatst gespeelde
track tonen), `standbyClockAnchorH`/`standbyClockAnchorV`/`standbyClockOffsetX`/`standbyClockOffsetY`.

Elke `POST` broadcast direct een `cast_design_updated` WebSocket-event, zodat een actief gecast scherm
meteen live bijwerkt zonder herladen — de editor toont daarom de echte cast-pagina (geschaald naar het
werkelijke Hub-formaat) als live voorbeeld in plaats van een losse mockup.

### `POST /api/cast/wake`
Verlaat standby direct (annuleert een eventueel wachtende auto-stop-timer). Gebruikt door de
"Standby verlaten"-knop in de Cast-tab — de betrouwbare weg, want een tik op het fysieke Nest Hub-scherm
zelf bereikt deze pagina niet gegarandeerd: `catt cast_site` toont een generieke webpagina, geen
geregistreerde Cast Receiver-app, dus Google's platform behandelt aanraken op het toestel zelf op zijn
eigen niveau, boven wat deze pagina's JavaScript ooit te zien krijgt.

**Auto-cast bij afspelen (`autoCastOnPlay`)**: staat dit aan en is er een `targetDeviceId` gekozen, dan
herstart de server bij elke echte "start afspelen"-actie (play, playlist/radio/NAS-bestand/-map kiezen,
of een nieuwe Spotify-track) altijd een `catt cast_site` naar dat apparaat — ook als de server nog denkt
dat er al gecast wordt. Dat is bewust: de Nest Hub kan een cast-sessie zelf beëindigd hebben zonder dat
de server dat merkt, dus vertrouwen op de onthouden `isCasting`-status alleen is niet betrouwbaar genoeg.
Er wordt niet herhaald op elke "volgende nummer"-stap binnen een lopende sessie, alleen op echte
start-momenten, om schermflikkering op de Nest Hub te voorkomen.

### Cast-kiosk verlaten
De sluitknop rechtsboven in de cast-weergave (`onExitCast`) verschijnt alleen wanneer de pagina handmatig
als voorbeeld is geopend vanuit het beheerscherm ("Test in browser"). Wordt de pagina geladen als echte
Cast-ontvanger (via `?kiosk=1`, zoals `catt` die op de Nest Hub zelf opent), dan is er geen sluitknop:
die zou anders het volledige beheerscherm tonen op een apparaat zonder adresbalk of terugknop, met geen
weg terug.

---

## ⚙️ 7. Systeem, Auth & Config

- `GET /api/config` / `POST /api/config` / `POST /api/config/regenerate-api-key` — Spotify-credentials, API-key
- `GET /api/user/preferences` / `POST /api/user/preferences` — actief tabblad + actief thema
- `GET /api/system/stats` / `GET /api/system/hardware-status` — CPU/RAM/temperatuur, ALSA-status
- `GET /api/setup/detect` / `POST /api/setup/provision` / `POST /api/setup/reboot` — onboarding wizard
- `GET /api/setup/kiosk-display` / `POST /api/setup/kiosk-display/enable` / `POST /api/setup/kiosk-display/disable` — lokaal HDMI-kiosk-scherm (cage + chromium-browser via systemd), zie sectie 6
- `POST /api/setup/shutdown` — `sudo poweroff` (admin:all). Naast `POST /api/setup/reboot` hierboven.
- `POST /api/system/update` — checkt of `origin/main` verder staat, en start dan `scripts/deploy.sh` via `systemd-run --collect` (admin:all): detached van `hss.service`'s eigen procesboom, zodat het script de herstart die het zelf triggert overleeft en de health-check-en-terugdraai-logica écht kan afmaken. Bij een terugdraai schrijft `deploy.sh` `/etc/hss/.update-result`, door `state.ts` bij de volgende opstart gelezen en gemeld via `reportHealthIssue` (zie `GET /api/system/health`). Alleen op verzoek ("Nu updaten"-knop), geen automatische achtergrond-updates; de update-check zelf (`git fetch` elk uur) zet alleen `updateAvailable`/`updateMessage` op `GET /api/status` en broadcast `update_available` (zie sectie 8) wanneer er een nieuwe commit is.
- `GET /api/system/backup` — streamt een online SQLite-backup (`db.backup()`, niet een ruwe bestandskopie — die kan bij WAL-mode corrupt zijn) als download (admin:all).
- `GET /api/system/network` — interfaces (type/status/SSID/IP via `nmcli`), geen auth vereist (alleen-lezen status).
- `GET /api/system/network/wifi-scan` — beschikbare WiFi-netwerken scannen (admin:all).
- `POST /api/system/network/wifi` — `{ ssid, password }`, verbindt via `nmcli device wifi connect` (admin:all). `ssid` mag niet met `-` beginnen (argv-injectie-guard tegen `nmcli`'s eigen flag-parsing).
- `GET /api/gpio/status` / `POST /api/gpio/config` / `POST /api/gpio/enable` / `POST /api/gpio/disable` — GPIO-hardwarekoppeling (rotary encoder + druktoets via libgpiod's `gpiomon`), config/enable/disable vereisen `admin:all`
- `GET /api/system/health` — actieve, eerder-stille storingen (geen ALSA-mixer gevonden, een mislukte DB-write, mpv die niet start, een teruggedraaide update) — zie `src/services/healthLog.ts`. Geen auth: alleen-lezen diagnostiek.
- `GET/POST/DELETE /api/auth/*` — gebruikers, login/logout, API-keys

---

## ⚡ 8. WebSocket Protocol (`ws://<ip>:3000/ws`)

Clients verbinden met `ws://<ip>:3000/ws` en ontvangen realtime JSON broadcasts. Elk bericht heeft de vorm
`{ "event": "...", "timestamp": 169..., "data": {...} }`.

**Alleen luisteren** (broadcasts ontvangen) vereist geen inloggen — zo blijft een passieve weergave (zoals de
Nest Hub-kiosk) werken zonder sessie. **Commando's sturen** over dezelfde socket (`{"action": "play", ...}`,
zie de `ws.on('message')`-voorbeelden hieronder) vereist wél een geldige sessie/API-sleutel, meegegeven als
`?token=<sleutel>` op de connectie-URL — zonder geldig token wordt elk binnenkomend commando genegeerd.

| Event | Frequentie | Inhoud |
|---|---|---|
| `progress_tick` | elke 1s | positie, duur, systemStats, telemetrie |
| `spectrum` | elke 150ms tijdens afspelen | 16-band FFT-array — losgekoppeld van `progress_tick` voor een vloeiende visualizer i.p.v. 1x/seconde sprongen |
| `playback_state` | bij play/pause/seek | `isPlaying`, `positionMs`, evt. `spotifyConnected` |
| `track_change` | bij nieuw nummer/bronwissel, of bij een gewijzigde ICY "nu speelt"-tag tijdens webradio | volledige track-metadata, wachtrij |
| `update_available` | eenmalig per nieuw gedetecteerde commit op `origin/main` (uurlijkse `git fetch`) | melding + commit-info, voedt het stipje op het Systeem-tabblad |
| `volume_change` | bij volumewijziging | volume, mute, dB, balans |
| `dac_update` | bij DAC/EQ-wijziging | dacConfig, actief device |
| `audio_settings_update` | bij crossfade/gapless-wijziging | advancedAudio, dacConfig |
| `crossfade_event` | tijdens actieve overgang | voortgang, volgende track |
| `queue_update` | bij wachtrijwijziging | volledige wachtrij |
| `cast_state_changed` | bij cast start/stop | cast-sessiestatus |
| `cast_design_updated` | bij elke `POST /api/cast/settings` | het volledige, bijgewerkte `CastSettings`-object — voedt live updates op een actief gecast scherm |
| `external_source_update` | bij nieuw herkend nummer, of start/stop | het volledige `ExternalSourceState`-object (zie §5b) |
