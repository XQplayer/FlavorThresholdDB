import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparisonPeakRows,
  buildPngFilename,
  buildSinglePeakRows,
  normalizePngScale,
  sortPeakRows,
} from './spectrumPresentation.js';

test('single peak rows retain source indices and normalized values', () => {
  assert.deepEqual(buildSinglePeakRows({ peaks: [[61.02, 40], [43.01, 100]] }), [
    { side: '', peak_index: 0, mz: 61.02, intensity: 40, matched: false, partner_mz: null, delta_da: null, delta_ppm: null },
    { side: '', peak_index: 1, mz: 43.01, intensity: 100, matched: false, partner_mz: null, delta_da: null, delta_ppm: null },
  ]);
});

test('comparison rows map matched partners to both spectrum sides', () => {
  const a = { peaks: [[43, 100], [61, 40]] };
  const b = { peaks: [[43.01, 80], [70, 20]] };
  const comparison = { matches: [{ a_index: 0, b_index: 0, mz_a: 43, mz_b: 43.01, delta_da: 0.01, delta_ppm: 232.53 }] };
  const rows = buildComparisonPeakRows(a, b, comparison);
  assert.equal(rows[0].side, 'A');
  assert.equal(rows[0].matched, true);
  assert.equal(rows[0].partner_mz, 43.01);
  assert.equal(rows[2].side, 'B');
  assert.equal(rows[2].partner_mz, 43);
  assert.equal(rows[3].matched, false);
});

test('peak sorting is stable and does not mutate input', () => {
  const rows = [{ mz: 61, intensity: 40 }, { mz: 43, intensity: 100 }, { mz: 44, intensity: 100 }];
  const sorted = sortPeakRows(rows, 'intensity', 'desc');
  assert.deepEqual(sorted.map(row => row.mz), [43, 44, 61]);
  assert.deepEqual(rows.map(row => row.mz), [61, 43, 44]);
});

test('PNG filename is safe and scale is bounded', () => {
  assert.equal(buildPngFilename({ source: 'MassBank', spectrum_id: 'A/1' }, { source: 'GNPS', spectrum_id: 'B:2' }), 'spectra-mirror_MassBank-A-1_GNPS-B-2.png');
  assert.equal(normalizePngScale(0), 1);
  assert.equal(normalizePngScale(2), 2);
  assert.equal(normalizePngScale(9), 4);
});
