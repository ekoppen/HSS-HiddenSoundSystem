# GPIO-hardwarekoppeling: instelbare fysieke bediening

Datum: 2026-08-24

## Aanleiding

Punt 8, derde en laatste deel — na multi-room casting (dropped, past niet
bij de single-DAC-audio-architectuur) en het lokale HDMI-scherm (al
gebouwd en gedeployed). Deze derde wens: fysieke hardware (te beginnen
met een rotary encoder met ingebouwde druktoets) aansluiten op de Pi's
GPIO-pinnen, aan een instelbare functie in de app koppelen (bijv. draaien
= volume, drukken = play/pause) — zonder dat toekomstige extra hardware
weer nieuwe code vergt, alleen nieuwe configuratie.

Dit codebase heeft vandaag geen enkele GPIO-code — alle hardware-I/O tot
nu toe is ALSA/`amixer` (`piHardware.ts`). Dit is dus een echt nieuwe
subsystem, geen uitbreiding van iets bestaands.

## Scope-beslissingen (al gemaakt met de gebruiker)

- **Rotary encoder**, geen analoge potentiometer — een encoder is digitaal
  (klikjes, stapjes omhoog/omlaag) en sluit rechtstreeks op GPIO aan.
  Een potmeter zou een aparte ADC-chip (bijv. MCP3008) hebben gevergd,
  omdat Pi GPIO-pinnen alleen digitale aan/uit-signalen kunnen lezen —
  bewust vermeden voor nu.
- **Algemeen instelbaar systeem**, geen hardgecodeerde ene knop — pin
  kiezen, apparaattype kiezen, functie toewijzen per signaal, allemaal in
  de UI. Toekomstige hardware = nieuw "apparaattype" toevoegen aan de
  driver-laag, geen herontwerp van de configuratielaag zelf.
- **Eén apparaattype in v1**: rotary encoder met ingebouwde druktoets
  (3 signalen: draai-A, draai-B, druktoets). Losse knoppen als apart
  apparaattype is een logische, maar nog niet gevraagde, uitbreiding.
- **Drie acties in v1**: draai-omhoog → volume omhoog, draai-omlaag →
  volume omlaag, druktoets → play/pause. Vaste stapgrootte van 2% per
  klik (een module-constante, niet zelf instelbaar in v1 — triviaal later
  een instelveld van te maken zonder de rest van het ontwerp te raken).
- **Geen ADC, geen analoge input** — alles wat deze v1 bouwt is digitale
  GPIO (edge-detection), geen analoog-naar-digitaal conversie.

## Technische aanpak: `libgpiod` CLI-tools, geen native Node-binding

Bookworm (waar de README al vanuit gaat) heeft de oude `/sys/class/gpio`
sysfs-interface niet meer standaard beschikbaar — de moderne interface is
`libgpiod` via `/dev/gpiochip0`. In plaats van een native Node
GPIO-addon (compilatierisico op ARM, niet gegarandeerd prebuilt voor elke
Pi-variant) hergebruikt dit ontwerp het patroon dat de rest van deze
codebase al consequent toepast: shell out naar gevestigde Linux
CLI-tools (`catt`, `amixer`, `mount`, `systemctl`) in plaats van native
bindings. `libgpiod`'s eigen CLI (het `gpiod` Debian-pakket, met o.a.
`gpiomon`) is hier het equivalent.

`gpiomon` kan continu edge-events op een of meerdere pinnen streamen naar
stdout totdat het proces gestopt wordt — precies het patroon van een
lang-lopend, event-gestuurd kind-proces (`child_process.spawn`, niet
`exec`/`execSync`), waarvan de `stdout`-events regel voor regel verwerkt
worden.

### Quadrature-decodering (hoe een rotary encoder "richting" geeft)

Een rotary encoder heeft twee signalen (A en B) die in een vaste volgorde
wisselen afhankelijk van de draairichting. Dit is een pure, goed
gedefinieerde state-transitie-tabel — geen hardware nodig om te
implementeren of te testen. `gpiomon` op beide pinnen (A en B) tegelijk
gevolgd, elke edge-event bijgewerkt in een klein state-object, en bij elke
volledige overgang wordt bepaald of dat een stap met- of tegen-de-klok-in
was.

### Geen apart systemd-unit, geen geautomatiseerde package-install

In tegenstelling tot het lokale HDMI-scherm (dat `cage`+`chromium-browser`
nodig had, zwaar genoeg om een eigen systemd-service en een
geautomatiseerde installatiestap te rechtvaardigen) is de GPIO-watcher een
kind-proces van de hoofdserver zelf (`hss.service`, al altijd actief) —
gestart/gestopt zodra de gebruiker het aan/uitzet, en automatisch herstart
bij het opstarten van de server als het laatst aanstond (zelfde patroon
als `loadDiskConfig()`). `gpiod` zelf is een klein, licht Debian-pakket —
gedocumenteerd als extra `apt-get`-vereiste in de README, net als
`nfs-common`/`mpv`/etc. nu al zijn, in plaats van een geautomatiseerde
installatieroute zoals bij het HDMI-scherm.

## Botsing met DAC-pinnen (bekend risico, hier al opgelost)

Een I2S-DAC-HAT gebruikt altijd dezelfde vaste BCM-pinnen (18, 19, 20, 21
voor I2S; 2, 3 voor I2C, indien de DAC I2C-configuratie nodig heeft) —
dit is een vaste Raspberry Pi HAT-conventie, niet iets dat per DAC-model
verschilt. `dacConfig`/`AVAILABLE_AUDIO_DEVICES` houdt vandaag geen
specifieke pinnummers bij (alleen `type: 'i2s_dac'` + een `dtoverlay`
string) — dus in plaats van pin-informatie te proberen af te leiden per
DAC-model, gebruikt dit ontwerp een vaste, hardgecodeerde
"gereserveerde pinnen"-lijst die altijd geldt zodra een I2S-DAC actief is:

```ts
const RESERVED_GPIO_PINS = {
  i2s: [18, 19, 20, 21],
  i2c: [2, 3],
};
```

Alle pinnummers in dit ontwerp — hier en in `GpioDeviceConfig` hieronder —
zijn **BCM GPIO-nummers** (wat `libgpiod`/`gpiomon` ook verwacht), niet de
fysieke pin-positie op de 40-pins header (die twee tellingen lopen
uiteen). De UI labelt dit expliciet ("GPIO 17 (BCM)") om een
verkeerde-pin-bekabelingsfout te voorkomen.

De pin-kiezer in de UI toont deze pinnen als niet-selecteerbaar zodra
`dacConfig`'s actieve device `type === 'i2s_dac'` is, én de backend
valideert dit onafhankelijk nog een keer bij het opslaan (net zoals
`isSafeAlsaDevice` elders al doet) — verdedigd op twee lagen, niet alleen
in de UI.

## Nieuwe systeemcomponenten

### 1. `src/services/gpioService.ts` (nieuw)

```ts
export type GpioAction = 'volume_up' | 'volume_down' | 'play_pause';

export interface GpioDeviceConfig {
  id: string;
  deviceType: 'rotary_encoder_button';
  pinA: number;
  pinB: number;
  pinButton: number;
  actionRotateCw: GpioAction;
  actionRotateCcw: GpioAction;
  actionButtonPress: GpioAction;
  enabled: boolean;
}

export interface GpioStatus {
  gpiodInstalled: boolean;
  watcherRunning: boolean;
  reservedPins: number[]; // computed from the currently active DAC
}

// Pure, hardware-independent — directly unit-testable.
export function decodeQuadratureStep(
  prev: { a: 0 | 1; b: 0 | 1 },
  next: { a: 0 | 1; b: 0 | 1 },
): -1 | 0 | 1 { /* standard quadrature state-transition table */ }

export function getReservedGpioPins(activeDacType: string | undefined): number[] { /* ... */ }

export function detectGpioStatus(activeDacType: string | undefined): GpioStatus { /* ... */ }

export function startGpioWatcher(config: GpioDeviceConfig, onAction: (action: GpioAction) => void): void { /* spawns gpiomon, wires decodeQuadratureStep + edge events to onAction */ }

export function stopGpioWatcher(): void { /* ... */ }
```

`onAction` is a callback the route layer supplies, calling the exact same
internal functions the web UI's own volume slider / play-pause button
already trigger (`handleVolumeChange`/`handleToggle`-equivalent
server-side functions in `state.ts`) — no new playback logic, a new input
source feeding the existing one.

### 2. Nieuwe route: `src/server/routes/gpio.ts`

```ts
router.get('/api/gpio/status', (req, res) => { ... }); // gpiod installed?, watcher running?, reserved pins, current config
router.post('/api/gpio/config', requireAudioPermission('admin:all'), (req, res) => { ... }); // save device config, validates against reserved pins
router.post('/api/gpio/enable', requireAudioPermission('admin:all'), (req, res) => { ... });
router.post('/api/gpio/disable', requireAudioPermission('admin:all'), (req, res) => { ... });
```

`admin:all` — zelfde afweging als de andere hardware-routes (NAS mount,
systeemtijd): dit stuurt fysieke GPIO-pinnen aan, geen taak voor een
scoped integratiesleutel. `POST /api/gpio/config` is een plain
replace/upsert van de ene `GpioDeviceConfig` — v1 ondersteunt precies één
apparaat (zie scope-beslissingen), dus geen lijst-/id-gebaseerde
create/update/delete-semantiek nodig.

### 3. Persistentie: `gpioConfig` in `state.ts`

Eén `GpioDeviceConfig | null` (v1 ondersteunt precies één apparaat),
opgeslagen via het bestaande `setDbConfig`/`getDbConfig`-patroon, net als
`castSettingsState`. Bij serverstart (`loadDiskConfig()`-equivalent): als
er een opgeslagen config is met `enabled: true`, start de watcher meteen
— geen aparte "boot-time" logica nodig, de server zelf is al de altijd-
actieve component.

### 4. Frontend: `src/components/AuthTabGpio.tsx` (nieuw)

Volgt exact het `AuthTab*.tsx`-patroon dat deze sessie al is gezet
(`AuthTabSpotify.tsx`, `AuthTabNas.tsx`, etc. — zelfstandige, prop-loze
instellingen-kaarten die hun eigen state en fetch-logica bezitten) — een
nieuwe sub-tab in `AuthAndApiKeysView.tsx`, naast NAS/Catalogic/etc.:

- Pin-kiezers voor A/B/druktoets (gereserveerde pinnen grijs/niet-
  selecteerbaar, met een tooltip die uitlegt waarom).
- Actie-dropdowns per signaal (v1: alleen de 3 vaste acties, maar als een
  `<select>` met een vaste lijst — triviaal uit te breiden later).
- Aan/uit-toggle + statusbadge (Actief / Uitgeschakeld / "gpiod niet
  geïnstalleerd — installeer via `apt-get install gpiod`").

## Foutafhandeling / zichtbare status (aansluitend bij punt 7)

- `gpiod` niet geïnstalleerd → statusbadge zegt dit expliciet met de
  installatie-instructie, in plaats van de watcher stilzwijgend nooit te
  starten.
- Ongeldige pin (gereserveerd, of dubbel toegewezen aan twee signalen) →
  harde 400 bij opslaan, met duidelijke foutmelding — niet stilzwijgend
  opslaan en pas bij het inschakelen laten falen.
- Watcher-subprocess crasht (bijv. bekabeling losgekomen) → status toont
  "Uitgeschakeld — onverwacht gestopt", niet stilzwijgend "Actief" blijven
  tonen terwijl er niets meer gelezen wordt.

## Niet in scope (v1)

- Analoge input (potentiometer + ADC).
- Meerdere gelijktijdige apparaten.
- Andere apparaattypes dan rotary-encoder-met-druktoets (losse knoppen,
  toggle-schakelaars, sensoren).
- Instelbare stapgrootte voor volume per klik (vast in v1).
- Lange-druk (long-press) als apart signaal naast een korte druk.

## Testplan

- Unit: `decodeQuadratureStep` — de kern van de encoder-logica, volledig
  hardware-onafhankelijk, testbaar met een reeks (prev, next) A/B-paren
  tegen de bekende state-transitie-tabel (CW-reeks, CCW-reeks, geen
  overgang, een overgeslagen/dubbele edge).
- Unit: `getReservedGpioPins` — met/zonder actieve I2S-DAC.
- Unit: pin-conflictvalidatie in de `/api/gpio/config`-route (zelfde
  patroon als bestaande input-validatietests elders in dit project).
- Smoke: onbeauthenticeerde `POST /api/gpio/config`/`enable`/`disable` →
  401 (regressie-patroon zoals de rest van de admin-gated routes).
- Handmatige verificatie op de echte Pi met een echte rotary encoder
  aangesloten — net als bij het HDMI-scherm geen manier om dit end-to-end
  te testen zonder echte hardware.
