const uniqueBy = (rows, key) => [...new Map((rows || []).filter(row => row?.[key]).map(row => [row[key], row])).values()];
export function normalizeStructureEvidence(payload = {}) {
  return { experimental: uniqueBy(payload.experimental_structures, 'pdb_id'), predicted: uniqueBy(payload.predicted_models, 'model_id'), gpcrs: uniqueBy(payload.gpcr_proteins, 'accession'), sources: payload.sources || {} };
}
