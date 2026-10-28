// Push a liked song into Listener (the user's own music-list app,
// https://listener.doorkoppen.nl). Its integration API dedupes on spotify_id
// and otherwise on normalized artist+title, so this can fire on every like
// without checking first — see listener's backend/src/routes/integration.js.
//
// Deliberately fire-and-forget: a like is stored locally first and must never
// fail, hang, or wait on someone else's server being up.
import { reportHealthIssue, clearHealthIssue } from './healthLog.ts';

const HEALTH_KEY = 'listener_push';
const COLLECTION_KEY = 'listener_collection';
const TIMEOUT_MS = 8000;

export async function pushLikeToListener(
  config: { url?: string; integrationKey?: string },
  song: { title: string; artist: string; spotifyId?: string | null },
): Promise<void> {
  const base = (config.url || '').trim().replace(/\/+$/, '');
  if (!base || !config.integrationKey) return;

  try {
    const res = await fetch(`${base}/api/integration/songs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-key': config.integrationKey,
      },
      body: JSON.stringify({
        title: song.title,
        artist: song.artist,
        ...(song.spotifyId ? { spotify_id: song.spotifyId } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 401 here means the integration key is wrong — worth surfacing, since
      // the like itself succeeded and nothing else would ever tell the user
      // their Listener half has been silently dropping every song.
      reportHealthIssue(
        HEALTH_KEY,
        'listener',
        'warning',
        `Listener weigerde "${song.artist} - ${song.title}" (HTTP ${res.status})`,
      );
      return;
    }
    clearHealthIssue(HEALTH_KEY);

    // Listener filet een aangenomen song zelf in de collectie die dezelfde
    // naam draagt als de gebruikte API-sleutel. Lukt dat niet, dan is er
    // niets mis met de verbinding — het nummer staat gewoon in de catalogus
    // en verder nergens, en zonder dit zou je dat pas merken door in Listener
    // te gaan zoeken waar je favorieten blijven. Eén misplaatste spatie in de
    // collectienaam kostte precies die zoektocht.
    // `undefined` (geen veld) betekent: een Listener van vóór deze afspraak,
    // die zegt niets over collecties — dan valt er ook niets te melden.
    const body = await res.json().catch(() => ({}) as any);
    if (body?.collection === null) {
      reportHealthIssue(
        COLLECTION_KEY,
        'listener',
        'warning',
        'Favorieten komen wel in Listener, maar in geen enkele lijst: daar bestaat geen collectie met dezelfde naam als je API-sleutel.',
      );
    } else if (body?.collection) {
      clearHealthIssue(COLLECTION_KEY);
    }
  } catch (e: any) {
    reportHealthIssue(HEALTH_KEY, 'listener', 'warning', `Listener niet bereikbaar: ${e?.message || e}`);
  }
}
