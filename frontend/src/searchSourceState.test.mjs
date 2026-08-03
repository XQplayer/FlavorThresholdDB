import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginCompoundProfileRequest,
  beginFemaProfileRequest,
  failCompoundProfileRequest,
  failFemaProfileRequest,
  getExportClassification,
  retryFetchOptions,
  withRetryGeneration,
} from './searchSourceState.js';

test('marks a FEMA retry without discarding the failed profile context', () => {
  const previous = { found: false, error: 'offline', source: 'FEMA Flavor Library' };
  assert.deepEqual(beginFemaProfileRequest(previous, { retrying: true }), {
    ...previous,
    loading: true,
    retrying: true,
  });
  assert.deepEqual(failFemaProfileRequest(previous, new Error('still offline')), {
    ...previous,
    found: false,
    loading: false,
    retrying: false,
    error: 'still offline',
  });
});

test('compound retry preserves a successful source and leaves failed children explicit', () => {
  const previous = {
    error: 'partial upstream failure',
    pubchem: { found: true, cid: 8857 },
    flavordb: { found: false, error: 'offline' },
    smart_classification: { en: 'Ester' },
  };
  assert.deepEqual(beginCompoundProfileRequest(previous, { retrying: true }), {
    ...previous,
    loading: true,
    retrying: true,
  });
  assert.deepEqual(failCompoundProfileRequest(previous, new Error('endpoint unavailable')), {
    loading: false,
    retrying: false,
    error: 'endpoint unavailable',
    pubchem: { found: true, cid: 8857 },
    flavordb: { found: false, error: 'endpoint unavailable' },
    smart_classification: { en: 'Ester' },
    pubchem_volatile: {
      found: false,
      status: 'upstream_unavailable',
      properties: {},
      source: 'PubChem PUG View',
      url: '',
    },
  });
});

test('initial compound failure marks both shared-endpoint sources as failed', () => {
  const failure = failCompoundProfileRequest(undefined, new Error('offline'));
  assert.equal(failure.pubchem.error, 'offline');
  assert.equal(failure.flavordb.error, 'offline');
});

test('retry requests bypass browser caches without changing initial request semantics', () => {
  assert.equal(withRetryGeneration('http://127.0.0.1:8787/fema?cas=141-78-6', 0), 'http://127.0.0.1:8787/fema?cas=141-78-6');
  assert.equal(withRetryGeneration('/book.json?v=1', 2), '/book.json?v=1&_retry=2');
  assert.equal(retryFetchOptions(0), undefined);
  assert.deepEqual(retryFetchOptions(2), { cache: 'no-store' });
});

test('exports classification only when SMARTS produced a reliable result', () => {
  assert.deepEqual(getExportClassification(undefined, false), { label: '', matches: [] });
  assert.deepEqual(getExportClassification({ loading: true }, false), { label: '', matches: [] });
  assert.deepEqual(getExportClassification({
    error: 'offline',
    smart_classification: { key: 'others', zh: '其他类', en: 'Others', reliable: false },
  }, false), { label: '', matches: [] });
  assert.deepEqual(getExportClassification({
    smart_classification: { key: 'others', zh: '其他类', en: 'Others', reliable: true, matches: [] },
  }, true), { label: 'Others', matches: [] });
  assert.deepEqual(getExportClassification({
    smart_classification: {
      key: 'esters', zh: '酯类', en: 'Esters', reliable: true,
      matches: [{ zh: '酯类', en: 'Esters' }],
    },
  }, false), { label: '酯类', matches: ['酯类'] });
});
