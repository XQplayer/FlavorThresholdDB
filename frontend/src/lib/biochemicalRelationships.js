const uniqueBy = (rows, key) => [...new Map((rows || []).filter(row => row?.[key]).map(row => [row[key], row])).values()];

export function normalizeBiochemicalGraph(payload = {}) {
  const verified = Boolean(payload.chebi?.identity_match?.verified);
  return {
    chebi: payload.chebi || null,
    verified,
    reactions: verified ? uniqueBy(payload.reactions, 'rhea_id') : [],
    proteins: verified ? uniqueBy(payload.proteins, 'accession') : [],
    sources: payload.sources || {},
    retrievedAt: payload.retrieved_at || '',
  };
}

export function summarizeBiochemicalSources(sources = {}) {
  return ['ChEBI', 'Rhea', 'UniProt'].map(name => {
    const source = sources[name] || {};
    const requests = Array.isArray(source.requests) ? source.requests : [];
    return {
      name,
      status: source.status || 'not_requested',
      cached: Boolean(source.cached),
      requestCount: requests.length,
      failedRequests: requests.filter(request => ['upstream_unavailable', 'invalid_response'].includes(request.status)).length,
    };
  });
}
