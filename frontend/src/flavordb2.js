const TAXONOMY_ORDER = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];

export function buildFlavorDB2Url(apiUrl, endpoint, params = {}) {
  const base = apiUrl.replace(/\/$/, '');
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${base}/flavordb2/${endpoint}${query ? `?${query}` : ''}`;
}

export function formatTaxonomy(taxonomy = {}) {
  return TAXONOMY_ORDER.map(rank => taxonomy[rank]).filter(Boolean).join(' · ');
}
