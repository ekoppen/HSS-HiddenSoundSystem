// Regression tests for the ALSA/mpv hardware layer — every case here maps
// directly to a real bug found live this session, most of them not caught
// by any test until now. These are pure-function extractions (no real
// amixer/mpv/fs calls), so they run the same in CI as on a Pi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateVolumeDb, computeBalanceSteps, computeEqRawValue, detectAudioCardIndex, parseMixerDb, volumePctFromDb } from '../src/services/piHardware.ts';
import { looksLikeStationJingle, parseIcyTitle } from '../src/services/localPlayer.ts';
import fs from 'node:fs';
import { buildAsoundConf } from '../src/services/piSetup.ts';

// --- detectAudioCardIndex ---------------------------------------------

test('detectAudioCardIndex picks the only real card on a single-DAC Pi', () => {
  const cardsContent = ` 0 [sndrpihifiberry]: HifiberryDacp - snd_rpi_hifiberry_dacplus\n                      snd_rpi_hifiberry_dacplus\n`;
  const result = detectAudioCardIndex(cardsContent);
  assert.equal(result.cardIndex, 0);
  assert.equal(result.hasHifiberry, true);
});

test('detectAudioCardIndex skips onboard HDMI and picks the DAC HAT on a Pi 5 (regression: hardcoded card 0 talked to HDMI instead)', () => {
  const cardsContent = [
    ' 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0',
    '                      vc4-hdmi-0',
    ' 1 [vc4hdmi1       ]: vc4-hdmi - vc4-hdmi-1',
    '                      vc4-hdmi-1',
    ' 2 [sndrpihifiberry]: HifiberryDacp - snd_rpi_hifiberry_dacplus',
    '                      snd_rpi_hifiberry_dacplus',
    '',
  ].join('\n');
  const result = detectAudioCardIndex(cardsContent);
  assert.equal(result.cardIndex, 2);
});

test('detectAudioCardIndex prefers the DAC over a USB webcam mic that also enumerates as non-HDMI (regression: "last non-HDMI card" picked the webcam)', () => {
  // The exact card layout confirmed live on production.
  const cardsContent = [
    ' 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0',
    '                      vc4-hdmi-0',
    ' 1 [vc4hdmi1       ]: vc4-hdmi - vc4-hdmi-1',
    '                      vc4-hdmi-1',
    ' 2 [sndrpihifiberry]: HifiberryDacp - snd_rpi_hifiberry_dacplus',
    '                      snd_rpi_hifiberry_dacplus',
    ' 3 [CameraB409241  ]: USB-Audio - USB Camera-B4.09.24.1',
    '                      OmniVision Technologies, Inc. USB Camera-B4.09.24.1 at usb-0000:01:00.0-1.2, hi',
    '',
  ].join('\n');
  const result = detectAudioCardIndex(cardsContent);
  assert.equal(result.cardIndex, 2);
});

test('detectAudioCardIndex falls back to the first non-HDMI, non-camera card for an unrecognized USB DAC', () => {
  const cardsContent = [
    ' 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0',
    '                      vc4-hdmi-0',
    ' 1 [Audio          ]: USB-Audio - Generic USB Audio Device',
    '                      Generic USB Audio Device at usb-0000:01:00.0-1.1, full speed',
    '',
  ].join('\n');
  const result = detectAudioCardIndex(cardsContent);
  assert.equal(result.cardIndex, 1);
});

test('detectAudioCardIndex returns null (no crash, caller keeps its previous index) when only HDMI cards exist', () => {
  const cardsContent = ' 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0\n                      vc4-hdmi-0\n';
  const result = detectAudioCardIndex(cardsContent);
  assert.equal(result.cardIndex, null);
});

test('detectAudioCardIndex handles empty/garbage input without throwing', () => {
  assert.doesNotThrow(() => detectAudioCardIndex(''));
  assert.equal(detectAudioCardIndex('').cardIndex, null);
  assert.doesNotThrow(() => detectAudioCardIndex('not even close to /proc/asound/cards format'));
});

// --- computeBalanceSteps -----------------------------------------------

test('computeBalanceSteps is a no-op at balance 0', () => {
  const { attenDb, leftStep, rightStep } = computeBalanceSteps(0);
  assert.equal(attenDb, 0);
  assert.equal(leftStep, '0dB-');
  assert.equal(rightStep, '0dB-');
});

test('computeBalanceSteps at halfway right leaves the loud channel untouched (regression: percentage scaling touched/silenced both channels)', () => {
  const { attenDb, leftStep, rightStep } = computeBalanceSteps(25);
  assert.equal(attenDb, 12);
  assert.equal(leftStep, '12dB-'); // quiet side
  assert.equal(rightStep, '0dB-'); // loud side — must never move
});

test('computeBalanceSteps at halfway left attenuates the opposite channel', () => {
  const { attenDb, leftStep, rightStep } = computeBalanceSteps(-25);
  assert.equal(attenDb, 12);
  assert.equal(leftStep, '0dB-');
  assert.equal(rightStep, '12dB-');
});

test('computeBalanceSteps never exceeds MAX_BALANCE_ATTEN_DB (24) at the hard extreme', () => {
  assert.equal(computeBalanceSteps(50).attenDb, 24);
  assert.equal(computeBalanceSteps(-50).attenDb, 24);
});

test('computeBalanceSteps clamps out-of-range input to the same result as the hard extreme', () => {
  assert.deepEqual(computeBalanceSteps(100), computeBalanceSteps(50));
  assert.deepEqual(computeBalanceSteps(-999), computeBalanceSteps(-50));
});

// --- calculateVolumeDb --------------------------------------------------

test('calculateVolumeDb floors at -60dB for silence and 0dB at full scale', () => {
  assert.equal(calculateVolumeDb(0), -60);
  assert.equal(calculateVolumeDb(100), 0);
});

test('calculateVolumeDb at 70% (regression: sent as raw "70%" to amixer, whose own percent scale is non-linear and made 70% nearly inaudible)', () => {
  assert.equal(calculateVolumeDb(70), -18);
});

// --- computeEqRawValue ---------------------------------------------------

test('computeEqRawValue maps 0dB gain to alsaequal\'s confirmed-live flat default (66)', () => {
  assert.equal(computeEqRawValue(0, true), 66);
});

test('computeEqRawValue stays inside 0-100 at the app\'s full ±12dB range', () => {
  assert.equal(computeEqRawValue(12, true), 90);
  assert.equal(computeEqRawValue(-12, true), 42);
});

test('computeEqRawValue forces flat (66) when the equalizer is disabled, regardless of stored gain', () => {
  assert.equal(computeEqRawValue(12, false), 66);
  assert.equal(computeEqRawValue(-12, false), 66);
});

test('computeEqRawValue clamps absurd gain values to the control\'s real 0-100 range', () => {
  assert.equal(computeEqRawValue(100, true), 100);
  assert.equal(computeEqRawValue(-100, true), 0);
});

// --- parseIcyTitle ---------------------------------------------------------

test('parseIcyTitle splits the common "Artist - Title" StreamTitle format', () => {
  assert.deepEqual(parseIcyTitle('Nirvana - Smells Like Teen Spirit'), {
    title: 'Smells Like Teen Spirit',
    artist: 'Nirvana',
  });
});

test('parseIcyTitle trims irregular whitespace (the exact raw string confirmed live from Pinguin Radio)', () => {
  assert.deepEqual(parseIcyTitle('Ennio Morricone  - The Ecstacy of Gold '), {
    title: 'The Ecstacy of Gold',
    artist: 'Ennio Morricone',
  });
});

test('parseIcyTitle treats a title with no " - " separator as title-only, no artist guessed', () => {
  const result = parseIcyTitle('JustATitleWithNoSeparator');
  assert.equal(result.title, 'JustATitleWithNoSeparator');
  assert.equal(result.artist, undefined);
});

test('parseIcyTitle never produces an empty-string artist from a leading separator', () => {
  const result = parseIcyTitle(' - Title Only');
  assert.equal(result.artist, undefined);
});

// --- looksLikeStationJingle -------------------------------------------

test('looksLikeStationJingle catches the exact malformed tag confirmed live on Pinguin Radio', () => {
  assert.equal(looksLikeStationJingle('PINGUIN_CLASSICS_SWEEP_06  -'), true);
});

test('looksLikeStationJingle lets a real "Artist - Title" song title through', () => {
  assert.equal(looksLikeStationJingle('Smells Like Teen Spirit'), false);
  assert.equal(looksLikeStationJingle('Nirvana'), false);
});

test('looksLikeStationJingle is not fooled by a genuinely all-caps song/artist (e.g. "R.E.M.", "ABBA")', () => {
  assert.equal(looksLikeStationJingle('ABBA'), false);
});

test('looksLikeStationJingle ignores an empty string', () => {
  assert.equal(looksLikeStationJingle(''), false);
  assert.equal(looksLikeStationJingle('   '), false);
});

// --- buildAsoundConf ---------------------------------------------------

test('buildAsoundConf routes the equal plugin through a plug-wrapped slave (regression: bare "type hw" slave failed hw_params negotiation live — "Slave PCM not usable")', () => {
  const conf = buildAsoundConf();
  assert.match(conf, /pcm\.hifisoloist_plug\s*\{\s*type plug\s*\n\s*slave\.pcm "hifisoloist"/);
  assert.match(conf, /pcm\.eqbase\s*\{\s*type equal\s*\n\s*slave\.pcm "hifisoloist_plug"/);
});

test('buildAsoundConf keeps default routed through the EQ chain, not straight to hardware', () => {
  const conf = buildAsoundConf();
  assert.match(conf, /pcm\.!default\s*\{\s*type plug\s*\n\s*slave\.pcm "eqbase"/);
});

// This exact line used to read slave.pcm "eq", and that one word cost two
// days of "Spotify just does nothing" on a live Pi: `eq` is itself a plug,
// so `!default` became plug-over-plug over the equal plugin, and
// snd_pcm_hw_params_any() aborts on that — SIGABRT before a single sample,
// for any program that opens `default`. librespot did; mpv addresses `eq`
// directly and never noticed. Reproduced with scripts/alsaprobe.c.
test('buildAsoundConf never stacks two plug layers over the equal plugin (regression: aborted libasound for every program opening `default`)', () => {
  const conf = buildAsoundConf();
  const defaultSlave = conf.match(/pcm\.!default\s*\{\s*type plug\s*\n\s*slave\.pcm "([^"]+)"/)?.[1];
  assert.ok(defaultSlave, 'pcm.!default should be a plug with a slave');

  // A plug may only sit on top of something that is not itself a plug.
  const slaveIsAlsoPlug = new RegExp(`pcm\\.${defaultSlave}\\s*\\{\\s*type plug`).test(conf);
  assert.equal(slaveIsAlsoPlug, false, `pcm.!default slaves to "${defaultSlave}", which is itself a plug`);
});

// setup.sh (fresh install, from a shell) and buildAsoundConf (re-provisioning
// from inside the app) both write /etc/asound.conf. They drifted apart once
// already, which is how one Pi ended up with a working chain and the other
// with a crashing one. Comments differ by design; the routing must not.
test('setup.sh and buildAsoundConf write the same ALSA routing', () => {
  const setupSh = fs.readFileSync(new URL('../setup.sh', import.meta.url), 'utf8');
  const embedded = setupSh.match(/cat << 'EOF' > \/etc\/asound\.conf\n([\s\S]*?)\nEOF\n/)?.[1];
  assert.ok(embedded, 'kon het asound.conf-sjabloon niet uit setup.sh halen');

  const routingOnly = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .join('\n');

  assert.equal(routingOnly(embedded), routingOnly(buildAsoundConf()));
});

// --- reading the mixer back ---------------------------------------------

// The app used to start every boot believing the volume was 78: a hardcoded
// default, never written to the amplifier nor read from it. Found live with
// the ceiling at 46 and the mixer sitting at -36dB — three numbers, none of
// which agreed, which is what a volume bar was being drawn from.

test('volumePctFromDb inverts calculateVolumeDb across the whole range', () => {
  for (const pct of [0, 1, 25, 40, 46, 78, 99, 100]) {
    assert.equal(volumePctFromDb(calculateVolumeDb(pct)), pct);
  }
});

test('volumePctFromDb reads the live tuinhuis reading (-36dB) as 40%', () => {
  assert.equal(volumePctFromDb(-36), 40);
});

test('volumePctFromDb clamps beyond the scale instead of returning something unusable', () => {
  assert.equal(volumePctFromDb(-90), 0);
  assert.equal(volumePctFromDb(6), 100);
  assert.equal(volumePctFromDb(NaN), 0);
});

test('parseMixerDb takes the dB value, never the mixer\'s own raw percent (regression: that percent scale is non-linear and made 70% nearly inaudible)', () => {
  const output = [
    "Simple mixer control 'Digital',0",
    '  Capabilities: pvolume',
    '  Limits: Playback 0 - 207',
    '  Mono:',
    '  Front Left: Playback 135 [65%] [-36.00dB] [on]',
    '  Front Right: Playback 135 [65%] [-36.00dB] [on]',
  ].join('\n');
  assert.equal(parseMixerDb(output), -36);
  assert.equal(volumePctFromDb(parseMixerDb(output)!), 40); // not 65
});

test('parseMixerDb returns null for a control that reports no dB at all', () => {
  assert.equal(parseMixerDb("Simple mixer control 'PCM',0\n  Limits: Playback 0 - 255\n"), null);
  assert.equal(parseMixerDb(''), null);
});
