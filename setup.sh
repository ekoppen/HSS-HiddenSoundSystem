#!/usr/bin/env bash
# ==============================================================================
#  HSS HiddenSoundSystem - Automated Setup Script
#  One-Click Provisioning for Raspberry Pi 3B+, 4B, 5 & Zero 2W
#
#  Run either:
#    - from inside an already-cloned checkout (`cd HSS-HiddenSoundSystem &&
#      sudo bash setup.sh`) — this is what production actually runs, and
#      lets `scripts/deploy.sh` (git pull based) redeploy it afterwards; or
#    - standalone (curl'd from anywhere) — it clones the repo itself.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================================${NC}"
echo -e "${GREEN}${BOLD}  🎵 HSS HiddenSoundSystem - Automated Setup & Installer${NC}"
echo -e "${CYAN}====================================================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[FOUT] Dit script moet als root worden uitgevoerd!${NC}"
   echo -e "${YELLOW}Gebruik: sudo bash setup.sh${NC}"
   exit 1
fi

PI_MODEL="Raspberry Pi"
if [ -f "/proc/device-tree/model" ]; then
    PI_MODEL=$(tr -d '\0' < /proc/device-tree/model)
fi
echo -e "${CYAN}Gedetecteerd Systeem : ${BOLD}${PI_MODEL}${NC}"

# The app itself always runs as root (systemd services below all set
# User=root — nodig voor ALSA/systemd/apt-toegang) — dit account is alleen
# nodig om te weten waar de repository moet komen (~/HSS-HiddenSoundSystem)
# en om audio-groepsrechten te geven voor handmatig gebruik.
DETECTED_USER="${SUDO_USER:-$(logname 2>/dev/null || true)}"
read -rp "Gebruikersaccount van deze Pi (zoals aangemaakt door de Imager) [standaard=${DETECTED_USER:-eelko}]: " TARGET_USER
TARGET_USER=${TARGET_USER:-${DETECTED_USER:-eelko}}
if ! id "$TARGET_USER" &>/dev/null; then
    echo -e "${RED}[FOUT] Gebruiker '${TARGET_USER}' bestaat niet op dit systeem.${NC}"
    exit 1
fi
echo -e "${GREEN}Account : ${BOLD}${TARGET_USER}${NC}"

# Detect or select DAC
echo -e "\n${YELLOW}[1/6] Kies jouw HiFi DAC HAT (of druk op Enter voor HiFiBerry DAC+ Pro):${NC}"
echo -e "  1) HiFiBerry DAC+ Pro / Standard (I2S HAT) [Standaard]"
echo -e "  2) Allo Boss DAC (Master I2S)"
echo -e "  3) IQaudIO DAC+ / Pi-DAC Pro"
echo -e "  4) JustBoom DAC HAT"
echo -e "  5) External USB DAC (Class 2.0 Bit-Perfect)"
echo -e "  6) HiFiBerry Amp2 (ingebouwde 2x30W versterker)"

read -rp "Keuze [1-6, standaard=1]: " DAC_CHOICE
DAC_CHOICE=${DAC_CHOICE:-1}

DAC_NAME="HiFiBerry DAC+ Pro"
DAC_OVERLAY="dtoverlay=hifiberry-dacplus"

case $DAC_CHOICE in
    1)
        DAC_NAME="HiFiBerry DAC+ Pro"
        DAC_OVERLAY="dtoverlay=hifiberry-dacplus"
        ;;
    2)
        DAC_NAME="Allo Boss DAC"
        DAC_OVERLAY="dtoverlay=allo-boss-dac-pcm512x-audio"
        ;;
    3)
        DAC_NAME="IQaudIO DAC+"
        DAC_OVERLAY="dtoverlay=iqaudio-dacplus"
        ;;
    4)
        DAC_NAME="JustBoom DAC"
        DAC_OVERLAY="dtoverlay=justboom-dac"
        ;;
    5)
        DAC_NAME="External USB DAC"
        DAC_OVERLAY="# Standard USB Audio Driver"
        ;;
    6)
        # Same overlay as the plain DAC+ Pro — the Amp2 is DAC+-compatible
        # at the driver level (adds an onboard amp stage), so this is the
        # correct overlay even though the board itself is different.
        DAC_NAME="HiFiBerry Amp2"
        DAC_OVERLAY="dtoverlay=hifiberry-dacplus"
        ;;
    *)
        DAC_NAME="HiFiBerry DAC+ Pro"
        DAC_OVERLAY="dtoverlay=hifiberry-dacplus"
        ;;
esac

echo -e "${GREEN}Geselecteerde DAC : ${BOLD}${DAC_NAME}${NC}"

read -rp "Spotify Connect apparaatnaam [standaard=HSSwoonkamer]: " SPOTIFY_DEV_NAME
SPOTIFY_DEV_NAME=${SPOTIFY_DEV_NAME:-HSSwoonkamer}
echo -e "${YELLOW}  Let op: zet deze zelfde naam straks ook in Instellingen -> Spotify HSS${NC}"
echo -e "${YELLOW}  daemon & account, anders raken librespot en de app uit sync.${NC}"

read -rp "Lokaal HDMI kiosk-scherm activeren, als er een scherm is aangesloten? [j/N]: " ENABLE_KIOSK
ENABLE_KIOSK=${ENABLE_KIOSK:-n}

# The app used to ship with a hardcoded fallback admin email/password,
# checked directly into this public repo — anyone reading the source could
# log into any install that hadn't gotten around to changing it yet. No
# credential of any kind lives in source any more: this is the only place
# a real password ever gets typed, straight into a seed file the app reads
# exactly once on first boot and then deletes (see state.ts's
# seedAdminCredentials). Skipping this prompt entirely still works — the
# app then generates and logs a random password instead of falling back to
# anything predictable.
echo -e "\n${YELLOW}Beheerdersaccount voor de webinterface:${NC}"
read -rp "E-mailadres (login) [standaard=admin@localhost]: " ADMIN_EMAIL
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@localhost}
read -rp "Naam [standaard=HSS Admin]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-HSS Admin}
while true; do
    read -rsp "Wachtwoord: " ADMIN_PASSWORD
    echo
    read -rsp "Wachtwoord (nogmaals): " ADMIN_PASSWORD_CONFIRM
    echo
    if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]; then
        echo -e "${RED}Wachtwoorden komen niet overeen — probeer opnieuw.${NC}"
        continue
    fi
    if [ -z "$ADMIN_PASSWORD" ]; then
        echo -e "${YELLOW}Leeg gelaten — er wordt zo dadelijk een willekeurig wachtwoord gegenereerd en getoond.${NC}"
    fi
    break
done

echo -e "\n${YELLOW}[2/6] Systeempakketten en audio-bibliotheken installeren...${NC}"
apt-get update -y
apt-get install -y \
    alsa-utils \
    libasound2 \
    libasound2-plugins \
    libasound2-plugin-equal \
    libasound2-dev \
    libsoxr-dev \
    curl \
    git \
    nodejs \
    npm \
    jq \
    avahi-daemon \
    libavahi-compat-libdnssd-dev \
    build-essential \
    mpv \
    gpiod

# jq (just installed above) properly escapes the password into valid JSON —
# naive string interpolation here would both break on a password containing
# a `"` and, worse, let one shape the JSON structure. Written only now that
# jq exists; /etc/hss may not exist yet this early (the app itself creates
# it on first boot), so made explicitly.
mkdir -p /etc/hss
jq -n --arg email "$ADMIN_EMAIL" --arg name "$ADMIN_NAME" --arg password "$ADMIN_PASSWORD" \
    '{email: $email, name: $name, password: $password}' > /etc/hss/admin-seed.json
chmod 600 /etc/hss/admin-seed.json

echo -e "\n${YELLOW}[3/6] /boot/config.txt configureren voor I2S & ${DAC_NAME}...${NC}"
CONFIG_FILE="/boot/config.txt"
if [ -f "/boot/firmware/config.txt" ]; then
    CONFIG_FILE="/boot/firmware/config.txt"
fi

cp "$CONFIG_FILE" "${CONFIG_FILE}.bak_$(date +%Y%m%d%H%M%S)"

# Disable onboard Broadcom audio
sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' "$CONFIG_FILE"
if ! grep -q "^#dtparam=audio=on" "$CONFIG_FILE" && ! grep -q "^dtparam=audio=off" "$CONFIG_FILE"; then
    echo "dtparam=audio=off" >> "$CONFIG_FILE"
fi

# Add overlay
if [ -n "$DAC_OVERLAY" ] && [[ "$DAC_OVERLAY" != \#* ]]; then
    if ! grep -q "$DAC_OVERLAY" "$CONFIG_FILE"; then
        echo "" >> "$CONFIG_FILE"
        echo "# --- HiFi Audio DAC Overlay ---" >> "$CONFIG_FILE"
        echo "$DAC_OVERLAY" >> "$CONFIG_FILE"
        echo "dtoverlay=i2s-mmap" >> "$CONFIG_FILE"
        echo "dtparam=i2c_arm=on" >> "$CONFIG_FILE"
        echo "dtparam=i2s=on" >> "$CONFIG_FILE"
        echo -e "${GREEN}  Overlay toegevoegd aan $CONFIG_FILE${NC}"
    fi
fi

echo -e "\n${YELLOW}[4/6] Bit-Perfect /etc/asound.conf genereren...${NC}"
cat << 'EOF' > /etc/asound.conf
# HSS HiddenSoundSystem Bit-Perfect ALSA Routing
# `default` and `eq` both route through the `equal` plugin
# before reaching the real hardware — this is what makes EQ
# and balance apply platform-wide, uniformly regardless of source, instead of
# only affecting NAS/radio playback like an mpv-only filter chain would. EQ
# bands are controlled live via `amixer -D eqbase sset '<band>' <val>` (see
# PiHardwareService.setHardwareEqualizer); balance applies separately at the
# hifisoloist mixer itself (setHardwareVolume).
# Exactly ONE plug layer, straight onto eqbase — never onto "eq", which is
# itself a plug. Two stacked plugs over the equal plugin make
# snd_pcm_hw_params_any() abort with
# `snd1_pcm_hw_param_get_min: Assertion !snd_interval_empty(i)' failed`, so
# every program that simply opens `default` dies with SIGABRT. That is what
# silently killed Spotify on the tuinhuis Pi: librespot ran `--device default`
# and crashed on every track before playing a single sample, while mpv was
# fine because it addresses `eq` directly. Reproduced live with a probe that
# mimics librespot's hw_params sequence (see ARCHITECTURE.md).
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

# hifisoloist_plug: the equal plugin cannot negotiate hw_params directly
# against a bare `type hw` slave (confirmed live: speaker-test/aplay against
# eqbase failed with "Slave PCM not usable" / "Invalid argument", while the
# same hifisoloist device works fine addressed directly) — a plug layer in
# between lets ALSA do the format/rate conversion equal does not do itself.
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
EOF

echo -e "\n${YELLOW}[5/6] librespot & Spotify Event Hook installeren...${NC}"

# librespot via the official raspotify apt repo (dtcooper/raspotify) — a
# maintained, current build. There is no plain `apt-get install raspotify`
# without this: the package isn't in Raspberry Pi OS's default archives, so
# its own install script adds the repo (with a GPG-verified apt source)
# first. Its default systemd service is disabled immediately afterwards —
# only its `librespot` binary is used, run via our own service below so we
# control the flags (device name, ALSA device, bitrate, event hook).
if ! command -v librespot >/dev/null 2>&1; then
    apt-get install -y curl
    curl -sL https://dtcooper.github.io/raspotify/install.sh | sh
fi
systemctl disable --now raspotify 2>/dev/null || true

LIBRESPOT_AVAILABLE=false
if command -v librespot >/dev/null 2>&1; then
    LIBRESPOT_AVAILABLE=true
else
    echo -e "${RED}[WAARSCHUWING] librespot kon niet geinstalleerd worden (raspotify-repo onbereikbaar?).${NC}"
    echo -e "${YELLOW}  librespot-hss.service wordt NIET aangemaakt. Controleer je netwerkverbinding${NC}"
    echo -e "${YELLOW}  en voer dit script opnieuw uit.${NC}"
fi

mkdir -p /opt/hss

# Spotify Event Bridge Hook Script
cat << 'EOF' > /opt/hss/spotify-event.sh
#!/usr/bin/env bash
# Real-Time Spotify Event Hook for Librespot / HSS HiddenSoundSystem

if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n \
    --arg event "${PLAYER_EVENT:-none}" \
    --arg track_id "${TRACK_ID:-}" \
    --arg track_name "${NAME:-}" \
    --arg artist_name "${ARTISTS:-}" \
    --arg album_name "${ALBUM:-}" \
    --argjson duration_ms "${DURATION_MS:-0}" \
    --argjson position_ms "${POSITION_MS:-0}" \
    --argjson volume "${VOLUME:-65535}" \
    --arg uri "${URI:-}" \
    '{
      event: $event,
      track_id: $track_id,
      track_name: $track_name,
      artist_name: $artist_name,
      album_name: $album_name,
      duration_ms: ($duration_ms // 0),
      position_ms: ($position_ms // 0),
      volume: ($volume // 65535),
      uri: $uri
    }')
else
  PAYLOAD=$(python3 -c "
import os, json
data = {
  'event': os.environ.get('PLAYER_EVENT', 'none'),
  'track_id': os.environ.get('TRACK_ID', ''),
  'track_name': os.environ.get('NAME', ''),
  'artist_name': os.environ.get('ARTISTS', ''),
  'album_name': os.environ.get('ALBUM', ''),
  'duration_ms': int(os.environ.get('DURATION_MS', 0) or 0),
  'position_ms': int(os.environ.get('POSITION_MS', 0) or 0),
  'volume': int(os.environ.get('VOLUME', 65535) or 65535),
  'uri': os.environ.get('URI', '')
}
print(json.dumps(data))
")
fi

curl -s -X POST "http://localhost:3000/api/spotify/event" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null 2>&1 || true
EOF
chmod +x /opt/hss/spotify-event.sh

# Determine where the app lives: if this script is already running from
# inside a git checkout, use that directory directly (so scripts/deploy.sh's
# `git pull` keeps working afterwards) — never copy files out to /opt,
# which would silently break that redeploy path. Otherwise clone one.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/.git" ]; then
    REPO_DIR="$SCRIPT_DIR"
    echo "Gevonden bestaande checkout op $REPO_DIR"
else
    TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
    TARGET_HOME=${TARGET_HOME:-/home/$TARGET_USER}
    REPO_DIR="$TARGET_HOME/HSS-HiddenSoundSystem"
    if [ ! -d "$REPO_DIR/.git" ]; then
        echo "Repository klonen naar $REPO_DIR..."
        sudo -u "$TARGET_USER" git clone https://github.com/ekoppen/HSS-HiddenSoundSystem.git "$REPO_DIR"
    fi
fi

# The whole point of cloning under $TARGET_USER's home is so that user can
# later run a plain `git pull && npm install && npm run build` themselves
# (scripts/deploy.sh assumes exactly this — it never uses sudo for those
# three) — so run them here as that user too, not as root. Building as
# root would leave node_modules/dist root-owned, breaking that redeploy
# path with EACCES the very next time a human runs it.
echo "Ownership van $REPO_DIR corrigeren naar $TARGET_USER..."
chown -R "$TARGET_USER:$TARGET_USER" "$REPO_DIR"
echo "Dependencies installeren en builden in $REPO_DIR (als $TARGET_USER)..."
sudo -u "$TARGET_USER" bash -c "cd '$REPO_DIR' && npm install && npm run build"

echo -e "\n${YELLOW}[6/6] Systemd Services configureren en starten...${NC}"
cat << EOF > /etc/systemd/system/hss.service
[Unit]
Description=HSS HiddenSoundSystem Web & Audio Engine
After=network-online.target sound.target avahi-daemon.service
Wants=network-online.target sound.target

[Service]
Type=simple
User=root
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

LimitRTPRIO=95
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

# /etc/asound.conf (step 4 above) is written before the DAC's dtoverlay is
# even loaded — that only happens on the reboot this script asks for at the
# very end — so its "card 0" is a guess, wrong on any board where the DAC
# doesn't end up as card 0 (a Pi 5's two onboard HDMI outputs claim cards 0
# and 1 first, for example). This one-time service runs after that reboot,
# once the overlay is actually live and /proc/asound/cards reflects reality,
# and corrects the card reference — self-disabling via a marker file so it
# only ever does real work once.
mkdir -p /opt/hss
cat << 'EOF' > /opt/hss/fix-audio-routing.sh
#!/bin/bash
MARKER=/etc/hss/.audio-routing-fixed
[ -f "$MARKER" ] && exit 0

# Prefer a card matching a known DAC family name — confirmed live on real
# hardware that a blind "skip HDMI, take what's left" isn't enough: a USB
# webcam's mic also shows up as a non-HDMI card and isn't the DAC. Only
# fall back to "first non-HDMI, non-camera card" for an unrecognized/plain
# USB DAC, where no better signal exists.
CARDS=$(grep -E '^\s*[0-9]+\s+\[' /proc/asound/cards 2>/dev/null)
DETECTED_CARD=$(echo "$CARDS" | grep -iE 'hifiberry|bossdac|allo|iqaudio|justboom' | tail -1 | grep -oE '^[[:space:]]*[0-9]+' | tr -d ' ')
if [ -z "$DETECTED_CARD" ]; then
    DETECTED_CARD=$(echo "$CARDS" | grep -viE 'hdmi|camera' | head -1 | grep -oE '^[[:space:]]*[0-9]+' | tr -d ' ')
fi

if [ -n "$DETECTED_CARD" ] && [ -f /etc/asound.conf ]; then
    sed -i "s/card 0$/card ${DETECTED_CARD}/" /etc/asound.conf
    echo "[hss-audio-fixup] /etc/asound.conf now targets card ${DETECTED_CARD}"
fi

mkdir -p /etc/hss
touch "$MARKER"
EOF
chmod +x /opt/hss/fix-audio-routing.sh

cat << EOF > /etc/systemd/system/hss-audio-fixup.service
[Unit]
Description=HSS one-time audio routing fixup (correct ALSA card index post-reboot)
After=sound.target
Before=hss.service librespot-hss.service

[Service]
Type=oneshot
ExecStart=/opt/hss/fix-audio-routing.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

if [ "$LIBRESPOT_AVAILABLE" = true ]; then
mkdir -p /etc/hss/librespot-cache
cat << EOF > /etc/systemd/system/librespot-hss.service
[Unit]
Description=Librespot Spotify Connect Daemon for HiFi DAC
After=network.target sound.target hss.service

[Service]
Type=simple
User=root
# --system-cache persists the Zeroconf-discovered credentials to disk —
# without it, a device pairing (selecting this Pi in the Spotify app)
# only lives in memory, so it drops out of Spotify's own device list on
# every restart until someone re-selects it there again. No --cache
# (audio data) on purpose: streamed audio doesn't need to survive a
# restart, and caching it would just wear the SD card for no benefit.
ExecStart=$(command -v librespot) --name "${SPOTIFY_DEV_NAME}" --backend alsa --device eq --bitrate 320 --enable-volume-normalisation --volume-ctrl linear --initial-volume 75 --zeroconf-port 5354 --system-cache /etc/hss/librespot-cache --onevent /opt/hss/spotify-event.sh
Restart=always
RestartSec=5
LimitRTPRIO=95
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF
fi

if [[ "$ENABLE_KIOSK" =~ ^[jJyY] ]]; then
    echo -e "\n${YELLOW}Lokaal HDMI kiosk-scherm installeren (cage + wlrctl + chromium)...${NC}"
    # "chromium" is the real package on current Debian/Raspberry Pi OS —
    # chromium-browser is now only a transitional dummy package that pulls
    # chromium in but installs no /usr/bin/chromium-browser executable.
    # Resolve whichever binary actually ends up present rather than
    # assuming a name; chromium-browser stays as a last-resort fallback
    # for older Pi OS releases that never renamed it.
    # wlrctl parks the touchscreen cursor off-screen (ExecStartPost below) —
    # cage draws its own cursor sprite at the compositor level regardless of
    # page CSS, a known unresolved upstream limitation (cage-kiosk/cage#83,
    # #299, #422, #235); a relative pointer-move far past any real
    # resolution, once per boot, is the only thing that actually hides it.
    apt-get install -y cage wlrctl chromium
    CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium-browser)"
    cat << EOF > /etc/systemd/system/hss-kiosk-display.service
[Unit]
Description=HSS Lokale Kiosk-weergave (HDMI)
After=network.target sound.target hss.service
Wants=hss.service

[Service]
Type=simple
User=root
RuntimeDirectory=cage
Environment=XDG_RUNTIME_DIR=/run/cage
ExecStart=/usr/bin/cage -- $CHROMIUM_BIN --kiosk --no-sandbox --ozone-platform=wayland --disable-infobars --noerrdialogs --incognito "http://localhost:3000/?kiosk=1"
ExecStartPost=/bin/sh -c 'for i in 1 2 3 4 5; do sleep 1; wlrctl pointer move 5000 5000 2>/dev/null && break; done || true'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

# Pre-seed the app's own Spotify device-name setting to match what
# librespot was actually just configured with above — without this, the
# app falls back to its default "HSSwoonkamer" until someone separately
# visits Instellingen and fixes it by hand, and until then every Spotify
# transport command (play/pause/skip) silently targets the wrong Connect
# device (found and fixed live: real hardware, real symptom — the UI
# reports success while nothing actually happens on the Pi).
mkdir -p /etc/hss
cat << EOF > /etc/hss/config.json
{"spotifyDeviceName": "${SPOTIFY_DEV_NAME}"}
EOF

systemctl daemon-reload
systemctl enable hss-audio-fixup.service
systemctl enable hss.service
systemctl restart hss.service || true
if [ "$LIBRESPOT_AVAILABLE" = true ]; then
    systemctl enable librespot-hss.service
    systemctl restart librespot-hss.service || true
fi
if [[ "$ENABLE_KIOSK" =~ ^[jJyY] ]]; then
    systemctl enable --now hss-kiosk-display.service
fi

# User audio permissions
usermod -aG audio,video root || true
usermod -aG audio,video "$TARGET_USER" || true
if [ "$TARGET_USER" != "pi" ] && id "pi" &>/dev/null; then
    usermod -aG audio,video pi || true
fi

IP_ADDR=$(hostname -I | awk '{print $1}')
echo -e "\n${GREEN}====================================================================${NC}"
echo -e "${GREEN}${BOLD}  ✅ INSTALLATIE SUCCESVOL VOLTOOID!${NC}"
echo -e "${CYAN}  Web Interface : ${BOLD}http://${IP_ADDR}:3000${NC}"
echo -e "${CYAN}  WebSocket Feed: ${BOLD}ws://${IP_ADDR}:3000/ws${NC}"
echo -e "${CYAN}  Beheerder     : ${BOLD}${ADMIN_EMAIL}${NC}"
if [ -z "$ADMIN_PASSWORD" ]; then
    echo -e "${YELLOW}  Wachtwoord    : leeg gelaten tijdens setup — bekijk de eerste opstart-log voor het${NC}"
    echo -e "${YELLOW}                  willekeurig gegenereerde wachtwoord: sudo journalctl -u hss.service | grep -i wachtwoord${NC}"
fi
echo -e "${CYAN}  Spotify Device: ${BOLD}${SPOTIFY_DEV_NAME}${NC}"
echo -e "${CYAN}  Repository    : ${BOLD}${REPO_DIR}${NC}"
echo -e "${CYAN}  Wachtwoord vergeten? sudo npx tsx scripts/reset-password.ts <email> <nieuw-wachtwoord>${NC}"
if [ "$LIBRESPOT_AVAILABLE" != true ]; then
    echo -e "${RED}  LET OP: librespot kon niet geinstalleerd worden — Spotify Connect werkt nog niet.${NC}"
    echo -e "${YELLOW}  Zie de waarschuwing hierboven om dit handmatig op te lossen.${NC}"
fi
if [[ "$ENABLE_KIOSK" =~ ^[jJyY] ]]; then
    echo -e "${CYAN}  Lokaal scherm  : ingeschakeld (hss-kiosk-display.service)${NC}"
fi
echo -e "${YELLOW}  Belangrijk: Herstart je Pi nu eenmalig om de I2S DAC te laden:${NC}"
echo -e "${BOLD}  sudo reboot${NC}"
echo -e "${GREEN}====================================================================${NC}"
