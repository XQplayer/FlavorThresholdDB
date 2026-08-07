import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCsvExportContract,
  beginCompoundProfileRequest,
  beginFemaProfileRequest,
  buildEntityExportSourceStatuses,
  failCompoundProfileRequest,
  failFemaProfileRequest,
  fetchSourceWithRetry,
  getExportClassification,
  retryFetchOptions,
  withRetryGeneration,
} from './searchSourceState.js';

test('source fetch retries transient cold-start failures before succeeding', async () => {
  const outcomes = [
    { ok: false, status: 503 },
    new TypeError('network connection reset'),
    { ok: true, status: 200 },
  ];
  let attempts = 0;

  const response = await fetchSourceWithRetry(async () => {
    const outcome = outcomes[attempts++];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, { retryDelaysMs: [0, 0] });

  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
});

test('source fetch does not retry a permanent client error', async () => {
  let attempts = 0;
  const response = await fetchSourceWithRetry(async () => {
    attempts += 1;
    return { ok: false, status: 404 };
  }, { retryDelaysMs: [0, 0] });

  assert.equal(response.status, 404);
  assert.equal(attempts, 1);
});

test('new CSV export ignores hidden classic filters and uses a fixed evidence contract', () => {
  const queryMatchedResults = [
    { cas: '141-78-6', medium: '水', threshold_data: ['A (2000) d 1'] },
    { cas: '141-78-6', medium: '空气', threshold_data: ['B (2001) r 2'] },
  ];
  const classicResults = [queryMatchedResults[0]];

  assert.deepEqual(buildCsvExportContract({
    resultView: 'new',
    queryMatchedResults,
    classicResults,
    selectedMedia: [],
    selectedThresholdTypes: [],
    includePubChem: false,
    includeFlavorDB: false,
    includeFlavorDescriptions: false,
    includeBookResults: false,
  }), {
    results: queryMatchedResults,
    media: ['水', '空气', '其他介质'],
    thresholdTypes: null,
    includePubChem: true,
    includeFlavorDB: true,
    includeFlavorDescriptions: true,
    includeBookResults: true,
  });
});

test('classic CSV export retains its selected records, fields, media, and threshold types', () => {
  const queryMatchedResults = [{ cas: '141-78-6', medium: '水' }];
  const classicResults = [];

  assert.deepEqual(buildCsvExportContract({
    resultView: 'classic',
    queryMatchedResults,
    classicResults,
    selectedMedia: ['空气'],
    selectedThresholdTypes: ['d'],
    includePubChem: false,
    includeFlavorDB: true,
    includeFlavorDescriptions: false,
    includeBookResults: true,
  }), {
    results: classicResults,
    media: ['空气'],
    thresholdTypes: ['d'],
    includePubChem: false,
    includeFlavorDB: true,
    includeFlavorDescriptions: false,
    includeBookResults: true,
  });
});

test('CSV source states are entity-scoped and preserve successful compound children', () => {
  const bookResults = [
    { matched_entity_cas: '141-78-6', text: 'ethyl acetate evidence' },
    { entity: { cas: '64-17-5' }, text: 'ethanol evidence' },
  ];
  const compoundProfile = {
    error: 'partial upstream failure',
    pubchem: { found: true, cid: 8857 },
    flavordb: { found: false, error: 'FlavorDB offline' },
  };

  assert.equal(buildEntityExportSourceStatuses({
    item: { cas: '141-78-6', threshold_data: ['A (2000) d 1'] },
    femaProfile: { found: true, error: 'stale request error' },
    compoundProfile,
    bookResults,
  }), 'local_thresholds:available; fema:available; pubchem:available; flavordb:failed; book:available');

  assert.equal(buildEntityExportSourceStatuses({
    item: { cas: '67-56-1', threshold_data: [] },
    femaProfile: { found: false },
    compoundProfile,
    bookResults,
  }), 'local_thresholds:unavailable; fema:unavailable; pubchem:available; flavordb:failed; book:unavailable');
});

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
