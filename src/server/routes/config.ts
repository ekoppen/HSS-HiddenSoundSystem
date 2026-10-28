// Hub configuration (Spotify/Catalogic/recognition credentials) and user
// preferences.
import express from 'express';
import dns from 'node:dns/promises';
import { configureCatalogic, ensureCatalogicWebhookRegistered } from '../../services/catalogicClient.ts';
import { isSafeAlsaDevice } from '../../services/audioRecognition.ts';
import { getUserPreferences, setUserPreferences } from '../../../db.ts';
import { applyVolumeChange, broadcastWebSocket, generateApiKey, hubConfig, playbackState, saveAuthState, saveDiskConfig, users } from '../state.ts';

const router = express.Router();

export function isPrivateOrReservedIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Must check for an IPv4-mapped IPv6 address ("::ffff:127.0.0.1") before
  // deciding the address family below — that string contains a "." too, so
  // checking ip.includes('.') first (the previous bug here) sent it down
  // the IPv4 branch, where splitting on "." yields a non-numeric first
  // octet and every comparison silently evaluates to false.
  if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice('::ffff:'.length));
  if (!lower.includes(':')) {
    const [a, b] = lower.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return lower === '::1' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd');
}

/**
 * Guards the one place this file makes a server-side request to an
 * admin-supplied URL (the Catalogic connection test below) against SSRF: only
 * http(s), and every resolved address must be public — this Hub's own LAN,
 * loopback, and link-local ranges are all off-limits as a fetch target, since
 * the real Catalogic deployment is always a public host, never a private IP.
 * ponytail: re-validates the hostname's DNS once here but fetch() resolves
 * again itself, leaving a narrow DNS-rebind gap between the two lookups —
 * upgrade to a fixed-IP dispatcher if that specific attack ever matters here.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('alleen http(s) URLs zijn toegestaan');
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new Error('deze URL wijst naar een privé/intern adres — niet toegestaan');
  }
}

router.get('/api/config', (req, res) => {
  res.json({
    config: {
      ...hubConfig,
      // Mask secrets for UI safety — this is a GET, deliberately left open
      // (see the mutation-only auth gate above) for read-browsing on the
      // LAN, so live credentials must never round-trip here in full.
      apiKey: hubConfig.apiKey ? hubConfig.apiKey.substring(0, 16) + '••••••••' : '',
      spotifyClientSecret: hubConfig.spotifyClientSecret
        ? hubConfig.spotifyClientSecret.substring(0, 4) + '••••••••'
        : '',
      catalogicApiKey: hubConfig.catalogicApiKey
        ? hubConfig.catalogicApiKey.substring(0, 4) + '••••••••'
        : '',
      acoustidApiKey: hubConfig.acoustidApiKey
        ? hubConfig.acoustidApiKey.substring(0, 4) + '••••••••'
        : '',
      auddApiToken: hubConfig.auddApiToken
        ? hubConfig.auddApiToken.substring(0, 4) + '••••••••'
        : '',
      listenerIntegrationKey: hubConfig.listenerIntegrationKey
        ? hubConfig.listenerIntegrationKey.substring(0, 4) + '••••••••'
        : '',
    },
  });
});

router.post('/api/config', async (req, res) => {
  const updates = req.body;

  // The Catalogic URL is fetched from repeatedly after this (song lookups,
  // artwork, the NAS scan) with the real Catalogic API key attached — the
  // /api/catalogic/test route above already guards against SSRF via this
  // same field, but that guard only ran on the test button, not on save.
  // Skip the DNS round-trip when the value isn't actually changing.
  if (updates.catalogicUrl && updates.catalogicUrl.trim() !== '' && updates.catalogicUrl.trim() !== hubConfig.catalogicUrl) {
    try {
      await assertSafeExternalUrl(updates.catalogicUrl.trim());
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Ongeldige of niet-toegestane Catalogic URL.' });
      return;
    }
  }

  if (updates.spotifyClientSecret && !updates.spotifyClientSecret.includes('••••')) {
    hubConfig.spotifyClientSecret = updates.spotifyClientSecret;
  }
  if (updates.spotifyClientId && updates.spotifyClientId.trim() !== '') {
    hubConfig.spotifyClientId = updates.spotifyClientId.trim();
  }
  if (updates.spotifyDeviceName) hubConfig.spotifyDeviceName = updates.spotifyDeviceName;
  if (updates.spotifyBitrate) hubConfig.spotifyBitrate = updates.spotifyBitrate;
  if (updates.soloistEnabled !== undefined) hubConfig.soloistEnabled = updates.soloistEnabled;
  if (updates.autostartService !== undefined) hubConfig.autostartService = updates.autostartService;
  if (updates.broadcastSpectrum !== undefined) hubConfig.broadcastSpectrum = updates.broadcastSpectrum;
  if (updates.enableAlsaDirectHw !== undefined) hubConfig.enableAlsaDirectHw = updates.enableAlsaDirectHw;
  if (typeof updates.maxVolumeLimit === 'number') {
    hubConfig.maxVolumeLimit = Math.max(0, Math.min(100, Math.round(updates.maxVolumeLimit)));
    // A newly-lowered ceiling takes effect immediately, not just on the next
    // volume change — otherwise the current level can keep playing above
    // the limit you just set until something else happens to touch it.
    // Called even when the level is already below the new ceiling, because
    // this is the one path that broadcasts volume_change, and every screen
    // drawing a volume bar needs to hear that the ceiling moved. Re-applying
    // an unchanged level at the mixer is idempotent.
    applyVolumeChange({ volume: Math.min(playbackState.volume, hubConfig.maxVolumeLimit) });
  }
  if (updates.catalogicEnabled !== undefined) hubConfig.catalogicEnabled = updates.catalogicEnabled;
  if (updates.catalogicUrl && updates.catalogicUrl.trim() !== '') hubConfig.catalogicUrl = updates.catalogicUrl.trim();
  if (typeof updates.publicUrl === 'string') hubConfig.publicUrl = updates.publicUrl.trim();
  if (updates.catalogicApiKey && !updates.catalogicApiKey.includes('••••')) {
    hubConfig.catalogicApiKey = updates.catalogicApiKey;
  }
  if (updates.catalogicScanLookupEnabled !== undefined) hubConfig.catalogicScanLookupEnabled = updates.catalogicScanLookupEnabled;
  if (updates.acoustidApiKey && !updates.acoustidApiKey.includes('••••')) {
    hubConfig.acoustidApiKey = updates.acoustidApiKey;
  }
  if (updates.auddApiToken && !updates.auddApiToken.includes('••••')) {
    hubConfig.auddApiToken = updates.auddApiToken;
  }
  if (updates.recognitionMicDevice !== undefined) {
    // Rejects anything that isn't a plausible ALSA device id (e.g. leading
    // "-") before it can ever reach the `arecord -D <device>` argv in
    // audioRecognition.ts's captureAudioClip().
    if (updates.recognitionMicDevice === '' || isSafeAlsaDevice(updates.recognitionMicDevice)) {
      hubConfig.recognitionMicDevice = updates.recognitionMicDevice;
    } else {
      res.status(400).json({ error: 'Ongeldig microfoon-apparaat' });
      return;
    }
  }
  if (typeof updates.recognitionSilenceThreshold === 'number' && Number.isFinite(updates.recognitionSilenceThreshold)) {
    // 16-bit PCM RMS range is 0-32767; clamp to a sane band so a typo can't
    // wedge the loop into either never detecting silence or always seeing it.
    hubConfig.recognitionSilenceThreshold = Math.max(10, Math.min(10000, Math.round(updates.recognitionSilenceThreshold)));
  }
  if (typeof updates.recognitionLongSilenceSec === 'number' && Number.isFinite(updates.recognitionLongSilenceSec)) {
    // Floor of 5s keeps a single stray quiet probe from ever counting as
    // "genuinely stopped"; 3600s (1h) is a generous ceiling against a typo.
    hubConfig.recognitionLongSilenceSec = Math.max(5, Math.min(3600, Math.round(updates.recognitionLongSilenceSec)));
  }
  if (updates.listenerPushLikes !== undefined) hubConfig.listenerPushLikes = !!updates.listenerPushLikes;
  if (updates.radioLogEnabled !== undefined) hubConfig.radioLogEnabled = !!updates.radioLogEnabled;
  if (updates.listenerPushRadioLog !== undefined) hubConfig.listenerPushRadioLog = !!updates.listenerPushRadioLog;
  if (typeof updates.listenerUrl === 'string') {
    const trimmed = updates.listenerUrl.trim();
    // Same SSRF guard as the Catalogic URL above: this Hub fetches it
    // server-side on every like, so it must not be pointable at the LAN.
    if (trimmed !== '' && trimmed !== hubConfig.listenerUrl) {
      try {
        await assertSafeExternalUrl(trimmed);
      } catch (e: any) {
        res.status(400).json({ error: `Ongeldige Listener-URL: ${e.message}` });
        return;
      }
    }
    hubConfig.listenerUrl = trimmed;
  }
  if (updates.listenerIntegrationKey && !updates.listenerIntegrationKey.includes('••••')) {
    hubConfig.listenerIntegrationKey = updates.listenerIntegrationKey;
  }
  configureCatalogic({ enabled: hubConfig.catalogicEnabled, url: hubConfig.catalogicUrl, apiKey: hubConfig.catalogicApiKey });
  void ensureCatalogicWebhookRegistered(hubConfig.publicUrl);

  saveDiskConfig();

  broadcastWebSocket({
    event: 'notification',
    timestamp: Date.now(),
    data: { message: 'Configuratie succesvol bijgewerkt op Raspberry Pi' },
  });

  res.json({
    success: true,
    config: {
      ...hubConfig,
      spotifyClientSecret: hubConfig.spotifyClientSecret
        ? hubConfig.spotifyClientSecret.substring(0, 4) + '••••••••'
        : '',
    },
  });
});

// SQLite User Preferences Endpoints (No localStorage!)
router.get('/api/user/preferences', (req, res) => {
  const prefs = getUserPreferences('usr-admin-01');
  res.json({ success: true, preferences: prefs });
});

router.post('/api/user/preferences', (req, res) => {
  const { activeTab, activeTheme } = req.body;
  setUserPreferences('usr-admin-01', { activeTab, activeTheme });
  res.json({ success: true, preferences: getUserPreferences('usr-admin-01') });
});

// Tests the Catalogic URL/API-sleutel from the settings form — accepts the
// values currently in the form (not necessarily saved yet) so the user can
// check before saving, falling back to the already-saved value for whichever
// field still holds the masked '••••' placeholder (the same convention the
// save route above uses to detect an untouched secret field).
router.post('/api/catalogic/test', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const url = rawUrl || hubConfig.catalogicUrl;
  const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : '';
  const apiKey = rawKey && !rawKey.includes('••••') ? rawKey : hubConfig.catalogicApiKey;

  if (!url) {
    res.json({ success: false, reachable: false, authChecked: false, message: 'Geen Catalogic URL ingevuld.' });
    return;
  }

  try {
    await assertSafeExternalUrl(url);
  } catch (e: any) {
    res.json({ success: false, reachable: false, authChecked: false, message: e.message || 'Ongeldige of niet-toegestane URL.' });
    return;
  }

  const TIMEOUT_MS = 8000;
  const fetchWithTimeout = (path: string, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // redirect: 'manual' — a redirect response is treated as failure below
    // rather than followed, so a URL that 302s to a private address can't
    // slip past the check above (which only validated the original host).
    return fetch(`${url.replace(/\/$/, '')}${path}`, { ...init, redirect: 'manual', signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  try {
    const healthRes = await fetchWithTimeout('/health');
    if (healthRes.type === 'opaqueredirect' || (healthRes.status >= 300 && healthRes.status < 400)) {
      res.json({ success: false, reachable: false, authChecked: false, message: 'Server stuurt door naar een andere URL — niet gevolgd.' });
      return;
    }
    if (!healthRes.ok) {
      res.json({ success: false, reachable: false, authChecked: false, message: `Server bereikbaar maar antwoordt met fout ${healthRes.status}.` });
      return;
    }
  } catch {
    res.json({ success: false, reachable: false, authChecked: false, message: 'Server niet bereikbaar op deze URL.' });
    return;
  }

  if (!apiKey) {
    res.json({ success: true, reachable: true, authChecked: false, message: 'Server bereikbaar. Geen API-sleutel ingevuld — die is alleen nodig voor toekomstige schrijftoegang.' });
    return;
  }

  try {
    const whoamiRes = await fetchWithTimeout('/v1/auth/whoami', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (whoamiRes.status === 401) {
      res.json({ success: false, reachable: true, authChecked: true, message: 'Server bereikbaar, maar de API-sleutel is ongeldig.' });
      return;
    }
    if (!whoamiRes.ok) {
      res.json({ success: false, reachable: true, authChecked: false, message: `Kon de sleutel niet verifiëren (fout ${whoamiRes.status}).` });
      return;
    }
    const body = (await whoamiRes.json()) as { scopes?: string[] };
    res.json({ success: true, reachable: true, authChecked: true, message: 'Verbinding en API-sleutel werken.', scopes: body.scopes || [] });
  } catch {
    res.json({ success: false, reachable: true, authChecked: false, message: 'Kon de sleutel niet verifiëren (verbinding viel weg tijdens controle).' });
  }
});

router.post('/api/config/regenerate-api-key', (req, res) => {
  const newKey = generateApiKey();
  hubConfig.apiKey = newKey;
  if (users[0] && users[0].apiKeys[0]) {
    users[0].apiKeys[0].key = newKey;
  }
  saveAuthState();
  res.json({ success: true, apiKey: hubConfig.apiKey });
});

export default router;
