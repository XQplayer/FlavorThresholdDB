const count = rows => Array.isArray(rows) ? rows.length : 0;

export function normalizeBioactivity(payload = {}) {
  return {
    pubchem: payload.pubchem_assays || [],
    chembl: payload.chembl_activities || [],
    gtopdb: payload.gtopdb_interactions || [],
    bindingdb: payload.bindingdb_interactions || [],
    sources: payload.sources || {},
  };
}

export function bioactivityCounts(payload = {}) {
  const data = normalizeBioactivity(payload);
  return { pubchem: count(data.pubchem), chembl: count(data.chembl), gtopdb: count(data.gtopdb), bindingdb: count(data.bindingdb) };
}
