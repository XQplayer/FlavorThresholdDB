const errorMessage = error => error?.message || String(error || 'Source unavailable');

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
