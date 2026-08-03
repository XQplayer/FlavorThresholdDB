import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCIENTIFIC_PRELOAD_ORDER,
  createScientificPreloadState,
  markScientificChapterStarted,
  nextScientificChapterToPreload,
} from './scientificChapterPreload.js';

test('uses the fixed low-cost progressive preload order', () => {
  assert.deepEqual(SCIENTIFIC_PRELOAD_ORDER, ['spectra', 'biochemistry', 'bioactivity', 'structures']);
});

test('starts the first unvisited chapter and waits while one is loading', () => {
  const state = createScientificPreloadState('cas:141-78-6');
  assert.equal(nextScientificChapterToPreload(state, {}), 'spectra');

  const started = markScientificChapterStarted(state, 'spectra');
  assert.equal(nextScientificChapterToPreload(started, { spectra: 'loading' }), null);
  assert.equal(nextScientificChapterToPreload(started, { spectra: 'available' }), 'biochemistry');
});

test('does not start a chapter twice and promotes a clicked chapter', () => {
  let state = createScientificPreloadState('cas:141-78-6');
  state = markScientificChapterStarted(state, 'bioactivity');
  state = markScientificChapterStarted(state, 'bioactivity');
  assert.deepEqual(state.started, ['bioactivity']);
  assert.equal(nextScientificChapterToPreload(state, {}, 'structures'), 'structures');
});

test('creates isolated preload state for a new entity', () => {
  const first = markScientificChapterStarted(createScientificPreloadState('cas:141-78-6'), 'spectra');
  const second = createScientificPreloadState('cas:64-17-5');
  assert.deepEqual(first.started, ['spectra']);
  assert.deepEqual(second, { entityKey: 'cas:64-17-5', started: [] });
});
