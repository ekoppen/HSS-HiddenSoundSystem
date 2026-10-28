import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyCatalogicWebhookSignature,
  lookupCatalogicArtist,
  lookupCatalogicAlbum,
  lookupCatalogicSong,
  configureCatalogic,
  getSongLookupFailureCount,
} from '../src/services/catalogicClient.ts';

test('verifyCatalogicWebhookSignature accepts a correctly signed body', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ type: 'song.created' });
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyCatalogicWebhookSignature(body, signature, secret), true);
});

test('verifyCatalogicWebhookSignature rejects a tampered body', () => {
  const secret = 'test-secret';
  const signature = 'sha256=' + createHmac('sha256', secret).update('{"type":"song.created"}').digest('hex');
  assert.equal(verifyCatalogicWebhookSignature('{"type":"tampered"}', signature, secret), false);
});

test('verifyCatalogicWebhookSignature rejects a missing header', () => {
  assert.equal(verifyCatalogicWebhookSignature('{}', undefined, 'test-secret'), false);
});

test('verifyCatalogicWebhookSignature rejects a malformed signature (wrong length)', () => {
  assert.equal(verifyCatalogicWebhookSignature('{}', 'sha256=deadbeef', 'test-secret'), false);
});

test('lookupCatalogicArtist and lookupCatalogicAlbum resolve to null when Catalogic is disabled', async () => {
  // configureCatalogic defaults to enabled:false at module load in a fresh
  // test process, so both must short-circuit without any network call.
  assert.equal(await lookupCatalogicArtist('Some Artist'), null);
  assert.equal(await lookupCatalogicAlbum('Some Album', 'fake-id'), null);
});

test('lookupCatalogicSong records a lookup failure (not a silent "no match") when Catalogic is unreachable', async () => {
  // Regression guard for the "visible enrichment status" fix: a network
  // failure must be distinguishable from a genuine empty result, so the
  // whole-library scan can tell the user "Catalogic was down" instead of
  // silently reporting every file as unmatched. Port 1 refuses the
  // connection immediately — no real listener needed, and no network
  // dependency for the test.
  configureCatalogic({ enabled: true, url: 'http://127.0.0.1:1' });
  try {
    const before = getSongLookupFailureCount();
    const result = await lookupCatalogicSong('Some Song', 'Some Artist');
    assert.equal(result, null);
    assert.equal(getSongLookupFailureCount(), before + 1);
  } finally {
    configureCatalogic({ enabled: false, url: 'https://catalogic.doorkoppen.nl' });
  }
});

test('lookupCatalogicSong does not record a failure when it is simply disabled', async () => {
  const before = getSongLookupFailureCount();
  configureCatalogic({ enabled: false, url: 'https://catalogic.doorkoppen.nl' });
  await lookupCatalogicSong('Some Song', 'Some Artist');
  assert.equal(getSongLookupFailureCount(), before);
});

test('lookupCatalogicSong rejects a hit whose title does not match, even when the artist does', async () => {
  // Regression guard: "I Appear Missing" by Queens Of The Stone Age matched
  // a different QOTSA track that outranked it in the top-3 text search,
  // wrongly showing that other track's album art (screenshot from the
  // Pinguin Classics radio stream, 2026-09-22).
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          { type: 'song', source: 'catalogic', id: 'wrong', title: 'Songs For The Deaf', artist_name: 'Queens Of The Stone Age' },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  configureCatalogic({ enabled: true, url: 'https://catalogic.example' });
  try {
    const result = await lookupCatalogicSong('I Appear Missing', 'Queens Of The Stone Age');
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
    configureCatalogic({ enabled: false, url: 'https://catalogic.doorkoppen.nl' });
  }
});

test('lookupCatalogicSong accepts a hit whose title and artist both match', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          { type: 'song', source: 'catalogic', id: 'right', title: 'I Appear Missing', artist_name: 'Queens Of The Stone Age', artwork_url: '/art/right.jpg' },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  configureCatalogic({ enabled: true, url: 'https://catalogic.example' });
  try {
    const result = await lookupCatalogicSong('I Appear Missing', 'Queens Of The Stone Age');
    assert.equal(result?.songId, 'right');
  } finally {
    global.fetch = originalFetch;
    configureCatalogic({ enabled: false, url: 'https://catalogic.doorkoppen.nl' });
  }
});
