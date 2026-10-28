import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrackTransition } from '../src/services/audioRecognition.ts';

test('isTrackTransition treats the very first probe as a transition even without silence', () => {
  assert.equal(isTrackTransition(0, false), true);
});

test('isTrackTransition requires at least one quiet probe once a lookup has already run for this run of sound — a no-match result counts too, otherwise an unrecognizable track re-triggers a full 12s capture on every 2s probe', () => {
  assert.equal(isTrackTransition(0, true), false);
});

test('isTrackTransition fires after a single full quiet probe — regression: a CD-length ~2s gap must count', () => {
  assert.equal(isTrackTransition(2000, true), true);
  assert.equal(isTrackTransition(4000, true), true);
});
