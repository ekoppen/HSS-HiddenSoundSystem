import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearHealthIssue, getHealthIssues, onHealthIssue, reportHealthIssue } from '../src/services/healthLog.ts';

test('reportHealthIssue creates a new issue and notifies listeners with isNew=true', () => {
  const seen: boolean[] = [];
  onHealthIssue((issue, isNew) => {
    if (issue.id === 'test-new-issue') seen.push(isNew);
  });
  reportHealthIssue('test-new-issue', 'test', 'warning', 'first occurrence');
  assert.deepEqual(seen, [true]);
  assert.equal(getHealthIssues().some((i) => i.id === 'test-new-issue'), true);
  clearHealthIssue('test-new-issue');
});

test('reportHealthIssue on a repeat occurrence updates count/lastSeen instead of creating a duplicate entry (no spam from a failure repeating every tick)', () => {
  clearHealthIssue('test-repeat');
  reportHealthIssue('test-repeat', 'test', 'error', 'first');
  reportHealthIssue('test-repeat', 'test', 'error', 'second');
  reportHealthIssue('test-repeat', 'test', 'error', 'third');
  const matches = getHealthIssues().filter((i) => i.id === 'test-repeat');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].count, 3);
  assert.equal(matches[0].message, 'third');
  clearHealthIssue('test-repeat');
});

test('reportHealthIssue notifies isNew=false for a repeat occurrence', () => {
  clearHealthIssue('test-repeat-notify');
  const notifications: boolean[] = [];
  onHealthIssue((issue, isNew) => {
    if (issue.id === 'test-repeat-notify') notifications.push(isNew);
  });
  reportHealthIssue('test-repeat-notify', 'test', 'warning', 'a');
  reportHealthIssue('test-repeat-notify', 'test', 'warning', 'b');
  assert.deepEqual(notifications, [true, false]);
  clearHealthIssue('test-repeat-notify');
});

test('clearHealthIssue removes it from the list, and a subsequent report starts fresh with count 1', () => {
  reportHealthIssue('test-clear', 'test', 'error', 'broken');
  clearHealthIssue('test-clear');
  assert.equal(getHealthIssues().some((i) => i.id === 'test-clear'), false);
  reportHealthIssue('test-clear', 'test', 'error', 'broken again');
  assert.equal(getHealthIssues().find((i) => i.id === 'test-clear')?.count, 1);
  clearHealthIssue('test-clear');
});

test('getHealthIssues sorts most-recently-seen first', async () => {
  clearHealthIssue('test-sort-a');
  clearHealthIssue('test-sort-b');
  reportHealthIssue('test-sort-a', 'test', 'warning', 'older');
  await new Promise((r) => setTimeout(r, 5)); // guarantee a distinct lastSeen, not just insertion order
  reportHealthIssue('test-sort-b', 'test', 'warning', 'newer');
  const ids = getHealthIssues().map((i) => i.id);
  assert.ok(ids.indexOf('test-sort-b') < ids.indexOf('test-sort-a'));
  clearHealthIssue('test-sort-a');
  clearHealthIssue('test-sort-b');
});
