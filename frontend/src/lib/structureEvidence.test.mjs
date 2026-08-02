import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStructureEvidence } from './structureEvidence.js';
test('keeps experimental and predicted structures distinct', () => {
  const data = normalizeStructureEvidence({ experimental_structures: [{ pdb_id: '1ABC' }, { pdb_id: '1ABC' }], predicted_models: [{ model_id: 'AF-P1-F1' }] });
  assert.equal(data.experimental.length, 1); assert.equal(data.predicted.length, 1); assert.equal(data.predicted[0].model_id, 'AF-P1-F1');
});
