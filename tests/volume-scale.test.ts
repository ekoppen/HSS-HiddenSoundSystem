// Straight from a live report: with "Maximaal volume" set, the web page's
// volume indicator scaled along with it but the HDMI kiosk screen did not.
// The web page got it right because it uses the shared Slider; the kiosk
// screen drew its own bar against a hardcoded 100. Both now go through
// fillPercent, so these cases pin the behaviour for both at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillPercent } from '../src/services/volumeScale.ts';

test('a volume at the ceiling fills the bar completely, whatever the ceiling is', () => {
  assert.equal(fillPercent(100, 0, 100), 100);
  // The actual report: max 40, volume 40 — a full bar, because 40 is as loud
  // as the knob goes. This used to draw at 40% on the kiosk screen.
  assert.equal(fillPercent(40, 0, 40), 100);
});

test('a volume halfway to the ceiling fills half the bar', () => {
  assert.equal(fillPercent(20, 0, 40), 50);
  assert.equal(fillPercent(50, 0, 100), 50);
});

test('a stale value above a just-lowered ceiling clamps instead of overflowing the track', () => {
  // The ceiling shrinks live; a value from just before that change would
  // otherwise compute >100% and push the slider thumb outside its own track.
  assert.equal(fillPercent(80, 0, 40), 100);
  assert.equal(fillPercent(-10, 0, 100), 0);
});

test('a maximum of 0 yields 0 rather than NaN (regression: NaN reaches the DOM as an invalid width and draws nothing)', () => {
  assert.equal(fillPercent(0, 0, 0), 0);
  assert.equal(fillPercent(50, 0, 0), 0);
  // max below min is nonsense input, not a reason to emit NaN
  assert.equal(fillPercent(5, 10, 4), 0);
});

test('non-numeric input yields 0 instead of poisoning the width with NaN', () => {
  assert.equal(fillPercent(NaN, 0, 100), 0);
  assert.equal(fillPercent(50, 0, NaN), 0);
});
