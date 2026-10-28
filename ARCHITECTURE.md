# Architectuuroverzicht

Dit document is er niet om features te verkopen (dat doet `README.md`) of
endpoints te documenteren (dat doet `docs/API.md`). Het is een kaart voor wie
— mens of AI-sessie — hierin moet gaan wijzigen en nog niet weet hoe
`state.ts`, de routebestanden, de WebSocket-events en de frontend elkaar
raken. Losse ontwerpbeslissingen per feature staan in
`docs/superpowers/specs/`; dit bestand vat samen hoe het geheel in elkaar
zit, niet waarom elke individuele beslissing is genomen.

Geschreven op 24 augustus 2026, na een sessie die dit expliciet als eerste
verbeterpunt uit een architectuuranalyse aanwees — reconstructie van dit
mentale model kostte tijd omdat het nergens stond. Houd het bij als de
structuur verandert; een verouderd overzicht is duurder dan geen overzicht.

## Runtime-topologie

Eén Node-proces, gestart als systemd-service (`hss.service`) op de Pi:

- **Build**: `vite build` (frontend, React 19 → statische assets) + `esbuild
  server.ts → dist/server.cjs` (backend, CommonJS-bundel, alle
  `node_modules` extern). Zie `npm run build`.
- **Serve**: `node dist/server.cjs` bedient zowel de statische frontend-assets
  als de REST-API als de WebSocket-server, allemaal op poort 3000 (via
  Express + de `ws`-library op dezelfde HTTP-server, geen aparte poort).
- **Persistentie**: één SQLite-bestand (`better-sqlite3`, WAL-mode),
  `/etc/hss/hss.db` op een echte Pi, valt terug op `/tmp/hss/hss.db` als
  `/etc/hss` niet bestaat (dat is ook wat lokale dev-sessies op een
  Mac/niet-Pi gebruiken — zie "Bekende valkuilen" onderaan).
- **Sibling-service**: Catalogic (`/Volumes/DATA/dev/catalogic` lokaal,
  productie op een aparte Proxmox LXC) — een volledig los Fastify/Postgres-
  project, geen gedeelde database, alleen HTTP. Zie "Catalogic-integratie"
  verderop.
- **Deploy**: `scripts/deploy.sh`, handmatig via SSH aangeroepen: `git pull`
  → `npm install` → `npm run build` → `systemctl restart hss.service`, met
  health-check-gebaseerde automatische rollback naar de vorige commit als de
  herstart niet binnen ~16 seconden weer `/api/status` beantwoordt. Geen
  CD-trigger, geen staging-omgeving.

## Het state-model (`src/server/state.ts`)

Dit ene bestand (1400+ regels) is de facto broncode-van-waarheid voor alles
wat de runtime weet: playback, cast, audio-hardware, auth, Spotify-tokens,
systeemstatistieken. Routebestanden importeren hier vrijwel alles uit in
plaats van eigen state bij te houden.

**Belangrijkste state-buckets:**

| Bucket | Wat | Persistent? |
|---|---|---|
| `playbackState` | huidige track, wachtrij, shuffle/repeat, spectrum-data | nee — in-memory only |
| `castSessionState` | is er nu gecast, naar welk apparaat, standby ja/nee | ja — `cast_session_v1` |
| `castSettingsState` | hele Cast Designer-configuratie (positionering, thema, lettertypes, automatisering) | ja — `cast_settings_v1` |
| `hubConfig` | Spotify-credentials, Catalogic-config, NAS-instellingen, publicUrl, etc. | ja — los per veld, zie hieronder |
| `dacConfig` / `advancedAudio` | actieve DAC, EQ-preset, crossfade/gapless-instellingen | ja |
| `users` / `userTokens` / `userPasswords` | auth-gebruikers, sessie-tokens, API-sleutels | ja — `auth_state_v1` |
| `systemStats` | CPU-temp, RAM, uptime — gesimuleerd op niet-Linux, echt via `/proc` op de Pi | nee — herberekend elke tick |
| `castDesignPresets` | opgeslagen Cast Designer-ontwerpen | ja |

**Het persistentiepatroon — en waarom het al meerdere keren mis is gegaan.**
Er is geen ORM, geen schema-afdwinging tussen "state die in het geheugen
leeft" en "state die is opgeslagen": elk stukje state dat overleeft moet
expliciet met `setDbConfig('een_sleutel', JSON.stringify(...))` naar de
generieke `config`-tabel (kolommen: `key`, `value`) worden weggeschreven,
los van elk ander stukje state. Niks controleert dat dit ook echt gebeurt na
elke mutatie. Drie bugs deze zomer kwamen hier direct uit voort: een cast-
sessie die "vergat" nog actief te zijn na een herstart, een
`autoStopOnPause`-default die in de UI wel `true` was maar in de
server-code nog `false`, en dubbele NAS-koppelingen. Vuistregel bij het
toevoegen van nieuwe muteerbare state: schrijf de `setDbConfig`-call
**in dezelfde functie** als de mutatie, niet als aparte "ik ruim dit later
op"-stap.

**Module-load-time gotcha.** `state.ts` doet bij het simpelweg *importeren*
van het bestand al écht werk: `loadDiskConfig()`, hardware-detectie via
`piHardware.getConnectedAudioCards()`, en twee ongeclausuleerde
`setInterval`-calls (systeemstatistieken-tick, progress-tick) die nooit
worden opgeruimd. Voor de *productieserver* is dat precies de bedoeling.
Voor een test die dit bestand rechtstreeks importeert (zie
`tests/cast-state.test.ts`) betekent het dat het proces nooit vanzelf
afsluit — vandaar `--test-force-exit` in het `test`-script in
`package.json`. Vergeet dat niet te behouden als je het testscript ooit
herschrijft.

## Routebestanden (`src/server/routes/*.ts`)

Zeventien bestanden, allemaal via `app.use(xRouter)` in `server.ts` gemount.
Geen enkel bestand kent een duidelijke bovengrens in regels — `spotify.ts`
(37KB, ~900 regels) is verreweg de grootste en de eerste kandidaat voor
opsplitsing.

| Bestand | Verantwoordelijkheid |
|---|---|
| `auth.ts` | login, registratie, sessie-tokens, API-sleutelbeheer |
| `playback.ts` | wachtrij, play/pause/seek/shuffle/repeat |
| `spotify.ts` | librespot event-hook (`/api/spotify/event`), OAuth, zoeken, playlist-import, artwork-lookup |
| `radio.ts` | webradio-zenders (Radio-Browser API + eigen opgeslagen lijst) |
| `radioLog.ts` | optionele radio-luistergeschiedenis lezen/wissen (`radioLogEnabled`, zie §4c in `docs/API.md`) — het vullen zelf gebeurt in `state.ts`'s ticker, niet hier |
| `nas.ts` | ruwe bestandsverkenner, map afspelen, playlist-van-map, Catalogic-webhook-endpoint |
| `nas-library.ts` | artiest→album→song-bibliotheekweergave, Catalogic-verrijking (los van `nas.ts`'s ruwe browse) |
| `playlists.ts` | opgeslagen afspeellijsten CRUD |
| `cast.ts` | cast-apparaten, start/stop, design-presets |
| `audio.ts` | DAC-selectie, hardware-mixervolume via `amixer` |
| `config.ts` | `hubConfig`-lezen/schrijven, gebruikersvoorkeuren, Catalogic-verbindingstest |
| `recognition.ts` | platenspeler/cd-herkenning (microfoon → AcoustID/AudD) |
| `system.ts` | systeeminfo, health-status, update-check/uitvoeren, DB-backup-download, herstarten/uitschakelen, netwerk-status + WiFi-scan/verbinden (`nmcli`) |
| `gpio.ts` | GPIO-hardwarekoppeling (rotary encoder + druktoets via `gpiomon`) |
| `likes.ts` | favorieten ("het hartje"), optionele Listener-push |
| `hubs.ts` | bekende-hubs CRUD voor de sidebar-apparaatwisselaar (bookmarks, geen discovery) |
| `settingsBackup.ts` | JSON-export/import van alle gebruikersinstellingen (niet hetzelfde als `system.ts`'s ruwe DB-backup) |

Elke route die muteert (niet-GET) loopt door één globale poort in
`server.ts`: een middleware die een geldige sessie/API-sleutel eist tenzij
het pad expliciet op de `PUBLIC_MUTATION_PATHS`-lijst staat (login, het
librespot event-hook-endpoint, het Catalogic-webhook-endpoint — die twee
laatste hebben hun eigen, andere verificatie: librespot draait lokaal
vertrouwd, het Catalogic-webhook checkt een HMAC-handtekening in plaats van
een sessie).

## WebSocket-events

Eén `ws`-server op `/ws`, geen Socket.io. `broadcastWebSocket(payload)` in
`state.ts` stuurt naar elke verbonden client; er is geen per-client
filtering of room-concept. Tweeëntwintig event-types bestaan (geteld via
`grep -rhoE "event:\s*'[a-z_]+'" src/server/ | sort -u` — sneller en
betrouwbaarder dan deze tabel uit het hoofd bijhouden); niet allemaal worden
ergens beluisterd:

| Event | Broadcast vanuit | Beluisterd door |
|---|---|---|
| `playback_state`, `track_change`, `queue_update` | playback/spotify/nas/radio routes | `App.tsx` (hoofd-state), `NestHubCastView.tsx` — `track_change` ook vanuit de progress-ticker bij een gewijzigde ICY-radiotag |
| `spectrum`, `progress_tick` | playback-tick-loop | live VU-meters/voortgangsbalk overal |
| `cast_state_changed`, `cast_design_updated` | `state.ts` cast-functies, `cast.ts` | `NestHubCastView.tsx` (live preview zonder herladen) |
| `volume_change`, `dac_update`, `audio_settings_update`, `crossfade_event` | audio-routes | relevante instellingen-tabbladen |
| `external_source_update` | `recognition.ts` | Bron-kiezen-paneel (platenspeler/cd-status) |
| `playlist_created` | `playlists.ts` | `App.tsx` (toast-melding) |
| `update_available` | `state.ts`'s uurlijkse `checkForAppUpdate()` | `App.tsx` → stipje op de Systeem-tab in `Sidebar.tsx` |
| `gpio_action` | `gpio.ts` | `AuthTabGpio.tsx` (eigen losse WebSocket-connectie, niet via `App.tsx`'s gedeelde socket) |
| `auth_event` | `auth.ts` | — (uitgezonden, geen huidige frontend-listener gevonden) |
| `nas_scan_progress`, `nas_backlog_reconciled` | `nasLibraryScan.ts` | **niemand** — de frontend pollt in plaats daarvan `/api/nas/scan/status` |
| `notification` | verspreid, generieke meldingen | **niemand** — geen generieke toast-consumer voor dit event |

De laatste drie rijen zijn geen bugs, maar wel iets om te weten voor je een
nieuwe live-update bouwt: een broadcast toevoegen betekent niet automatisch
dat er iets naar kijkt. Check of je ook echt een listener aan de kant van
`App.tsx` (of het specifieke component) toevoegt.

## Frontend-structuur

Geen state-management-library. `App.tsx` (1000+ regels) is de enige plek die
de WebSocket opent, de centrale `playback`/`toasts`/modal-open-state
bijhoudt, en op basis van `activeTab` een van de acht tabbladen rendert
(zie `Sidebar.tsx`'s `TABS`-array).
Elk scherm haalt verder zelf zijn eigen data op via `fetch()` en luistert
zelf naar de WS-events die het nodig heeft — er is geen gedeelde
data-laag/cache tussen componenten.

- **Schil**: `Sidebar.tsx` (8 tabs + mobiele drawer sinds 24 augustus),
  `App.tsx`'s header/footer.
- **Grote views**: `NowPlaying.tsx`, `PlaylistManager.tsx`,
  `AuthAndApiKeysView.tsx` (2000+ regels, alle instellingen-tabbladen in
  één bestand — eerste kandidaat om op te splitsen), `AdvancedAudioSettingsView.tsx`,
  `PiScriptCenter.tsx`, `WebSocketStreamView.tsx`.
- **NAS heeft twee aparte browsers**: `NasBrowser.tsx` (ruwe
  bestandsboom) en `NasMusicLibrary.tsx` (artiest→album→song, met
  Catalogic-verrijkingsknoppen) — bewust gescheiden, zie
  `docs/superpowers/specs/2026-08-22-nas-music-library-design.md`.
- **Cast-subsysteem**: zie apart hoofdstuk hieronder, is groot en complex
  genoeg om op zichzelf te staan.
- **`ui/`**: kleine gedeelde presentatiecomponenten (`Button`, `Card`,
  `Modal`, `Toggle`, `Slider`, `Toast`, …). Bijna geen styling-library
  eronder — vrijwel alle styling is inline `style={{}}` met CSS custom
  properties uit `src/styles/tokens/*.css` (`var(--bg-page)`,
  `var(--accent)`, etc.), Tailwind wordt sinds 24 augustus consequent
  gebruikt voor responsive breakpoints (`md:hidden` e.d.), niet voor
  algemene styling.

## Het cast/kiosk-subsysteem

Het meest verweven deel van de codebase — waard om apart te begrijpen voor
je hier iets aan verandert.

**Twee losse React-componenten, twee losse contexten:**
- `NestHubCastManager.tsx` — het dashboard + de "Inhoud & vormgeving"-editor,
  gerenderd binnen de normale admin-app-shell.
- `NestHubCastView.tsx` — de daadwerkelijke kiosk-pagina die op de Nest Hub
  zelf draait (bereikt via `?kiosk=1&layout=…&theme=…`), een volledig losse
  render-boom die buiten de normale app-shell om gaat en zijn eigen
  WebSocket-verbinding opent.
- De "live preview" in de editor is **geen aparte mockup** — het is een
  `<iframe>` die `NestHubCastView.tsx` in kiosk-modus laadt en dezelfde
  WebSocket-events ontvangt als een echt gecast scherm. Wijzig je iets aan
  hoe de kiosk-pagina rendert, dan verandert de preview vanzelf mee; er is
  geen aparte preview-implementatie om gesynchroniseerd te houden.

**Twee parallelle theming-mechanismen, bewust apart gehouden:**
- `src/styles/tokens/colors.css` — CSS custom properties per
  `[data-theme="x"]`, stuurt de **hele admin-webinterface** aan
  (`applyTheme()` zet gewoon een `data-theme`-attribuut op `<html>`). Vijf
  thema's: obsidian/slate/emerald/copper/daylight.
- `src/services/themeManager.ts`'s `THEME_PRESETS` — losse JS-objecten
  (`bgMain`, `accentColor`, `glowColor`, `spectrumGradient`) die
  **alleen** de kiosk-pagina aansturen, via directe JS-lookup, niet via
  CSS-variabelen (de kiosk-pagina kan niet op de CSS-scope van de
  hoofd-app leunen, die draait immers in een los tabblad/losse sessie).
  Daarom heeft `daylight` bewust **geen** entry hier: cast-tekstkleuren
  zijn per-ontwerp door de gebruiker ingesteld (default wit), dus een licht
  thema zou zonder verdere aanpassing wit-op-wit-tekst opleveren. Elke
  lookup valt terug op `obsidian` als een thema-id hier ontbreekt.

**De cast-standby-statemachine** (`state.ts`, zie ook
`tests/cast-state.test.ts` voor het gedrag): `startCast`/`stopCast` zijn de
harde aan/uit-schakelaars (echte `catt`-aanroep, sluit de hele
ontvangerpagina). Een pauze in de muziek triggert **niet** meer `stopCast`
— dat gaf een harde overgang terug naar Google's eigen idle-scherm bij elke
gewone pauze. In plaats daarvan: `scheduleAutoStopCast()` (met een
instelbare vertraging) → `enterCastStandby()`, die de sessie en pagina
levend houdt maar een merk-eigen "gereed"-scherm toont.
`maybeAutoCast()` — aangeroepen vanuit elke "iets is gestart/hervat"-route
door de hele app (playback, Spotify-hook, NAS, radio, playlists) — is het
enige aanknooppunt dat zowel de pending timer annuleert als standby
verlaat, zodat een snel hervatten binnen het vertragingsvenster nooit een
onnodige stop/standby veroorzaakt.

## Catalogic-integratie

Catalogic is een **volledig los project** (`/Volumes/DATA/dev/catalogic`),
geen gedeelde database, geen gedeelde auth — puur HTTP. HSS praat ermee via
`src/services/catalogicClient.ts`, dat een eigen module-level `config`-object
bijhoudt (`enabled`/`url`/`apiKey`), ingesteld via `configureCatalogic()` bij
het opstarten en bij elke config-wijziging.

- **Read-only voor de meeste doeleinden**: titel/artiest/albumhoes/songtekst
  opzoeken voor NAS-bestanden die alleen ruwe tags hebben.
  `lookupCatalogicSong`/`lookupCatalogicArtist`/`lookupCatalogicAlbum` zijn
  pure lookups, geen schrijfrechten nodig.
  - **Sinds deze sessie ook automatisch voor radio**: de optionele
    radio-luistergeschiedenis (`radio_log`, zie `docs/API.md` §4c) doet
    dezelfde alleen-lezen `lookupCatalogicSong` per nieuw ICY-nummer — dat
    mag automatisch vanuit de achtergrond, in tegenstelling tot de
    write-actie hieronder. Een nog onbekend nummer gaat in plaats daarvan de
    bestaande `submitCatalogicBacklog`-wachtrij in; de `song.created`-webhook
    triggert dan `reconcileRadioLogBacklog` naast `reconcileNasBacklog`.
  - **Eén write-actie**: `lookupOrCreateCatalogicSong` (via
    `/v1/songs/lookup?create_if_missing=true`) — mag Catalogic zelf een
    Spotify-based song/artist/album laten aanmaken als het nog onbekend is.
    Sinds deze sessie krijgt die aanroep ook een `album`-hint mee (welke
    release Catalogic moet verkiezen boven de populairste Spotify-hit) en
    een `force_refresh`-vlag (dwingt een verse Spotify-zoekopdracht af,
    zelfs als er al een — mogelijk verkeerde — match bestaat).
  - **Verbindingstest**: `POST /api/catalogic/test` (in `config.ts`) checkt
    zowel bereikbaarheid (`/health`) als sleutelgeldigheid (`/v1/auth/whoami`,
    een endpoint dat aan de Catalogic-kant is toegevoegd specifiek voor deze
    check). SSRF-beveiligd: alleen http(s), DNS wordt opgelost en elk
    privé/intern IP-adres wordt geweigerd voordat er iets wordt opgehaald.
  - **Webhook, andere richting**: Catalogic kan HSS terugbellen op
    `/api/catalogic/webhook` (bijv. wanneer een backlog-item alsnog is
    gematcht) — geverifieerd via een HMAC-handtekening, niet via de normale
    sessie/API-sleutel-poort (zie `PUBLIC_MUTATION_PATHS` in `server.ts`).

## Bekende valkuilen

- **Node ABI-mismatch**: het systeem-Homebrew-Node (v26+) kan
  `better-sqlite3`'s prebuilt binary niet laden. Altijd
  `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` vóór elke
  npm/node/tsc-aanroep op de dev-Mac.
- **`npm test` bouwt niet vanzelf**: `tests/smoke.test.ts` spawnt
  `dist/server.cjs` als los proces — draai altijd eerst `npm run build`
  als er backend-code is veranderd, anders test je stilletjes oude code.
- **Zombie-proces op poort 3099**: check `lsof -nP -iTCP:3099
  -sTCP:LISTEN` voor een achtergebleven testserver-proces voordat je een
  groene testrun vertrouwt — dit heeft al meerdere keren een echte
  mislukking gemaskeerd.
- **Koude-start-flakiness**: de eerste `npm test`-run na een afhankelijkheid-
  of configwijziging kan falen doordat Vite's dependency-cache herbouwt
  ("Re-optimizing dependencies") en de 20-seconden health-check-timeout
  overschrijdt — dat is geen echte regressie, gewoon opnieuw draaien.
- **Gedeelde dev-database**: lokale dev-sessies op deze Mac gebruiken
  dezelfde `/tmp/hss/hss.db` als losse testruns. Nooit een echte API-sleutel
  of wachtwoord uit deze database lezen om iets te verifiëren — een
  `401 Unauthorized`-respons is altijd voldoende bewijs dat een auth-poort
  goed staat.
- **`state.ts` direct importeren in een test vereist `--test-force-exit`**
  (zie hierboven) — zonder die vlag hangt het testproces voor altijd door de
  twee ongeclausuleerde `setInterval`-calls.
- **Deploy is geen CI/CD**: `scripts/deploy.sh` moet je handmatig via SSH
  aftrappen na een `git push`; er gebeurt niets automatisch op de Pi zelf.
- **ALSA-kaartindex is niet altijd `0`**: `piHardware.ts`'s `cardIndex`-
  detectie scant `/proc/asound/cards` en skipt bewust HDMI-kaarten — een Pi 5
  heeft er twee (`vc4hdmi0`/`vc4hdmi1`) die vóór een echte DAC-HAT
  enumereren, en op productie bleek zelfs een USB-webcam-microfoon als
  extra niet-HDMI-kaart mee te tellen. Alle `amixer`-aanroepen in
  `piHardware.ts` MOETEN `-c ${this.cardIndex}` gebruiken — een kale
  `amixer sset "Digital" ...` of hardgecodeerde `-c 0` faalt stilletjes
  (`2>/dev/null`) op elke Pi waar de DAC niet toevallig kaart 0 is, zonder
  dat er ooit een fout naar de gebruiker doorkomt. `/etc/asound.conf`'s
  `default`-apparaat routeert bewust door de `equal`-EQ-plugin heen vóór de
  echte hardware (zie README, "Bit-Perfect Routing") — zowel `mpv` als
  `librespot --device eq` moeten door die keten, nooit via een specifieke
  `hw:CARD=...`-string, anders omzeilen ze de EQ/balans-laag stilletjes.
- **Nooit twee `plug`-lagen stapelen boven de `equal`-plugin.** `pcm.!default`
  moet rechtstreeks op `eqbase` slaven, niet op `eq` (dat is zelf al een
  plug). Bij plug-over-plug breekt `snd_pcm_hw_params_any()` af met
  `snd1_pcm_hw_param_get_min: Assertion !snd_interval_empty(i)' failed` —
  een SIGABRT nog vóór er iets onderhandeld is, dus élk programma dat gewoon
  `default` opent gaat eraan. Dat is wat Spotify op de tuinhuis-Pi maandenlang
  stil hield: librespot draaide `--device default` en crashte bij elke track
  vóór de eerste sample, terwijl mpv niets merkte omdat het `eq` rechtstreeks
  aanspreekt. Systemd startte librespot elke 5 seconden opnieuw, dus van
  buiten leek het "Spotify doet gewoon niets" — zonder één foutmelding.
  Nagespeeld met een probe die librespot's hw_params-volgorde nadoet: `eq` ok,
  `default` (toen dubbel geplugd) SIGABRT in `hw_params_any`. Let ook op dat
  `eqbase` alleen FLOAT aankan (`set_format S16_LE` → "Invalid argument"), dus
  er moet altijd precies één plug boven zitten — niet nul, niet twee.
