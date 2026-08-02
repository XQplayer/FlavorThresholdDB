import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNistSections } from './nistWebbook.js';

test('NIST sections use fixed order and only HTTPS WebBook links', () => {
  const result = normalizeNistSections([
    { type: 'gc', url: 'https://webbook.nist.gov/cgi/cbook.cgi#Gas-Chrom' },
    { type: 'ei_ms', url: 'javascript:alert(1)' },
    { type: 'ir', url: 'https://webbook.nist.gov/cgi/cbook.cgi#IR-Spec' },
  ]);
  assert.deepEqual(result.map(item => item.type), ['ir', 'gc']);
});
