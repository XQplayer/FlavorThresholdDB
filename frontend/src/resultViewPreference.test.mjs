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

test('loadResultView returns new when injected storage access throws', () => {
  const storage = {
    getItem() {
      throw new Error('storage unavailable');
    },
  };

  assert.equal(loadResultView(storage), 'new');
});

test('loadResultView and saveResultView handle a throwing global storage getter', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage unavailable');
    },
  });

  try {
    assert.equal(loadResultView(), 'new');
    assert.doesNotThrow(() => saveResultView('classic'));
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
});

test('saveResultView persists valid views, skips invalid values, and absorbs storage failures', () => {
  const storage = memoryStorage();

  saveResultView('classic', storage);
  assert.equal(storage.getItem('ftdb:result-view'), 'classic');
  assert.equal(loadResultView(storage), 'classic');

  saveResultView('new', storage);
  assert.equal(storage.getItem('ftdb:result-view'), 'new');
  assert.equal(loadResultView(storage), 'new');

  let writeCount = 0;
  saveResultView('unexpected', {
    setItem() {
      writeCount += 1;
    },
  });
  assert.equal(writeCount, 0);

  assert.doesNotThrow(() => saveResultView('new', {
    setItem() {
      throw new Error('storage unavailable');
    },
  }));
});
