import { test } from 'node:test';
import assert from 'node:assert/strict';
import { likeKey, describeLikeSource, isLikeable } from '../src/services/likedTracks.ts';
import { Track } from '../src/types.ts';

function track(over: Partial<Track>): Track {
  return {
    id: 't1',
    title: 'Hey Jude',
    artist: 'The Beatles',
    album: 'Past Masters',
    coverUrl: '',
    durationMs: 431000,
    uri: 'spotify:track:123',
    ...over,
  };
}

test('likeKey ignores case, punctuation and stray whitespace', () => {
  // The same song arrives spelled differently depending on where it came
  // from — an ICY tag ("THE BEATLES - Hey Jude!"), a NAS tag, Spotify — and
  // liking it from two sources must not produce two rows.
  assert.equal(likeKey('The Beatles', 'Hey Jude'), likeKey('THE  BEATLES', ' hey jude! '));
});

test('likeKey keeps different songs apart', () => {
  assert.notEqual(likeKey('The Beatles', 'Hey Jude'), likeKey('The Beatles', 'Let It Be'));
  assert.notEqual(likeKey('The Beatles', 'Hey Jude'), likeKey('Wilson Pickett', 'Hey Jude'));
});

test('describeLikeSource recognises a radio stream and keeps the station name', () => {
  // On radio the ICY tag overwrites title/artist with the actual song, so
  // album is the only place left holding which station it came from.
  const source = describeLikeSource(
    track({ uri: 'http://icecast.omroep.nl/radio2-bb-mp3', album: 'NPO Radio 2', durationMs: 0 }),
    null,
  );
  assert.deepEqual(source, { source: 'radio', sourceDetail: 'NPO Radio 2' });
});

test('describeLikeSource tells a NAS file and a Spotify track apart', () => {
  assert.equal(describeLikeSource(track({ uri: 'file:///mnt/nas/a.flac' }), null).source, 'nas');
  assert.equal(describeLikeSource(track({ uri: 'spotify:track:123' }), null).source, 'spotify');
});

test('describeLikeSource lets an active turntable/CD win over whatever the player still holds', () => {
  // The external source is display-only: playbackState keeps whatever was
  // last played through the Hub, so the uri would otherwise mislabel it.
  const source = describeLikeSource(track({ uri: 'file:///mnt/nas/a.flac' }), 'Platenspeler');
  assert.deepEqual(source, { source: 'external', sourceDetail: 'Platenspeler' });
});

test('isLikeable rejects a track without a usable title or artist', () => {
  // A stream that only ever says "Live Web Radio" / "Internet Radio Stream"
  // is the station's own branding, not a song — saving that is noise.
  assert.equal(isLikeable(track({})), true);
  assert.equal(isLikeable(null), false);
  assert.equal(isLikeable(track({ title: '' })), false);
  assert.equal(isLikeable(track({ artist: '   ' })), false);
});
