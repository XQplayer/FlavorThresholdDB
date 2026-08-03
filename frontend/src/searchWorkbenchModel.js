export const CHAPTERS = Object.freeze([
  Object.freeze({ id: 'overview', zh: '概览', en: 'Overview' }),
  Object.freeze({ id: 'sensory', zh: '感官', en: 'Sensory' }),
  Object.freeze({ id: 'thresholds', zh: '阈值', en: 'Thresholds' }),
  Object.freeze({ id: 'spectra', zh: '光谱', en: 'Spectra' }),
  Object.freeze({ id: 'biochemistry', zh: '生化关系', en: 'Biochemical relationships' }),
  Object.freeze({ id: 'bioactivity', zh: '活性与靶点', en: 'Bioactivity and targets' }),
  Object.freeze({ id: 'structures', zh: '蛋白结构', en: 'Protein structures' }),
  Object.freeze({ id: 'citation', zh: '引用与导出', en: 'Citation and export' }),
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
  sensory: { sources: null, kinds: null },
  thresholds: { media: null, types: null, includeBooks: true, bookOnly: false },
  spectra: { sources: ['PubChem'], includeExperimental: true },
});

export const createDefaultChapterFilters = () => ({
  sensory: { ...DEFAULT_CHAPTER_FILTERS.sensory },
  thresholds: {
    ...DEFAULT_CHAPTER_FILTERS.thresholds,
    media: DEFAULT_CHAPTER_FILTERS.thresholds.media,
    types: DEFAULT_CHAPTER_FILTERS.thresholds.types,
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
            : 'not_requested';
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
  bookResults = [],
} = {}) {
  const matched = asArray(matchedResults);
  const hasEntity = Boolean(currentCas) || matched.length > 0;
  const hasLocalThresholds = matched
    .some((item) => asArray(item?.threshold_data).length > 0);
  const localStatus = loading ? 'loading' : hasLocalThresholds ? 'ready' : 'no_data';
  const hasObservedFema = femaProfile && Object.keys(femaProfile).some(key => key !== 'loading');
  const femaStatus = !currentCas
    ? 'not_requested'
    : !femaProfile || femaProfile.loading
      ? 'loading'
      : femaProfile.error
        ? 'failed'
        : femaProfile.found === false
          ? 'no_data'
          : hasObservedFema
            ? 'ready'
            : 'not_requested';
  const bookStatus = loading
    ? 'loading'
    : !hasEntity
      ? 'not_requested'
      : asArray(bookResults).length > 0
        ? 'ready'
        : 'no_data';

  return {
    local_thresholds: sourceState(localStatus, '本地阈值', 'Local thresholds'),
    fema: sourceState(femaStatus, 'FEMA', 'FEMA'),
    pubchem: sourceState(compoundSourceStatus(currentCas, compoundProfile, 'pubchem'), 'PubChem', 'PubChem'),
    flavordb: sourceState(compoundSourceStatus(currentCas, compoundProfile, 'flavordb'), 'FlavorDB2', 'FlavorDB2'),
    book: sourceState(bookStatus, '书籍证据', 'Book evidence'),
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

export function compoundEntityKey(item) {
  const entity = getItem(item);
  const cas = normaliseCas(entity?.cas);
  if (cas) return `cas:${cas}`;
  const name = entity?.english_name
    ?? entity?.englishName
    ?? entity?.common_english_name
    ?? entity?.chinese_name
    ?? entity?.chineseName;
  return `name:${normaliseText(name)}`;
}

export function buildWorkbenchIntegratedResults({
  matchedResults = [],
  femaProfiles = {},
  compoundProfiles = {},
} = {}) {
  const seen = new Set();
  return asArray(matchedResults).filter(Boolean).flatMap((item) => {
    const entityKey = compoundEntityKey(item);
    if (entityKey === 'name:' || seen.has(entityKey)) return [];
    seen.add(entityKey);
    return [{
      item,
      fema: item.cas ? femaProfiles[item.cas] || {} : {},
      profile: item.cas ? compoundProfiles[item.cas] || {} : {},
    }];
  });
}

export function selectProfileRequestCas({
  matchedResults = [],
  searchMode = 'single',
  selectedCas = null,
  bulkLimit = 10,
} = {}) {
  const uniqueCas = [...new Set(asArray(matchedResults)
    .map(item => normaliseCas(item?.cas))
    .filter(Boolean))];
  if (searchMode !== 'bulk') {
    return [uniqueCas.includes(selectedCas) ? selectedCas : uniqueCas[0]].filter(Boolean);
  }
  return uniqueCas.slice(0, bulkLimit);
}

const bookRecordValues = (record, field) => [
  record?.[field],
  record?.entity?.[field],
  ...asArray(record?.source_hits).flatMap(hit => [hit?.[field], hit?.entity?.[field]]),
].filter(Boolean);

const groupNames = group => [group.chineseName, group.englishName].map(normaliseText).filter(Boolean);

const bookBelongsToGroup = (record, group, nameOwners) => {
  const casValues = [
    ...bookRecordValues(record, 'matched_entity_cas'),
    ...bookRecordValues(record, 'entity_cas'),
    ...bookRecordValues(record, 'cas'),
    ...asArray(record?.entity_cas_list),
  ].map(normaliseCas).filter(Boolean);
  if (casValues.length > 0) return Boolean(group.cas) && casValues.includes(group.cas);
  const normalizedGroupNames = new Set(groupNames(group));
  const bookNames = [
    ...bookRecordValues(record, 'matched_subject_label'),
    ...bookRecordValues(record, 'subject_label'),
    ...bookRecordValues(record, 'name'),
  ].map(normaliseText).filter(Boolean);
  return bookNames.some(name => normalizedGroupNames.has(name) && nameOwners.get(name)?.size === 1);
};

export function groupDossierInputsByEntity({
  matchedResults = [],
  integratedResults = [],
  bookResults = [],
} = {}) {
  const groups = new Map();
  asArray(matchedResults).filter(Boolean).forEach((item) => {
    const entityKey = compoundEntityKey(item);
    if (entityKey === 'name:') return;
    if (!groups.has(entityKey)) {
      groups.set(entityKey, {
        entityKey,
        cas: normaliseCas(item.cas) || null,
        chineseName: item.chinese_name ?? item.chineseName ?? null,
        englishName: item.english_name ?? item.englishName ?? item.common_english_name ?? null,
        matchReason: item.cas ? 'cas' : 'name',
        matchedResults: [],
      });
    }
    groups.get(entityKey).matchedResults.push(item);
  });

  const nameOwners = new Map();
  for (const group of groups.values()) {
    for (const name of groupNames(group)) {
      if (!nameOwners.has(name)) nameOwners.set(name, new Set());
      nameOwners.get(name).add(group.entityKey);
    }
  }

  return [...groups.values()].map(group => ({
    ...group,
    recordCount: group.matchedResults.reduce(
      (total, item) => total + asArray(item.threshold_data).length,
      0,
    ),
    integratedResults: asArray(integratedResults)
      .filter(entry => compoundEntityKey(getItem(entry)) === group.entityKey),
    bookResults: asArray(bookResults).filter(record => bookBelongsToGroup(record, group, nameOwners)),
  }));
}

export function summarizeChapterStatus({ recordCount = 0, sourceStates = [] } = {}) {
  const statuses = asArray(sourceStates).map(state => normalizeSourceStatus(state).status);
  if (statuses.includes('loading')) return 'loading';
  if (statuses.length === 0) return recordCount > 0 ? 'ready' : 'not_requested';
  if (statuses.every(status => status === 'failed')) return 'failed';
  if (statuses.every(status => status === 'not_requested')) return recordCount > 0 ? 'ready' : 'not_requested';
  if (recordCount === 0 && statuses.every(status => status === 'no_data')) return 'no_data';

  const hasReady = recordCount > 0 || statuses.includes('ready');
  const hasLimited = statuses.some(status => ['partial', 'failed', 'no_data'].includes(status));
  if (statuses.includes('partial') || (hasReady && hasLimited)) return 'partial';
  if (hasReady) return 'ready';
  if (statuses.includes('failed')) return statuses.includes('no_data') ? 'partial' : 'failed';
  if (statuses.includes('no_data')) return 'no_data';
  return 'not_requested';
}

const chapter = (records = []) => ({ records });

const parseThreshold = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0
      ? { value, unit: null }
      : { value: null, unit: null };
  }
  const text = String(value ?? '').trim();
  const exactMatch = /^([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s*([A-Za-zµμ%]+(?:\s*\/\s*[A-Za-z0-9µμ³^%-]+)?))?$/.exec(text);
  if (!exactMatch) return { value: null, unit: null };
  const numericText = exactMatch[1].replace(/,/g, '').replace(/\s+/g, '');
  const parsedValue = Number(numericText);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? { value: parsedValue, unit: exactMatch[2]?.replace(/\s+/g, '') ?? null }
    : { value: null, unit: null };
};

const parseStringThreshold = (raw) => {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  const typeMatch = /(?:^|\s)([dr])\s+(.+)$/i.exec(trimmed);
  const parseReliableValue = (thresholdText) => {
    const parsed = parseThreshold(thresholdText);
    const looksLikeYear = Number.isInteger(parsed.value) && parsed.value >= 1800 && parsed.value <= 2099;
    return parsed.value == null || looksLikeYear
      ? { value: null, unit: null, parseStatus: 'unparsed' }
      : { ...parsed, parseStatus: 'parsed' };
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

const foreignCasReferences = (entry, currentCas) => [
  ...String(entry ?? '').matchAll(/(?<!\d)(\d{2,7}-\d{2}-\d)(?!\d)/g),
].map(match => match[1]).filter(cas => cas !== normaliseCas(currentCas));

const hasExplicitThresholdSemantics = (entry) => {
  const text = String(entry ?? '').trim();
  if (parseStringThreshold(text).type != null) return true;
  return /(?:threshold|阈值)/i.test(text) && /\d/.test(text);
};

const toThresholdEvidence = (matchedResults, integratedResults) => {
  const seenOrigins = new Map();
  const seenCrossReferenceOrigins = new Map();
  const occurrences = new Map();
  const crossReferenceOccurrences = new Map();
  const records = [];
  const crossReferences = [];
  thresholdSources(matchedResults, integratedResults).forEach(({ item, origin }) => {
    const entityKey = entityKeyFor(item);
    asArray(item.threshold_data).forEach((entry) => {
      const stringEntry = typeof entry === 'string';
      const targetCases = stringEntry ? foreignCasReferences(entry, item.cas) : [];
      if (targetCases.length > 0 && !hasExplicitThresholdSemantics(entry)) {
        const signature = `${entityKey}|${item.medium ?? ''}|${normaliseText(entry)}|${targetCases.join(',')}`;
        const origins = seenCrossReferenceOrigins.get(signature) ?? new Set();
        if (origins.size > 0 && !origins.has(origin)) return;
        origins.add(origin);
        seenCrossReferenceOrigins.set(signature, origins);
        const idBase = `crossref:${entityKey}|${item.medium ?? ''}|${normaliseText(entry)}`;
        const occurrence = crossReferenceOccurrences.get(idBase) ?? 0;
        crossReferenceOccurrences.set(idBase, occurrence + 1);
        crossReferences.push({
          id: `${idBase}:${occurrence}`,
          raw: entry,
          originalText: entry,
          currentCas: normaliseCas(item.cas) || null,
          targetCas: targetCases[0],
          targetCases: [...new Set(targetCases)],
          medium: item.medium ?? null,
        });
        return;
      }
      const parsedString = stringEntry ? parseStringThreshold(entry) : null;
      const hasObjectQualifier = !stringEntry && (
        [entry?.comparator, entry?.operator, entry?.qualifier]
          .some(value => String(value ?? '').trim() !== '')
        || entry?.high != null
        || entry?.max != null
        || entry?.upper != null
        || asArray(entry?.range).length > 1
      );
      const parsed = stringEntry
        ? parsedString
        : hasObjectQualifier
          ? { value: null, unit: null }
          : parseThreshold(entry?.threshold ?? entry?.value);
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
        unit: parsed.value == null ? null : entry?.unit ?? parsed.unit,
        source: entry?.reference ?? entry?.source ?? parsedString?.source ?? item.reference ?? null,
        originalText,
        sourceRecordKey: entry?.source_record_key ?? entry?.sourceRecordKey ?? null,
        raw: entry,
        parseStatus: stringEntry
          ? parsedString.parseStatus
          : parsed.value == null ? 'unparsed' : 'parsed',
      };
      const signature = `${entityKey}|${thresholdSignature(record)}`;
      const origins = seenOrigins.get(signature) ?? new Set();
      if (origins.size > 0 && !origins.has(origin)) return;
      origins.add(origin);
      seenOrigins.set(signature, origins);
      const idBase = record.sourceRecordKey ?? `${record.cas ?? entityKey}|${record.medium ?? ''}|${normaliseText(originalText)}`;
      const occurrence = occurrences.get(idBase) ?? 0;
      occurrences.set(idBase, occurrence + 1);
      records.push({ ...record, id: record.sourceRecordKey && occurrence === 0 ? record.sourceRecordKey : `${idBase}:${occurrence}` });
    });
  });
  return { records, crossReferences };
};

const sensoryValues = (value) => asArray(value)
  .flatMap(item => typeof item === 'string' ? item.split(/[,;|]/) : [item])
  .map(item => String(item ?? '').trim())
  .filter(Boolean);

const toSensoryRecords = (integratedResults) => asArray(integratedResults).flatMap((entry) => {
  const fema = entry?.fema ?? {};
  const flavorDb = getFlavorDb(entry);
  const profile = getProfile(entry);
  const foodEntities = asArray(profile.flavordb2_entities?.entities ?? entry?.flavordb2_entities?.entities);
  const records = [];
  const addDescriptors = (source, informationType, value, raw) => {
    const descriptors = sensoryValues(value);
    if (descriptors.length > 0) {
      records.push({ source, sourceLabel: raw?.source ?? source, kind: informationType, informationType, descriptors, raw });
    }
  };
  addDescriptors('FEMA', 'flavor', fema.flavor_profile, fema);
  addDescriptors('FlavorDB', 'flavor', flavorDb.flavor_profile ?? flavorDb.descriptors, flavorDb);
  addDescriptors('FlavorDB', 'odor', flavorDb.odor, flavorDb);
  addDescriptors('FlavorDB', 'taste', flavorDb.taste, flavorDb);
  foodEntities.forEach((entity) => {
    if (!entity?.name) return;
    records.push({
      source: 'FlavorDB',
      sourceLabel: flavorDb.source ?? 'FlavorDB2',
      kind: 'food_entity',
      informationType: 'food_entity',
      descriptors: [String(entity.name)],
      naturalSource: entity.natural_source?.name ?? null,
      raw: entity,
    });
    if (entity.natural_source?.name) {
      records.push({
        source: 'FlavorDB',
        sourceLabel: flavorDb.source ?? 'FlavorDB2',
        kind: 'natural_source',
        informationType: 'natural_source',
        descriptors: [String(entity.natural_source.name)],
        relatedFoodEntity: String(entity.name),
        raw: entity,
      });
    }
  });
  return records;
});

const bookThresholdQuality = (record) => ({
  associationMethod: record?.association_method ?? null,
  associationConfidence: record?.association_confidence ?? null,
  reviewStatus: record?.review_status ?? null,
  reviewFlags: [...asArray(record?.review_flags)],
  sourceCorrections: [...asArray(record?.source_corrections)],
  subjectResolution: record?.subject_resolution ?? null,
});

const bookThresholdValue = (record, quality) => {
  const resolutionType = normaliseText(quality.subjectResolution?.resolution_type);
  const unreliable = quality.reviewFlags.length > 0
    || (quality.reviewStatus != null && quality.reviewStatus !== 'clean')
    || quality.associationConfidence === 'low'
    || resolutionType.includes('conflict')
    || resolutionType.includes('error');
  if (unreliable) return { value: null, unit: null };
  const values = asArray(record?.values).filter(value => value?.role == null || value.role === 'threshold');
  if (values.length !== 1 || values[0].high != null) return { value: null, unit: null };
  const parsed = Number(values[0].low);
  return Number.isFinite(parsed) && parsed > 0
    ? { value: parsed, unit: values[0].unit ?? null }
    : { value: null, unit: null };
};

const toBookThresholdRecords = (bookThresholds) => asArray(bookThresholds).filter(Boolean).map((entry, index) => {
  const recordId = entry.record_id ?? entry.source_record_key ?? `record-${index}`;
  const blockMatch = String(recordId).match(/-b(\d+)$/);
  const quality = bookThresholdQuality(entry);
  return {
    id: `book:${recordId}:${index}`,
    cas: entry.entity_cas ?? entry.subject_resolution?.canonical_cas ?? null,
    medium: asArray(entry.media).filter(Boolean)[0] ?? null,
    type: entry.threshold_type ?? null,
    thresholdType: entry.threshold_type ?? null,
    ...bookThresholdValue(entry, quality),
    source: '酒类风味化学',
    sourceKind: 'book',
    originalText: entry.raw_text ?? null,
    sourceRecordKey: recordId,
    page: Number.isFinite(entry.page) ? entry.page : null,
    block: blockMatch ? Number(blockMatch[1]) : null,
    quality,
    raw: entry,
  };
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
  bookThresholds = [],
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
  const commonName = pubchem.title ?? pubchem.name ?? primaryItem.common_name ?? primaryItem.commonName ?? englishName;
  const molecularFormula = pubchem.molecular_formula ?? pubchem.molecularFormula ?? primaryItem.molecular_formula ?? null;
  const inchikey = pubchem.inchi_key ?? pubchem.inchikey ?? primaryItem.inchi_key ?? primaryItem.inchikey ?? null;
  const smiles = pubchem.smiles ?? pubchem.canonical_smiles ?? primaryItem.smiles ?? null;
  const normalizedSourceStates = Object.fromEntries(
    Object.entries(sourceStates && typeof sourceStates === 'object' ? sourceStates : {})
      .map(([name, state]) => [name, normalizeSourceStatus(state)]),
  );
  const thresholdEvidence = toThresholdEvidence(matched, integrated);

  return {
    identity: {
      entityKey: cas ?? (cid == null ? normaliseText(englishName || chineseName) || null : `cid:${cid}`),
      cas,
      cid,
      chineseName,
      englishName,
      commonName,
      molecularFormula,
      inchikey,
      smiles,
      raw: primaryItem,
    },
    sourceStates: normalizedSourceStates,
    overview: chapter(),
    sensory: chapter(toSensoryRecords(integrated)),
    thresholds: {
      records: [...thresholdEvidence.records, ...toBookThresholdRecords(bookThresholds)],
      crossReferences: thresholdEvidence.crossReferences,
    },
    spectra: chapter(toIntegratedRecords(integrated, ['spectra', 'pubchem_spectra'])),
    biochemistry: chapter(toIntegratedRecords(integrated, ['biochemistry', 'pathways'])),
    bioactivity: chapter(toIntegratedRecords(integrated, ['bioactivity', 'activities'])),
    structures: chapter(toIntegratedRecords(integrated, ['structures'])),
    citation: chapter(asArray(bookResults).filter(Boolean).map((record) => ({ raw: record }))),
  };
}

export function filterSensoryRecords(records, filters = {}) {
  const sources = filters.sources == null ? null : new Set(filters.sources);
  const kinds = filters.kinds == null ? null : new Set(filters.kinds);
  return asArray(records).filter(record => (
    (!sources || sources.has(record.source))
    && (!kinds || kinds.has(record.kind))
  ));
}

const thresholdMediumCategory = (medium) => {
  const text = normaliseText(medium);
  if (text.includes('空气') || text === 'air') return 'air';
  if (text === '水' || text === 'water' || text.includes('水溶液')) return 'water';
  if (/(酒|乙醇|酒精|ethanol|wine|beer)/i.test(text)) return 'alcohol';
  return 'other';
};

export function filterThresholdRecords(records, filters = {}) {
  const media = filters.media ?? null;
  const types = filters.types == null ? null : new Set(filters.types);
  const includeBooks = filters.includeBooks ?? true;
  const bookOnly = filters.bookOnly === true;
  return asArray(records).filter((record) => {
    const isBook = record.sourceKind === 'book' || record.isBook === true || record.source === 'book';
    if (bookOnly && !isBook) return false;
    if (media && thresholdMediumCategory(record.medium) !== media) return false;
    if (types?.size && !types.has(record.thresholdType ?? record.type)) return false;
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
