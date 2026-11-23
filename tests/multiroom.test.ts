// Multiroom builders — each case pins down something found live in the
// phase 0 Snapcast test on the real Pi's (2026-11-23). Pure functions only;
// the systemctl side is exercised on the Pi itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  librespotPipeDropIn,
  normalizeHost,
  SNAP_FIFO,
  snapclientDropIn,
  snapserverConf,
} from '../src/services/multiroom.ts';
import { mpvAudioArgs } from '../src/services/localPlayer.ts';

// The two real units differ (binary path, --system-cache) — both verbatim.
const HIDDENSOUND_UNIT = `[Service]
Type=simple
User=root
ExecStart=/usr/bin/librespot --name "HSSwoonkamer" --backend alsa --device eq --bitrate 320 --enable-volume-normalisation --volume-ctrl linear --initial-volume 75 --zeroconf-port 5354 --onevent /opt/hss/spotify-event.sh
Restart=always
`;
const TUINHUIS_EXEC =
  'ExecStart=/usr/bin/librespot --name "HSStuinhuis" --backend alsa --device eq --bitrate 320 --enable-volume-normalisation --volume-ctrl linear --initial-volume 75 --zeroconf-port 5354 --system-cache /etc/hss/librespot-cache --onevent /opt/hss/spotify-event.sh';

test('librespot drop-in swaps only backend and device, keeps name/cache/hook', () => {
  const dropIn = librespotPipeDropIn(HIDDENSOUND_UNIT);
  assert.match(dropIn, /^\[Service\]\nExecStart=\nExecStart=\/usr\/bin\/librespot /);
  assert.match(dropIn, new RegExp(`--backend pipe --device ${SNAP_FIFO} `));
  assert.match(dropIn, /--name "HSSwoonkamer"/);
  assert.match(dropIn, /--onevent \/opt\/hss\/spotify-event.sh/);
  assert.doesNotMatch(dropIn, /--backend alsa|--device eq/);

  const tuinhuis = librespotPipeDropIn(`[Service]\n${TUINHUIS_EXEC}\n`);
  assert.match(tuinhuis, /--system-cache \/etc\/hss\/librespot-cache/);
});

test('librespot drop-in adds --device when the unit had none', () => {
  const dropIn = librespotPipeDropIn('ExecStart=/usr/bin/librespot --name X --backend alsa\n');
  assert.match(dropIn, new RegExp(`--backend pipe --device ${SNAP_FIFO}$`, 'm'));
});

test('librespot drop-in uses the last real ExecStart, ignoring a reset line', () => {
  const dropIn = librespotPipeDropIn(`ExecStart=\n${TUINHUIS_EXEC}\n`);
  assert.match(dropIn, /HSStuinhuis/);
});

test('librespot drop-in refuses a unit it cannot understand', () => {
  assert.throws(() => librespotPipeDropIn('[Service]\nUser=root\n'), /Geen ExecStart/);
  assert.throws(() => librespotPipeDropIn('ExecStart=/usr/bin/librespot --name X\n'), /--backend/);
});

test('snapclient runs as root on `default` (regression: `eq` matched eqbase, own user lost the EQ)', () => {
  const dropIn = snapclientDropIn('192.168.178.191');
  assert.match(dropIn, /^User=root$/m);
  assert.match(dropIn, /--soundcard default /);
  assert.match(dropIn, /tcp:\/\/192\.168\.178\.191:1704$/m);
});

test('snapclient brackets an IPv6 leader address', () => {
  assert.match(snapclientDropIn('fd06:3c2b::1'), /tcp:\/\/\[fd06:3c2b::1\]:1704/);
});

test('normalizeHost strips the IPv4-mapped prefix and rejects anything else', () => {
  assert.equal(normalizeHost('::ffff:192.168.178.191'), '192.168.178.191');
  assert.throws(() => normalizeHost(undefined));
  assert.throws(() => normalizeHost('1.2.3.4 --player file'));
  assert.throws(() => normalizeHost('a\nExecStartPre=/bin/evil'));
});

test('snapserver source matches librespot/mpv output: 44100:16:2 from the fifo', () => {
  assert.match(snapserverConf(), new RegExp(`pipe://${SNAP_FIFO}\\?name=HSS&sampleformat=44100:16:2`));
});

test('mpv goes to ALSA eq solo, and to the fifo as raw 44.1k s16 stereo when leading', () => {
  assert.deepEqual(mpvAudioArgs(null), ['--audio-device=alsa/eq']);
  const fifo = mpvAudioArgs(SNAP_FIFO);
  assert.ok(fifo.includes(`--ao-pcm-file=${SNAP_FIFO}`));
  assert.ok(fifo.includes('--ao-pcm-waveheader=no'));
  assert.ok(fifo.includes('--audio-samplerate=44100'));
  assert.ok(fifo.includes('--audio-format=s16'));
});
