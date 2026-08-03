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
  thresholds: { media: ['空气', '水', '其他介质'], types: ['d', 'r'], includeBooks: true },
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
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/);
  if (!match) return { value: null, unit: text || null };
  return { value: Number(match[1]), unit: match[2].trim() || null };
};

const thresholdSources = (matchedResults, integratedResults) => {
  const matched = asArray(matchedResults).filter(Boolean);
  if (matched.length) return matched;
  return asArray(integratedResults).map(getItem).filter(Boolean);
};

const toThresholdRecords = (matchedResults, integratedResults) => thresholdSources(matchedResults, integratedResults)
  .flatMap((item) => asArray(item.threshold_data).map((entry) => {
    const parsed = parseThreshold(entry?.threshold ?? entry?.value);
    const thresholdType = entry?.type ?? entry?.threshold_type ?? item.threshold_type ?? null;
    return {
      cas: item.cas ?? entry?.cas ?? null,
      medium: item.medium ?? entry?.medium ?? null,
      type: thresholdType,
      thresholdType,
      value: parsed.value,
      unit: entry?.unit ?? parsed.unit,
      source: entry?.reference ?? entry?.source ?? item.reference ?? null,
      originalText: entry?.original_text ?? entry?.originalText ?? entry?.threshold ?? null,
      sourceRecordKey: entry?.source_record_key ?? entry?.sourceRecordKey ?? null,
      raw: entry,
    };
  }));

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
    if (types && !types.has(record.thresholdType ?? record.type)) return false;
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

const coverageFor = (item) => {
  const thresholdCount = asArray(item?.threshold_data).length;
  return {
    matched: Boolean(item),
    thresholdRecords: thresholdCount,
    hasThresholds: thresholdCount > 0,
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
    const exact = candidates.find((item) => normaliseCas(item.cas) === cas && cas !== '');
    const normalizedName = normaliseText(originalInput);
    const candidate = exact ?? candidates.find((item) => matchedNames(item).includes(normalizedName) && normalizedName !== '');
    const status = exact ? 'exact' : candidate ? 'candidate' : 'unmatched';
    return {
      id: `${inputKey}:${occurrence}`,
      originalInput,
      normalizedName,
      cas: candidate?.cas ?? (/^\d{2,7}-\d{2}-\d$/.test(cas) ? cas : null),
      status,
      coverage: coverageFor(candidate),
      issues: status === 'unmatched' ? ['no_match'] : status === 'candidate' ? ['name_match_not_cas'] : [],
      raw: candidate ?? null,
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
