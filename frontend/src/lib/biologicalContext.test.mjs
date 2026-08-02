import assert from 'node:assert/strict';
import test from 'node:test';
import { biologicalContextCounts, normalizeBiologicalContext } from './biologicalContext.js';

test('normalizes identifiers without inflating duplicate evidence', () => {
  const payload = {
    genes: [{ gene_id: '1' }, { gene_id: '1' }, { gene_id: '2' }],
    taxa: [{ taxon_id: 4932 }, { taxon_id: 4932 }],
    studies: [{ accession: 'MTBLS1' }],
    study_hit_count: 78,
    links: { BRENDA: [{ ec_number: '1.1.1.1' }], HMDB: { integration_mode: 'link_only' } },
  };
  assert.deepEqual(biologicalContextCounts(payload), { genes: 2, taxa: 1, studies: 1 });
  assert.equal(normalizeBiologicalContext(payload).studyHitCount, 78);
  assert.equal(normalizeBiologicalContext(payload).hmdb.integration_mode, 'link_only');
});
