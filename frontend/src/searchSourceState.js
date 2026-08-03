const errorMessage = error => error?.message || String(error || 'Source unavailable');

const NEW_EXPORT_MEDIA = Object.freeze(['水', '空气', '其他介质']);

export function buildCsvExportContract({
  resultView,
  queryMatchedResults = [],
  classicResults = [],
  selectedMedia = [],
  selectedThresholdTypes = [],
  includePubChem = true,
  includeFlavorDB = true,
  includeFlavorDescriptions = true,
  includeBookResults = true,
} = {}) {
  if (resultView === 'new') {
    return {
      results: queryMatchedResults,
      media: [...NEW_EXPORT_MEDIA],
      thresholdTypes: null,
      includePubChem: true,
      includeFlavorDB: true,
      includeFlavorDescriptions: true,
      includeBookResults: true,
    };
  }

  return {
    results: classicResults,
    media: [...selectedMedia],
    thresholdTypes: [...selectedThresholdTypes],
    includePubChem,
    includeFlavorDB,
    includeFlavorDescriptions,
    includeBookResults,
  };
}

const childExportStatus = (compound, child) => {
  if (child?.found === true) return 'available';
  if (child?.error || compound?.error) return 'failed';
  if (!compound || compound.loading) return 'loading';
  return 'unavailable';
};

const bookHitMatchesCas = (hit, cas) => Boolean(cas) && [
  hit?.matched_entity_cas,
  hit?.entity?.cas,
  hit?.entity_cas,
  ...(hit?.entity_cas_list || []),
].includes(cas);

export function buildEntityExportSourceStatuses({
  item = {},
  femaProfile,
  compoundProfile,
  bookResults = [],
  bookLoading = false,
  bookError,
} = {}) {
  const entityHasBookEvidence = bookResults.some(hit => bookHitMatchesCas(hit, item.cas));
  const states = {
    local_thresholds: item.threshold_data?.length ? 'available' : 'unavailable',
    fema: femaProfile?.found === true
      ? 'available'
      : !femaProfile || femaProfile.loading
        ? 'loading'
        : femaProfile.error
          ? 'failed'
          : 'unavailable',
    pubchem: childExportStatus(compoundProfile, compoundProfile?.pubchem),
    flavordb: childExportStatus(compoundProfile, compoundProfile?.flavordb),
    book: entityHasBookEvidence
      ? 'available'
      : bookLoading
        ? 'loading'
        : bookError
          ? 'failed'
          : 'unavailable',
  };
  return Object.entries(states).map(([key, value]) => `${key}:${value}`).join('; ');
}

export function withRetryGeneration(url, generation = 0) {
  if (!(generation > 0)) return url;
  const separator = String(url).includes('?') ? '&' : '?';
  return `${url}${separator}_retry=${encodeURIComponent(generation)}`;
}

export function retryFetchOptions(generation = 0) {
  return generation > 0 ? { cache: 'no-store' } : undefined;
}

export function getExportClassification(profile, isEnglish = false) {
  const classification = profile?.smart_classification;
  if (classification?.reliable !== true) return { label: '', matches: [] };
  return {
    label: (isEnglish ? classification.en : classification.zh) || '',
    matches: Array.isArray(classification.matches)
      ? classification.matches.map(match => (isEnglish ? match?.en : match?.zh) || '').filter(Boolean)
      : [],
  };
}

export function beginFemaProfileRequest(previous, { retrying = false } = {}) {
  return retrying
    ? { ...(previous || {}), loading: true, retrying: true }
    : { loading: true, retrying: false };
}

export function failFemaProfileRequest(previous, error) {
  return {
    ...(previous || {}),
    found: previous?.found === true,
    loading: false,
    retrying: false,
    error: errorMessage(error),
  };
}

export function beginCompoundProfileRequest(previous, { retrying = false } = {}) {
  return retrying
    ? { ...(previous || {}), loading: true, retrying: true }
    : { loading: true, retrying: false };
}

const failedChild = (previous, message) => previous?.found === true
  ? previous
  : { ...(previous || {}), found: false, error: message };

export function failCompoundProfileRequest(previous, error) {
  const message = errorMessage(error);
  return {
    ...(previous || {}),
    loading: false,
    retrying: false,
    error: message,
    pubchem: failedChild(previous?.pubchem, message),
    flavordb: failedChild(previous?.flavordb, message),
    pubchem_volatile: previous?.pubchem_volatile?.found
      ? previous.pubchem_volatile
      : {
          found: false,
          status: 'upstream_unavailable',
          properties: {},
          source: 'PubChem PUG View',
          url: '',
        },
  };
}
