import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as searchWorkbenchModel from './searchWorkbenchModel.js';
import {
  CHAPTERS,
  createDefaultChapterFilters,
  normalizeSourceStatus,
  buildCompoundDossier,
  filterSensoryRecords,
  filterThresholdRecords,
  buildBatchReviewRows,
  parseBatchReviewInputs,
  sortBatchRows,
  buildCandidateScopeKey,
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
  profile: { pubchem: {
    cid: 8857,
    title: 'Ethyl acetate',
    molecular_formula: 'C4H8O2',
    smiles: 'CCOC(=O)C',
    inchi_key: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
  } },
};

test('candidate scope changes with normalized query, search mode, and match mode', () => {
  assert.equal(buildCandidateScopeKey({ query: '  对叔丁基苯甲醛 ', mode: 'single', exactMatch: true }), 'single:exact:对叔丁基苯甲醛');
  assert.equal(buildCandidateScopeKey({ query: '对叔丁基苯甲醛', mode: 'single', exactMatch: false }), 'single:fuzzy:对叔丁基苯甲醛');
  assert.notEqual(
    buildCandidateScopeKey({ query: 'same', mode: 'single', exactMatch: true }),
    buildCandidateScopeKey({ query: 'same', mode: 'bulk', exactMatch: true }),
  );
});

test('groups dossier inputs by stable entity key without cross-contaminating evidence', () => {
  assert.equal(typeof searchWorkbenchModel.groupDossierInputsByEntity, 'function');
  const second = {
    cas: '18127-01-0',
    chinese_name: '对叔丁基苯甲醛',
    english_name: 'Bourgeonal',
    medium: '空气',
    threshold_data: ['Second source d 2 μg/m3'],
  };
  const groups = searchWorkbenchModel.groupDossierInputsByEntity({
    matchedResults: [threshold, second],
    integratedResults: [
      integrated,
      { item: second, profile: { pubchem: { cid: 222 } } },
    ],
    bookResults: [
      { id: 'book-a', matched_entity_cas: threshold.cas },
      { id: 'book-b', entity: { cas: second.cas } },
    ],
  });

  assert.deepEqual(groups.map(group => group.entityKey), ['cas:141-78-6', 'cas:18127-01-0']);
  for (const group of groups) {
    assert.ok(group.matchedResults.every(item => `cas:${item.cas}` === group.entityKey));
    assert.ok(group.integratedResults.every(entry => `cas:${entry.item.cas}` === group.entityKey));
    assert.ok(group.bookResults.every(record => (
      record.matched_entity_cas === group.cas || record.entity?.cas === group.cas
    )));
  }
  assert.deepEqual(groups.map(group => group.recordCount), [1, 1]);
});

test('does not assign an ambiguous name-only book hit to multiple entities', () => {
  const sharedName = '共享化合物名';
  const groups = searchWorkbenchModel.groupDossierInputsByEntity({
    matchedResults: [
      { ...threshold, chinese_name: sharedName, english_name: 'First entity' },
      { ...threshold, cas: '222-22-2', chinese_name: sharedName, english_name: 'Second entity' },
    ],
    bookResults: [{ id: 'ambiguous-book', subject_label: sharedName }],
  });
  assert.deepEqual(groups.map(group => group.bookResults.length), [0, 0]);
});

test('does not override an explicit mismatched book CAS with a name match', () => {
  const groups = searchWorkbenchModel.groupDossierInputsByEntity({
    matchedResults: [threshold],
    bookResults: [{
      id: 'mismatched-book',
      matched_entity_cas: '18127-01-0',
      subject_label: threshold.chinese_name,
    }],
  });
  assert.equal(groups[0].bookResults.length, 0);
});

test('builds unfiltered workbench integrated inputs from raw profile state', () => {
  assert.equal(typeof searchWorkbenchModel.buildWorkbenchIntegratedResults, 'function');
  const missingProfile = { ...threshold, cas: '222-22-2' };
  const entries = searchWorkbenchModel.buildWorkbenchIntegratedResults({
    matchedResults: [threshold, { ...threshold, medium: '空气' }, missingProfile],
    femaProfiles: { [threshold.cas]: { found: false } },
    compoundProfiles: { [threshold.cas]: { pubchem: { found: false }, flavordb: { found: false } } },
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].fema, { found: false });
  assert.deepEqual(entries[0].profile, { pubchem: { found: false }, flavordb: { found: false } });
  assert.deepEqual(entries[1].profile, {});
});

test('prioritizes a selected single-search CAS without expanding ambiguous candidates', () => {
  assert.equal(typeof searchWorkbenchModel.selectProfileRequestCas, 'function');
  const matches = [
    { cas: '939-97-9' },
    { cas: '939-97-9' },
    { cas: '18127-01-0' },
  ];
  assert.deepEqual(searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'single',
  }), ['939-97-9']);
  assert.deepEqual(searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'single',
    selectedCas: '18127-01-0',
  }), ['18127-01-0']);
  assert.deepEqual(searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'bulk',
    selectedCas: '18127-01-0',
    bulkLimit: 2,
  }), ['939-97-9', '18127-01-0']);
});

test('puts a selected late bulk CAS inside the compound prefetch limit without duplicates', () => {
  const matches = Array.from({ length: 12 }, (_, index) => ({ cas: `batch-${index + 1}` }));
  matches.splice(4, 0, { cas: 'batch-2' });

  assert.deepEqual(searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'bulk',
    bulkLimit: 10,
  }), Array.from({ length: 10 }, (_, index) => `batch-${index + 1}`));

  const selected = searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'bulk',
    selectedCas: 'batch-12',
    bulkLimit: 10,
  });
  assert.deepEqual(selected, [
    ...Array.from({ length: 9 }, (_, index) => `batch-${index + 1}`),
    'batch-12',
  ]);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected).size, selected.length);
});

test('puts a selected late bulk CAS inside the FEMA prefetch limit', () => {
  const matches = Array.from({ length: 52 }, (_, index) => ({ cas: `fema-${index + 1}` }));
  const selected = searchWorkbenchModel.selectProfileRequestCas({
    matchedResults: matches,
    searchMode: 'bulk',
    selectedCas: 'fema-52',
    bulkLimit: 50,
  });

  assert.equal(selected.length, 50);
  assert.deepEqual(selected.slice(0, -1), Array.from({ length: 49 }, (_, index) => `fema-${index + 1}`));
  assert.equal(selected.at(-1), 'fema-52');
  assert.equal(new Set(selected).size, selected.length);
});

test('summarizes chapter status from records and source outcomes', () => {
  assert.equal(typeof searchWorkbenchModel.summarizeChapterStatus, 'function');
  const status = searchWorkbenchModel.summarizeChapterStatus;
  assert.equal(status({ recordCount: 2, sourceStates: [{ status: 'loading' }, { status: 'ready' }] }), 'loading');
  assert.equal(status({ recordCount: 1, sourceStates: [{ status: 'ready' }, { status: 'failed' }] }), 'partial');
  assert.equal(status({ recordCount: 0, sourceStates: [{ status: 'failed' }, { status: 'failed' }] }), 'failed');
  assert.equal(status({ recordCount: 0, sourceStates: [{ status: 'not_requested' }] }), 'not_requested');
  assert.equal(status({ recordCount: 0, sourceStates: [{ status: 'no_data' }] }), 'no_data');
  assert.equal(status({ recordCount: 2, sourceStates: [{ status: 'ready' }] }), 'ready');
});

test('keeps an unverified biochemical candidate visible as partial rather than no data', () => {
  assert.equal(searchWorkbenchModel.summarizeScientificSourceStatus({
    hasCandidate: true,
    verified: false,
    sourceStatuses: ['candidate', 'blocked_unverified_identity'],
  }), 'partial');
  assert.equal(searchWorkbenchModel.summarizeScientificSourceStatus({
    sourceStatuses: ['no_data', 'not_requested'],
  }), 'no_data');
});

test('derives dossier source states from observed local and upstream data', () => {
  assert.equal(typeof searchWorkbenchModel.deriveDossierSourceStates, 'function');
  const states = searchWorkbenchModel.deriveDossierSourceStates({
    loading: false,
    matchedResults: [threshold],
    currentCas: threshold.cas,
    femaProfile: { found: false },
    compoundProfile: {
      pubchem: { found: true },
      flavordb: { found: false },
    },
    bookResults: [{ id: 'book-ready' }],
  });

  assert.deepEqual(Object.fromEntries(Object.entries(states).map(([name, state]) => [name, state.status])), {
    local_thresholds: 'ready',
    fema: 'no_data',
    pubchem: 'ready',
    flavordb: 'no_data',
    book: 'ready',
  });
  assert.equal(states.local_thresholds.labelZh, '本地阈值');
  assert.equal(states.flavordb.labelEn, 'FlavorDB2');
  assert.equal(states.book.labelZh, '书籍证据');
});

test('keeps pending, failed, and indeterminate source states distinct', () => {
  assert.equal(typeof searchWorkbenchModel.deriveDossierSourceStates, 'function');
  const pending = searchWorkbenchModel.deriveDossierSourceStates({
    loading: true,
    matchedResults: [{ cas: threshold.cas, threshold_data: [] }],
    currentCas: threshold.cas,
  });
  assert.deepEqual(Object.fromEntries(Object.entries(pending).map(([name, state]) => [name, state.status])), {
    local_thresholds: 'loading',
    fema: 'loading',
    pubchem: 'loading',
    flavordb: 'loading',
    book: 'loading',
  });

  const failed = searchWorkbenchModel.deriveDossierSourceStates({
    matchedResults: [{ cas: threshold.cas, threshold_data: [] }],
    currentCas: threshold.cas,
    femaProfile: { found: false, error: 'offline' },
    compoundProfile: { loading: false, error: 'offline' },
  });
  assert.deepEqual(Object.fromEntries(Object.entries(failed).map(([name, state]) => [name, state.status])), {
    local_thresholds: 'no_data',
    fema: 'failed',
    pubchem: 'failed',
    flavordb: 'failed',
    book: 'no_data',
  });

  const notRequested = searchWorkbenchModel.deriveDossierSourceStates();
  assert.equal(notRequested.fema.status, 'not_requested');
  assert.equal(notRequested.pubchem.status, 'not_requested');
  assert.equal(notRequested.flavordb.status, 'not_requested');
  assert.equal(notRequested.book.status, 'not_requested');
  const emptyFema = searchWorkbenchModel.deriveDossierSourceStates({
    currentCas: threshold.cas,
    femaProfile: {},
    compoundProfile: {},
  });
  assert.equal(emptyFema.fema.status, 'not_requested');
  const emptyCompletedFema = searchWorkbenchModel.deriveDossierSourceStates({
    currentCas: threshold.cas,
    femaProfile: { loading: false, retrying: false },
  });
  assert.equal(emptyCompletedFema.fema.status, 'not_requested');
});

test('keeps local identity evidence readable while remote and book sources load independently', () => {
  const states = searchWorkbenchModel.deriveDossierSourceStates({
    matchedResults: [threshold],
    currentCas: threshold.cas,
    femaProfile: { loading: true },
    compoundProfile: { loading: true },
    bookLoading: true,
  });

  assert.deepEqual(Object.fromEntries(Object.entries(states).map(([name, state]) => [name, state.status])), {
    local_thresholds: 'ready',
    fema: 'loading',
    pubchem: 'loading',
    flavordb: 'loading',
    book: 'loading',
  });
});

test('retains source-specific failure and retry metadata without erasing successful compound evidence', () => {
  const states = searchWorkbenchModel.deriveDossierSourceStates({
    matchedResults: [threshold],
    currentCas: threshold.cas,
    femaProfile: { found: false, error: 'offline', loading: true, retrying: true },
    compoundProfile: {
      loading: true,
      retrying: true,
      pubchem: { found: true, cid: 8857 },
      flavordb: { found: false, error: 'offline' },
    },
    bookError: 'book unavailable',
    bookRetrying: true,
  });

  assert.equal(states.local_thresholds.status, 'ready');
  assert.deepEqual(states.fema, {
    status: 'failed', labelZh: 'FEMA', labelEn: 'FEMA', retrying: true,
  });
  assert.equal(states.pubchem.status, 'ready');
  assert.deepEqual(states.flavordb, {
    status: 'failed', labelZh: 'FlavorDB2', labelEn: 'FlavorDB2', retrying: true,
  });
  assert.deepEqual(states.book, {
    status: 'failed', labelZh: '书籍证据', labelEn: 'Book evidence', retrying: true,
  });
});

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
    ['生化关系', 'Biochemical relationships'],
    ['活性与靶点', 'Bioactivity and targets'],
    ['蛋白结构', 'Protein structures'],
    ['引用与导出', 'Citation and export'],
  ]);
});

test('creates independent default chapter-filter copies', () => {
  const defaults = createDefaultChapterFilters();
  defaults.thresholds.media = 'water';
  assert.deepEqual(createDefaultChapterFilters(), {
    sensory: { sources: null, kinds: null },
    thresholds: { media: null, types: null, includeBooks: true, bookOnly: false },
    spectra: { sources: ['PubChem'], includeExperimental: true },
  });
  assert.notEqual(defaults.thresholds, defaults.sensory);
});

test('keeps FEMA and FlavorDB2 sensory evidence separate and filters without mutation', () => {
  const sensoryInput = {
    item: threshold,
    fema: { flavor_profile: ['fruity', 'green'], source: 'FEMA Flavor Library' },
    profile: {
      flavordb: {
        flavor_profile: ['fruity'],
        odor: ['pineapple'],
        taste: ['sweet'],
        source: 'FlavorDB2',
      },
      flavordb2_entities: {
        entities: [{ id: 12, name: 'Pineapple', natural_source: { name: 'Ananas comosus' } }],
      },
    },
  };
  const records = buildCompoundDossier({ integratedResults: [sensoryInput] }).sensory.records;
  const before = structuredClone(records);
  assert.ok(records.every(record => ['odor', 'taste', 'natural_source', 'food_entity', 'flavor'].includes(record.kind)));
  assert.ok(records.some(record => record.source === 'FEMA' && record.descriptors.includes('fruity')));
  assert.ok(records.some(record => record.source === 'FlavorDB' && record.descriptors.includes('fruity')));
  assert.ok(records.some(record => record.source === 'FEMA' && record.sourceLabel === 'FEMA Flavor Library'));
  assert.ok(records.some(record => record.informationType === 'odor' && record.descriptors.includes('pineapple')));
  assert.ok(records.some(record => record.informationType === 'taste' && record.descriptors.includes('sweet')));
  assert.ok(records.some(record => (
    record.informationType === 'food_entity'
    && record.descriptors.includes('Pineapple')
    && record.naturalSource === 'Ananas comosus'
  )));
  assert.ok(records.some(record => (
    record.informationType === 'natural_source'
    && record.descriptors.includes('Ananas comosus')
    && record.relatedFoodEntity === 'Pineapple'
  )));
  assert.ok(filterSensoryRecords(records, { sources: ['FEMA'] }).every(record => record.source === 'FEMA'));
  assert.ok(filterSensoryRecords(records, { sources: ['FlavorDB'] }).every(record => record.source === 'FlavorDB'));
  assert.ok(filterSensoryRecords(records, { kinds: ['odor'] }).every(record => record.kind === 'odor'));
  assert.ok(filterSensoryRecords(records, { sources: ['FlavorDB'], kinds: ['taste'] }).every(record => (
    record.source === 'FlavorDB' && record.kind === 'taste'
  )));
  assert.deepEqual(filterSensoryRecords(records, { sources: null, kinds: null }), records);
  assert.deepEqual(records, before);
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
    commonName: 'Ethyl acetate',
    molecularFormula: 'C4H8O2',
    inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
    smiles: 'CCOC(=O)C',
    raw: threshold,
  });
  assert.deepEqual(dossier.thresholds.records, [{
    cas: '141-78-6',
    medium: '水',
    type: 'd',
    thresholdType: 'd',
      value: 0.005,
      unit: 'mg/L',
      originalUnit: 'mg/L',
    source: 'Van Gemert (2011)',
    originalText: '0.005 mg/L',
    sourceRecordKey: 'book:p12:r3',
    id: 'book:p12:r3',
    raw: threshold.threshold_data[0],
    parseStatus: 'parsed',
  }]);
  assert.deepEqual(dossier.sourceStates, {
    pubchem: { state: 'ready', status: 'ready' },
    book: { state: 'partial', status: 'partial' },
  });
  for (const { id } of CHAPTERS) assert.ok(Array.isArray(dossier[id].records));
});

test('builds canonical scientific props from the same raw profile used by classic and dossier views', () => {
  assert.equal(typeof searchWorkbenchModel.buildScientificComponentProps, 'function');
  const rawProfile = {
    item: threshold,
    fema: { found: true, name: 'ETHYL   ACETATE (natural)' },
    profile: {
      pubchem: {
        found: true,
        cid: 8857,
        title: 'PUBCHEM TITLE',
        inchi_key: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
        smiles: 'CCOC(=O)C',
      },
      flavordb: { found: true, cid: 999999, common_name: 'FlavorDB name' },
    },
  };
  const expected = {
    cas: '141-78-6',
    cid: 8857,
    inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
    smiles: 'CCOC(=O)C',
    name: 'Ethyl acetate',
  };

  assert.deepEqual(searchWorkbenchModel.buildScientificComponentProps({ rawProfile }), expected);
  assert.deepEqual(searchWorkbenchModel.buildScientificComponentProps({
    dossier: { identity: { cas: '141-78-6', raw: threshold }, rawProfile },
  }), expected);
  assert.deepEqual(searchWorkbenchModel.buildScientificComponentProps({
    rawProfile,
    includeFlavorDescriptions: false,
  }), { ...expected, name: 'Pubchem title' });
});

test('maps thresholds and identity from integrated-only results', () => {
  const dossier = buildCompoundDossier({ matchedResults: [], integratedResults: [integrated] });
  assert.equal(dossier.identity.cid, 8857);
  assert.equal(dossier.identity.molecularFormula, 'C4H8O2');
  assert.equal(dossier.thresholds.records.length, 1);
  assert.equal(dossier.thresholds.records[0].type, 'd');
});

test('maps production-style string thresholds without losing comparator or range text', () => {
  const productionRecord = {
    cas: '108-24-7',
    medium: '空气',
    threshold_data: [
      'Hellman & Small (1973,1974) d < 0.6',
      'Schieberle & Grosch (1988) 0.002 - 0.0108',
    ],
  };
  const records = buildCompoundDossier({ matchedResults: [productionRecord] }).thresholds.records;
  assert.equal(records[0].type, 'd');
  assert.equal(records[0].value, null);
  assert.equal(records[0].unit, null);
  assert.equal(records[0].parseStatus, 'unparsed');
  assert.equal(records[0].raw, productionRecord.threshold_data[0]);
  assert.equal(records[0].originalText, productionRecord.threshold_data[0]);
  assert.equal(records[1].type, null);
  assert.equal(records[1].raw, productionRecord.threshold_data[1]);
  assert.equal(records[1].originalText, productionRecord.threshold_data[1]);
  assert.equal(filterThresholdRecords(records, createDefaultChapterFilters().thresholds).length, 2);
});

test('separates foreign-CAS cross references while retaining explicit current threshold evidence', () => {
  const crossReference = '          [1506-02-1]';
  const mixedEvidence = 'See [1506-02-1]; Current compound d 0.005 mg/L';
  const dossier = buildCompoundDossier({
    matchedResults: [{
      cas: '164524-93-0',
      medium: '空气',
      threshold_data: [crossReference, mixedEvidence],
    }],
  });
  assert.deepEqual(dossier.thresholds.records.map(record => record.raw), [mixedEvidence]);
  assert.deepEqual(dossier.thresholds.crossReferences, [{
    id: 'crossref:cas:164524-93-0|空气|[1506-02-1]:0',
    raw: crossReference,
    originalText: crossReference,
    currentCas: '164524-93-0',
    targetCas: '1506-02-1',
    targetCases: ['1506-02-1'],
    medium: '空气',
  }]);
});

test('keeps zero and non-positive string thresholds unparsed', () => {
  const source = 'Deadman & Prigg (1959) d 0.00';
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '2365-48-2', medium: '空气', threshold_data: [source] }],
  }).thresholds.records;
  assert.equal(record.value, null);
  assert.equal(record.unit, null);
  assert.equal(record.parseStatus, 'unparsed');
  assert.equal(record.raw, source);
  assert.equal(record.originalText, source);
});

test('keeps a typed threshold range unparsed instead of collapsing it to the lower bound', () => {
  const source = 'Wise et al. (2007); Miyazawa et al. (2009a) d 0.017 - 0.020';
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-6', medium: '空气', threshold_data: [source] }],
  }).thresholds.records;
  assert.equal(record.type, 'd');
  assert.equal(record.value, null);
  assert.equal(record.unit, null);
  assert.equal(record.parseStatus, 'unparsed');
  assert.equal(record.originalText, source);
});

test('parses only an exact single string threshold with an optional unit', () => {
  const source = 'Takeoka et al. (1989) d 0.005 mg/L';
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-9', medium: '水', threshold_data: [source] }],
  }).thresholds.records;
  assert.equal(record.value, 0.005);
  assert.equal(record.unit, 'mg/L');
  assert.equal(record.parseStatus, 'parsed');
  assert.equal(record.originalText, source);
});

test('keeps exact scientific-notation thresholds with an attached unit parseable', () => {
  const source = 'Reference d 1.2e-3mg/L';
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-2', medium: '水', threshold_data: [source] }],
  }).thresholds.records;
  assert.equal(record.value, 0.0012);
  assert.equal(record.unit, 'mg/L');
  assert.equal(record.parseStatus, 'parsed');
});

test('does not structure comparator or range values from object thresholds', () => {
  const entries = [
    { threshold: '< 0.6 mg/L', type: 'd' },
    { threshold: '0.017 - 0.020 mg/L', type: 'd' },
    { value: 0.6, unit: 'mg/L', comparator: '<', type: 'd' },
    { threshold: '0.005 mg/L', type: 'd' },
  ];
  const records = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-0', medium: '水', threshold_data: entries }],
  }).thresholds.records;
  assert.deepEqual(records.map(({ value, unit }) => [value, unit]), [
    [null, null],
    [null, null],
    [null, null],
    [0.005, 'mg/L'],
  ]);
  assert.deepEqual(records.map(record => record.raw), entries);
});

test('rejects nonpositive and nonfinite structured threshold values', () => {
  const entries = [
    { value: 0, unit: 'mg/L' },
    { value: -1, unit: 'mg/L' },
    { value: Number.NaN, unit: 'mg/L' },
    { value: Number.POSITIVE_INFINITY, unit: 'mg/L' },
  ];
  const records = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-9', medium: '水', threshold_data: entries }],
  }).thresholds.records;
  assert.deepEqual(records.map(({ value, unit, parseStatus }) => ({ value, unit, parseStatus })), [
    { value: null, unit: null, parseStatus: 'unparsed' },
    { value: null, unit: null, parseStatus: 'unparsed' },
    { value: null, unit: null, parseStatus: 'unparsed' },
    { value: null, unit: null, parseStatus: 'unparsed' },
  ]);
  assert.deepEqual(records.map(record => record.raw), entries);
});

test('keeps a positive structured threshold value parsed', () => {
  const entry = { value: 0.25, unit: 'mg/L' };
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-9', medium: '水', threshold_data: [entry] }],
  }).thresholds.records;
  assert.deepEqual(
    { value: record.value, unit: record.unit, parseStatus: record.parseStatus, raw: record.raw },
    { value: 0.25, unit: 'mg/L', parseStatus: 'parsed', raw: entry },
  );
});

test('leaves author-led strings without a threshold type unparsed', () => {
  const source = 'Hofmann et al. (1995) 0.000 02 - 0.000 08';
  const [record] = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-7', medium: '空气', threshold_data: [source] }],
  }).thresholds.records;
  assert.equal(record.value, null);
  assert.equal(record.originalText, source);
});

test('preserves spaced-decimal threshold strings as unparsed evidence', () => {
  const first = 'McGee et al. (1995) d 0.000 5 - 0.005';
  const second = 'Kraft & Popaj (2004) d 0.000 002';
  const records = buildCompoundDossier({
    matchedResults: [{ cas: '123-45-8', medium: '空气', threshold_data: [first, second] }],
  }).thresholds.records;
  for (const [record, source] of records.map((record, index) => [record, [first, second][index]])) {
    assert.equal(record.type, 'd');
    assert.equal(record.value, null);
    assert.equal(record.unit, null);
    assert.equal(record.parseStatus, 'unparsed');
    assert.equal(record.originalText, source);
  }
});

test('gives thresholds stable unique ids and prioritizes a source record key', () => {
  const duplicateStrings = {
    cas: '108-24-7',
    medium: '空气',
    threshold_data: ['Hellman & Small (1973,1974) d < 0.6', 'Hellman & Small (1973,1974) d < 0.6'],
  };
  const keyed = buildCompoundDossier({ matchedResults: [threshold] }).thresholds.records[0];
  const first = buildCompoundDossier({ matchedResults: [duplicateStrings] }).thresholds.records;
  const second = buildCompoundDossier({ matchedResults: [duplicateStrings] }).thresholds.records;
  assert.equal(keyed.id, 'book:p12:r3');
  assert.equal(new Set(first.map(({ id }) => id)).size, 2);
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
});

test('merges matched and integrated threshold records by entity and deduplicates identical records', () => {
  const noThresholdMatch = { ...threshold, threshold_data: [] };
  const fromIntegrated = buildCompoundDossier({
    matchedResults: [noThresholdMatch],
    integratedResults: [integrated],
  }).thresholds.records;
  const deduplicated = buildCompoundDossier({
    matchedResults: [threshold],
    integratedResults: [integrated],
  }).thresholds.records;
  assert.equal(fromIntegrated.length, 1);
  assert.equal(deduplicated.length, 1);
});

test('filters threshold records without mutating source records', () => {
  const records = buildCompoundDossier({ matchedResults: [threshold] }).thresholds.records;
  const filtered = filterThresholdRecords(records, { media: ['空气'], types: ['d'], includeBooks: true });
  assert.equal(filtered.length, 0);
  assert.equal(records.length, 1);
});

test('filters thresholds independently by medium category, threshold type, and mapped book records', () => {
  const records = [
    { id: 'water-d', medium: '水', type: 'd', thresholdType: 'd', sourceKind: 'local' },
    { id: 'air-r', medium: '空气', type: 'r', thresholdType: 'r', sourceKind: 'local' },
    { id: 'wine-unknown', medium: '葡萄酒', type: null, thresholdType: null, sourceKind: 'local' },
    { id: 'other-unknown', medium: null, type: null, thresholdType: null, sourceKind: 'local' },
    { id: 'book-water', medium: '水', type: 'odor', thresholdType: 'odor', sourceKind: 'book' },
  ];
  const before = structuredClone(records);
  assert.deepEqual(filterThresholdRecords(records, createDefaultChapterFilters().thresholds), records);
  assert.deepEqual(filterThresholdRecords(records, {
    ...createDefaultChapterFilters().thresholds,
    media: 'water',
  }).map(record => record.id), ['water-d', 'book-water']);
  assert.deepEqual(filterThresholdRecords(records, {
    ...createDefaultChapterFilters().thresholds,
    media: 'alcohol',
  }).map(record => record.id), ['wine-unknown']);
  assert.deepEqual(filterThresholdRecords(records, {
    ...createDefaultChapterFilters().thresholds,
    media: 'other',
  }).map(record => record.id), ['other-unknown']);
  assert.deepEqual(filterThresholdRecords(records, {
    ...createDefaultChapterFilters().thresholds,
    types: ['d'],
  }).map(record => record.id), ['water-d']);
  assert.deepEqual(filterThresholdRecords(records, {
    ...createDefaultChapterFilters().thresholds,
    bookOnly: true,
  }).map(record => record.id), ['book-water']);
  assert.deepEqual(records, before);
});

test('maps only associated book thresholds and preserves their source lineage', () => {
  const bookThreshold = {
    entity_cas: '141-78-6',
    page: 182,
    record_id: 'book-flavor-chemistry-p0182-b10',
    media: ['水'],
    threshold_type: 'odor',
    values: [{ low: '0.6', high: null, unit: 'μg/L', role: 'threshold' }],
    raw_text: '水中觉察嗅阈值0.6μg/L',
  };
  const dossier = buildCompoundDossier({
    matchedResults: [{ ...threshold, threshold_data: [] }],
    bookThresholds: [bookThreshold],
  });
  assert.deepEqual(dossier.thresholds.records, [{
    id: 'book:book-flavor-chemistry-p0182-b10:0',
    cas: '141-78-6',
    medium: '水',
    type: 'odor',
    thresholdType: 'odor',
    value: 0.6,
    unit: 'μg/L',
    source: '酒类风味化学',
    sourceKind: 'book',
    originalText: '水中觉察嗅阈值0.6μg/L',
    sourceRecordKey: 'book-flavor-chemistry-p0182-b10',
    page: 182,
    block: 10,
    quality: {
      associationMethod: null,
      associationConfidence: null,
      reviewStatus: null,
      reviewFlags: [],
      sourceCorrections: [],
      subjectResolution: null,
    },
    raw: bookThreshold,
  }]);
  assert.equal(dossier.citation.records.length, 0, 'mapped thresholds do not fabricate citation hits');
});

test('keeps reviewed or weakly associated book thresholds unstructured with quality details', () => {
  const bookThreshold = {
    entity_cas: '141-78-6',
    page: 182,
    record_id: 'book-flavor-chemistry-p0182-b11',
    media: ['水'],
    threshold_type: 'odor',
    values: [{ low: '0.6', high: null, unit: 'μg/L', role: 'threshold' }],
    raw_text: '水中嗅阈值0.6μg/L',
    association_method: 'inherited_context',
    association_confidence: 'low',
    review_status: 'review',
    review_flags: ['identity_conflict'],
    source_corrections: [{ field: 'subject_label', reason: 'source conflict' }],
    subject_resolution: { resolution_type: 'source_identity_error' },
  };
  const [record] = buildCompoundDossier({ bookThresholds: [bookThreshold] }).thresholds.records;
  assert.equal(record.value, null);
  assert.equal(record.unit, null);
  assert.deepEqual(record.quality, {
    associationMethod: 'inherited_context',
    associationConfidence: 'low',
    reviewStatus: 'review',
    reviewFlags: ['identity_conflict'],
    sourceCorrections: [{ field: 'subject_label', reason: 'source conflict' }],
    subjectResolution: { resolution_type: 'source_identity_error' },
  });
  assert.equal(record.raw, bookThreshold);
});

test('production scan isolates cross references and has no parsed non-positive thresholds', () => {
  const productionData = JSON.parse(readFileSync(
    new URL('../public/aroma_data_merged.json', import.meta.url),
    'utf8',
  ));
  const dossier = buildCompoundDossier({ matchedResults: productionData });
  const crossReferenceSignatures = new Set(dossier.thresholds.crossReferences.map(record => (
    `${record.currentCas}|${record.medium}|${record.raw}`
  )));
  const leakedCrossReferences = dossier.thresholds.records.filter(record => (
    crossReferenceSignatures.has(`${record.cas}|${record.medium}|${record.raw}`)
  ));
  const parsedNonPositive = dossier.thresholds.records.filter(record => (
    record.value != null && record.value <= 0
  ));
  assert.equal(dossier.thresholds.records.length, 20277);
  assert.equal(dossier.thresholds.crossReferences.length, 56);
  assert.equal(leakedCrossReferences.length, 0);
  assert.equal(parsedNonPositive.length, 0);
});

test('normalizes requested source states while retaining state fields', () => {
  assert.equal(normalizeSourceStatus(undefined).status, 'not_requested');
  assert.deepEqual(normalizeSourceStatus({ state: 'no_data', source: 'book' }), {
    state: 'no_data', source: 'book', status: 'no_data',
  });
  assert.equal(normalizeSourceStatus({ state: 'partial_failure' }).status, 'partial');
  assert.equal(normalizeSourceStatus({ state: 'timeout' }).status, 'failed');
  assert.equal(normalizeSourceStatus({ state: 'ok' }).status, 'ready');
  assert.equal(normalizeSourceStatus({ state: 'fetching' }).status, 'not_requested');
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
  assert.equal(rows[0].standardName, 'Ethyl acetate');
  assert.equal(rows[3].standardName, null);
  assert.equal(rows[0].candidateEntityKey, 'cas:141-78-6');
  assert.equal(rows[2].candidateEntityKey, 'cas:141-78-6');
  assert.ok('cas' in rows[2] && 'coverage' in rows[2] && Array.isArray(rows[2].issues));
});

test('keeps duplicate batch row ids stable and records the original input order', () => {
  const inputs = [' 141-78-6 ', '141-78-6', '141-78-6'];
  const first = buildBatchReviewRows(inputs, [threshold]);
  const second = buildBatchReviewRows(inputs, [threshold]);
  assert.deepEqual(first.map(row => row.id), ['141-78-6:0', '141-78-6:1', '141-78-6:2']);
  assert.deepEqual(second.map(row => row.id), first.map(row => row.id));
  assert.deepEqual(first.map(row => row.inputIndex), [0, 1, 2]);
  assert.equal(new Set(first.map(row => row.id)).size, first.length);
});

test('parses batch text by preserving non-empty raw lines and intentionally ignoring blank lines', () => {
  assert.deepEqual(
    parseBatchReviewInputs('141-78-6\r\n\r\n 64-17-5 \n   \nunknown'),
    ['141-78-6', ' 64-17-5 ', 'unknown'],
  );
});

test('batch session signature includes search and match modes without input delimiter collisions', () => {
  const exact = searchWorkbenchModel.buildBatchSessionSignature({
    mode: 'bulk',
    exactMatch: true,
    rawInputs: ['ethyl acetate'],
  });
  const fuzzy = searchWorkbenchModel.buildBatchSessionSignature({
    mode: 'bulk',
    exactMatch: false,
    rawInputs: ['ethyl acetate'],
  });

  assert.notEqual(exact, fuzzy);
  assert.notEqual(exact, searchWorkbenchModel.buildBatchSessionSignature({
    mode: 'single',
    exactMatch: true,
    rawInputs: ['ethyl acetate'],
  }));
  assert.equal(exact, searchWorkbenchModel.buildBatchSessionSignature({
    mode: 'bulk',
    exactMatch: true,
    rawInputs: ['ethyl acetate'],
  }));
  assert.notEqual(
    searchWorkbenchModel.buildBatchSessionSignature({ mode: 'bulk', exactMatch: true, rawInputs: ['a\u001fb'] }),
    searchWorkbenchModel.buildBatchSessionSignature({ mode: 'bulk', exactMatch: true, rawInputs: ['a', 'b'] }),
  );
});

test('aggregates all media for one CAS without mutating matched inputs', () => {
  const airThreshold = {
    ...threshold,
    medium: '空气',
    threshold_data: [{ threshold: '0.6 mg/m3', type: 'd' }],
  };
  const candidates = [threshold, airThreshold];
  const before = structuredClone(candidates);
  const [row] = buildBatchReviewRows(['141-78-6'], candidates);
  assert.equal(row.status, 'exact');
  assert.equal(row.thresholdRecordCount, 2);
  assert.deepEqual(row.media, ['水', '空气']);
  assert.equal(row.coverage, 2);
  assert.equal(row.matches.length, 2);
  assert.deepEqual(row.issues, []);
  assert.deepEqual(candidates, before);
});

test('keeps a multi-CAS name match ambiguous instead of choosing the first identity', () => {
  const candidates = [
    { cas: '111-11-1', english_name: 'Shared name', medium: '水', threshold_data: ['A (2001) d 1'] },
    { cas: '222-22-2', english_name: 'Shared name', medium: '空气', threshold_data: ['B (2002) d 2'] },
  ];
  const [row] = buildBatchReviewRows(['shared name'], candidates);
  assert.equal(row.status, 'conflict');
  assert.equal(row.cas, null);
  assert.equal(row.candidateEntityKey, null);
  assert.ok(row.issues.includes('ambiguous_identity'));
  assert.equal(row.matches.length, 2);
});

test('assigns classic medium units while preserving raw threshold evidence', () => {
  const productionData = JSON.parse(readFileSync(
    new URL('../public/aroma_data_merged.json', import.meta.url),
    'utf8',
  )).filter(item => item.cas === '141-78-6');
  const records = buildCompoundDossier({ matchedResults: productionData }).thresholds.records;
  const air = records.find(record => record.originalText.includes('Jung (1936)') && record.type === 'd');
  const water = records.find(record => record.originalText.includes('Hansen et al. (1992)'));
  assert.equal(air.unit, 'mg/m3');
  assert.equal(water.unit, 'mg/kg');
  assert.equal(air.originalUnit, null);
  assert.equal(air.raw, air.originalText);
});

test('infers units only for known classic media and leaves unknown media unset', () => {
  const records = buildCompoundDossier({ matchedResults: [
    { cas: '1-11-1', medium: 'Air', threshold_data: ['Source d 1'] },
    { cas: '2-22-2', medium: '橄榄油', threshold_data: ['Source d 2'] },
    { cas: '3-33-3', medium: 'mystery matrix', threshold_data: ['Source d 3'] },
    { cas: '4-44-4', medium: null, threshold_data: ['Source d 4'] },
  ] }).thresholds.records;
  assert.deepEqual(records.map(record => record.unit), ['mg/m3', 'mg/kg', null, null]);
});

test('uses actual matched names for fuzzy batch candidates while exact mode keeps full matches', () => {
  const candidates = [
    { cas: '141-78-6', english_name: 'Ethyl acetate', threshold_data: [] },
    { cas: '105-54-4', english_name: 'Ethyl butyrate', common_english_name: 'Ethyl butanoate', threshold_data: [] },
    { cas: '141-97-9', english_name: 'Ethyl acetoacetate', threshold_data: [] },
  ];

  const [exactRow] = buildBatchReviewRows(['ethyl acet'], candidates, { exactMatch: true });
  assert.equal(exactRow.status, 'unmatched');

  const [fuzzyRow] = buildBatchReviewRows(['ethyl acet'], candidates, { exactMatch: false });
  assert.equal(fuzzyRow.status, 'conflict');
  assert.equal(fuzzyRow.matches.length, 2);
  assert.equal(fuzzyRow.candidateEntityKey, null);
  assert.equal(fuzzyRow.standardName, null);
  assert.equal(fuzzyRow.cas, null);
  assert.ok(fuzzyRow.issues.includes('ambiguous_identity'));
});

test('treats a CAS identity and a no-CAS normalized-name identity as ambiguous', () => {
  const candidates = [
    { cas: '111-11-1', english_name: 'Shared identity', threshold_data: [] },
    { cas: null, english_name: 'Shared identity', threshold_data: [] },
  ];
  const [row] = buildBatchReviewRows(['shared identity'], candidates);

  assert.equal(row.status, 'conflict');
  assert.equal(row.candidateEntityKey, null);
  assert.equal(row.standardName, null);
  assert.equal(row.cas, null);
  assert.ok(row.issues.includes('ambiguous_identity'));
  assert.deepEqual(row.candidateEntityKeys, ['cas:111-11-1', 'name:shared identity']);
});

test('writes actual dossier chapter coverage onto uniquely linked batch rows', () => {
  const [row] = buildBatchReviewRows(['141-78-6'], [threshold], {
    dossierCandidates: [{
      entityKey: 'cas:141-78-6',
      dossier: {
        overview: { records: [{ id: 'identity' }] },
        thresholds: { records: [{ id: 'threshold' }] },
        spectra: { records: [] },
      },
    }],
  });

  assert.equal(row.chapterCoverageCount, 2);
});

test('sorts batch review priority deterministically without changing inputs', () => {
  const rows = buildBatchReviewRows(['141-78-6', 'ethyl acetate', 'missing compound'], [threshold]);
  const before = rows.map(row => row.id);
  const sorted = sortBatchRows(rows, { key: 'reviewPriority', direction: 'asc' });
  assert.deepEqual(sorted.map(row => row.status), ['unmatched', 'candidate', 'exact']);
  assert.deepEqual(rows.map(row => row.id), before);
});

test('sorts input order and coverage deterministically in both directions', () => {
  const richThreshold = {
    ...threshold,
    cas: '64-17-5',
    english_name: 'Ethanol',
    medium: '空气',
    threshold_data: ['A d 1', 'B d 2', 'C d 3'],
  };
  const rows = buildBatchReviewRows(
    ['64-17-5', 'missing compound', '141-78-6'],
    [threshold, richThreshold],
  );

  assert.deepEqual(
    sortBatchRows(rows, { key: 'inputOrder', direction: 'asc' }).map(row => row.originalInput),
    ['64-17-5', 'missing compound', '141-78-6'],
  );
  assert.deepEqual(
    sortBatchRows(rows, { key: 'inputOrder', direction: 'desc' }).map(row => row.originalInput),
    ['141-78-6', 'missing compound', '64-17-5'],
  );
  assert.deepEqual(
    sortBatchRows(rows, { key: 'coverage', direction: 'desc' }).map(row => row.originalInput),
    ['64-17-5', '141-78-6', 'missing compound'],
  );
  assert.deepEqual(
    sortBatchRows(rows, { key: 'coverage', direction: 'desc' }).map(row => row.id),
    ['64-17-5:0', '141-78-6:0', 'missing compound:0'],
  );
});

test('sorts coverage by chapters then media then threshold records', () => {
  const rows = [
    { id: 'threshold-rich', chapterCoverageCount: 0, media: ['water', 'air', 'wine'], thresholdRecordCount: 99 },
    { id: 'one-chapter-one-medium', chapterCoverageCount: 1, media: ['water'], thresholdRecordCount: 50 },
    { id: 'two-chapters', chapterCoverageCount: 2, media: [], thresholdRecordCount: 0 },
    { id: 'one-chapter-two-media', chapterCoverageCount: 1, media: ['water', 'air'], thresholdRecordCount: 1 },
  ];

  assert.deepEqual(
    sortBatchRows(rows, { key: 'coverage', direction: 'desc' }).map(row => row.id),
    ['two-chapters', 'one-chapter-two-media', 'one-chapter-one-medium', 'threshold-rich'],
  );
});
