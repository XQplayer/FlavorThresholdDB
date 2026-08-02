const uniqueBy = (rows, key) => [...new Map((rows || []).filter(row => row?.[key] !== undefined && row?.[key] !== null).map(row => [row[key], row])).values()];

export function normalizeBiologicalContext(payload = {}) {
  return {
    genes: uniqueBy(payload.genes, 'gene_id'),
    taxa: uniqueBy(payload.taxa, 'taxon_id'),
    studies: uniqueBy(payload.studies, 'accession'),
    studyHitCount: Number(payload.study_hit_count || 0),
    brenda: uniqueBy(payload.links?.BRENDA, 'ec_number'),
    hmdb: payload.links?.HMDB || null,
    sources: payload.sources || {},
  };
}

export function biologicalContextCounts(payload = {}) {
  const context = normalizeBiologicalContext(payload);
  return { genes: context.genes.length, taxa: context.taxa.length, studies: context.studies.length };
}
