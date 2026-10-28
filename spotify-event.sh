#!/usr/bin/env bash
# Real-Time Spotify Event Hook for Librespot / Soloist HiFi Hub

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

echo "$PAYLOAD" > /tmp/spotify-last-track.json 2>/dev/null || true
chmod 666 /tmp/spotify-last-track.json 2>/dev/null || true

curl -s -X POST "http://localhost:3000/api/spotify/event" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null 2>&1 || true
