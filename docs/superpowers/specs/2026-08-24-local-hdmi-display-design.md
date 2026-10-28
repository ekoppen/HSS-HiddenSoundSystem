# Lokaal HDMI-scherm: kiosk-weergave rechtstreeks vanaf de Pi

Datum: 2026-08-24

## Aanleiding

Punt 8 van de productanalyse-verbeterlijst was oorspronkelijk "multi-room
casting". Bij het scherpstellen bleek dat HSS altijd al maar één
audio-stream naar één DAC/versterker stuurt (casten naar een Nest Hub
toont alleen het visuele scherm, niet het geluid) — echte losse
audiozones zou een compleet andere audio-architectuur vergen (meerdere
DAC's/eindpunten of een protocol als Snapcast). De gebruiker heeft die
richting laten vallen na deze uitleg.

In plaats daarvan: de mogelijkheid om dezelfde kiosk-weergave (albumhoes,
klok, spectrum — precies wat nu op een gecaste Nest Hub verschijnt) ook
rechtstreeks op een HDMI-scherm te tonen dat op de Pi zelf is aangesloten,
zonder Chromecast/`catt` ertussen. De Pi draait headless (Raspberry Pi OS
Lite, geen bureaublad) — dat bepaalt de hele technische aanpak hieronder.

## Scope-beslissingen (al gemaakt met de gebruiker)

- **Geen losse audiozones** — dit blijft puur een tweede plek om dezelfde
  visuele weergave te tonen, geen aparte audio-routing.
- **Altijd aan bij opstarten**, niet handmatig aan/uit zoals Nest Hub
  casten — een vast scherm dat continu de kiosk-weergave toont, onafhankelijk
  van of iemand de webinterface open heeft.
- **Hergebruikt de bestaande kiosk-pagina 1-op-1** — geen nieuwe
  rendering, geen aparte layout-code. Dezelfde `?kiosk=1` URL die `catt`
  nu op een Nest Hub opent.
- **Eén gedeeld ontwerp** — het lokale scherm gebruikt dezelfde
  opgeslagen `layout`/`themeId` als Cast-instellingen (`castSettingsState`),
  niet een eigen onafhankelijke configuratie. Wijzig je het ontwerp, dan
  werkt dat live door op het lokale scherm, net als nu al bij een actief
  gecast Nest Hub-scherm (via het bestaande `cast_design_updated`
  WebSocket-event — de kiosk-pagina leest zijn weergave al live bij, dus
  het lokale scherm hoeft nooit herladen te worden bij een ontwerpwijziging).
- **Draait onafhankelijk van Nest Hub casten** — beide kunnen tegelijk
  actief zijn (het lokale scherm via systemd, Nest Hub casten via het
  bestaande `catt`-mechanisme); ze delen alleen het ontwerp, niet de
  aan/uit-status.
- **Geen reboot nodig** om het scherm te activeren — in tegenstelling tot
  DAC-provisionering (die een device-tree overlay in `config.txt` wijzigt)
  start dit alleen een nieuwe systemd-service; `systemctl enable --now`
  is voldoende.
- **Installatie synchroon met duidelijke voortgang** — het aanzetten van
  de toggle installeert ontbrekende pakketten en toont dat proces stap
  voor stap (zelfde patroon als de bestaande Setup Wizard: een
  `ProvisioningLogEntry[]`-log), niet een optimistische toggle met een
  melding achteraf. Mislukt de installatie, dan springt de toggle terug
  naar uit met een duidelijke foutmelding.

## Technische aanpak: `cage` + `chromium-browser`

Bookworm (waar de README al vanuit gaat) gebruikt standaard Wayland. De
door de Raspberry Pi Foundation zelf aanbevolen aanpak voor een
kiosk-browser op een headless installatie is
[`cage`](https://github.com/cage-kiosk/cage) — een minimale
Wayland-compositor die precies één applicatie fullscreen toont, zonder
X11 of een volledige desktopomgeving. Daarbinnen draait
`chromium-browser --kiosk` met de Wayland/ozone-backend, gericht op de
bestaande kiosk-URL.

```
cage -- chromium-browser --kiosk --ozone-platform=wayland \
  --disable-infobars --noerrdialogs --incognito \
  'http://localhost:<PORT>/?kiosk=1'
```

- `--incognito`: geen browserstatus die tussen herstarts blijft hangen
  (geen cache-conflicten met de PWA-achtige kiosk-pagina).
- `--noerrdialogs --disable-infobars`: voorkomt dat een netwerkhikje een
  zichtbare Chromium-foutdialoog op het scherm laat staan.
- Poort komt uit dezelfde `PORT`-constante als de rest van de server
  (`system.ts` gebruikt die al voor `generatePiInstallScript`).

## Nieuwe systeemcomponenten

### 1. `PiSetupService` (`src/services/piSetup.ts`) — nieuwe provisioning-stap

Nieuwe publieke methode naast het bestaande `autoProvisionSystem`:

```ts
export interface KioskDisplayStatus {
  packagesInstalled: boolean;
  serviceEnabled: boolean;
  serviceActive: boolean;
}

public detectKioskDisplayStatus(): KioskDisplayStatus { ... }

public async enableLocalKioskDisplay(webPort: number): Promise<{
  success: boolean;
  logs: ProvisioningLogEntry[];
}> { ... }

public async disableLocalKioskDisplay(): Promise<{
  success: boolean;
  logs: ProvisioningLogEntry[];
}> { ... }
```

`enableLocalKioskDisplay` volgt exact het bestaande stappenpatroon uit
`autoProvisionSystem` (elke stap pusht een `ProvisioningLogEntry` met
`step`/`status`/`message`/`timestamp`, ongeacht succes doorgaan naar de
volgende stap waar zinvol, falen bij een stap die de rest onbruikbaar
maakt):

1. **Pakketten controleren/installeren** — `which cage` en
   `dpkg -s chromium-browser`; ontbrekende pakketten via
   `apt-get install -y cage chromium-browser` (`execFile`, argv-array,
   zelfde patroon als de mount-commando's in `nas.ts` — nooit een
   shell-string). Faalt dit (geen internet, repo-fout), dan stopt de
   stap hier met een duidelijke foutmelding — de resterende stappen
   worden overgeslagen.
2. **Systemd-unit wegschrijven** — `/etc/systemd/system/hss-kiosk-display.service`,
   zelfde schrijfpatroon als de bestaande `librespot-hss.service` in
   `autoProvisionSystem` (regel ~357), met dezelfde argv-escaping-voorzichtigheid
   die daar al gedocumenteerd staat.
3. **Service inschakelen + starten** — `systemctl enable --now hss-kiosk-display.service`.
4. **Kort verifiëren** — `systemctl is-active` na een korte wachttijd;
   niet-actief (bijv. geen HDMI-scherm aangesloten, `cage` kan geen
   output vinden) wordt gerapporteerd als waarschuwing, niet als harde
   fout — de service blijft ingeschakeld en probeert het vanzelf
   opnieuw zodra er wel een scherm is (systemd `Restart=on-failure`).

`disableLocalKioskDisplay` is het spiegelbeeld: `systemctl disable --now`.
Geen pakketten verwijderen — alleen de service stopt met gebruiken.

Voorbeeld systemd-unit — draait als `root`, zelfde precedent als de
bestaande `librespot-hss.service` hierboven (die ook `User=root` gebruikt,
voor RT-priority/memlock-rechten). Dat omzeilt meteen de vraag of de
service-gebruiker aan de `video`/`render`-groepen moet, wat anders niet
zonder echte hardware met een DRM/KMS-stack te verifiëren is. Chromium
weigert als root te draaien zonder `--no-sandbox` — die vlag hoort er dus
bij; `cage` zelf (een compositor, geen browser) heeft geen vergelijkbare
weigering:

```ini
[Unit]
Description=HSS Lokale Kiosk-weergave (HDMI)
After=network.target sound.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/cage -- /usr/bin/chromium-browser --kiosk --no-sandbox --ozone-platform=wayland --disable-infobars --noerrdialogs --incognito "http://localhost:${webPort}/?kiosk=1"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`WantedBy=multi-user.target`, niet `graphical.target` — een Lite-installatie
bereikt nooit `graphical.target` (dat vereist een display-manager-keten
die er niet is); `cage` is hier zelf de volledige sessie, het heeft geen
voorafgaand grafisch target nodig om op te starten.

**Resterend risico, te verifiëren op echte hardware:** of `cage` zonder
extra configuratie het aangesloten HDMI-scherm als primaire output
oppikt. Dit is de plek waar de door de gebruiker voorbereide Pi 3B+ met
scherm het eerst getest wordt.

### 2. Nieuwe route: `src/server/routes/system.ts`

```ts
router.get('/api/setup/kiosk-display', (req, res) => { ... }); // status
router.post('/api/setup/kiosk-display/enable', requireAudioPermission('admin:all'), async (req, res) => { ... });
router.post('/api/setup/kiosk-display/disable', requireAudioPermission('admin:all'), async (req, res) => { ... });
```

`admin:all` — zelfde afweging als de bestaande `/api/setup/*`-routes
(zie de security-hardening van punt 6): dit installeert systeempakketten
en schrijft een root-owned systemd-unit, geen taak voor een
scoped integratie-sleutel.

### 3. Frontend: `AuthTabNas.tsx` of nieuwe `AuthTabDisplay.tsx`?

Gezien dit conceptueel dicht bij Cast-instellingen zit (het gaat over
"waar laat ik de kiosk-weergave zien"), maar geen NAS-gerelateerde state
nodig heeft, krijgt dit een plek in `NestHubCastManager.tsx`
(`src/components/NestHubCastManager.tsx`) — een nieuwe kaart naast "1.
Cast apparaat", met dezelfde `cardHeaderStyle`/`Card`-conventies als de
rest van dat scherm:

- Toggle: "Toon dit scherm automatisch bij opstarten (lokaal HDMI-scherm)".
- Tijdens installatie: voortgangslijst (hergebruikt hetzelfde
  `ProvisioningLogEntry[]`-renderpatroon als `PiScriptCenter.tsx` al voor
  de Setup Wizard toont).
- Statusbadge: "Actief" / "Uitgeschakeld" / "Pakketten ontbreken —
  installeer via de toggle" / "Scherm niet gevonden" (uit
  `detectKioskDisplayStatus`).

## State-model

Geen wijziging aan `castSessionState`/`castSettingsState` nodig — het
lokale scherm is geen "cast target" in die zin (geen `activeDeviceId`,
geen `catt`-aanroep). De enige nieuwe persistente staat is of de
systemd-service is ingeschakeld, en dat leest de app on-demand via
`systemctl is-enabled`/`is-active` (`detectKioskDisplayStatus`) in plaats
van een eigen databasekolom bij te houden — systemd is hier al de bron
van waarheid, dupliceren zou uit sync kunnen raken na een handmatige
`systemctl`-ingreep buiten de app om.

## Foutafhandeling / zichtbare status (aansluitend bij punt 7)

- Pakket-installatie mislukt → duidelijke foutregel in de log, toggle
  terug naar uit, geen halve installatie blijft "aan" ogen.
- Service start maar wordt niet actief (geen scherm aangesloten) →
  service blijft *ingeschakeld* (want "je hebt het aangezet, het werkt
  zodra er een scherm is"), maar de statusbadge toont expliciet "Scherm
  niet gevonden" in plaats van stilzwijgend "Actief" te tonen terwijl er
  niets te zien is.

## Niet in scope (v1)

- Onafhankelijk ontwerp per scherm (lokaal vs. Nest Hub) — beide delen nu
  één `castSettingsState`.
- Meerdere lokale schermen (bijv. een Pi met twee HDMI-poorten) — één
  `cage`-instantie, één output.
- Automatische installatie van de onderliggende Wayland/DRM-stack zelf
  (`libgl1-mesa-dri`, firmware) — aangenomen dat een stock Bookworm Lite
  install dat al meebrengt; als dat niet zo blijkt, wordt dat een
  aanvulling op stap 1 hierboven, niet een nieuw ontwerp.

## Testplan

- Unit: `detectKioskDisplayStatus`/`enableLocalKioskDisplay`/`disableLocalKioskDisplay`
  zijn moeilijk zuiver te unit-testen (echte `systemctl`/`apt-get`
  side-effects) — zelfde afweging als de bestaande `autoProvisionSystem`,
  die ook geen directe unit-tests heeft. Wel testbaar: de systemd-unit-string
  generatie zelf (argv-escaping van `webPort`) als pure functie, zoals
  `piSetup.ts` dat al voor de librespot-unit doet.
- Smoke: `GET /api/setup/kiosk-display` zonder credential → 401 (regressie
  op het bestaande mutation-gate-patroon); `POST .../enable` met een
  scoped (niet-admin) sleutel → 403.
- Handmatige verificatie op de echte Pi met een aangesloten scherm —
  geen manier om dit in de bestaande geëmuleerde dev-omgeving (macOS)
  end-to-end te testen.
