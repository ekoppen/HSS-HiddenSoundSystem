// Multiroom group control. The hub you click "group" on becomes the leader
// and tells each chosen hub to follow it, authenticating with the API key
// stored for that hub in known_hubs. See services/multiroom.ts for what
// leader/follower actually do to the audio chain.
import express from 'express';
import { getDbKnownHubs, getDbKnownHubWithKey } from '../../../db.ts';
import { stopLocal } from '../../services/localPlayer.ts';
import {
  becomeFollower,
  becomeLeader,
  getMultiroomState,
  normalizeHost,
  resetToSolo,
  setMemberHubIds,
} from '../../services/multiroom.ts';
import { clearSpotifyToStandby, PORT, requireAudioPermission } from '../state.ts';

const router = express.Router();
// A follow makes the other hub restart systemd units — give it time.
const HUB_REQUEST_TIMEOUT_MS = 15_000;

type KnownHubWithKey = NonNullable<ReturnType<typeof getDbKnownHubWithKey>>;

async function sendToHub(hub: KnownHubWithKey, path: string, body: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(new URL(path, hub.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': hub.apiKey || '' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const detail = await res.json().catch(() => ({}));
    const error = `${hub.name}: ${detail.error || `HTTP ${res.status}`}`;
    console.error(`[Multiroom] ${path} naar ${hub.name} mislukt:`, error);
    return { ok: false, error };
  } catch (e: any) {
    const error = `${hub.name}: niet bereikbaar (${e?.message || e})`;
    console.error(`[Multiroom] ${path} naar ${hub.name} mislukt:`, error);
    return { ok: false, error };
  }
}

function describeState() {
  const s = getMultiroomState();
  const names = new Map(getDbKnownHubs().map((h: any) => [h.id, h.name]));
  return { ...s, members: s.memberHubIds.map((id) => ({ id, name: names.get(id) ?? id })) };
}

router.get('/api/multiroom', (req, res) => {
  res.json({ success: true, ...describeState() });
});

// Body: { hubIds: string[] } — the full desired member list. [] dissolves the group.
router.post('/api/multiroom/group', requireAudioPermission('audio:control'), async (req, res) => {
  const hubIds: unknown = req.body?.hubIds;
  if (!Array.isArray(hubIds) || !hubIds.every((id) => typeof id === 'string')) {
    return res.status(400).json({ error: 'hubIds moet een lijst met hub-id\'s zijn' });
  }
  const wanted = [...new Set(hubIds as string[])];
  const current = getMultiroomState();
  if (current.role === 'follower') {
    return res.status(409).json({ error: `Deze hub speelt mee met ${current.leaderUrl} — maak hem daar eerst los.` });
  }

  const hubs: KnownHubWithKey[] = [];
  for (const id of wanted) {
    const hub = getDbKnownHubWithKey(id);
    if (!hub) return res.status(404).json({ error: `Onbekende hub: ${id}` });
    if (!hub.apiKey) return res.status(400).json({ error: `Geen API-sleutel ingesteld voor ${hub.name}` });
    hubs.push(hub);
  }

  const errors: string[] = [];
  for (const id of current.memberHubIds.filter((id) => !wanted.includes(id))) {
    const hub = getDbKnownHubWithKey(id);
    const result = hub ? await sendToHub(hub, '/api/multiroom/unfollow', {}) : { ok: false, error: `${id}: verwijderd` };
    if (!result.ok && result.error) errors.push(result.error);
  }

  if (hubs.length === 0) {
    await resetToSolo();
    return res.json({ success: true, errors, ...describeState() });
  }

  try {
    await becomeLeader();
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }

  const joined = current.memberHubIds.filter((id) => wanted.includes(id));
  const newHubs = hubs.filter((h) => !joined.includes(h.id));
  const results = await Promise.all(
    newHubs.map((h) => sendToHub(h, '/api/multiroom/follow', { leaderPort: PORT, leaderProtocol: req.protocol })),
  );
  newHubs.forEach((h, i) => (results[i].ok ? joined.push(h.id) : errors.push(results[i].error!)));
  setMemberHubIds(joined);

  if (joined.length === 0) {
    await resetToSolo();
    return res.status(502).json({ error: 'Geen enkele hub kon meedoen', errors });
  }
  res.json({ success: true, errors, ...describeState() });
});

// Called by the leader. Its address comes from the connection itself, so the
// leader never needs to know (or guess) its own LAN address.
router.post('/api/multiroom/follow', requireAudioPermission('audio:control'), async (req, res) => {
  const port = Number(req.body?.leaderPort);
  const protocol = req.body?.leaderProtocol;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (protocol !== 'http' && protocol !== 'https')) {
    return res.status(400).json({ error: 'leaderPort/leaderProtocol ongeldig' });
  }
  if (getMultiroomState().role === 'leader') {
    return res.status(409).json({ error: 'Deze hub is zelf leider van een groep' });
  }
  let host: string;
  try {
    host = normalizeHost(req.socket.remoteAddress);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
  const leaderUrl = `${protocol}://${host.includes(':') ? `[${host}]` : host}:${port}`;

  // Local playback has to let go of ALSA before snapclient grabs it.
  stopLocal();
  clearSpotifyToStandby();
  try {
    await becomeFollower(host, leaderUrl);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ success: true, ...describeState() });
});

router.post('/api/multiroom/unfollow', requireAudioPermission('audio:control'), async (req, res) => {
  if (getMultiroomState().role === 'follower') await resetToSolo();
  res.json({ success: true, ...describeState() });
});

export default router;
