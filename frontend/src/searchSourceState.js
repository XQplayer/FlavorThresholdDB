const errorMessage = error => error?.message || String(error || 'Source unavailable');

const NEW_EXPORT_MEDIA = Object.freeze(['水', '空气', '其他介质']);
const TRANSIENT_SOURCE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SOURCE_CACHE_TTL_MS = Object.freeze({ fema: 7 * 24 * 60 * 60 * 1000, compound: 24 * 60 * 60 * 1000 });

const getStorage = storage => storage || (typeof window !== 'undefined' ? window.localStorage : null);
const sourceCacheKey = (source, cas) => `flavorthresholddb:source:${source}:v1:${cas}`;

export function readSourceCache(source, cas, { storage, now = Date.now() } = {}) {
  try {
    const raw = getStorage(storage)?.getItem(sourceCacheKey(source, cas));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const ttl = SOURCE_CACHE_TTL_MS[source] || 0;
    if (!entry?.savedAt || !entry?.profile || now - entry.savedAt > ttl) return null;
    return entry.profile;
  } catch {
    return null;
  }
}

export function writeSourceCache(source, cas, profile, { storage, now = Date.now() } = {}) {
  try {
    getStorage(storage)?.setItem(sourceCacheKey(source, cas), JSON.stringify({ savedAt: now, profile }));
  } catch {
    // Private browsing and quota errors must never block source loading.
  }
}

const wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));

export async function fetchSourceWithRetry(request, {
  retryDelaysMs = [1200, 3000, 6000],
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await request(attempt);
      if (!TRANSIENT_SOURCE_STATUSES.has(response.status) || attempt === retryDelaysMs.length) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === retryDelaysMs.length) throw error;
    }
    await wait(retryDelaysMs[attempt]);
  }
  throw lastError || new Error('Source request failed');
}

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
