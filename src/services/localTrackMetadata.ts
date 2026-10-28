// Reads local/NAS audio-file tags: embedded tags if present,
// filename/folder-derived otherwise. Pure and network-free — the
// Catalogic-aware, cached Track-building this file used to also do now
// lives in resolveLocalTrack (nasLibraryScan.ts), which is the single
// place that decides whether a file needs re-reading at all (see
// docs/superpowers/specs/2026-08-22-nas-metadata-unification-design.md).
import * as mm from 'music-metadata';
import path from 'path';

const AUDIO_EXTENSIONS = ['.flac', '.mp3', '.wav', '.dsd', '.dsf', '.m4a', '.alac', '.ogg'];

export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

const SYSTEM_DIR_NAMES = new Set([
  '@eaDir',    // Synology thumbnail-/metadatacache, per map
  '@tmp',      // Synology tijdelijke map tijdens bestandsbewerkingen
  '#recycle',  // Synology prullenbak (netwerkgedeeld zichtbaar)
  '#snapshot', // Synology snapshot-map
  '.streams',  // QNAP thumbnail-/streamingcache
  '@Recycle',  // QNAP prullenbak
]);

/**
 * Herkent NAS-systeemmappen (Synology/QNAP thumbnailcaches, prullenbakken)
 * die nooit als artiest/album/songmap bedoeld zijn — blocklist plus "alles
 * wat met een punt begint" (verborgen mappen, geen enkele echte
 * artiest/album heeft een naam die met een punt start).
 */
export function isSystemDirectory(name: string): boolean {
  return SYSTEM_DIR_NAMES.has(name) || name.startsWith('.');
}

export interface LocalFileMeta {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  playable: boolean;
}

/** Local-only: embedded tags if present, filename/folder-derived otherwise. No network. */
export async function readLocalTags(filePath: string): Promise<LocalFileMeta> {
  const ext = path.extname(filePath).toLowerCase();
  const fallbackTitle = path.basename(filePath, ext);
  const fallbackArtist = path.basename(path.dirname(filePath));
  try {
    const parsed = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    // music-metadata does not throw on garbage bytes with an audio-like
    // extension — it returns a best-effort format object with `container`
    // left undefined. A real container is always populated for anything it
    // actually recognized (verified: a hand-built minimal valid WAV parses
    // with `container: "WAVE"`; garbage bytes named `corrupt.mp3` parse
    // without throwing but with `container: undefined`). "Did parseFile
    // throw" alone is therefore not a reliable playability signal — checking
    // `format.container` is.
    const playable = !!parsed.format.container;
    return {
      title: parsed.common.title || fallbackTitle,
      artist: parsed.common.artist || parsed.common.albumartist || fallbackArtist,
      album: parsed.common.album || fallbackArtist,
      durationMs: parsed.format.duration ? Math.round(parsed.format.duration * 1000) : 240000,
      playable,
    };
  } catch {
    return { title: fallbackTitle, artist: fallbackArtist, album: fallbackArtist, durationMs: 240000, playable: false };
  }
}
