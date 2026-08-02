export function isSpectrumDownloadAllowed(record = {}) {
  record ||= {};
  const status = String(record.license_status || '').toLowerCase();
  const license = String(record.license || '').trim().toLowerCase();
  if (['needs_review', 'restricted', 'link_only'].includes(status)) return false;
  return license.startsWith('cc ') || license.startsWith('cc0') || ['public domain', 'pddl'].includes(license);
}

export function isComparisonExportAllowed(spectrumA, spectrumB) {
  return isSpectrumDownloadAllowed(spectrumA) && isSpectrumDownloadAllowed(spectrumB);
}

export function spectrumDetailPath(source, spectrumId) {
  return `/spectra/${encodeURIComponent(source)}/${encodeURIComponent(spectrumId)}`;
}

export function assignComparisonSlot(current, record) {
  if (!current.a) return { a: record, b: current.b };
  if (!current.b) return { a: current.a, b: record };
  return { a: current.a, b: record };
}

export function comparisonMatchSets(comparison = {}) {
  const matches = Array.isArray(comparison?.matches) ? comparison.matches : [];
  return {
    a: new Set(matches.map(match => match.a_index).filter(Number.isInteger)),
    b: new Set(matches.map(match => match.b_index).filter(Number.isInteger)),
  };
}

export function comparisonExportFilename(spectrumA, spectrumB, extension) {
  const safe = value => String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-');
  return `spectra-comparison_${safe(spectrumA?.source)}-${safe(spectrumA?.spectrum_id)}_${safe(spectrumB?.source)}-${safe(spectrumB?.spectrum_id)}.${safe(extension)}`;
}

const normalized = value => String(value || '').trim().toLowerCase();

export function filterSpectrumRecords(records = [], filters = {}) {
  return records.filter(record => {
    if (filters.source && filters.source !== 'all' && normalized(record.source) !== normalized(filters.source)) return false;
    if (filters.type && filters.type !== 'all' && normalized(record.spectrum_type) !== normalized(filters.type)) return false;
    if (filters.ionMode && filters.ionMode !== 'all' && normalized(record.ion_mode) !== normalized(filters.ionMode)) return false;
    if (filters.adduct && filters.adduct !== 'all' && String(record.adduct || '') !== filters.adduct) return false;
    if (filters.instrument && filters.instrument !== 'all' && String(record.instrument || '') !== filters.instrument) return false;
    return true;
  });
}

export function spectrumFilterOptions(records = []) {
  const values = field => [...new Set(records.map(record => String(record[field] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { ionModes: values('ion_mode'), adducts: values('adduct'), instruments: values('instrument') };
}
