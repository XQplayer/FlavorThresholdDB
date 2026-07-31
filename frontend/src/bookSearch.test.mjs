import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildBookSearchTerms,
  getBookConflictQuality,
  getBookDisplayCas,
  getBookSourceLocator,
  getBookThresholdQuality,
  getBookThresholdReviewDetails,
  getBookThresholdRowKey,
  getThresholdsForBookHit,
  mergeBookHitsByEntity,
  groupBookThresholds,
  summarizeBookSources,
  searchBookIndex,
} from './bookSearch.js';

const loadJson = async (relativePath) => JSON.parse(
  await readFile(new URL(relativePath, import.meta.url), 'utf8'),
);

test('buildBookSearchTerms expands a CAS query to compound names', () => {
  const terms = buildBookSearchTerms(['141-78-6'], [{
    cas: '141-78-6',
    chinese_name: '乙酸乙酯',
    english_name: 'ETHYL ACETATE',
  }]);

  assert.deepEqual(
    terms.map(item => item.term),
    ['141-78-6', '乙酸乙酯', 'ethyl acetate'],
  );
});

test('searchBookIndex collapses overlapping chunks from the same page', () => {
  const records = [
    { id: 'p1-1', book_title: '书', page: 1, chunk: 1, text: `前文${'甲'.repeat(40)}乙酸乙酯${'乙'.repeat(60)}` },
    { id: 'p1-2', book_title: '书', page: 1, chunk: 2, text: `${'乙'.repeat(60)}乙酸乙酯用于酒类` },
  ];

  const results = searchBookIndex({ records, rawQueries: ['乙酸乙酯'] });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].chunks, [1, 2]);
  assert.match(results[0].text, /用于酒类/);
});

test('source-verified table rows are searchable even when linear OCR corrupts a compound name', () => {
  const records = [{
    id: 'p24-table-1-7',
    page: 24,
    chunk: 2,
    text: '表1-7 (E)-2-王烯醛 0.00008',
    structured_search_text: '(E)-2-壬烯醛 0.00008 0.00011 mg/kg',
  }];
  const results = searchBookIndex({ records, rawQueries: ['(E)-2-壬烯醛'] });
  assert.equal(results.length, 1);
  assert.ok(results[0].matchReasonCodes.includes('query'));
});

test('book entity records are returned even when a continuation block omits the name', () => {
  const records = [{
    id: 'p2-b1', book_title: '书', page: 2, chunk: 1, entity_cas: '141-78-6', text: '在白酒中的含量较高。',
  }];
  const bookEntities = [{
    cas: '141-78-6', chinese_name: '乙酸乙酯', english_names: ['ethyl acetate'], aliases: ['乙酸乙酯', 'ethyl acetate'],
  }];
  const results = searchBookIndex({ records, rawQueries: ['141-78-6'], bookEntities });
  assert.equal(results.length, 1);
  assert.equal(results[0].entity.cas, '141-78-6');
  assert.ok(results[0].matchReasonCodes.includes('bookEntity'));
});

test('a mixed OCR block resolves the queried entity and filters its thresholds', () => {
  const records = [{
    id: 'p199-b10', page: 199, chunk: 10, entity_cas: null,
    entity_cas_list: ['105-66-8', '106-27-4'],
    text: '丁酸丙酯 CAS号105-66-8；丁酸异戊酯 CAS号106-27-4。',
  }];
  const entities = [
    { cas: '105-66-8', chinese_name: '丁酸丙酯', english_names: ['propyl butanoate'], aliases: [] },
    { cas: '106-27-4', chinese_name: '丁酸异戊酯', english_names: ['isoamyl butyrate'], aliases: [] },
  ];
  const results = searchBookIndex({ records, rawQueries: ['propyl butanoate'], bookEntities: entities });
  assert.equal(results[0].entity.cas, '105-66-8');
  assert.equal(results[0].matched_entity_cas, '105-66-8');

  const thresholds = [
    { page: 199, record_id: 'p199-b10', entity_cas: '105-66-8' },
    { page: 199, record_id: 'p199-b10', entity_cas: '106-27-4' },
  ];
  assert.deepEqual(getThresholdsForBookHit(thresholds, results[0]), [thresholds[0]]);
});

test('a common English name resolves an entity when the canonical alias contains parenthetical text', () => {
  const entities = [{
    cas: '123-66-0',
    chinese_name: '己酸乙酯',
    english_names: ['ethyl hexanoate (ethyl caproate)'],
    aliases: ['ethyl caproate'],
  }];
  const records = [{ id: 'p185', page: 185, chunk: 1, entity_cas: '123-66-0', text: '空气中嗅阈值3ng/L' }];
  const hits = searchBookIndex({ records, rawQueries: ['ethyl hexanoate'], bookEntities: entities });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entity.cas, '123-66-0');
});

test('threshold quality prioritizes review flags over association confidence', () => {
  assert.deepEqual(getBookThresholdQuality({
    review_status: 'needs_review',
    review_flags: [{ category: 'ambiguous_unit' }],
    association_confidence: 'high',
  }), { level: 'review', reason: 'needsReview', flagCount: 1 });

  assert.deepEqual(getBookThresholdQuality({
    review_status: 'clean',
    review_flags: [],
    association_confidence: 'high',
  }), { level: 'high', reason: 'exactAssociation', flagCount: 0 });

  assert.deepEqual(getBookThresholdQuality({
    review_status: 'clean',
    association_confidence: 'medium',
  }), { level: 'medium', reason: 'contextAssociation', flagCount: 0 });
});

test('threshold review details and source locator remain machine traceable', () => {
  const threshold = {
    page: 183,
    record_id: 'book-flavor-chemistry-p0183-b11',
    review_flags: [
      { category: 'ambiguous_unit' },
      { category: 'unknown_medium' },
      { category: 'ambiguous_unit' },
    ],
    source_corrections: [{ reason: 'verified_against_source_page' }],
  };
  assert.deepEqual(getBookThresholdReviewDetails(threshold), ['ambiguous_unit', 'unknown_medium']);
  assert.deepEqual(getBookSourceLocator(threshold), {
    page: 183,
    block: 11,
    recordId: 'book-flavor-chemistry-p0183-b11',
    sourceVerifiedCorrection: true,
    sourceVerificationKind: 'corrected',
  });
  assert.equal(getBookSourceLocator({
    source_corrections: [{ source_text: '0.02pg/L', corrected_text: '0.02pg/L' }],
  }).sourceVerificationKind, 'literal');
  assert.deepEqual(getBookSourceLocator({
    page: 197,
    record_id: 'book-flavor-chemistry-p0197-b02',
    medium_resolution: {
      resolution_type: 'source_verified_context_medium',
      source_page_evidence: '该句跨页，前页末明确为10%vol酒精-水溶液中',
    },
  }), {
    page: 197,
    block: 2,
    recordId: 'book-flavor-chemistry-p0197-b02',
    sourceVerifiedCorrection: false,
    sourceVerificationKind: null,
    mediumResolutionKind: 'source_verified_context_medium',
    mediumResolutionEvidence: '该句跨页，前页末明确为10%vol酒精-水溶液中',
  });
});

test('canonical conflicts are graded instead of all being presented as identity errors', () => {
  assert.deepEqual(getBookConflictQuality({ type: 'name_variant' }), { level: 'info', reason: 'nameVariant' });
  assert.deepEqual(getBookConflictQuality({ type: 'likely_ocr_error' }), { level: 'review', reason: 'likelyOcrError' });
  assert.deepEqual(getBookConflictQuality({ type: 'identity_conflict' }), { level: 'high', reason: 'identityConflict' });
  assert.deepEqual(
    getBookConflictQuality({ type: 'source_identity_error', resolution: { authority: 'PubChem' } }),
    { level: 'verified', reason: 'verifiedSourceConflict' },
  );
  assert.deepEqual(
    getBookConflictQuality({ type: 'verified_name_variant' }),
    { level: 'verified', reason: 'verifiedNameVariant' },
  );
});

test('name-only book hits only show thresholds from matching source blocks', () => {
  const thresholds = [
    { page: 432, record_id: 'book-flavor-chemistry-p0432-b07', subject_label: 'Ala-Leu' },
    { page: 432, record_id: 'book-flavor-chemistry-p0432-b08', subject_label: 'Gly-Leu' },
  ];
  const hit = { page: 432, chunks: [7], entity_cas: null };
  assert.deepEqual(getThresholdsForBookHit(thresholds, hit), [thresholds[0]]);
});

test('exact entity search excludes pages that only mention the queried compound', () => {
  const entity = {
    cas: '7647-14-5',
    chinese_name: '氯化钠',
    english_names: ['sodium chloride'],
    aliases: ['氯化钠', 'sodium chloride'],
  };
  const records = [
    {
      id: 'book-flavor-chemistry-p0607-b07', book_title: '酒类风味化学', page: 607, chunk: 7,
      subject_label: '氯化钠', text: '氯化钠在水溶液中咸味阈值3.90mmol/L。',
    },
    {
      id: 'book-flavor-chemistry-p0437-b03', book_title: '酒类风味化学', page: 437, chunk: 3,
      subject_label: 'y-Glu-Ile', text: '水溶液中涩味阈值2.3mmol/L，氯化钠-L-谷氨酸单钠。',
    },
  ];

  const results = searchBookIndex({
    records,
    rawQueries: ['氯化钠'],
    bookEntities: [entity],
    exactMatch: true,
  });

  assert.deepEqual(results.map(item => item.page), [607]);
  assert.equal(results[0].entity.cas, '7647-14-5');
});

test('exact entity hit includes direct CAS and verified name-only thresholds', () => {
  const entity = {
    cas: '7647-14-5',
    chinese_name: '氯化钠',
    english_names: ['sodium chloride'],
    aliases: ['氯化钠', 'sodium chloride'],
  };
  const hit = { page: 607, chunks: [7, 8], matched_entity_cas: '7647-14-5', entity };
  const thresholds = [
    { page: 607, record_id: 'book-flavor-chemistry-p0607-b07', entity_cas: '7647-14-5' },
    {
      page: 607,
      record_id: 'book-flavor-chemistry-p0607-b08',
      entity_cas: null,
      subject_label: '氯化钠',
      subject_resolution: { resolution_type: 'source_verified_context_subject', subject_label: '氯化钠' },
    },
    { page: 607, record_id: 'book-flavor-chemistry-p0607-b08', entity_cas: null, subject_label: '氯化钾' },
  ];

  assert.deepEqual(getThresholdsForBookHit(thresholds, hit), thresholds.slice(0, 2));
});

test('exact Chinese-name search uses the matched compound CAS to exclude other entities', () => {
  const records = [
    { id: 'target', page: 10, chunk: 1, entity_cas: '141-78-6', text: '乙酸乙酯在啤酒中阈值。' },
    { id: 'other', page: 11, chunk: 1, entity_cas: '123-96-6', text: '乙酸乙酯相关的仲辛醇资料。' },
  ];
  const results = searchBookIndex({
    records,
    rawQueries: ['乙酸乙酯'],
    matchedCompounds: [{ cas: '141-78-6', chinese_name: '乙酸乙酯' }],
    exactMatch: true,
  });
  assert.deepEqual(results.map(item => item.page), [10]);
});

test('exact English-name search uses the matched compound CAS to exclude other entities', () => {
  const records = [
    { id: 'target', page: 50, chunk: 10, entity_cas: '123-96-6', text: '2-Octanol 在啤酒中气味阈值。' },
    { id: 'other', page: 51, chunk: 3, entity_cas: '141-78-6', text: '2-Octanol 相关的乙酸乙酯资料。' },
  ];
  const results = searchBookIndex({
    records,
    rawQueries: ['2-octanol'],
    matchedCompounds: [{ cas: '123-96-6', chinese_name: '仲辛醇', english_name: '2-octanol' }],
    exactMatch: true,
  });
  assert.deepEqual(results.map(item => item.page), [50]);
});

test('exact Chinese name does not include similarly named ester entities', () => {
  const entities = [
    { cas: '141-78-6', chinese_name: '乙酸乙酯', english_names: ['ethyl acetate'] },
    { cas: '623-??-?', chinese_name: '硫代乙酸乙酯', english_names: ['ethyl thioacetate'] },
    { cas: '102-??-?', chinese_name: '苯乙酸乙酯', english_names: ['ethyl phenylacetate'] },
  ];
  const records = entities.map((entity, index) => ({
    id: entity.cas, page: index + 1, chunk: 1, entity_cas: entity.cas,
    text: `${entity.chinese_name} 原文记录。乙酸乙酯相关描述。`,
  }));
  const results = searchBookIndex({ records, rawQueries: ['乙酸乙酯'], bookEntities: entities, exactMatch: true });
  assert.deepEqual(results.map(item => item.page), [1]);
});

test('book thresholds group by fixed medium-system order and preserve original media', () => {
  const thresholds = [
    { media: ['果汁'] },
    { media: ['啤酒'] },
    { media: ['空气'] },
    { media: ['葡萄酒'] },
    { media: ['乙醇-水'], medium_detail: '10%vol' },
    { media: ['水'] },
  ];

  const groups = groupBookThresholds(thresholds);
  assert.deepEqual(groups.map(group => group.key), ['air', 'water', 'ethanolWater', 'wine', 'beer', 'other']);
  assert.equal(groups.at(-1).thresholds[0].media[0], '果汁');
});

test('book source summary deduplicates pages and blocks and reports corrections', () => {
  const summary = summarizeBookSources([
    { page: 607, record_id: 'book-flavor-chemistry-p0607-b07', source_corrections: [] },
    { page: 607, record_id: 'book-flavor-chemistry-p0607-b08', source_corrections: [{ reason: 'verified_against_source_page' }] },
    { page: 608, record_id: 'book-flavor-chemistry-p0608-b02', source_corrections: [] },
  ]);

  assert.deepEqual(summary.pages, [607, 608]);
  assert.deepEqual(summary.blocks, [{ page: 607, block: 7 }, { page: 607, block: 8 }, { page: 608, block: 2 }]);
  assert.equal(summary.hasSourceCorrection, true);
});

test('book display CAS falls back to a source-verified canonical subject CAS', () => {
  assert.equal(getBookDisplayCas({}, [{
    subject_resolution: {
      resolution_type: 'source_verified_context_subject',
      canonical_cas: '7647-14-5',
    },
  }]), '7647-14-5');
  assert.equal(getBookDisplayCas({ entity: { cas: '141-78-6' } }, []), '141-78-6');
});

test('book threshold row keys remain unique across medium groups from the same source block', () => {
  const threshold = { page: 607, record_id: 'book-flavor-chemistry-p0607-b08' };
  assert.notEqual(
    getBookThresholdRowKey(threshold, 'wine', 0),
    getBookThresholdRowKey(threshold, 'other', 0),
  );
});

test('book hits for one CAS merge into one card with all source pages', () => {
  const results = mergeBookHitsByEntity([
    { id: 'p50', page: 50, chunk: 10, matched_entity_cas: '123-96-6', entity: { cas: '123-96-6' }, text: 'page 50' },
    { id: 'p51', page: 51, chunk: 2, matched_entity_cas: '123-96-6', entity: { cas: '123-96-6' }, text: 'page 51' },
    { id: 'p60', page: 60, chunk: 1, matched_entity_cas: '141-78-6', entity: { cas: '141-78-6' }, text: 'other' },
  ]);

  assert.equal(results.length, 2);
  assert.deepEqual(results[0].pages, [50, 51]);
  assert.deepEqual(results[0].source_hits.map(hit => hit.page), [50, 51]);
  assert.match(results[0].text, /page 50/);
  assert.match(results[0].text, /page 51/);
});

test('real index supports CAS-to-English-name expansion without duplicate pages', async () => {
  const [bookPayload, thresholdData] = await Promise.all([
    loadJson('../public/book_flavor_chemistry_index.json'),
    loadJson('../public/aroma_data_merged.json'),
  ]);
  const compounds = thresholdData.filter(item => item.cas === '141-78-6');
  assert.ok(compounds.length > 0, 'expected ethyl acetate in threshold data');

  const results = searchBookIndex({
    records: bookPayload.records,
    rawQueries: ['141-78-6'],
    matchedCompounds: compounds,
  });

  assert.ok(results.length > 0, 'expected book hits through expanded compound names');
  assert.equal(new Set(results.map(item => item.page)).size, results.length);
  assert.ok(results.some(item => item.matchReasonCodes.includes('englishName')));
});

test('real index exposes source-verified alpha-pinene identity correction to the website', async () => {
  const bookPayload = await loadJson('../public/book_flavor_chemistry_index.json');
  const results = searchBookIndex({
    records: bookPayload.records,
    rawQueries: ['80-56-8'],
    bookEntities: bookPayload.entities,
  });
  const page511 = results.find(item => item.page === 511);
  assert.ok(page511, 'expected corrected alpha-pinene page');
  assert.equal(page511.matched_entity_cas, '80-56-8');
  assert.equal(page511.entity?.chinese_name, 'α-蒎烯');
  assert.equal(page511.identity_correction?.corrected_cas, '80-56-8');
  const thresholds = getThresholdsForBookHit(bookPayload.thresholds, page511);
  assert.ok(thresholds.some(item => item.threshold_type === 'detection'));
  assert.ok(thresholds.every(item => item.entity_cas === '80-56-8'));
});

test('real index searches source-verified rows from every detected book table', async () => {
  const bookPayload = await loadJson('../public/book_flavor_chemistry_index.json');
  assert.equal(bookPayload.tables.length, 17);
  assert.ok(bookPayload.tables.every(table => table.structure_status === 'source_verified_rows'));
  assert.equal(bookPayload.tables.reduce((sum, table) => sum + table.rows.length, 0), 180);
  const results = searchBookIndex({
    records: bookPayload.records,
    rawQueries: ['1-p-孟烯-8-硫醇'],
    bookEntities: bookPayload.entities,
  });
  assert.ok(results.some(item => item.page === 20 && item.table_metadata?.table_id === '1-2'));
});
