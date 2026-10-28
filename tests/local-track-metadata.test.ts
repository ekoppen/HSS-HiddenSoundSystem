import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSystemDirectory, readLocalTags } from '../src/services/localTrackMetadata.ts';

test('isSystemDirectory recognizes known NAS system folders', () => {
  assert.equal(isSystemDirectory('@eaDir'), true);
  assert.equal(isSystemDirectory('#recycle'), true);
  assert.equal(isSystemDirectory('.hidden-folder'), true);
});

test('isSystemDirectory does not flag a real artist/album folder name', () => {
  assert.equal(isSystemDirectory('ABBA'), false);
  assert.equal(isSystemDirectory('Massive Attack - Mezzanine'), false);
  assert.equal(isSystemDirectory('2004 - Greatest Hits'), false);
});

test('readLocalTags marks a file that music-metadata cannot parse as not playable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hss-nas-test-'));
  const filePath = join(dir, 'corrupt.mp3');
  writeFileSync(filePath, Buffer.from('this is not a valid mp3 frame at all'));
  try {
    const meta = await readLocalTags(filePath);
    assert.equal(meta.playable, false);
    assert.equal(meta.title, 'corrupt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
