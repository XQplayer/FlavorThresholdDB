const errorMessage = error => error?.message || String(error || 'Source unavailable');

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
