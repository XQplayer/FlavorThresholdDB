export const SCIENTIFIC_PRELOAD_ORDER = Object.freeze([
  'spectra',
  'biochemistry',
  'bioactivity',
  'structures',
]);

const TERMINAL_STATUSES = new Set(['available', 'ready', 'no_data', 'partial', 'failed']);

export function createScientificPreloadState(entityKey = null) {
  return { entityKey, started: [] };
}

export function markScientificChapterStarted(state, chapterId) {
  if (!SCIENTIFIC_PRELOAD_ORDER.includes(chapterId) || state.started.includes(chapterId)) return state;
  return { ...state, started: [...state.started, chapterId] };
}

export function nextScientificChapterToPreload(state, statuses = {}, promotedChapterId = null) {
  if (promotedChapterId && !state.started.includes(promotedChapterId)) return promotedChapterId;
  const hasInFlightChapter = state.started.some(id => !TERMINAL_STATUSES.has(statuses[id]));
  if (hasInFlightChapter) return null;
  return SCIENTIFIC_PRELOAD_ORDER.find(id => !state.started.includes(id)) || null;
}
