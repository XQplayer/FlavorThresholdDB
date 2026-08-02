import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFlavorDB2Url, formatTaxonomy } from './flavordb2.js';

test('builds encoded FlavorDB2 proxy URLs', () => {
  assert.equal(
    buildFlavorDB2Url('https://proxy.example', 'entities', { q: 'red wine' }),
    'https://proxy.example/flavordb2/entities?q=red%20wine'
  );
  assert.equal(
    buildFlavorDB2Url('https://proxy.example/', 'entity', { id: 245 }),
    'https://proxy.example/flavordb2/entity?id=245'
  );
});

test('formats available taxonomy ranks in scientific order', () => {
  assert.equal(
    formatTaxonomy({ kingdom: 'Plantae', family: 'Orchidaceae', genus: 'Vanilla' }),
    'Plantae · Orchidaceae · Vanilla'
  );
  assert.equal(formatTaxonomy({}), '');
});
