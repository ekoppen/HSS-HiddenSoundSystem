import fs from 'fs';
import { exec, execSync } from 'child_process';
import { AudioDevice, HubConfig } from '../types.ts';

export interface SetupDetectionResult {
  isLinux: boolean;
  isRaspberryPi: boolean;
  piModel: string;
  kernel: string;
  configFile: string | null;
  hasDacOverlay: boolean;
  overlayName: string | null;
  detectedAlsaCards: { id: string; name: string; raw: string }[];
  isHifiberryDetected: boolean;
  hasLibrespotBinary: boolean;
  isLibrespotServiceActive: boolean;
  hasEventHookScript: boolean;
  needsReboot: boolean;
}

export interface ProvisioningOptions {
  dacId: string;
  deviceName: string;
  bitrate: string;
  enableVolumeNormalisation: boolean;
  webPort: number;
}

export interface ProvisioningLogEntry {
  step: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export interface KioskDisplayStatus {
  packagesInstalled: boolean;
  serviceEnabled: boolean;
  serviceActive: boolean;
}

const KIOSK_DISPLAY_SERVICE_NAME = 'hss-kiosk-display';
const KIOSK_DISPLAY_UNIT_PATH = `/etc/systemd/system/${KIOSK_DISPLAY_SERVICE_NAME}.service`;

// Debian/Raspberry Pi OS renamed the real chromium binary from
// chromium-browser to plain chromium at some point (chromium-browser is
// now only a transitional dummy package that pulls chromium in as a
// dependency but installs no /usr/bin/chromium-browser executable) —
// verified live: `apt-get install chromium-browser` succeeds and reports
// installed, but ExecStart=/usr/bin/chromium-browser then fails with
// "Failed to spawn client: No such file or directory". Resolve whichever
// binary actually exists rather than assuming a name; chromium-browser
// stays as a last-resort fallback for older Pi OS releases that never
// renamed it.
export function resolveChromiumBinary(): string {
  try {
    return execSync('which chromium', { encoding: 'utf8' }).trim();
  } catch {}
  try {
    return execSync('which chromium-browser', { encoding: 'utf8' }).trim();
  } catch {}
  return '/usr/bin/chromium-browser';
}

// `default` and `eq` both route through the `equal` plugin before reaching
// the real hardware — this is what makes EQ and balance apply platform-wide
// (mpv and librespot both address `eq`) instead of only affecting NAS/radio
// playback like a player-specific filter chain would. EQ bands are controlled live via
// `amixer -D eqbase sset '<band>' <val>` (see PiHardwareService.
// setHardwareEqualizer); balance applies separately at the hifisoloist mixer
// itself (setHardwareVolume). hifisoloist_plug exists because the `equal`
// plugin cannot negotiate hw_params directly against a bare `type hw` slave
// on every Pi — confirmed live on one unit: speaker-test/aplay against
// eqbase failed with "Slave PCM not usable" / "Invalid argument" while the
// same hifisoloist device worked fine addressed directly. A plug layer in
// between lets ALSA do the format/rate conversion the equal plugin itself
// does not do — harmless on units that didn't need it, so this is applied
// unconditionally rather than only on hardware known to require it.
export function buildAsoundConf(): string {
  return `# /etc/asound.conf - Auto-provisioned by HSS HiFi Hub
# Exactly ONE plug above eqbase — slaving this to "eq" instead would stack a
# second plug (eq is itself a plug), and two of them make
# snd_pcm_hw_params_any() abort with
# \`snd1_pcm_hw_param_get_min: Assertion !snd_interval_empty(i)' failed\`,
# killing every program that simply opens \`default\`. That is what silently
# broke Spotify: librespot ran --device default and crashed on every track
# before playing a sample, while mpv was fine because it addresses eq.
pcm.!default {
    type plug
    slave.pcm "eqbase"
}

ctl.!default {
    type hw
    card 0
}

pcm.hifisoloist {
    type hw
    card 0
    device 0
}

pcm.hifisoloist_plug {
    type plug
    slave.pcm "hifisoloist"
}

pcm.eqbase {
    type equal
    slave.pcm "hifisoloist_plug"
}

ctl.eqbase {
    type equal
}

pcm.eq {
    type plug
    slave.pcm "eqbase"
}

pcm.softvol {
    type softvol
    slave.pcm "hifisoloist"
    control {
        name "SoloistMaster"
        card 0
    }
    min_dB -51.0
    max_dB 0.0
}
`;
}

// webPort always comes from state.ts's own PORT constant server-side, but
// it still lands inside a double-quoted ExecStart= segment below — same
// defensive validation as the deviceName/bitrate handling in
// autoProvisionSystem, applied at the actual sink rather than trusting
// every future caller.
export function buildKioskDisplayUnit(webPort: number, chromiumPath: string = '/usr/bin/chromium-browser', kioskToken?: string): string {
  const safePort = Number.isInteger(webPort) && webPort > 0 && webPort < 65536 ? webPort : 3000;
  // Without a token in the URL fragment, this chromium instance (launched
  // --incognito, so it never has a stored session either) has no way to
  // authenticate its own play/pause/volume/etc requests — the server
  // rejects every one with 401 while the touch UI updates optimistically
  // anyway, making every control look like it works when nothing actually
  // reaches the hardware. See buildKioskUrl() in state.ts for the same
  // pattern used by the Cast flow.
  const tokenFragment = kioskToken ? `#token=${encodeURIComponent(kioskToken)}` : '';
  return `[Unit]
Description=HSS Lokale Kiosk-weergave (HDMI)
After=network.target sound.target hss.service
Wants=hss.service

[Service]
Type=simple
User=root
RuntimeDirectory=cage
Environment=XDG_RUNTIME_DIR=/run/cage
ExecStart=/usr/bin/cage -- ${chromiumPath} --kiosk --no-sandbox --ozone-platform=wayland --disable-infobars --noerrdialogs --incognito "http://localhost:${safePort}/?kiosk=1${tokenFragment}"
# cage draws its own cursor sprite at the compositor level whenever a
# touchscreen reports pointer capability — a known, unresolved upstream
# limitation (no page CSS or client cursor-surface protocol can hide it;
# see cage-kiosk/cage#83, #299, #422, #235). wlrctl's relative pointer-move,
# via the native wlroots virtual-pointer protocol, is the only thing that
# actually works: nudge it far past any real resolution once cage's Wayland
# socket is up, and a touch-only kiosk has nothing to move it back with.
# Retried for a few seconds since that socket isn't ready the instant
# ExecStart fires; best-effort (|| true) so a slow boot never fails the unit.
ExecStartPost=/bin/sh -c 'for i in 1 2 3 4 5; do sleep 1; wlrctl pointer move 5000 5000 2>/dev/null && break; done || true'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

export class PiSetupService {
  private isLinux: boolean = process.platform === 'linux';

  public detectSetupStatus(audioDevices: AudioDevice[]): SetupDetectionResult {
    const isLinux = process.platform === 'linux';
    let isRaspberryPi = false;
    let piModel = 'Emulated Dev Environment (Pi 4B)';
    let kernel = 'Darwin / Dev OS';
    let configFile: string | null = null;
    let hasDacOverlay = false;
    let overlayName: string | null = null;
    const detectedAlsaCards: { id: string; name: string; raw: string }[] = [];
    let isHifiberryDetected = false;
    let hasLibrespotBinary = false;
    let isLibrespotServiceActive = false;
    let hasEventHookScript = false;
    let needsReboot = false;

    if (isLinux) {
      // 1. Detect Pi Model
      try {
        if (fs.existsSync('/proc/device-tree/model')) {
          piModel = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
          isRaspberryPi = true;
        }
      } catch {}

      // 2. Detect Kernel
      try {
        kernel = execSync('uname -r', { encoding: 'utf8' }).trim();
      } catch {
        kernel = 'Linux Generic';
      }

      // 3. Locate /boot config file (Bookworm uses /boot/firmware/config.txt)
      if (fs.existsSync('/boot/firmware/config.txt')) {
        configFile = '/boot/firmware/config.txt';
      } else if (fs.existsSync('/boot/config.txt')) {
        configFile = '/boot/config.txt';
      }

      // 4. Check for DAC Overlay in config.txt
      if (configFile) {
        try {
          const configContent = fs.readFileSync(configFile, 'utf8');
          for (const dac of audioDevices) {
            if (dac.dtoverlay && configContent.includes(dac.dtoverlay)) {
              hasDacOverlay = true;
              overlayName = dac.name;
              break;
            }
          }
        } catch {}
      }

      // 5. Detect ALSA Soundcards in /proc/asound/cards
      try {
        if (fs.existsSync('/proc/asound/cards')) {
          const cardsContent = fs.readFileSync('/proc/asound/cards', 'utf8');
          const lines = cardsContent.split('\n');
          for (const line of lines) {
            if (line.match(/^\s*\d+\s+\[/)) {
              const raw = line.trim();
              const isHifi = raw.toLowerCase().includes('hifiberry') || raw.toLowerCase().includes('snd_rpi_hifiberry');
              if (isHifi) isHifiberryDetected = true;
              detectedAlsaCards.push({
                id: 'card-' + detectedAlsaCards.length,
                name: isHifi ? 'HiFiBerry DAC+ I2S' : raw,
                raw,
              });
            }
          }
        }
      } catch {}

      // 6. Check if Librespot is installed
      hasLibrespotBinary = fs.existsSync('/usr/local/bin/librespot') || fs.existsSync('/usr/bin/librespot');

      // 7. Check if Librespot service is running
      try {
        const svcStatus = execSync('systemctl is-active librespot-hss 2>/dev/null || true', { encoding: 'utf8' }).trim();
        isLibrespotServiceActive = svcStatus === 'active';
      } catch {}

      // 8. Check if event hook script is present
      hasEventHookScript = fs.existsSync('/opt/hss/spotify-event.sh');

      // 9. Needs reboot if overlay was added but card not in ALSA yet
      if (hasDacOverlay && !isHifiberryDetected) {
        needsReboot = true;
      }
    }

    return {
      isLinux,
      isRaspberryPi,
      piModel,
      kernel,
      configFile,
      hasDacOverlay,
      overlayName,
      detectedAlsaCards,
      isHifiberryDetected,
      hasLibrespotBinary,
      isLibrespotServiceActive,
      hasEventHookScript,
      needsReboot,
    };
  }

  private isKioskDisplaySoftwareInstalled(): boolean {
    try {
      execSync('which cage', { stdio: 'ignore' });
    } catch {
      return false;
    }
    // Drives the ExecStartPost cursor-park command in buildKioskDisplayUnit —
    // without it the unit's cursor fix silently no-ops on real hardware.
    try {
      execSync('which wlrctl', { stdio: 'ignore' });
    } catch {
      return false;
    }
    try {
      execSync('which chromium', { stdio: 'ignore' });
      return true;
    } catch {}
    try {
      execSync('which chromium-browser', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public detectKioskDisplayStatus(): KioskDisplayStatus {
    if (!this.isLinux) {
      return { packagesInstalled: false, serviceEnabled: false, serviceActive: false };
    }

    const packagesInstalled = this.isKioskDisplaySoftwareInstalled();

    let serviceEnabled = false;
    try {
      const out = execSync(`systemctl is-enabled ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      serviceEnabled = out === 'enabled';
    } catch {}

    let serviceActive = false;
    try {
      const out = execSync(`systemctl is-active ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      serviceActive = out === 'active';
    } catch {}

    return { packagesInstalled, serviceEnabled, serviceActive };
  }

  public async enableLocalKioskDisplay(webPort: number, kioskToken?: string): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }> {
    const logs: ProvisioningLogEntry[] = [];
    const addLog = (step: string, status: ProvisioningLogEntry['status'], message: string) => {
      logs.push({ step, status, message, timestamp: new Date().toLocaleTimeString() });
    };

    addLog('Init', 'pending', 'Start installatie van lokaal kiosk-scherm...');

    if (!this.isLinux) {
      addLog('Omgeving', 'warning', 'Ontwikkelingsomgeving (niet-Linux). Installatie wordt virtueel gesimuleerd.');
      addLog('Pakketten', 'success', 'cage, wlrctl en chromium geïnstalleerd (virtueel).');
      addLog('Systemd-unit', 'success', `${KIOSK_DISPLAY_UNIT_PATH} weggeschreven (virtueel).`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service ingeschakeld en gestart (virtueel).`);
      return { success: true, logs };
    }

    // apt-get, writing to /etc/systemd/system and systemctl enable --now all
    // require root — the deployed soloist-hub.service already runs as
    // User=root, so this only bites when the app is started manually
    // (e.g. `npm start` as a regular user) for local testing on real hardware.
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      addLog('Rechten', 'error', 'Deze functie vereist root-rechten. Start de app als root, bijv. met "sudo npm start" (de systemd-service doet dit al automatisch via User=root).');
      return { success: false, logs };
    }

    // 1. Packages
    const packagesInstalled = this.isKioskDisplaySoftwareInstalled();

    if (!packagesInstalled) {
      addLog('Pakketten', 'pending', 'cage, wlrctl en/of chromium ontbreken, installeren via apt-get...');
      try {
        execSync('apt-get update -y', { stdio: 'pipe' });
      } catch {
        // best-effort — proceed to install even if this fails, the existing index may still work
      }
      try {
        // "chromium" is the real package on current Debian/Raspberry Pi OS —
        // chromium-browser is now only a transitional dummy depending on it.
        // wlrctl parks the cursor off-screen (see buildKioskDisplayUnit).
        execSync('apt-get install -y cage wlrctl chromium', { stdio: 'pipe' });
        addLog('Pakketten', 'success', 'cage, wlrctl en chromium succesvol geïnstalleerd.');
      } catch (e: any) {
        addLog('Pakketten', 'error', `Installatie van cage/wlrctl/chromium mislukt: ${e.message}`);
        return { success: false, logs };
      }
    } else {
      addLog('Pakketten', 'success', 'cage en chromium zijn al geïnstalleerd.');
    }

    // 2. Systemd unit
    try {
      fs.writeFileSync(KIOSK_DISPLAY_UNIT_PATH, buildKioskDisplayUnit(webPort, resolveChromiumBinary(), kioskToken), 'utf8');
      addLog('Systemd-unit', 'success', `${KIOSK_DISPLAY_UNIT_PATH} weggeschreven.`);
    } catch (e: any) {
      addLog('Systemd-unit', 'error', `Kon systemd-unit niet schrijven: ${e.message}`);
      return { success: false, logs };
    }

    // 3. Enable + (re)start — `enable --now` is a no-op on an already-running
    // unit (systemd never restarts what's already active), so a re-enable
    // meant to pick up a rewritten unit file (new token, new chromium path,
    // etc.) would silently keep the OLD process running with the stale
    // config. `restart` always launches fresh, and works fine on a unit
    // that isn't running yet too.
    try {
      execSync(`systemctl daemon-reload && systemctl enable ${KIOSK_DISPLAY_SERVICE_NAME}.service && systemctl restart ${KIOSK_DISPLAY_SERVICE_NAME}.service`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service ingeschakeld en (opnieuw) gestart.`);
    } catch (e: any) {
      addLog('Service', 'error', `Kon service niet starten: ${e.message}`);
      return { success: false, logs };
    }

    // 4. Verify (best-effort — a missing screen is a warning, not a hard failure,
    // since the service stays enabled and retries on its own via Restart=on-failure)
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const active = execSync(`systemctl is-active ${KIOSK_DISPLAY_SERVICE_NAME} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (active === 'active') {
        addLog('Verificatie', 'success', 'Kiosk-scherm actief.');
      } else {
        addLog('Verificatie', 'warning', 'Service is ingeschakeld maar nog niet actief — controleer of er een scherm is aangesloten. De service blijft het opnieuw proberen.');
      }
    } catch {}

    return { success: true, logs };
  }

  public async disableLocalKioskDisplay(): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }> {
    const logs: ProvisioningLogEntry[] = [];
    const addLog = (step: string, status: ProvisioningLogEntry['status'], message: string) => {
      logs.push({ step, status, message, timestamp: new Date().toLocaleTimeString() });
    };

    if (!this.isLinux) {
      addLog('Omgeving', 'warning', 'Ontwikkelingsomgeving (niet-Linux). Uitschakelen wordt virtueel gesimuleerd.');
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service gestopt en uitgeschakeld (virtueel).`);
      return { success: true, logs };
    }

    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      addLog('Rechten', 'error', 'Deze functie vereist root-rechten. Start de app als root, bijv. met "sudo npm start".');
      return { success: false, logs };
    }

    try {
      execSync(`systemctl disable --now ${KIOSK_DISPLAY_SERVICE_NAME}.service 2>/dev/null || true`);
      addLog('Service', 'success', `${KIOSK_DISPLAY_SERVICE_NAME}.service gestopt en uitgeschakeld.`);
      return { success: true, logs };
    } catch (e: any) {
      addLog('Service', 'error', `Kon service niet uitschakelen: ${e.message}`);
      return { success: false, logs };
    }
  }

  public async autoProvisionSystem(
    options: ProvisioningOptions,
    selectedDac: AudioDevice
  ): Promise<{ success: boolean; logs: ProvisioningLogEntry[]; needsReboot: boolean }> {
    const logs: ProvisioningLogEntry[] = [];
    let needsReboot = false;

    const addLog = (step: string, status: 'pending' | 'success' | 'warning' | 'error', message: string) => {
      logs.push({
        step,
        status,
        message,
        timestamp: new Date().toLocaleTimeString(),
      });
    };

    addLog('Init', 'pending', `Start geautomatiseerde provisioning voor DAC: ${selectedDac.name}`);

    // options.deviceName/bitrate come straight from the /api/setup/provision
    // request body (or hubConfig, itself settable via /api/config) and get
    // embedded in a systemd unit file's ExecStart= line below. systemd's own
    // argv parsing splits ExecStart on unescaped whitespace, so an
    // unvalidated bitrate like "320 --onevent /tmp/evil.sh" would smuggle in
    // an extra librespot flag — executed as root, since the service runs
    // User=root. Validated at this actual sink rather than trusting every
    // caller to have done it already; deviceName additionally sits inside a
    // double-quoted ExecStart segment, so a bare `"` would break out of it.
    const SAFE_DEVICE_NAME = /^[\w .-]{1,64}$/;
    const safeDeviceName = SAFE_DEVICE_NAME.test(options.deviceName) ? options.deviceName : 'HSSwoonkamer';
    if (safeDeviceName !== options.deviceName) {
      addLog('Beveiliging', 'warning', `Apparaatnaam bevatte ongeldige tekens, teruggevallen op standaardnaam '${safeDeviceName}'.`);
    }
    const VALID_BITRATES = ['96', '160', '320'];
    const safeBitrate = VALID_BITRATES.includes(options.bitrate) ? options.bitrate : '320';
    if (safeBitrate !== options.bitrate) {
      addLog('Beveiliging', 'warning', `Ongeldige bitrate '${options.bitrate}', teruggevallen op 320 kbps.`);
    }
    options = { ...options, deviceName: safeDeviceName, bitrate: safeBitrate };

    if (!this.isLinux) {
      addLog('Omgeving', 'warning', 'Ontwikkelingsomgeving (niet-Linux). Configuratiebestanden worden virtueel gevalideerd.');
      addLog('ALSA Config', 'success', '/etc/asound.conf bit-perfect profiel gegenereerd (virtueel).');
      addLog('Spotify Hook', 'success', '/opt/hss/spotify-event.sh aangemaakt (virtueel).');
      addLog('Librespot', 'success', 'Spotify Connect daemon service geconfigureerd voor 320 kbps.');
      addLog('Afronding', 'success', 'Systeemconfiguratie gereed in emulatiemodus.');
      return { success: true, logs, needsReboot: false };
    }

    // 1. Configure /etc/asound.conf for Bit-Perfect ALSA
    try {
      fs.writeFileSync('/etc/asound.conf', buildAsoundConf(), 'utf8');
      addLog('ALSA Config', 'success', 'Bit-Perfect /etc/asound.conf succesvol weggeschreven.');
    } catch (e: any) {
      addLog('ALSA Config', 'warning', `Kon /etc/asound.conf niet direct schrijven (vereist mogelijk sudo): ${e.message}`);
    }

    // 2. Configure /opt/hss/spotify-event.sh
    try {
      if (!fs.existsSync('/opt/hss')) {
        fs.mkdirSync('/opt/hss', { recursive: true });
      }

      const eventScript = `#!/usr/bin/env bash
# Real-Time Spotify Event Hook for Librespot / HSS HiFi Hub

# Safely construct bulletproof JSON using jq to avoid escaping bugs with quotes/apostrophes in track names
if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n \\
    --arg event "\${PLAYER_EVENT:-none}" \\
    --arg track_id "\${TRACK_ID:-}" \\
    --arg track_name "\${NAME:-}" \\
    --arg artist_name "\${ARTISTS:-}" \\
    --arg album_name "\${ALBUM:-}" \\
    --arg duration_ms_raw "\${DURATION_MS:-}" \\
    --arg position_ms_raw "\${POSITION_MS:-}" \\
    --argjson volume "\${VOLUME:-65535}" \\
    --arg uri "\${URI:-}" \\
    '{
      event: $event,
      track_id: $track_id,
      track_name: $track_name,
      artist_name: $artist_name,
      album_name: $album_name,
      duration_ms: (if $duration_ms_raw == "" then null else ($duration_ms_raw | tonumber) end),
      position_ms: (if $position_ms_raw == "" then null else ($position_ms_raw | tonumber) end),
      volume: ($volume // 65535),
      uri: $uri
    }')
else
  # Python fallback
  PAYLOAD=$(python3 -c "
import os, json
data = {
  'event': os.environ.get('PLAYER_EVENT', 'none'),
  'track_id': os.environ.get('TRACK_ID', ''),
  'track_name': os.environ.get('NAME', ''),
  'artist_name': os.environ.get('ARTISTS', ''),
  'album_name': os.environ.get('ALBUM', ''),
  'duration_ms': int(os.environ['DURATION_MS']) if os.environ.get('DURATION_MS') else None,
  'position_ms': int(os.environ['POSITION_MS']) if os.environ.get('POSITION_MS') else None,
  'volume': int(os.environ.get('VOLUME', 65535) or 65535),
  'uri': os.environ.get('URI', '')
}
print(json.dumps(data))
")
fi

echo "$PAYLOAD" > /tmp/spotify-last-track.json 2>/dev/null || true

curl -s -X POST "http://localhost:${options.webPort}/api/spotify/event" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" >/dev/null 2>&1 || true
`;
      // writeFileSync's `mode` only applies when the file doesn't exist yet —
      // it does NOT chmod an existing file, so re-provisioning over an
      // already-present script silently left it non-executable (librespot
      // then fails every event with EACCES and the Afspelen screen never
      // gets track metadata, even though audio itself plays fine). Force it
      // explicitly so this can't regress on a re-run.
      fs.writeFileSync('/opt/hss/spotify-event.sh', eventScript, { encoding: 'utf8', mode: 0o755 });
      fs.chmodSync('/opt/hss/spotify-event.sh', 0o755);
      addLog('Spotify Event Hook', 'success', '/opt/hss/spotify-event.sh aangemaakt en uitvoerbaar gemaakt.');
    } catch (e: any) {
      addLog('Spotify Event Hook', 'warning', `Kon event hook script niet schrijven: ${e.message}`);
    }

    // 3. Configure /boot/firmware/config.txt or /boot/config.txt for DAC overlay
    let configFile = fs.existsSync('/boot/firmware/config.txt')
      ? '/boot/firmware/config.txt'
      : fs.existsSync('/boot/config.txt')
      ? '/boot/config.txt'
      : null;

    if (configFile && selectedDac.dtoverlay) {
      try {
        let content = fs.readFileSync(configFile, 'utf8');
        let modified = false;

        // Disable onboard audio
        if (content.includes('dtparam=audio=on')) {
          content = content.replace(/^dtparam=audio=on/m, 'dtparam=audio=off');
          modified = true;
        }

        // Add overlay if not present
        if (!content.includes(selectedDac.dtoverlay)) {
          content += `\n\n# --- Added by HSS Hub Auto-Setup ---\n${selectedDac.dtoverlay}\ndtoverlay=i2s-mmap\ndtparam=i2s=on\ndtparam=i2c_arm=on\n`;
          modified = true;
          needsReboot = true;
        }

        if (modified) {
          fs.writeFileSync(configFile, content, 'utf8');
          addLog('Boot Config', 'success', `DAC Overlay '${selectedDac.dtoverlay}' geconfigureerd in ${configFile}.`);
        } else {
          addLog('Boot Config', 'success', `DAC Overlay was reeds actief in ${configFile}.`);
        }
      } catch (e: any) {
        addLog('Boot Config', 'warning', `Kon ${configFile} niet direct bijwerken (vereist root): ${e.message}`);
      }
    }

    // 4. Download and setup Librespot if missing
    try {
      const hasLibrespot = fs.existsSync('/usr/local/bin/librespot') || fs.existsSync('/usr/bin/librespot');
      if (!hasLibrespot) {
        addLog('Librespot Daemon', 'pending', 'Downloaden van geoptimaliseerde librespot binary voor ARM...');
        const arch = execSync('uname -m', { encoding: 'utf8' }).trim();
        const url = arch === 'aarch64'
          ? 'https://github.com/librespot-org/librespot/releases/download/v0.4.2/librespot-linux-arm64.tar.gz'
          : 'https://github.com/librespot-org/librespot/releases/download/v0.4.2/librespot-linux-armhf.tar.gz';
        
        execSync(`wget -qO- "${url}" | tar -xz -C /usr/local/bin/ 2>/dev/null && chmod +x /usr/local/bin/librespot 2>/dev/null || true`);
        addLog('Librespot Daemon', 'success', 'Librespot binary succesvol geïnstalleerd in /usr/local/bin/librespot.');
      } else {
        addLog('Librespot Daemon', 'success', 'Librespot binary is reeds aanwezig op het systeem.');
      }
    } catch (e: any) {
      addLog('Librespot Daemon', 'warning', `Librespot installatiecheck: ${e.message}`);
    }

    // 5. Create and Restart Systemd Service
    try {
      fs.mkdirSync('/etc/hss/librespot-cache', { recursive: true });
      const svcFile = `/etc/systemd/system/librespot-hss.service`;
      // --system-cache persists the Zeroconf-discovered credentials to disk
      // — without it, selecting this Pi in the Spotify app only lives in
      // memory, so it drops out of Spotify's own device list on every
      // restart until someone re-selects it there again. No --cache (audio
      // data) on purpose — streamed audio doesn't need to survive a
      // restart, and caching it would just wear the SD card for nothing.
      const svcContent = `[Unit]
Description=Librespot Spotify Connect Daemon for HiFi DAC
After=network.target sound.target hss.service

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/librespot --name "${options.deviceName}" --backend alsa --device eq --bitrate ${options.bitrate} --enable-volume-normalisation --volume-ctrl linear --initial-volume 75 --zeroconf-port 5354 --system-cache /etc/hss/librespot-cache --onevent /opt/hss/spotify-event.sh
Restart=always
RestartSec=5
LimitRTPRIO=95
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
`;
      fs.writeFileSync(svcFile, svcContent, 'utf8');
      execSync('systemctl daemon-reload && systemctl enable librespot-hss.service 2>/dev/null && (systemctl restart librespot-hss.service 2>/dev/null || systemctl start librespot-hss.service 2>/dev/null) || true');
      addLog('Systemd Service', 'success', 'librespot-hss.service geactiveerd en gestart.');
    } catch (e: any) {
      addLog('Systemd Service', 'warning', `Systemd service configuratie: ${e.message}`);
    }

    addLog('Voltooid', 'success', needsReboot ? 'Setup voltooid! Herstart je Raspberry Pi om de nieuwe I2S DAC overlay te laden.' : 'Setup succesvol voltooid! Spotify Connect is nu live.');

    return { success: true, logs, needsReboot };
  }

  public triggerReboot(): boolean {
    if (!this.isLinux) {
      console.log('[PiSetup - Emulation] Systeem herstart getriggerd');
      return true;
    }
    try {
      exec('sudo reboot || reboot', () => {});
      return true;
    } catch (e) {
      console.warn('[PiSetup] Reboot command failed:', e);
      return false;
    }
  }

  public triggerShutdown(): boolean {
    if (!this.isLinux) {
      console.log('[PiSetup - Emulation] Systeem uitschakelen getriggerd');
      return true;
    }
    try {
      exec('sudo poweroff || poweroff || sudo shutdown -h now', () => {});
      return true;
    } catch (e) {
      console.warn('[PiSetup] Shutdown command failed:', e);
      return false;
    }
  }

  // Delegates to scripts/deploy.sh, launched via `systemd-run` so it's
  // detached from hss.service's own process tree — deploy.sh restarts the
  // service partway through, which kills this Node process; anything that
  // needs to keep running *after* that (health-checking the new version,
  // rolling back if it doesn't come up healthy) has to live outside the
  // process being restarted. An earlier version ran the git/npm/build
  // steps inline for live in-app progress, but that traded away deploy.sh's
  // rollback safety net entirely — a broken update just stayed live with
  // no recovery. This gets both: deploy.sh's proven rollback logic, and
  // (via /etc/hss/.update-result, read on next startup by state.ts) a
  // report if a rollback actually happened, instead of that happening
  // silently. What's lost is the step-by-step live log this used to show;
  // the single message below is what's left after the process starting it
  // may no longer be around to report anything more granular.
  public async performUpdate(): Promise<{ success: boolean; logs: ProvisioningLogEntry[] }> {
    const logs: ProvisioningLogEntry[] = [];
    const addLog = (step: string, status: ProvisioningLogEntry['status'], message: string) => {
      logs.push({ step, status, message, timestamp: new Date().toLocaleTimeString() });
    };

    if (!this.isLinux) {
      addLog('Ophalen', 'success', 'Ontwikkelomgeving — update wordt virtueel gesimuleerd.');
      addLog('Herstarten', 'success', 'Service herstart (virtueel).');
      return { success: true, logs };
    }

    const repoDir = process.cwd();
    // hss.service runs as root, but the repo directory is owned by whoever
    // deployed it (e.g. eelko) — git's "dubious ownership" check then
    // refuses every git command here outright. Confirmed live: this is
    // exactly what broke "Nu updaten" the first time it was actually
    // clicked. `-c safe.directory=<dir>` scopes trust to this invocation
    // only, no persistent `git config --global` needed on the Pi itself.
    const safeDirArg = `safe.directory=${repoDir}`;
    // The remote is an SSH URL and root has no SSH setup of its own at all
    // (confirmed live: no known_hosts entry for github.com) — reuse the
    // deploying user's already-working key instead, found by asking who
    // actually owns the directory rather than hardcoding a username. Root
    // can already read that file unconditionally, so this crosses no new
    // privilege boundary. Empty string (no override) if that lookup
    // doesn't hold, so fetch just fails the same way it would have.
    let sshArg = '';
    try {
      const owner = execSync(`stat -c '%U' ${repoDir}`, { encoding: 'utf8' }).trim();
      const keyPath = `/home/${owner}/.ssh/id_ed25519`;
      if (owner && owner !== 'root' && fs.existsSync(keyPath)) {
        sshArg = ` -c core.sshCommand="ssh -i ${keyPath} -o UserKnownHostsFile=/home/${owner}/.ssh/known_hosts -o IdentitiesOnly=yes"`;
      }
    } catch {}
    try {
      addLog('Ophalen', 'pending', 'Controleren op nieuwe versie...');
      execSync(`git -c ${safeDirArg}${sshArg} fetch origin main --quiet`, { cwd: repoDir, stdio: 'pipe' });
      const local = execSync(`git -c ${safeDirArg} rev-parse HEAD`, { cwd: repoDir, encoding: 'utf8' }).trim();
      const remote = execSync(`git -c ${safeDirArg} rev-parse origin/main`, { cwd: repoDir, encoding: 'utf8' }).trim();
      if (local === remote) {
        addLog('Ophalen', 'success', 'Al up-to-date — niets te installeren.');
        return { success: true, logs };
      }
    } catch (e: any) {
      addLog('Ophalen', 'error', `Kon niet controleren op updates: ${e.message}`);
      return { success: false, logs };
    }

    addLog(
      'Bijwerken',
      'success',
      'Update gestart op de achtergrond (scripts/deploy.sh) — dit duurt enkele minuten. De service herstart zelf; komt de nieuwe versie niet gezond op, dan wordt automatisch teruggedraaid naar de vorige versie.',
    );
    const unitName = `hss-update-${Date.now()}`;
    exec(
      `systemd-run --unit=${unitName} --collect --property=WorkingDirectory=${repoDir} -- /bin/bash ${repoDir}/scripts/deploy.sh`,
      (err) => {
        if (err) console.warn('[PiSetup] Kon achtergrond-update niet starten:', err.message);
      },
    );
    return { success: true, logs };
  }
}

export const piSetup = new PiSetupService();
