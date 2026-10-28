import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLocalTrack } from '../src/services/nasLibraryScan.ts';
import { getDbNasLibraryEntry, upsertDbNasLibraryEntry } from '../db.ts';

// resolveLocalTrack's freshness gate (see its own doc-comment in
// nasLibraryScan.ts) is the single place every caller — browse, playback,
// playlist creation, whole-library scan — decides whether a cached row can
// be trusted or must be re-read/re-looked-up. Getting that gate wrong has
// already caused real regressions this session (a Catalogic match silently
// treated as fresh when it wasn't, matches erased on a routine re-resolve).
// These tests seed DB rows directly (via upsertDbNasLibraryEntry, the same
// function the source uses) rather than relying on real parseable audio
// tags, so each case exercises exactly one freshness condition
// deterministically instead of depending on what music-metadata happens to
// extract from throwaway file bytes.

function makeTempFile(dir: string, content = 'placeholder audio bytes'): { filePath: string; size: number; mtimeMs: number } {
  const filePath = join(dir, 'track.mp3');
  writeFileSync(filePath, Buffer.from(content));
  const stat = statSync(filePath);
  return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
}

function seedRow(
  filePath: string,
  size: number,
  mtimeMs: number,
  overrides: Partial<{ matchConfidence: string | null; playable: boolean; catalogicSongId: string | null }> = {}
) {
  upsertDbNasLibraryEntry({
    filePath,
    title: 'SEED-TITLE-MARKER',
    artist: 'Seed Artist',
    album: 'Seed Album',
    fileSize: size,
    mtimeMs,
    catalogicSongId: overrides.catalogicSongId ?? null,
    matchConfidence: overrides.matchConfidence ?? null,
    artworkUrl: null,
    playable: overrides.playable ?? true,
    durationMs: 200000,
  });
}

test('resolveLocalTrack returns an unplayable placeholder for a file that does not exist', async () => {
  const track = await resolveLocalTrack('/nonexistent/path/ghost.mp3', { allowCatalogicLookup: false });
  assert.equal(track.playable, false);
  assert.equal(track.fromCache, false);
  assert.equal(track.catalogicSongId, null);
});

test('resolveLocalTrack reads and caches a new (never-seen) file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath } = makeTempFile(dir);
    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
    assert.equal(track.fromCache, false);
    assert.ok(getDbNasLibraryEntry(filePath), 'a row should now exist in the index');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalTrack serves from cache when size/mtime are unchanged and no Catalogic lookup is requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath, size, mtimeMs } = makeTempFile(dir);
    seedRow(filePath, size, mtimeMs);

    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
    assert.equal(track.fromCache, true);
    assert.equal(track.title, 'SEED-TITLE-MARKER');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalTrack re-resolves when the cached size/mtime no longer match the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath, size, mtimeMs } = makeTempFile(dir);
    // Seed a row claiming a different size than the real file has.
    seedRow(filePath, size + 999, mtimeMs);

    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
    assert.equal(track.fromCache, false);
    assert.notEqual(track.title, 'SEED-TITLE-MARKER');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalTrack re-resolves a cached-but-unplayable row even when the file itself is unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath, size, mtimeMs } = makeTempFile(dir);
    seedRow(filePath, size, mtimeMs, { playable: false });

    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: false });
    assert.equal(track.fromCache, false);
    assert.notEqual(track.title, 'SEED-TITLE-MARKER');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalTrack does NOT trust a browse-only cached row (match_confidence still null) once a Catalogic lookup is requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath, size, mtimeMs } = makeTempFile(dir);
    // Simulates a row written by a plain browse (allowCatalogicLookup: false
    // at the time) — playable and size/mtime-fresh, but never actually
    // asked Catalogic anything, so match_confidence is still null.
    seedRow(filePath, size, mtimeMs, { matchConfidence: null });

    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: true });
    assert.equal(track.fromCache, false, 'a null match_confidence must not satisfy a lookup request');
    assert.notEqual(track.title, 'SEED-TITLE-MARKER');

    // Catalogic is disabled by default in a fresh test process (see
    // catalogic-client.test.ts) — lookupCatalogicSong short-circuits to
    // null, which resolveLocalTrack records as the 'geen' sentinel (a real
    // attempt that found nothing), never leaving match_confidence null.
    const after = getDbNasLibraryEntry(filePath);
    assert.equal(after.match_confidence, 'geen');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalTrack DOES trust a cached row with a real match_confidence, even when a Catalogic lookup is requested again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-resolve-test-'));
  try {
    const { filePath, size, mtimeMs } = makeTempFile(dir);
    // A lookup genuinely happened before (confidence is non-null) — asking
    // again with allowCatalogicLookup: true must not re-trigger it.
    seedRow(filePath, size, mtimeMs, { matchConfidence: 'hoog', catalogicSongId: 'song-123' });

    const track = await resolveLocalTrack(filePath, { allowCatalogicLookup: true });
    assert.equal(track.fromCache, true);
    assert.equal(track.title, 'SEED-TITLE-MARKER');
    assert.equal(track.catalogicSongId, 'song-123');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
