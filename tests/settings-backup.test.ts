import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsBackup } from '../src/server/routes/settingsBackup.ts';
import { hubConfig } from '../src/server/state.ts';

test('buildSettingsBackup never includes a credential field', () => {
  // Poison every known secret with an obviously-fake marker so the
  // assertion below actually proves something — an empty string would
  // "pass" whether or not the field was ever excluded in the first place.
  hubConfig.spotifyClientSecret = 'secret-spotify-client-secret';
  hubConfig.catalogicApiKey = 'secret-catalogic-api-key';
  hubConfig.acoustidApiKey = 'secret-acoustid-api-key';
  hubConfig.auddApiToken = 'secret-audd-api-token';
  hubConfig.listenerIntegrationKey = 'secret-listener-integration-key';
  hubConfig.apiKey = 'secret-kiosk-api-key';

  const backup = buildSettingsBackup();
  const serialized = JSON.stringify(backup);

  for (const secret of [
    'secret-spotify-client-secret',
    'secret-catalogic-api-key',
    'secret-acoustid-api-key',
    'secret-audd-api-token',
    'secret-listener-integration-key',
    'secret-kiosk-api-key',
  ]) {
    assert.equal(serialized.includes(secret), false, `backup leaked a credential: ${secret}`);
  }
});

test('buildSettingsBackup never includes a network share password', () => {
  const backup = buildSettingsBackup();
  for (const share of backup.networkShares as any[]) {
    assert.equal('password' in share, false, `network share "${share.name}" still carries a password field`);
  }
});

test('buildSettingsBackup carries the non-secret settings it should', () => {
  const backup = buildSettingsBackup();
  assert.equal(backup.version, 1);
  assert.equal(typeof backup.exportedAt, 'string');
  assert.ok(Array.isArray(backup.radioStations));
  assert.ok(Array.isArray(backup.knownHubs));
  assert.ok(Array.isArray(backup.likedTracks));
  assert.ok(Array.isArray(backup.playlists));
});
