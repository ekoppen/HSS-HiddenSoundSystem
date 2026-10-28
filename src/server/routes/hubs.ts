// Known-hubs CRUD for the sidebar device switcher — a bookmark list of other
// HSS hubs on the LAN. No discovery, no cross-hub auth: picking one just
// navigates the browser to that hub's own URL, same as typing it in by hand.
import express from 'express';
import { addDbKnownHub, deleteDbKnownHub, getDbKnownHubs } from '../../../db.ts';

const router = express.Router();

router.get('/api/hubs', (req, res) => {
  res.json({ success: true, hubs: getDbKnownHubs() });
});

router.post('/api/hubs', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!name || !url) {
    return res.status(400).json({ error: 'Naam en URL zijn verplicht' });
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
  } catch {
    return res.status(400).json({ error: 'Ongeldige URL — begin met http:// of https://' });
  }
  const id = addDbKnownHub({ name, url });
  res.json({ success: true, id, hubs: getDbKnownHubs() });
});

router.delete('/api/hubs/:id', (req, res) => {
  deleteDbKnownHub(req.params.id);
  res.json({ success: true, hubs: getDbKnownHubs() });
});

export default router;
