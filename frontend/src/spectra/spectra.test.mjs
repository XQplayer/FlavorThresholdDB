import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignComparisonSlot,
  isSpectrumDownloadAllowed,
  spectrumDetailPath,
} from './spectrumContract.js';

test('download is enabled only for reviewed open licenses', () => {
  assert.equal(isSpectrumDownloadAllowed({ license: 'CC BY-NC-SA' }), true);
  assert.equal(isSpectrumDownloadAllowed({ license: 'needs_review', license_status: 'needs_review' }), false);
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
