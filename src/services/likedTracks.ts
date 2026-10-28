// "Like" bookkeeping for whatever is playing — see src/server/routes/likes.ts
// for the endpoints and db.ts for the liked_tracks table.
//
// Pure on purpose: db.ts pulls in better-sqlite3 (a native module), so
// anything importable here stays testable in a plain `node --test` run.
import { Track } from '../types.ts';

export type LikeSource = 'spotify' | 'nas' | 'radio' | 'external';

// A liked song is identified by artist+title, never by its uri: the same
// song reaches this app as a Spotify uri, a NAS file path, an ICY tag off a
// radio stream and a fingerprint match from the turntable. Liking it twice
// from two of those must land on one row, so everything that differs
// between those spellings (case, punctuation, doubled spaces) is stripped.
export function likeKey(artist: string, title: string): string {
  const normalize = (value: string) =>
    (value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return `${normalize(artist)}|${normalize(title)}`;
}

// Which source the like came from, and the one detail worth keeping about
// it. Mirrors the same uri-sniffing NowPlaying already does for its badge.
export function describeLikeSource(
  track: Track | null,
  externalSourceLabel: string | null,
): { source: LikeSource; sourceDetail: string } {
  // An external turntable/CD is display-only — playbackState still holds
  // whatever the Hub itself played last, which would mislabel the like.
  if (externalSourceLabel) return { source: 'external', sourceDetail: externalSourceLabel };

  const uri = track?.uri || '';
  if (/^https?:\/\//i.test(uri)) {
    // On radio the ICY tag overwrites title/artist with the actual song, so
    // album is the only field left saying which station it came from.
    return { source: 'radio', sourceDetail: track?.album || '' };
  }
  if (uri.startsWith('file://')) return { source: 'nas', sourceDetail: track?.album || '' };
  return { source: 'spotify', sourceDetail: track?.album || '' };
}

// A stream that still only says "Live Web Radio" / "Internet Radio Stream"
// hasn't told us a song yet — that's station branding, and saving it would
// fill the list with noise.
export function isLikeable(track: Track | null): boolean {
  return !!track && !!track.title?.trim() && !!track.artist?.trim();
}
