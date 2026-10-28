import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT_ORDER, getEnabledLayoutOrder } from '../src/services/castLayoutOrder.ts';

test('getEnabledLayoutOrder falls back to the default order when unset', () => {
  assert.deepEqual(getEnabledLayoutOrder(undefined), DEFAULT_LAYOUT_ORDER);
});

test('getEnabledLayoutOrder falls back to the default order when the list is empty', () => {
  // Unchecking the last enabled layout in the editor must not strand the swipe
  // carousel (or the "start layout" picker) with nothing to choose from.
  assert.deepEqual(getEnabledLayoutOrder([]), DEFAULT_LAYOUT_ORDER);
});

test('getEnabledLayoutOrder returns a custom subset/order unchanged', () => {
  const custom = ['ambient_clock', 'kiosk_touch'] as const;
  assert.deepEqual(getEnabledLayoutOrder([...custom]), custom);
});
