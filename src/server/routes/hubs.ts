// Known-hubs CRUD for the sidebar device switcher — a bookmark list of other
// HSS hubs on the LAN. No discovery: picking one just navigates the browser
// to that hub's own URL. Optionally stores an API key *for* that hub, which
// multiroom uses to send it group commands (see routes/multiroom.ts).
import express from 'express';
import { addDbKnownHub, deleteDbKnownHub, getDbKnownHubs, setDbKnownHubApiKey } from '../../../db.ts';
import { requireAudioPermission } from '../state.ts';

const router = express.Router();

/** undefined = not given, null = clear, string = valid key. Throws on garbage. */
function parseApiKey(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\S{8,256}$/.test(raw.trim())) {
    throw new Error('Ongeldige API-sleutel');
  }
  return raw.trim();
}

router.get('/api/hubs', (req, res) => {
  res.json({ success: true, hubs: getDbKnownHubs() });
});

router.post('/api/hubs', requireAudioPermission('admin:all'), (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!name || !url) {
    return res.status(400).json({ error: 'Naam en URL zijn verplicht' });
  }
  let apiKey: string | null | undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
  } catch {
    return res.status(400).json({ error: 'Ongeldige URL — begin met http:// of https://' });
  }
  try {
    apiKey = parseApiKey(req.body?.apiKey);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
  const id = addDbKnownHub({ name, url, apiKey });
  res.json({ success: true, id, hubs: getDbKnownHubs() });
});

// Set or clear (apiKey: null) the key this hub uses to talk to that hub.
router.put('/api/hubs/:id/api-key', requireAudioPermission('admin:all'), (req, res) => {
  let apiKey: string | null | undefined;
  try {
    apiKey = parseApiKey(req.body?.apiKey);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
  if (apiKey === undefined) return res.status(400).json({ error: 'apiKey ontbreekt (null om te wissen)' });
  if (!setDbKnownHubApiKey(req.params.id, apiKey)) return res.status(404).json({ error: 'Hub niet gevonden' });
  res.json({ success: true, hubs: getDbKnownHubs() });
});

router.delete('/api/hubs/:id', (req, res) => {
  deleteDbKnownHub(req.params.id);
  res.json({ success: true, hubs: getDbKnownHubs() });
});

export default router;
