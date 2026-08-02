import assert from 'node:assert/strict';
import test from 'node:test';
import { bioactivityCounts, normalizeBioactivity } from './bioactivity.js';

test('keeps source records and audited source state separate', () => {
  const payload = { pubchem_assays: [{ aid: '1' }], chembl_activities: [{ activity_id: 2 }], sources: { BindingDB: { status: 'no_data', match_mode: 'exact_structure' } } };
  assert.deepEqual(bioactivityCounts(payload), { pubchem: 1, chembl: 1, gtopdb: 0, bindingdb: 0 });
  assert.equal(normalizeBioactivity(payload).sources.BindingDB.match_mode, 'exact_structure');
});
