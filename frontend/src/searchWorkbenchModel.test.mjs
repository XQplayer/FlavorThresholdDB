import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAPTERS,
  createDefaultChapterFilters,
  normalizeSourceStatus,
  buildCompoundDossier,
  filterThresholdRecords,
  buildBatchReviewRows,
  sortBatchRows,
} from './searchWorkbenchModel.js';

const threshold = {
  cas: '141-78-6',
  chinese_name: '乙酸乙酯',
  english_name: 'Ethyl acetate',
  medium: '水',
  threshold_data: [{
    threshold: '0.005 mg/L',
    type: 'd',
    reference: 'Van Gemert (2011)',
    original_text: '0.005 mg/L',
    source_record_key: 'book:p12:r3',
  }],
};

const integrated = {
  item: threshold,
  fema: { flavor_profile: ['fruity'] },
  profile: { pubchem: { cid: 8857, molecular_formula: 'C4H8O2' } },
};

test('defines eight bilingual compound-dossier chapters', () => {
  assert.deepEqual(CHAPTERS.map(({ id }) => id), [
    'overview', 'sensory', 'thresholds', 'spectra',
    'biochemistry', 'bioactivity', 'structures', 'citation',
  ]);
  assert.deepEqual(CHAPTERS.map(({ zh, en }) => [zh, en]), [
    ['概览', 'Overview'],
    ['感官', 'Sensory'],
    ['阈值', 'Thresholds'],
    ['光谱', 'Spectra'],
    ['生物化学', 'Biochemistry'],
    ['生物活性', 'Bioactivity'],
    ['结构', 'Structures'],
    ['引文', 'Citation'],
  ]);
});

test('creates independent default chapter-filter copies', () => {
  const defaults = createDefaultChapterFilters();
  defaults.thresholds.media.pop();
  assert.deepEqual(createDefaultChapterFilters().thresholds.media, ['空气', '水', '其他介质']);
  assert.notEqual(defaults.thresholds, defaults.sensory);
});

test('builds identity and preserves parsed threshold provenance', () => {
  const dossier = buildCompoundDossier({
    matchedResults: [threshold],
    integratedResults: [integrated],
    bookResults: [],
    sourceStates: { pubchem: { state: 'ready' }, book: { state: 'partial' } },
  });

  assert.deepEqual(dossier.identity, {
    entityKey: '141-78-6',
    cas: '141-78-6',
    cid: 8857,
    chineseName: '乙酸乙酯',
    englishName: 'Ethyl acetate',
    molecularFormula: 'C4H8O2',
    raw: threshold,
  });
  assert.deepEqual(dossier.thresholds.records, [{
    cas: '141-78-6',
    medium: '水',
    type: 'd',
    thresholdType: 'd',
    value: 0.005,
    unit: 'mg/L',
    source: 'Van Gemert (2011)',
    originalText: '0.005 mg/L',
    sourceRecordKey: 'book:p12:r3',
    raw: threshold.threshold_data[0],
  }]);
  assert.deepEqual(dossier.sourceStates, {
    pubchem: { state: 'ready', status: 'ready' },
    book: { state: 'partial', status: 'partial' },
  });
  for (const { id } of CHAPTERS) assert.ok(Array.isArray(dossier[id].records));
});

test('maps thresholds and identity from integrated-only results', () => {
  const dossier = buildCompoundDossier({ matchedResults: [], integratedResults: [integrated] });
  assert.equal(dossier.identity.cid, 8857);
  assert.equal(dossier.identity.molecularFormula, 'C4H8O2');
  assert.equal(dossier.thresholds.records.length, 1);
  assert.equal(dossier.thresholds.records[0].type, 'd');
});

test('filters threshold records without mutating source records', () => {
  const records = buildCompoundDossier({ matchedResults: [threshold] }).thresholds.records;
  const filtered = filterThresholdRecords(records, { media: ['空气'], types: ['d'], includeBooks: true });
  assert.equal(filtered.length, 0);
  assert.equal(records.length, 1);
});

test('normalizes requested source states while retaining state fields', () => {
  assert.equal(normalizeSourceStatus(undefined).status, 'not_requested');
  assert.deepEqual(normalizeSourceStatus({ state: 'no_data', source: 'book' }), {
    state: 'no_data', source: 'book', status: 'no_data',
  });
  assert.equal(normalizeSourceStatus({ state: 'partial_failure' }).status, 'partial');
  assert.equal(normalizeSourceStatus({ state: 'timeout' }).status, 'failed');
  assert.equal(normalizeSourceStatus({ state: 'ok' }).status, 'ready');
  assert.equal(normalizeSourceStatus({ state: 'fetching' }).status, 'loading');
});

test('keeps canonical source status kinds stable across repeated normalization', () => {
  for (const status of ['ready', 'partial', 'failed', 'loading', 'not_requested', 'no_data']) {
    const once = normalizeSourceStatus({ kind: status });
    const twice = normalizeSourceStatus(once);
    assert.equal(once.status, status);
    assert.equal(twice.status, status);
    assert.equal(normalizeSourceStatus({ status }).status, status);
  }
});

test('builds occurrence-aware batch review rows for exact candidate and unmatched inputs', () => {
  const rows = buildBatchReviewRows(
    ['141-78-6', '141-78-6', 'ethyl acetate', 'missing compound'],
    [threshold],
  );
  assert.deepEqual(rows.map(({ id, status }) => [id, status]), [
    ['141-78-6:0', 'exact'],
    ['141-78-6:1', 'exact'],
    ['ethyl acetate:0', 'candidate'],
    ['missing compound:0', 'unmatched'],
  ]);
  assert.equal(rows[2].normalizedName, 'ethyl acetate');
  assert.ok('cas' in rows[2] && 'coverage' in rows[2] && Array.isArray(rows[2].issues));
});

test('sorts batch review priority deterministically without changing inputs', () => {
  const rows = buildBatchReviewRows(['141-78-6', 'ethyl acetate', 'missing compound'], [threshold]);
  const before = rows.map(row => row.id);
  const sorted = sortBatchRows(rows, { key: 'reviewPriority', direction: 'asc' });
  assert.deepEqual(sorted.map(row => row.status), ['unmatched', 'candidate', 'exact']);
  assert.deepEqual(rows.map(row => row.id), before);
});
