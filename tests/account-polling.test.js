import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshVisibleAccounts } from '../admin-src/app/shared/account-polling.js';

test('account visibility refresh requires an open panel and elapsed interval', () => {
  assert.equal(shouldRefreshVisibleAccounts(false, 'visible', 120_000, 0), false);
  assert.equal(shouldRefreshVisibleAccounts(true, 'hidden', 120_000, 0), false);
  assert.equal(shouldRefreshVisibleAccounts(true, 'visible', 59_999, 0), false);
  assert.equal(shouldRefreshVisibleAccounts(true, 'visible', 60_000, 0), true);
});
