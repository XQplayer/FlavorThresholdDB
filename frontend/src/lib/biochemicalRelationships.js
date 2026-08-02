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
