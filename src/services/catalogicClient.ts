// Read/write client for Catalogic (https://catalogic.doorkoppen.nl), the shared
// music-metadata hub. Search/lookup reads are public — no API key needed.
// Submitting a backlog and registering a webhook are opt-in write calls, used
// only when Catalogic is enabled and a Hub API key is configured (see
// /api/config). Best-effort only: any failure (disabled, network, timeout, no
// match) resolves to `null`/`false` and callers fall back to locally-derived
// metadata, matching Catalogic's own "best-effort" integration philosophy
// (see CATALOGIC_SYNC.md in the catalogic repo).

import { createHmac, timingSafeEqual } from 'crypto';
import { getDbConfig, setDbConfig } from '../../db.ts';

const LOOKUP_TIMEOUT_MS = 3000;
// create_if_missing does real work server-side (Spotify search, artist/album
// upserts, DB writes) and — since /v1/songs/lookup now retries in-request on
// a Spotify rate limit (see withRateLimitRetry in the catalogic repo) — can
// legitimately take several seconds longer than a plain read lookup under a
// bulk sweep. The plain LOOKUP_TIMEOUT_MS was cutting those off mid-retry.
const CREATE_TIMEOUT_MS = 12000;

interface CatalogicConfig {
  enabled: boolean;
  url: string;
  apiKey?: string;
}

let config: CatalogicConfig = {
  enabled: false,
  url: process.env.CATALOGIC_URL || 'https://catalogic.doorkoppen.nl',
};

export function configureCatalogic(next: CatalogicConfig): void {
  config = { ...next, url: next.url.replace(/\/$/, '') };
}

// A `null` result from lookupCatalogicSong is ambiguous on its own — it
// means either "searched, genuinely no match" (fine, nothing to report) or
// "couldn't get an authoritative answer at all" (Catalogic down, timed out,
// bad API key). Callers that report enrichment coverage to the user (the
// whole-library scan) need to tell those apart, so every non-ok-response or
// network/timeout failure bumps this counter — see getSongLookupFailureCount().
let songLookupFailures = 0;
export function getSongLookupFailureCount(): number {
  return songLookupFailures;
}

export interface CatalogicMatch {
  songId: string;
  title: string;
  artistName: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
}

interface SearchHit {
  type: 'song' | 'artist' | 'album';
  source: 'catalogic' | 'spotify';
  id?: string;
  title?: string;
  artist_name?: string | null;
  duration_ms?: number | null;
  artwork_url?: string | null;
}

/**
 * Best-effort lookup of a song's canonical metadata + artwork by title/artist.
 * Uses Catalogic's local (non-Spotify) search only — this is a passive read,
 * we never want a metadata lookup to trigger an external Spotify search.
 */
export async function lookupCatalogicSong(title: string, artist?: string): Promise<CatalogicMatch | null> {
  if (!config.enabled || !title.trim()) return null;
  const q = artist ? `${title} ${artist}` : title;
  const url = `${config.url}/v1/search?q=${encodeURIComponent(q)}&type=song&limit=3`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) {
      songLookupFailures++;
      return null;
    }
    const body = (await res.json()) as { data: SearchHit[] };
    const hits = (body.data || []).filter((h) => h.type === 'song' && h.source === 'catalogic');
    if (hits.length === 0) return null;

    // Only accept a hit whose title also matches — matching artist alone
    // (the old behavior) accepted a different song by the right artist
    // whenever it outranked the actual one (e.g. "I Appear Missing" by
    // Queens Of The Stone Age matched a top-3 hit for a different QOTSA
    // track, wrongly showing that other track's album art). Falling back to
    // the top full-text hit regardless of artist accepted completely
    // unrelated songs whenever none of the top-3 candidates matched (e.g.
    // searching "Crazy World" + "ABBA" returned an Elvis Costello track as
    // the #1 text match, which then got wrongly cached as ABBA's artwork).
    const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const wantTitle = norm(title);
    const best = hits.find((h) => {
      const hitTitle = norm(h.title || '');
      const titleMatches = hitTitle === wantTitle || hitTitle.includes(wantTitle) || wantTitle.includes(hitTitle);
      return titleMatches && (!artist || h.artist_name?.toLowerCase().includes(artist.toLowerCase()));
    });
    if (!best?.id || !best.title) return null;

    return {
      songId: best.id,
      title: best.title,
      artistName: best.artist_name ?? null,
      durationMs: best.duration_ms ?? null,
      artworkUrl: best.artwork_url ? `${config.url}${best.artwork_url}` : null,
    };
  } catch {
    songLookupFailures++;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface MediaAssetHit {
  id: string;
  kind: string;
  variant: string;
}

/**
 * Fetches the best available artwork URL for a Catalogic artist/album via
 * the media-assets list endpoint. Note: this endpoint's filter params are
 * `owner_type`/`owner_id` — NOT `resource_type`/`resource_id` (verified
 * directly against the live API; the wrong names are silently ignored and
 * the endpoint returns an unfiltered/wrong result instead of an error).
 */
export async function fetchCatalogicArtwork(ownerType: 'artist' | 'album', ownerId: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${config.url}/v1/media-assets?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal, headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { data: MediaAssetHit[] };
    const assets = (body.data || []).filter((a) => a.kind === 'artwork');
    const best = assets.find((a) => a.variant === 'sq') || assets.find((a) => a.variant === 'thumb') || assets[0];
    return best ? `${config.url}/v1/media-assets/${best.id}/download` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicArtistMatch {
  artistId: string;
  name: string;
  artworkUrl: string | null;
}

interface ArtistSearchHit {
  type: 'artist';
  source: 'catalogic' | 'spotify';
  id?: string;
  name?: string;
}

/**
 * Best-effort artist lookup by exact (case-insensitive) name — no fallback
 * to "closest hit regardless of name", same discipline as the song-match
 * fix: a folder named after an artist that isn't in Catalogic must resolve
 * to null, not to some unrelated similarly-named artist.
 */
export async function lookupCatalogicArtist(name: string): Promise<CatalogicArtistMatch | null | undefined> {
  if (!config.enabled || !name.trim()) return null;
  const url = `${config.url}/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=3`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined; // transient HTTP failure — not a real "no match" answer
    const body = (await res.json()) as { data: ArtistSearchHit[] };
    const hits = (body.data || []).filter((h) => h.type === 'artist' && h.source === 'catalogic');
    const exact = hits.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    if (!exact?.id || !exact.name) return null; // genuinely searched, no exact match
    const artworkUrl = await fetchCatalogicArtwork('artist', exact.id);
    return { artistId: exact.id, name: exact.name, artworkUrl };
  } catch {
    return undefined; // network/timeout failure — not a real "no match" answer
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicAlbumMatch {
  albumId: string;
  title: string;
  artworkUrl: string | null;
}

interface AlbumSearchHit {
  type: 'album';
  source: 'catalogic' | 'spotify';
  id?: string;
  title?: string;
  primary_artist_id?: string | null;
}

/**
 * Best-effort album lookup, disambiguated by `primary_artist_id` against
 * the already-resolved Catalogic artist id — an exact ID comparison, more
 * reliable than the fuzzy artist-name-substring check songs use.
 */
export async function lookupCatalogicAlbum(title: string, artistCatalogicId: string): Promise<CatalogicAlbumMatch | null | undefined> {
  if (!config.enabled || !title.trim() || !artistCatalogicId) return null;
  const url = `${config.url}/v1/search?q=${encodeURIComponent(title)}&type=album&limit=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined; // transient HTTP failure — not a real "no match" answer
    const body = (await res.json()) as { data: AlbumSearchHit[] };
    const hits = (body.data || []).filter((h) => h.type === 'album' && h.source === 'catalogic');
    const match = hits.find((h) => h.primary_artist_id === artistCatalogicId);
    if (!match?.id || !match.title) return null; // genuinely searched, no match
    const artworkUrl = await fetchCatalogicArtwork('album', match.id);
    return { albumId: match.id, title: match.title, artworkUrl };
  } catch {
    return undefined; // network/timeout failure — not a real "no match" answer
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicBacklogItem {
  externalId: string;
  title: string;
  artist?: string;
}

/**
 * Hands a batch of not-yet-matched local files to Catalogic's own backlog
 * queue (job kind `songs.resolve_backlog_item` on the Catalogic side — see
 * docs/superpowers/specs/2026-08-22-nas-catalogic-backlog-design.md), so it
 * can resolve/create them at its own pace instead of blocking a scan on a
 * live Spotify lookup per file. Best-effort: a failure just means these files
 * stay unmatched until the next scan re-submits them (Catalogic dedupes by
 * external_id, so re-submitting the same backlog repeatedly is harmless).
 */
export async function submitCatalogicBacklog(items: CatalogicBacklogItem[]): Promise<boolean> {
  if (!config.enabled || items.length === 0) return false;
  const url = `${config.url}/v1/songs/backlog`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        items: items.slice(0, 500).map((i) => ({ external_id: i.externalId, title: i.title, artist: i.artist })),
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers this Hub as a Catalogic webhook subscriber for `song.created`,
 * so a resolved backlog item pokes `callbackUrl` instead of HSS having to
 * poll. Returns the delivery secret (for verifyCatalogicWebhookSignature) on
 * success, `null` on any failure — caller decides whether/how to retry.
 */
export async function registerCatalogicWebhook(callbackUrl: string): Promise<string | null> {
  if (!config.enabled) return null;
  const url = `${config.url}/v1/webhooks`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ target_url: callbackUrl, events: ['song.created'] }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { secret?: string };
    return body.secret ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers the webhook once and remembers the secret in the (non-hubConfig,
 * non-disk-serialized — see Global Constraints) SQLite config table. A stored
 * secret means "already registered," so this is a cheap no-op on every
 * subsequent call — including every server boot.
 *
 * ponytail: doesn't detect a changed `publicUrl` and re-register — if you
 * move the Hub to a new address, clear the `catalogic_webhook_secret` config
 * key manually (or add a re-register button) to force it. Upgrade when
 * that's actually happened to someone.
 */
export async function ensureCatalogicWebhookRegistered(publicUrl: string): Promise<void> {
  if (!config.enabled || !publicUrl.trim()) return;
  if (getDbConfig('catalogic_webhook_secret', '')) return;
  const callbackUrl = `${publicUrl.replace(/\/$/, '')}/api/catalogic/webhook`;
  const secret = await registerCatalogicWebhook(callbackUrl);
  if (secret) setDbConfig('catalogic_webhook_secret', secret);
}

/**
 * Verifies the `X-Catalogic-Signature: sha256=<hex>` header Catalogic sends
 * with every webhook delivery (HMAC-SHA256 of the raw request body, keyed by
 * the secret returned from registerCatalogicWebhook). Constant-time compare
 * so response timing can't leak the secret.
 */
export function verifyCatalogicWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export interface CatalogicLyrics {
  id: string;
  locale: string;
  format: 'plain' | 'lrc';
  text: string;
}

/**
 * Best-effort lyrics lookup for an already-matched Catalogic song — GET
 * /v1/songs/:songId/lyrics is publicly readable (no scope required, unlike
 * the PUT/DELETE variants), verified directly against the live route
 * source (catalogic/src/routes/lyrics.ts). Returns `undefined` on a
 * transient failure (HTTP error, timeout, network down) — NOT the same as
 * a genuine "no lyrics for this song" (an empty array), same error/no-match
 * discipline as lookupCatalogicArtist/lookupCatalogicAlbum: a temporary
 * Catalogic outage must never permanently cache "no lyrics".
 */
export async function lookupCatalogicLyrics(songId: string): Promise<CatalogicLyrics[] | undefined> {
  if (!config.enabled || !songId) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.url}/v1/songs/${encodeURIComponent(songId)}/lyrics`, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data: CatalogicLyrics[] };
    return body.data || [];
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogicCreatedSong {
  songId: string;
  artistId: string | null;
  albumId: string | null;
  source: 'catalogic' | 'spotify';
}

/**
 * Onderscheidt zich van lookupCatalogicSong: dit MAG een nieuwe song (en
 * de bijbehorende artiest/album) aanmaken via Spotify als Catalogic 'm nog
 * niet kent (GET /v1/songs/lookup?create_if_missing=true, geverifieerd
 * tegen de live routebroncode — catalogic/src/routes/songs-lookup.ts).
 * Alleen aanroepen vanuit een expliciete gebruikersactie (een klik op
 * "aanmaken"), nooit vanuit automatische achtergrond-matching — zie het
 * ontwerpdocument voor de afweging.
 */
export async function lookupOrCreateCatalogicSong(
  title: string,
  artist: string,
  album?: string,
  forceRefresh?: boolean
): Promise<CatalogicCreatedSong | undefined> {
  if (!config.enabled || !title.trim() || !artist.trim()) return undefined;
  // album disambiguates which release Catalogic's Spotify search should
  // prefer (see pickBestAlbumMatch server-side) — without it, a title/artist
  // search ranks by Spotify popularity, which is very often a "Greatest
  // Hits" compilation or an anniversary remaster rather than the specific
  // album this local file is actually in.
  const albumParam = album?.trim() ? `&album=${encodeURIComponent(album.trim())}` : '';
  // forceRefresh skips catalogic's own already-matched-by-title/artist
  // shortcut — needed to fix a song matched to the wrong release before
  // `album` existed, since without this a plain re-lookup just keeps
  // returning that same wrong match forever.
  const forceParam = forceRefresh ? '&force_refresh=true' : '';
  const url = `${config.url}/v1/songs/lookup?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}${albumParam}${forceParam}&create_if_missing=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { source: 'catalogic' | 'spotify'; song: { id: string; primaryArtistId: string | null; primaryAlbumId: string | null } };
    return { songId: body.song.id, artistId: body.song.primaryArtistId, albumId: body.song.primaryAlbumId, source: body.source };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
