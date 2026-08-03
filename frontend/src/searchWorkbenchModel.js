export const CHAPTERS = Object.freeze([
  Object.freeze({ id: 'overview', zh: '概览', en: 'Overview' }),
  Object.freeze({ id: 'sensory', zh: '感官', en: 'Sensory' }),
  Object.freeze({ id: 'thresholds', zh: '阈值', en: 'Thresholds' }),
  Object.freeze({ id: 'spectra', zh: '光谱', en: 'Spectra' }),
  Object.freeze({ id: 'biochemistry', zh: '生物化学', en: 'Biochemistry' }),
  Object.freeze({ id: 'bioactivity', zh: '生物活性', en: 'Bioactivity' }),
  Object.freeze({ id: 'structures', zh: '结构', en: 'Structures' }),
  Object.freeze({ id: 'citation', zh: '引文', en: 'Citation' }),
]);

const freezeFilters = (value) => {
  Object.values(value).forEach((chapter) => {
    Object.values(chapter).forEach((setting) => {
      if (Array.isArray(setting)) Object.freeze(setting);
    });
    Object.freeze(chapter);
  });
  return Object.freeze(value);
};

export const DEFAULT_CHAPTER_FILTERS = freezeFilters({
  sensory: { sources: ['FEMA', 'FlavorDB'] },
  thresholds: { media: ['空气', '水', '其他介质'], types: [], includeBooks: true },
  spectra: { sources: ['PubChem'], includeExperimental: true },
});

export const createDefaultChapterFilters = () => ({
  sensory: { ...DEFAULT_CHAPTER_FILTERS.sensory, sources: [...DEFAULT_CHAPTER_FILTERS.sensory.sources] },
  thresholds: {
    ...DEFAULT_CHAPTER_FILTERS.thresholds,
    media: [...DEFAULT_CHAPTER_FILTERS.thresholds.media],
    types: [...DEFAULT_CHAPTER_FILTERS.thresholds.types],
  },
  spectra: { ...DEFAULT_CHAPTER_FILTERS.spectra, sources: [...DEFAULT_CHAPTER_FILTERS.spectra.sources] },
});

const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

const sourceStateValue = (state) => {
  if (state && typeof state === 'object') return state.state ?? state.kind ?? state.status ?? state.phase;
  return state;
};

export function normalizeSourceStatus(state) {
  const source = state && typeof state === 'object' ? { ...state } : state === undefined ? {} : { state };
  const value = sourceStateValue(state);
  const normalized = value === undefined
    ? 'not_requested'
    : ['ready', 'partial', 'failed', 'loading', 'not_requested', 'no_data'].includes(value)
      ? value
      : value === 'no_data'
      ? 'no_data'
      : value === 'partial_failure'
        ? 'partial'
        : ['upstream_unavailable', 'error', 'timeout'].includes(value)
          ? 'failed'
          : value === 'ok'
            ? 'ready'
            : 'loading';
  return { ...source, status: normalized };
}

const sourceState = (status, labelZh, labelEn) => ({ status, labelZh, labelEn });

const compoundSourceStatus = (currentCas, compoundProfile, sourceName) => {
  if (!currentCas) return 'not_requested';
  if (!compoundProfile || compoundProfile.loading) return 'loading';
  if (compoundProfile.error) return 'failed';
  const source = compoundProfile[sourceName];
  if (!source) return 'not_requested';
  if (source.error) return 'failed';
  const normalized = normalizeSourceStatus(source).status;
  if (normalized !== 'not_requested') return normalized;
  if (source.found === true) return 'ready';
  if (source.found === false) return 'no_data';
  return 'not_requested';
};

export function deriveDossierSourceStates({
  loading = false,
  matchedResults = [],
  currentCas = null,
  femaProfile,
  compoundProfile,
} = {}) {
  const hasLocalThresholds = asArray(matchedResults)
    .some((item) => asArray(item?.threshold_data).length > 0);
  const localStatus = loading ? 'loading' : hasLocalThresholds ? 'ready' : 'no_data';
  const femaStatus = !currentCas
    ? 'not_requested'
    : !femaProfile || femaProfile.loading
      ? 'loading'
      : femaProfile.error
        ? 'failed'
        : femaProfile.found === false
          ? 'no_data'
          : 'ready';

  return {
    local_thresholds: sourceState(localStatus, '本地阈值', 'Local thresholds'),
    fema: sourceState(femaStatus, 'FEMA', 'FEMA'),
    pubchem: sourceState(compoundSourceStatus(currentCas, compoundProfile, 'pubchem'), 'PubChem', 'PubChem'),
    flavordb: sourceState(compoundSourceStatus(currentCas, compoundProfile, 'flavordb'), 'FlavorDB2', 'FlavorDB2'),
  };
}

const normaliseText = (value) => String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const normaliseCas = (value) => String(value ?? '').trim();

const getItem = (entry) => entry?.item ?? entry?.compound ?? entry ?? {};
const getProfile = (entry) => entry?.profile ?? entry?.profiles ?? {};
const getPubChem = (entry) => {
  const profile = getProfile(entry);
  return profile.pubchem ?? entry?.pubchem ?? {};
};
const getFlavorDb = (entry) => {
  const profile = getProfile(entry);
  return profile.flavordb ?? entry?.flavordb ?? {};
};

const chapter = (records = []) => ({ records });

const parseThreshold = (value) => {
  if (typeof value === 'number') return { value, unit: null };
  const text = String(value ?? '').trim();
  const match = text.replace(/,/g, '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*[eE][+-]?\d+)?/);
  if (!match) return { value: null, unit: text || null };
  const valueText = match[0].replace(/\s+/g, '');
  const remainder = text.slice((match.index ?? 0) + match[0].length);
  const unitMatch = remainder.match(/^\s*([A-Za-zµμ]+(?:\s*\/\s*[A-Za-z0-9^]+)?)/);
  return { value: Number(valueText), unit: unitMatch?.[1]?.replace(/\s+/g, '') ?? null };
};

const parseStringThreshold = (raw) => {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  const typeMatch = /(?:^|\s)([dr])\s+(.+)$/i.exec(trimmed);
  const parseReliableValue = (thresholdText) => {
    if (/\d+[.,]\d+\s+\d+/.test(thresholdText)) {
      return { value: null, unit: null, parseStatus: 'unparsed' };
    }
    const parsed = parseThreshold(thresholdText);
    const looksLikeYear = Number.isInteger(parsed.value) && parsed.value >= 1800 && parsed.value <= 2099;
    return looksLikeYear ? { value: null, unit: null, parseStatus: 'unparsed' } : { ...parsed, parseStatus: 'parsed' };
  };
  if (typeMatch) {
    const thresholdText = typeMatch[2].trim();
    return {
      source: trimmed.slice(0, typeMatch.index).trim() || null,
      type: typeMatch[1].toLowerCase(),
      ...parseReliableValue(thresholdText),
    };
  }
  const startsWithThreshold = /^(?:[<>≤≥]\s*)?[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.test(trimmed);
  return {
    source: null,
    type: null,
    ...(startsWithThreshold ? parseReliableValue(trimmed) : { value: null, unit: null, parseStatus: 'unparsed' }),
  };
};

const entityKeyFor = (item) => {
  const cas = normaliseCas(item?.cas);
  if (cas) return `cas:${cas}`;
  if (item?.cid != null) return `cid:${item.cid}`;
  return `name:${normaliseText(item?.english_name ?? item?.chinese_name)}`;
};

const thresholdSources = (matchedResults, integratedResults) => [
  ...asArray(matchedResults).filter(Boolean).map((item) => ({ item, origin: 'matched' })),
  ...asArray(integratedResults).map(getItem).filter(Boolean).map((item) => ({ item, origin: 'integrated' })),
];

const thresholdSignature = (record) => [
  record.cas ?? '',
  record.medium ?? '',
  record.type ?? '',
  record.value ?? '',
  record.unit ?? '',
  record.source ?? '',
  normaliseText(record.originalText),
  record.sourceRecordKey ?? '',
].join('|');

const toThresholdRecords = (matchedResults, integratedResults) => {
  const seenOrigins = new Map();
  const occurrences = new Map();
  return thresholdSources(matchedResults, integratedResults).flatMap(({ item, origin }) => {
    const entityKey = entityKeyFor(item);
    return asArray(item.threshold_data).flatMap((entry) => {
      const stringEntry = typeof entry === 'string';
      const parsedString = stringEntry ? parseStringThreshold(entry) : null;
      const parsed = stringEntry ? parsedString : parseThreshold(entry?.threshold ?? entry?.value);
      const thresholdType = stringEntry
        ? parsedString.type
        : entry?.type ?? entry?.threshold_type ?? item.threshold_type ?? null;
      const originalText = stringEntry
        ? entry
        : entry?.original_text ?? entry?.originalText ?? entry?.threshold ?? null;
      const record = {
        cas: item.cas ?? entry?.cas ?? null,
        medium: item.medium ?? entry?.medium ?? null,
        type: thresholdType,
        thresholdType,
        value: parsed.value,
        unit: entry?.unit ?? parsed.unit,
        source: entry?.reference ?? entry?.source ?? parsedString?.source ?? item.reference ?? null,
        originalText,
        sourceRecordKey: entry?.source_record_key ?? entry?.sourceRecordKey ?? null,
        raw: entry,
        ...(stringEntry ? { parseStatus: parsedString.parseStatus } : {}),
      };
      const signature = `${entityKey}|${thresholdSignature(record)}`;
      const origins = seenOrigins.get(signature) ?? new Set();
      if (origins.size > 0 && !origins.has(origin)) return [];
      origins.add(origin);
      seenOrigins.set(signature, origins);
      const idBase = record.sourceRecordKey ?? `${record.cas ?? entityKey}|${record.medium ?? ''}|${normaliseText(originalText)}`;
      const occurrence = occurrences.get(idBase) ?? 0;
      occurrences.set(idBase, occurrence + 1);
      return [{ ...record, id: record.sourceRecordKey && occurrence === 0 ? record.sourceRecordKey : `${idBase}:${occurrence}` }];
    });
  });
};

const toSensoryRecords = (integratedResults) => asArray(integratedResults).flatMap((entry) => {
  const fema = entry?.fema ?? {};
  const flavorDb = getFlavorDb(entry);
  const records = [];
  if (fema.flavor_profile != null) records.push({ source: 'FEMA', descriptors: fema.flavor_profile, raw: fema });
  if (flavorDb.flavor_profile != null || flavorDb.descriptors != null) {
    records.push({ source: 'FlavorDB', descriptors: flavorDb.flavor_profile ?? flavorDb.descriptors, raw: flavorDb });
  }
  return records;
});

const toIntegratedRecords = (integratedResults, fieldNames) => asArray(integratedResults).flatMap((entry) => {
  const profile = getProfile(entry);
  return fieldNames.flatMap((name) => {
    const value = profile[name] ?? entry?.[name];
    return value == null ? [] : [{ source: name, data: value, raw: value }];
  });
});

export function buildCompoundDossier({
  matchedResults = [],
  integratedResults = [],
  bookResults = [],
  sourceStates = {},
} = {}) {
  const matched = asArray(matchedResults).filter(Boolean);
  const integrated = asArray(integratedResults).filter(Boolean);
  const primaryEntry = integrated[0];
  const primaryItem = getItem(primaryEntry ?? matched[0] ?? {});
  const pubchem = getPubChem(primaryEntry);
  const flavorDb = getFlavorDb(primaryEntry);
  const cas = primaryItem.cas ?? null;
  const cid = pubchem.cid ?? flavorDb.cid ?? primaryItem.cid ?? null;
  const chineseName = primaryItem.chinese_name ?? primaryItem.chineseName ?? null;
  const englishName = primaryItem.english_name ?? primaryItem.englishName ?? primaryItem.common_english_name ?? null;
  const molecularFormula = pubchem.molecular_formula ?? pubchem.molecularFormula ?? primaryItem.molecular_formula ?? null;
  const normalizedSourceStates = Object.fromEntries(
    Object.entries(sourceStates && typeof sourceStates === 'object' ? sourceStates : {})
      .map(([name, state]) => [name, normalizeSourceStatus(state)]),
  );

  return {
    identity: {
      entityKey: cas ?? (cid == null ? normaliseText(englishName || chineseName) || null : `cid:${cid}`),
      cas,
      cid,
      chineseName,
      englishName,
      molecularFormula,
      raw: primaryItem,
    },
    sourceStates: normalizedSourceStates,
    overview: chapter(),
    sensory: chapter(toSensoryRecords(integrated)),
    thresholds: chapter(toThresholdRecords(matched, integrated)),
    spectra: chapter(toIntegratedRecords(integrated, ['spectra', 'pubchem_spectra'])),
    biochemistry: chapter(toIntegratedRecords(integrated, ['biochemistry', 'pathways'])),
    bioactivity: chapter(toIntegratedRecords(integrated, ['bioactivity', 'activities'])),
    structures: chapter(toIntegratedRecords(integrated, ['pubchem', 'structures'])),
    citation: chapter(asArray(bookResults).filter(Boolean).map((record) => ({ raw: record }))),
  };
}

export function filterThresholdRecords(records, filters = {}) {
  const media = filters.media == null ? null : new Set(filters.media);
  const types = filters.types == null ? null : new Set(filters.types);
  const includeBooks = filters.includeBooks ?? true;
  return asArray(records).filter((record) => {
    if (media && !media.has(record.medium)) return false;
    if (types?.size && !types.has(record.thresholdType ?? record.type)) return false;
    const isBook = record.sourceKind === 'book' || record.isBook === true || record.source === 'book';
    return includeBooks || !isBook;
  });
}

const matchedNames = (item) => [
  item?.chinese_name,
  item?.chineseName,
  item?.english_name,
  item?.englishName,
  item?.common_english_name,
  item?.commonName,
].map(normaliseText).filter(Boolean);

const coverageFor = (items) => {
  const matches = asArray(items).filter(Boolean);
  const recordsByItem = matches.map((item) => ({ item, count: asArray(item.threshold_data).length }));
  const media = [...new Set(recordsByItem
    .filter(({ count }) => count > 0)
    .map(({ item }) => item.medium)
    .filter(Boolean))];
  const thresholdRecordCount = recordsByItem.reduce((total, { count }) => total + count, 0);
  return {
    thresholdRecordCount,
    media,
    coverage: media.length,
  };
};

export function buildBatchReviewRows(rawInputs, matchedResults) {
  const occurrences = new Map();
  const candidates = asArray(matchedResults).filter(Boolean);
  return asArray(rawInputs).map((input) => {
    const originalInput = String(input ?? '');
    const inputKey = normaliseText(originalInput) || 'empty';
    const occurrence = occurrences.get(inputKey) ?? 0;
    occurrences.set(inputKey, occurrence + 1);
    const cas = normaliseCas(originalInput);
    const exactMatches = candidates.filter((item) => normaliseCas(item.cas) === cas && cas !== '');
    const normalizedName = normaliseText(originalInput);
    const nameMatches = candidates.filter((item) => matchedNames(item).includes(normalizedName) && normalizedName !== '');
    const candidateCas = [...new Set(nameMatches.map((item) => normaliseCas(item.cas)).filter(Boolean))];
    const ambiguous = exactMatches.length === 0 && candidateCas.length > 1;
    const matches = exactMatches.length > 0 ? exactMatches : nameMatches;
    const status = exactMatches.length > 0 ? 'exact' : matches.length > 0 ? 'candidate' : 'unmatched';
    const coverage = coverageFor(matches);
    return {
      id: `${inputKey}:${occurrence}`,
      originalInput,
      normalizedName,
      cas: ambiguous ? null : matches[0]?.cas ?? (/^\d{2,7}-\d{2}-\d$/.test(cas) ? cas : null),
      status,
      thresholdRecordCount: coverage.thresholdRecordCount,
      media: coverage.media,
      coverage: coverage.coverage,
      issues: status === 'unmatched' ? ['no_match'] : status === 'candidate' ? [
        'name_match_not_cas',
        ...(ambiguous ? ['ambiguous_identity'] : []),
      ] : [],
      matches,
      raw: matches,
    };
  });
}

const compareValues = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), 'en', { numeric: true, sensitivity: 'base' });

export function sortBatchRows(rows, { key = 'reviewPriority', direction = 'asc' } = {}) {
  const multiplier = direction === 'desc' ? -1 : 1;
  const priority = { unmatched: 0, candidate: 1, exact: 2 };
  return asArray(rows).map((row, index) => ({ row, index })).sort((left, right) => {
    const compared = key === 'reviewPriority'
      ? (priority[left.row.status] ?? 99) - (priority[right.row.status] ?? 99)
      : compareValues(left.row[key], right.row[key]);
    if (compared) return compared * multiplier;
    const byId = compareValues(left.row.id, right.row.id);
    return byId ? byId * multiplier : left.index - right.index;
  }).map(({ row }) => row);
}
