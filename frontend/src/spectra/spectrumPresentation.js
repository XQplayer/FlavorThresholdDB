function baseRow(side, peak, index) {
  return {
    side,
    peak_index: index,
    mz: Number(peak?.[0]),
    intensity: Number(peak?.[1]),
    matched: false,
    partner_mz: null,
    delta_da: null,
    delta_ppm: null,
  };
}

export function buildSinglePeakRows(record = {}) {
  return (record.peaks || []).map((peak, index) => baseRow('', peak, index));
}

export function buildComparisonPeakRows(spectrumA = {}, spectrumB = {}, comparison = {}) {
  const matchesA = new Map();
  const matchesB = new Map();
  for (const match of comparison?.matches || []) {
    matchesA.set(match.a_index, { partner_mz: match.mz_b, delta_da: match.delta_da, delta_ppm: match.delta_ppm });
    matchesB.set(match.b_index, { partner_mz: match.mz_a, delta_da: match.delta_da, delta_ppm: match.delta_ppm });
  }
  const decorate = (side, peaks, matches) => (peaks || []).map((peak, index) => {
    const match = matches.get(index);
    return { ...baseRow(side, peak, index), ...(match ? { matched: true, ...match } : {}) };
  });
  return [...decorate('A', spectrumA.peaks, matchesA), ...decorate('B', spectrumB.peaks, matchesB)];
}

export function sortPeakRows(rows = [], field = 'mz', direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const delta = (Number(left.row[field]) - Number(right.row[field])) * factor;
    return delta || left.index - right.index;
  }).map(item => item.row);
}

function safePart(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-');
}

export function buildPngFilename(spectrumA, spectrumB) {
  return `spectra-mirror_${safePart(spectrumA?.source)}-${safePart(spectrumA?.spectrum_id)}_${safePart(spectrumB?.source)}-${safePart(spectrumB?.spectrum_id)}.png`;
}

export function normalizePngScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 2;
  return Math.min(4, Math.max(1, scale));
}
