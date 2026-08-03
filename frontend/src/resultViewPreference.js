const RESULT_VIEW_STORAGE_KEY = 'ftdb:result-view';
const DEFAULT_RESULT_VIEW = 'new';
const VALID_RESULT_VIEWS = new Set([DEFAULT_RESULT_VIEW, 'classic']);

export function loadResultView(storage = globalThis.localStorage) {
  try {
    const view = storage.getItem(RESULT_VIEW_STORAGE_KEY);
    return VALID_RESULT_VIEWS.has(view) ? view : DEFAULT_RESULT_VIEW;
  } catch {
    return DEFAULT_RESULT_VIEW;
  }
}

export function saveResultView(view, storage = globalThis.localStorage) {
  if (!VALID_RESULT_VIEWS.has(view)) {
    return;
  }

  try {
    storage.setItem(RESULT_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage is optional; a failed persistence attempt must not interrupt the session.
  }
}
