import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackState, applyVolumeChange, togglePlayback } from '../src/server/state.ts';

test('applyVolumeChange clamps volume to 0-100', () => {
  applyVolumeChange({ volume: 150 });
  assert.equal(playbackState.volume, 100);
  applyVolumeChange({ volume: -10 });
  assert.equal(playbackState.volume, 0);
  applyVolumeChange({ volume: 42 });
  assert.equal(playbackState.volume, 42);
});

test('applyVolumeChange updates isMuted independently of volume', () => {
  applyVolumeChange({ volume: 50 });
  applyVolumeChange({ isMuted: true });
  assert.equal(playbackState.isMuted, true);
  assert.equal(playbackState.volume, 50);
  applyVolumeChange({ isMuted: false });
  assert.equal(playbackState.isMuted, false);
});

test('applyVolumeChange ignores fields that are not provided', () => {
  applyVolumeChange({ volume: 33 });
  const before = { volume: playbackState.volume, isMuted: playbackState.isMuted };
  applyVolumeChange({});
  assert.deepEqual({ volume: playbackState.volume, isMuted: playbackState.isMuted }, before);
});

test('togglePlayback resolves with a success boolean without throwing', async () => {
  // No real Spotify session exists in a fresh test process and no local
  // file is playing, so this exercises the "no active source" path — the
  // point of this test is that the extracted function is callable and
  // well-formed, not to validate real Spotify/local-player behavior
  // (which the existing project already doesn't unit-test elsewhere for
  // the same reason: it requires either real hardware or a real Spotify
  // session neither of which exist in this environment).
  const result = await togglePlayback();
  assert.equal(typeof result.success, 'boolean');
});
