import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignComparisonSlot,
  comparisonMatchSets,
  comparisonExportFilename,
  isSpectrumDownloadAllowed,
  isComparisonExportAllowed,
  spectrumDetailPath,
  filterSpectrumRecords,
  spectrumFilterOptions,
} from './spectrumContract.js';

test('download is enabled only for reviewed open licenses', () => {
  assert.equal(isSpectrumDownloadAllowed({ license: 'CC BY-NC-SA' }), true);
  assert.equal(isSpectrumDownloadAllowed({ license: 'needs_review', license_status: 'needs_review' }), false);
});

test('comparison export requires both spectra to have reviewed open licenses', () => {
  assert.equal(isComparisonExportAllowed({ license: 'CC BY' }, { license: 'CC0' }), true);
  assert.equal(isComparisonExportAllowed({ license: 'CC BY' }, { license_status: 'needs_review' }), false);
  assert.equal(isComparisonExportAllowed({ license: 'CC BY' }, null), false);
});

test('spectrum filters combine source, type, ion mode, adduct, and instrument', () => {
  const records = [
    { source: 'MassBank', spectrum_type: 'EI', ion_mode: 'positive', adduct: '', instrument: 'GC-MS' },
    { source: 'GNPS', spectrum_type: 'MS2', ion_mode: 'positive', adduct: '[M+H]+', instrument: 'Orbitrap' },
    { source: 'GNPS', spectrum_type: 'MS2', ion_mode: 'negative', adduct: '[M-H]-', instrument: 'QTOF' },
  ];
  assert.equal(filterSpectrumRecords(records, { source: 'gnps', type: 'ms2', ionMode: 'positive', adduct: '[M+H]+', instrument: 'Orbitrap' }).length, 1);
  assert.deepEqual(spectrumFilterOptions(records).ionModes, ['negative', 'positive']);
  assert.deepEqual(spectrumFilterOptions(records).adducts, ['[M-H]-', '[M+H]+']);
});

test('comparison slot selection fills A then B and replaces B', () => {
  const a = { source: 'MassBank', spectrum_id: 'A' };
  const b = { source: 'MassBank', spectrum_id: 'B' };
  const c = { source: 'GNPS', spectrum_id: 'C' };
  assert.deepEqual(assignComparisonSlot({ a: null, b: null }, a), { a, b: null });
  assert.deepEqual(assignComparisonSlot({ a, b: null }, b), { a, b });
  assert.deepEqual(assignComparisonSlot({ a, b }, c), { a, b: c });
});

test('detail path encodes source and spectrum identifier', () => {
  assert.equal(spectrumDetailPath('MassBank', 'MSBNK A/1'), '/spectra/MassBank/MSBNK%20A%2F1');
});

test('comparison match sets expose peak indices for both mirror halves', () => {
  const sets = comparisonMatchSets({ matches: [{ a_index: 1, b_index: 3 }, { a_index: 4, b_index: 2 }] });
  assert.deepEqual([...sets.a], [1, 4]);
  assert.deepEqual([...sets.b], [3, 2]);
});

test('comparison match sets remain empty while comparison is loading', () => {
  const sets = comparisonMatchSets(null);
  assert.equal(sets.a.size, 0);
  assert.equal(sets.b.size, 0);
});

test('comparison export filename is filesystem safe and identifies both records', () => {
  assert.equal(
    comparisonExportFilename({ source: 'MassBank', spectrum_id: 'A/1' }, { source: 'GNPS', spectrum_id: 'B:2' }, 'csv'),
    'spectra-comparison_MassBank-A-1_GNPS-B-2.csv',
  );
});
