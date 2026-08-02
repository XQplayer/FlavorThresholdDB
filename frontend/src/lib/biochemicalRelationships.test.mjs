import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBiochemicalGraph } from './biochemicalRelationships.js';

test('normalizes and deduplicates identifier-backed biochemical relationships', () => {
  const graph = normalizeBiochemicalGraph({
    chebi: { chebi_id: 'CHEBI:27750', name: 'ethyl acetate', identity_match: { verified: true, type: 'inchikey_exact' } },
    reactions: [{ rhea_id: 'RHEA:10020', equation: 'A = B' }, { rhea_id: 'RHEA:10020', equation: 'A = B' }],
    proteins: [{ accession: 'P12345', protein_name: 'Enzyme', rhea_id: 'RHEA:10020' }, { accession: 'P12345' }],
    sources: { ChEBI: { status: 'ok' }, Rhea: { status: 'ok' }, UniProt: { status: 'ok' } },
  });
  assert.equal(graph.verified, true);
  assert.equal(graph.reactions.length, 1);
  assert.equal(graph.proteins.length, 1);
});

test('does not present name-only candidates as verified relationships', () => {
  const graph = normalizeBiochemicalGraph({ chebi: { chebi_id: 'CHEBI:1', identity_match: { verified: false } }, reactions: [{ rhea_id: 'RHEA:1' }] });
  assert.equal(graph.verified, false);
  assert.deepEqual(graph.reactions, []);
});
