import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparisonCsv,
  buildComparisonPeakRows,
  buildPngFilename,
  buildSinglePeakRows,
  filterPeakRows,
  normalizePngScale,
  peakRowsToTsv,
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

test('comparison CSV preserves source, license, tolerance, compatibility, and peak error evidence', () => {
  const csv = buildComparisonCsv(
    { tolerance: { value: 10, mode: 'ppm' }, compatibility: { comparable: true, warnings: ['different_adduct'] }, similarity: 0.8, coverage_a: 0.5, coverage_b: 0.4, matches: [{ mz_a: 100, mz_b: 100.0005, intensity_a: 50, intensity_b: 40, delta_da: 0.0005, delta_ppm: 5 }] },
    { source: 'MassBank', spectrum_id: 'A', source_url: 'https://example.org/a', license: 'CC BY' },
    { source: 'GNPS', spectrum_id: 'B', source_url: 'https://example.org/b', license: 'CC0' },
  );
  for (const value of ['MassBank', 'GNPS', 'CC BY', 'CC0', 'different_adduct', 'delta_ppm', '0.0005']) assert.match(csv, new RegExp(value));
});

test('peak search accepts an m/z value or range and copy format retains audit columns', () => {
  const rows = [{ side: 'A', mz: 43.01, intensity: 100, matched: true, partner_mz: 43.02, delta_da: 0.01, delta_ppm: 232 }, { side: 'B', mz: 61, intensity: 40, matched: false }];
  assert.deepEqual(filterPeakRows(rows, '43'), [rows[0]]);
  assert.deepEqual(filterPeakRows(rows, '40-50'), [rows[0]]);
  const tsv = peakRowsToTsv(rows);
  assert.match(tsv, /side\tmz\tintensity\tmatched\tpartner_mz\tdelta_da\tdelta_ppm/);
  assert.match(tsv, /A\t43.01\t100\ttrue/);
});

test('PNG filename is safe and scale is bounded', () => {
  assert.equal(buildPngFilename({ source: 'MassBank', spectrum_id: 'A/1' }, { source: 'GNPS', spectrum_id: 'B:2' }), 'spectra-mirror_MassBank-A-1_GNPS-B-2.png');
  assert.equal(normalizePngScale(0), 1);
  assert.equal(normalizePngScale(2), 2);
  assert.equal(normalizePngScale(9), 4);
});
