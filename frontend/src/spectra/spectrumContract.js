export function isSpectrumDownloadAllowed(record = {}) {
  const status = String(record.license_status || '').toLowerCase();
  const license = String(record.license || '').trim().toLowerCase();
  if (['needs_review', 'restricted', 'link_only'].includes(status)) return false;
  return license.startsWith('cc ') || license.startsWith('cc0') || ['public domain', 'pddl'].includes(license);
}

export function spectrumDetailPath(source, spectrumId) {
  return `/spectra/${encodeURIComponent(source)}/${encodeURIComponent(spectrumId)}`;
}

export function assignComparisonSlot(current, record) {
  if (!current.a) return { a: record, b: current.b };
  if (!current.b) return { a: current.a, b: record };
  return { a: current.a, b: record };
}
