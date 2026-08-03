import assert from 'node:assert/strict';
import test from 'node:test';

import { loadResultView, saveResultView } from './resultViewPreference.js';

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('loadResultView defaults to new and only restores classic', () => {
  assert.equal(loadResultView(memoryStorage()), 'new');
  assert.equal(loadResultView(memoryStorage({ 'ftdb:result-view': 'classic' })), 'classic');
  assert.equal(loadResultView(memoryStorage({ 'ftdb:result-view': 'unexpected' })), 'new');
});

test('loadResultView returns new when storage access throws', () => {
  const storage = {
    getItem() {
      throw new Error('storage unavailable');
    },
  };

  assert.equal(loadResultView(storage), 'new');
});

test('saveResultView only persists valid views and absorbs storage failures', () => {
  const storage = memoryStorage();

  saveResultView('classic', storage);
  assert.equal(storage.getItem('ftdb:result-view'), 'classic');

  saveResultView('unexpected', storage);
  assert.equal(storage.getItem('ftdb:result-view'), 'classic');

  assert.doesNotThrow(() => saveResultView('new', {
    setItem() {
      throw new Error('storage unavailable');
    },
  }));
});
