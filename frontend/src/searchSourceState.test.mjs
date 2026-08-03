import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginCompoundProfileRequest,
  beginFemaProfileRequest,
  failCompoundProfileRequest,
  failFemaProfileRequest,
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
