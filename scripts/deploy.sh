#!/usr/bin/env bash
# Run this ON the Pi, from the repo's working directory. Pulls, builds,
# restarts hss.service, and health-checks the result — if the service
# doesn't come back healthy, automatically rolls back to the previous
# commit and restarts again, rather than leaving a broken deploy live.
#
# Also invoked programmatically by piSetup.ts's performUpdate() (the
# in-app "Nu updaten" button), via `systemd-run` so it survives the very
# restart it triggers — that's the whole reason this exists as a
# detachable script rather than inline logic in the Node process: a
# restart kills whatever triggered it, so the health-check-and-rollback
# has to run somewhere that isn't the process being restarted.
#
# A restart landing mid-session has repeatedly interrupted whatever was
# being tested (killed an active recognition session, frozen the kiosk
# display) — this doesn't prevent that, but it does mean a genuinely
# broken deploy never stays live unnoticed.
set -euo pipefail

# When launched via systemd-run from hss.service (which runs as root),
# every git command here runs as root too — but the repo directory is
# owned by whoever deployed it (e.g. eelko). Git's "dubious ownership"
# check (post-CVE-2022-24765) then refuses to run at all. Confirmed live:
# this is exactly what broke the in-app "Nu updaten" button the first
# time it was actually clicked. Scoped to this invocation only via `-c`,
# no persistent `git config --global` needed on the Pi itself — also
# harmless (a no-op) on the manual SSH path, where the running user
# already owns the directory.
# Arrays, not a plain string — the SSH-command override built below embeds
# spaces inside a single -c VALUE, which a plain "$GIT rev-parse ..." string
# expansion would word-split into garbled separate argv tokens. Arrays
# preserve each -c argument as one element through expansion.
GIT_ARGS=(-c "safe.directory=$(pwd)")

# The remote is an SSH URL and root has no SSH setup of its own at all
# (confirmed live: no known_hosts entry for github.com) — reuse the
# deploying user's already-working key instead, found by asking who
# actually owns this directory rather than hardcoding a username. Root can
# already read that file unconditionally, so this crosses no new privilege
# boundary. Only relevant for the network-touching `pull` below — rev-parse
# and reset --hard are purely local, but harmless to include there too.
# No-op when this isn't running as root or the lookup doesn't hold, so the
# manual SSH path (already the repo owner) behaves exactly as before.
if [ "$(id -u)" = "0" ]; then
  OWNER=$(stat -c '%U' "$(pwd)" 2>/dev/null || true)
  if [ -n "$OWNER" ] && [ "$OWNER" != "root" ] && [ -f "/home/$OWNER/.ssh/id_ed25519" ]; then
    GIT_ARGS+=(-c "core.sshCommand=ssh -i /home/$OWNER/.ssh/id_ed25519 -o UserKnownHostsFile=/home/$OWNER/.ssh/known_hosts -o IdentitiesOnly=yes")
  fi
fi

SERVICE="hss.service"
HEALTH_URL="http://localhost:3000/api/status"
MAX_HEALTH_CHECKS=8
HEALTH_CHECK_INTERVAL_SEC=2

is_healthy() {
  curl -sf --max-time 3 "$HEALTH_URL" | grep -q '"status":"ok"'
}

wait_for_healthy() {
  for i in $(seq 1 "$MAX_HEALTH_CHECKS"); do
    sleep "$HEALTH_CHECK_INTERVAL_SEC"
    if is_healthy; then
      return 0
    fi
    echo "    health check $i/$MAX_HEALTH_CHECKS: not ready yet"
  done
  return 1
}

echo "==> Recording current commit for rollback"
PREV_COMMIT=$(git "${GIT_ARGS[@]}" rev-parse HEAD)

echo "==> Pulling latest"
git "${GIT_ARGS[@]}" pull origin main

NEW_COMMIT=$(git "${GIT_ARGS[@]}" rev-parse HEAD)
if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  echo "==> Already up to date — nothing to deploy"
  exit 0
fi

echo "==> Installing dependencies"
npm install --no-audit --no-fund

echo "==> Building"
npm run build

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Health-checking..."
if wait_for_healthy; then
  echo "==> Deploy succeeded (${PREV_COMMIT:0:7} -> ${NEW_COMMIT:0:7}), service healthy"
  # Clear any stale marker from a previous failed run — a later successful
  # deploy means that old rollback notice shouldn't linger in the UI forever.
  sudo rm -f /etc/hss/.update-result 2>/dev/null || true
  exit 0
fi

echo "==> Service did not become healthy — rolling back to ${PREV_COMMIT:0:7}"
git "${GIT_ARGS[@]}" reset --hard "$PREV_COMMIT"
npm install --no-audit --no-fund
npm run build
sudo systemctl restart "$SERVICE"

if wait_for_healthy; then
  echo "==> Rollback succeeded — service healthy again on ${PREV_COMMIT:0:7}"
  echo "==> DEPLOY FAILED — investigate commit ${NEW_COMMIT:0:7} before retrying"
  # Read by state.ts on next startup and surfaced as a system-health
  # warning — a silent rollback would just be a new silent failure of
  # exactly the kind healthLog.ts exists to eliminate.
  echo "{\"status\":\"rolled_back\",\"failedCommit\":\"${NEW_COMMIT:0:7}\",\"restoredCommit\":\"${PREV_COMMIT:0:7}\"}" | sudo tee /etc/hss/.update-result > /dev/null
  exit 1
fi

echo "==> ROLLBACK ALSO FAILED — service is down, manual intervention required"
echo "{\"status\":\"failed\",\"failedCommit\":\"${NEW_COMMIT:0:7}\"}" | sudo tee /etc/hss/.update-result > /dev/null 2>&1 || true
exit 2
