import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pushLikeToListener } from '../src/services/listenerClient.ts';
import { getHealthIssues, clearHealthIssue } from '../src/services/healthLog.ts';

const CONFIG = { url: 'https://listener.example', integrationKey: 'ml_test' };
const SONG = { title: 'Sleepin\' Bird', artist: 'Herman Brood', spotifyId: null };

function stubFetch(response: { ok: boolean; status?: number; body?: any }) {
  (globalThis as any).fetch = async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body ?? {},
  });
}

function issueIds(): string[] {
  return getHealthIssues().map((i) => i.id);
}

beforeEach(() => {
  clearHealthIssue('listener_push');
  clearHealthIssue('listener_collection');
});

test('een song die in de collectie belandt levert geen enkele melding op', async () => {
  stubFetch({ ok: true, body: { id: 's1', collection: { id: 'c1', name: 'HSS tuinhuis', added: true } } });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), []);
});

test('collection:null meldt dat er geen gelijknamige collectie bestaat', async () => {
  // Precies de stille fout die dit moet vangen: Listener neemt het nummer aan
  // (dus geen transportfout), maar er is geen collectie met de naam van de
  // sleutel — bijvoorbeeld "HSStuinhuis" tegenover sleutel "HSS tuinhuis".
  stubFetch({ ok: true, body: { id: 's1', collection: null } });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), ['listener_collection']);
  assert.match(getHealthIssues()[0].message, /collectie/i);
});

test('een Listener zonder dit veld (oudere versie) zegt niets over collecties en meldt dus niets', async () => {
  stubFetch({ ok: true, body: { id: 's1' } });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), []);
});

test('een geweigerde push meldt dát, en niet de collectie', async () => {
  stubFetch({ ok: false, status: 403 });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), ['listener_push']);
});

test('een song die later alsnog gefileerd wordt ruimt de eerdere melding op', async () => {
  stubFetch({ ok: true, body: { collection: null } });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), ['listener_collection']);

  stubFetch({ ok: true, body: { collection: { id: 'c1', name: 'HSS tuinhuis', added: true } } });
  await pushLikeToListener(CONFIG, SONG);
  assert.deepEqual(issueIds(), []);
});

test('zonder URL of sleutel wordt er niets verstuurd en niets gemeld', async () => {
  let called = false;
  (globalThis as any).fetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await pushLikeToListener({ url: '', integrationKey: '' }, SONG);
  assert.equal(called, false);
  assert.deepEqual(issueIds(), []);
});
