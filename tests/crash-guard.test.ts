// buildCrashRecord is the only pure (fs/process-free) part of crashGuard.ts
// — the rest is thin fs/process wiring, exercised for real by deploying and
// watching a restart pick up the marker, not by a unit test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrashRecord } from '../src/services/crashGuard.ts';

test('buildCrashRecord captures message and stack from a real Error', () => {
  const record = buildCrashRecord('uncaughtException', new Error('boom'));
  assert.equal(record.kind, 'uncaughtException');
  assert.equal(record.message, 'boom');
  assert.ok(record.stack && record.stack.includes('boom'));
});

test('buildCrashRecord handles a non-Error unhandledRejection reason without throwing', () => {
  const record = buildCrashRecord('unhandledRejection', 'plain string rejection');
  assert.equal(record.kind, 'unhandledRejection');
  assert.equal(record.message, 'plain string rejection');
  assert.equal(record.stack, null);
});

test('buildCrashRecord handles a rejection reason that is neither an Error nor a string', () => {
  const record = buildCrashRecord('unhandledRejection', { code: 'ECONNREFUSED' });
  assert.equal(record.message, '[object Object]');
  assert.equal(record.stack, null);
});
