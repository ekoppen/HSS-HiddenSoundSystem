// Optionele radio-luistergeschiedenis (hubConfig.radioLogEnabled) — het
// vullen gebeurt in de ticker in state.ts, hier alleen lezen en wissen.
import express from 'express';
import { clearRadioLog, getRadioLog } from '../../../db.ts';
import { requireAudioPermission } from '../state.ts';

const router = express.Router();

router.get('/api/radio/log', (req, res) => {
  // Clamp against garbage query params rather than letting them reach the
  // SQL LIMIT/OFFSET as NaN (better-sqlite3 throws on a non-integer bind).
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({ success: true, entries: getRadioLog(limit, offset) });
});

router.delete('/api/radio/log', requireAudioPermission('audio:control'), (req, res) => {
  clearRadioLog();
  res.json({ success: true });
});

export default router;
