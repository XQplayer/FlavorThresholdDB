# Search Results Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default FlavorThresholdDB search-result presentation with a chapter-based compound dossier and a batch-review table while preserving the current page as an unchanged classic view.

**Architecture:** Keep the existing query, enrichment, and CSV-export logic in `App.jsx` as the source of truth. Add pure adapters that map those results into a stable dossier model, then render that model through focused components under `components/search-results/`; the classic JSX path continues to consume the existing structures. Store only presentation state locally, so switching views never re-runs data acquisition or changes scientific data.

**Tech Stack:** React 19, Vite 8, JavaScript ES modules, Node built-in test runner, Playwright E2E, existing Lucide icons and project CSS.

---

## Execution precondition and file map

The current checkout contains unrelated, uncommitted Shimadzu work. Do not implement this plan directly on top of that dirty tree. First finish or commit the Shimadzu work, then create an isolated worktree from the intended integration commit. Never reset, stash, or overwrite user-owned changes merely to start this feature.

Files created by this plan:

- `frontend/src/searchWorkbenchModel.js`: pure normalization, chapter construction, batch-row construction, filter defaults, and source-status semantics.
- `frontend/src/searchWorkbenchModel.test.mjs`: unit tests for scientific-field preservation and state distinctions.
- `frontend/src/resultViewPreference.js`: safe browser persistence for `new` / `classic` presentation choice.
- `frontend/src/resultViewPreference.test.mjs`: preference fallback and storage-failure tests.
- `frontend/src/components/search-results/SearchResultsWorkbench.jsx`: composition root for the new result view.
- `frontend/src/components/search-results/ResultViewSwitch.jsx`: accessible new/classic segmented control.
- `frontend/src/components/search-results/CompoundIdentityHeader.jsx`: one-time identity and coverage summary.
- `frontend/src/components/search-results/ChapterNavigation.jsx`: desktop rail and mobile chapter selector.
- `frontend/src/components/search-results/ChapterPanel.jsx`: common chapter state/filter/disclosure frame.
- `frontend/src/components/search-results/EvidenceRecordDisclosure.jsx`: accessible raw-record expansion.
- `frontend/src/components/search-results/SourceStatusSummary.jsx`: loading, partial failure, failure, and retry messages.
- `frontend/src/components/search-results/BatchReviewTable.jsx`: batch review, sorting, filtering, and dossier entry.
- `frontend/src/components/search-results/chapters/OverviewChapter.jsx`: identity overview.
- `frontend/src/components/search-results/chapters/SensorySourcesChapter.jsx`: FEMA/FlavorDB2 evidence.
- `frontend/src/components/search-results/chapters/ThresholdEvidenceChapter.jsx`: medium/type/book filters.
- `frontend/src/components/search-results/chapters/SpectraChapter.jsx`: lazy spectrum workbench boundary.
- `frontend/src/components/search-results/chapters/MechanismChapters.jsx`: separate biochemical, activity, and structure sections.
- `frontend/src/components/search-results/chapters/CitationExportChapter.jsx`: citations and existing export actions.
- `frontend/src/components/search-results/SearchResultsWorkbench.css`: scoped high-contrast product UI and responsive rules.
- `scripts/e2e/verify_search_results_workbench.mjs`: new/classic, single/batch, error, responsive, and console regression checks.

Files modified by this plan:

- `frontend/src/App.jsx`: create the dossier adapter input, hide global filters in new mode, select new/classic renderer, and preserve query/export ownership.
- `frontend/src/index.css`: only remove or override layout rules that otherwise leak into the new scoped workbench; do not restyle classic selectors.
- `frontend/package.json`: add unit and E2E scripts.

## Task 1: Add safe result-view preference state

**Files:**
- Create: `frontend/src/resultViewPreference.js`
- Create: `frontend/src/resultViewPreference.test.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing preference tests**

```js
// frontend/src/resultViewPreference.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadResultView, saveResultView } from './resultViewPreference.js';

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('new view is the default', () => {
  assert.equal(loadResultView(memoryStorage()), 'new');
});

test('only a valid classic preference is restored', () => {
  assert.equal(loadResultView(memoryStorage({ 'ftdb:result-view': 'classic' })), 'classic');
  assert.equal(loadResultView(memoryStorage({ 'ftdb:result-view': 'unknown' })), 'new');
});

test('storage failures do not block the page', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(loadResultView(broken), 'new');
  assert.doesNotThrow(() => saveResultView('classic', broken));
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && node --test src/resultViewPreference.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `resultViewPreference.js`.

- [ ] **Step 3: Implement the minimal safe preference module**

```js
// frontend/src/resultViewPreference.js
const STORAGE_KEY = 'ftdb:result-view';
const VALID_VIEWS = new Set(['new', 'classic']);

export function loadResultView(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return VALID_VIEWS.has(value) ? value : 'new';
  } catch {
    return 'new';
  }
}

export function saveResultView(view, storage = globalThis.localStorage) {
  if (!VALID_VIEWS.has(view)) return;
  try { storage?.setItem(STORAGE_KEY, view); } catch { /* session state remains usable */ }
}
```

- [ ] **Step 4: Add and run the unit-test script**

Add to `frontend/package.json`:

```json
"test:search-workbench": "node --test src/resultViewPreference.test.mjs src/searchWorkbenchModel.test.mjs"
```

Run: `cd frontend && node --test src/resultViewPreference.test.mjs`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the preference boundary**

```powershell
git add frontend/src/resultViewPreference.js frontend/src/resultViewPreference.test.mjs frontend/package.json
git commit -m "feat: add search result view preference"
```

## Task 2: Build the pure dossier and batch-review model

**Files:**
- Create: `frontend/src/searchWorkbenchModel.js`
- Create: `frontend/src/searchWorkbenchModel.test.mjs`

- [ ] **Step 1: Write failing model tests using representative scientific records**

```js
// frontend/src/searchWorkbenchModel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBatchReviewRows,
  buildCompoundDossier,
  filterThresholdRecords,
  normalizeSourceStatus,
} from './searchWorkbenchModel.js';

const threshold = {
  cas: '141-78-6', chinese_name: '乙酸乙酯', english_name: 'Ethyl acetate', medium: '水',
  threshold_data: [{ threshold: '0.005 mg/L', type: 'd', reference: 'Van Gemert (2011)', original_text: '0.005 mg/L' }],
};

test('dossier preserves identity, source, medium, type, unit, and original evidence', () => {
  const dossier = buildCompoundDossier({
    matchedResults: [threshold], integratedResults: [{ item: threshold, fema: { flavor_profile: ['fruity'] }, profile: { pubchem: { cid: 8857, molecular_formula: 'C4H8O2' } } }],
    bookResults: [], sourceStates: { PubChem: { status: 'ok' } },
  });
  assert.equal(dossier.identity.cas, '141-78-6');
  assert.equal(dossier.identity.cid, 8857);
  const record = dossier.chapters.thresholds.records[0];
  assert.equal(record.medium, '水');
  assert.equal(record.thresholdType, 'd');
  assert.equal(record.value, '0.005');
  assert.equal(record.unit, 'mg/L');
  assert.equal(record.source, 'Van Gemert (2011)');
  assert.equal(record.originalText, '0.005 mg/L');
  assert.equal(record.sourceRecordKey, null);
});

test('threshold filters distinguish no data from no records under current filters', () => {
  const records = buildCompoundDossier({ matchedResults: [threshold], integratedResults: [], bookResults: [], sourceStates: {} }).chapters.thresholds.records;
  assert.equal(filterThresholdRecords(records, { media: ['空气'], types: ['d'], includeBooks: true }).length, 0);
  assert.equal(records.length, 1);
});

test('source status distinguishes not requested, no data, failed, and partial', () => {
  assert.equal(normalizeSourceStatus(undefined).kind, 'not_requested');
  assert.equal(normalizeSourceStatus({ status: 'no_data' }).kind, 'no_data');
  assert.equal(normalizeSourceStatus({ status: 'upstream_unavailable' }).kind, 'failed');
  assert.equal(normalizeSourceStatus({ status: 'partial_failure' }).kind, 'partial');
});

test('batch rows retain original input and classify exact, candidate, and unmatched rows', () => {
  const rows = buildBatchReviewRows(['141-78-6', 'ethyl acetate', 'unknown'], [threshold]);
  assert.deepEqual(rows.map(row => row.matchStatus), ['exact', 'candidate', 'unmatched']);
  assert.equal(rows[0].originalInput, '141-78-6');
});
```

- [ ] **Step 2: Run the model tests and verify failure**

Run: `cd frontend && node --test src/searchWorkbenchModel.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `searchWorkbenchModel.js`.

- [ ] **Step 3: Implement stable model constants and source semantics**

```js
// frontend/src/searchWorkbenchModel.js
export const CHAPTERS = [
  ['overview', '档案概览', 'Overview'], ['sensory', '感官与天然来源', 'Sensory & natural sources'],
  ['thresholds', '阈值证据', 'Threshold evidence'], ['spectra', '谱图与鉴定', 'Spectra & identification'],
  ['biochemistry', '生化关系', 'Biochemical relationships'], ['bioactivity', '活性与靶点', 'Bioactivity & targets'],
  ['structures', '蛋白结构', 'Protein structures'], ['citation', '引用与导出', 'Citation & export'],
].map(([id, zh, en]) => ({ id, zh, en }));

export const DEFAULT_CHAPTER_FILTERS = Object.freeze({
  sensory: { sources: ['fema', 'flavordb2'], kinds: ['odor', 'taste', 'natural_source', 'food'] },
  thresholds: { media: ['水', '空气', '酒类', '其他介质'], types: ['d', 'r'], includeBooks: true },
  spectra: { libraries: ['massbank', 'gnps'], spectrumTypes: ['ei', 'msms'], ionModes: ['positive', 'negative'] },
});

export function normalizeSourceStatus(state) {
  if (!state) return { kind: 'not_requested' };
  if (state.status === 'no_data') return { kind: 'no_data', ...state };
  if (state.status === 'partial_failure') return { kind: 'partial', ...state };
  if (['upstream_unavailable', 'error', 'timeout'].includes(state.status)) return { kind: 'failed', ...state };
  return { kind: state.status === 'ok' ? 'ready' : 'loading', ...state };
}
```

- [ ] **Step 4: Implement record mapping without losing provenance**

```js
const splitThreshold = raw => {
  const text = String(raw ?? '').trim();
  const match = text.match(/^([^\s]+)\s*(.*)$/);
  return { value: match?.[1] || text, unit: match?.[2] || '' };
};

const thresholdRecords = matchedResults => matchedResults.flatMap(entity =>
  (entity.threshold_data || []).map((record, index) => ({
    id: `${entity.cas || 'unknown'}:${entity.medium || 'unknown'}:${index}`,
    cas: entity.cas || '', medium: entity.medium || '其他介质',
    thresholdType: record.type || '', ...splitThreshold(record.threshold),
    source: record.reference || record.source || '', originalText: record.original_text || record.threshold || '',
    sourceRecordKey: record.source_record_key || null, raw: record,
  })),
);
```

Implement `buildCompoundDossier`, `filterThresholdRecords`, and `buildBatchReviewRows` around this mapper. `buildCompoundDossier` must always return all eight chapter keys, even when a chapter has `records: []`, and must attach normalized source states separately from records.

- [ ] **Step 5: Run all search-workbench unit tests**

Run: `cd frontend && pnpm run test:search-workbench`

Expected: all preference and model tests PASS with no warning output.

- [ ] **Step 6: Commit the pure model**

```powershell
git add frontend/src/searchWorkbenchModel.js frontend/src/searchWorkbenchModel.test.mjs
git commit -m "feat: model chapter-based compound dossiers"
```

## Task 3: Add the accessible shell and version switch

**Files:**
- Create: `frontend/src/components/search-results/ResultViewSwitch.jsx`
- Create: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Create: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `frontend/src/App.jsx:108-160,1354-1505`

- [ ] **Step 1: Add a failing E2E assertion for the default and persisted view**

Create the first portion of `scripts/e2e/verify_search_results_workbench.mjs` using the same server/bootstrap helpers as `verify_release_candidate.mjs`:

```js
await page.goto(`${baseUrl}/FlavorThresholdDB/aroma-threshold/`);
await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
await page.waitForSelector('[data-testid="search-results-workbench"]');
assert.equal(await page.getByRole('button', { name: '新版档案' }).getAttribute('aria-pressed'), 'true');
await page.getByRole('button', { name: '经典版' }).click();
await page.reload();
assert.equal(await page.getByRole('button', { name: '经典版' }).getAttribute('aria-pressed'), 'true');
```

Stub external endpoints exactly as the release-candidate script does so the test is deterministic.

- [ ] **Step 2: Run E2E and verify failure**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: FAIL because `[data-testid="search-results-workbench"]` and the version buttons do not exist.

- [ ] **Step 3: Implement the switch component**

```jsx
// frontend/src/components/search-results/ResultViewSwitch.jsx
export default function ResultViewSwitch({ value, onChange, isEnglish }) {
  const options = [
    ['new', isEnglish ? 'New dossier' : '新版档案'],
    ['classic', isEnglish ? 'Classic' : '经典版'],
  ];
  return <div className="result-view-switch" role="group" aria-label={isEnglish ? 'Result view' : '结果展示方式'}>
    {options.map(([id, label]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}
```

- [ ] **Step 4: Add presentation state to App without touching query dependencies**

In `App.jsx`, initialize once and persist only when the user switches:

```jsx
const [resultView, setResultView] = useState(() => loadResultView());
const changeResultView = next => {
  setResultView(next);
  saveResultView(next);
};
```

Render `ResultViewSwitch` after the search controls and before any result renderer. Wrap the existing `advanced-filters legacy-filter-list` block with `resultView === 'classic'`. Do not add `resultView` to any fetch effect dependency array.

- [ ] **Step 5: Add the workbench composition root and scoped substrate**

```jsx
// SearchResultsWorkbench.jsx
export default function SearchResultsWorkbench({ dossier, mode, batchRows, isEnglish, children }) {
  return <section className="search-results-workbench" data-testid="search-results-workbench">
    {children}
  </section>;
}
```

In `SearchResultsWorkbench.css`, define scoped tokens (`--workbench-page`, `--workbench-surface`, `--workbench-ink`, `--workbench-muted`, `--workbench-accent`, `--workbench-warning`) and set body/label contrast to WCAG AA. Do not change `.legacy-filter-*`, `.result-section`, or `.threshold-result-entity` rules.

- [ ] **Step 6: Re-run the view-switch E2E**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: PASS for default new view, classic persistence, and no duplicate network request after switching.

- [ ] **Step 7: Commit the shell**

```powershell
git add frontend/src/App.jsx frontend/src/components/search-results/ResultViewSwitch.jsx frontend/src/components/search-results/SearchResultsWorkbench.jsx frontend/src/components/search-results/SearchResultsWorkbench.css scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: add search result workbench shell"
```

## Task 4: Implement identity, navigation, chapter state, and disclosure primitives

**Files:**
- Create: `frontend/src/components/search-results/CompoundIdentityHeader.jsx`
- Create: `frontend/src/components/search-results/ChapterNavigation.jsx`
- Create: `frontend/src/components/search-results/ChapterPanel.jsx`
- Create: `frontend/src/components/search-results/EvidenceRecordDisclosure.jsx`
- Create: `frontend/src/components/search-results/SourceStatusSummary.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add failing E2E checks for one-time identity and keyboard disclosure**

```js
assert.equal(await page.getByText('CAS 141-78-6').count(), 1);
await page.getByRole('button', { name: /阈值证据/ }).click();
const disclosure = page.getByRole('button', { name: /查看原始记录/ }).first();
assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
await disclosure.focus();
await page.keyboard.press('Enter');
assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
```

- [ ] **Step 2: Verify the new assertions fail**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: FAIL because the identity header and chapter controls are absent.

- [ ] **Step 3: Implement the navigation contract**

```jsx
export default function ChapterNavigation({ chapters, activeId, onChange, isEnglish }) {
  return <nav className="chapter-navigation" aria-label={isEnglish ? 'Dossier chapters' : '档案章节'}>
    {chapters.map(chapter => <button key={chapter.id} type="button" aria-current={activeId === chapter.id ? 'page' : undefined} onClick={() => onChange(chapter.id)}>
      <span>{isEnglish ? chapter.en : chapter.zh}</span><span>{chapter.count}</span>
    </button>)}
  </nav>;
}
```

The desktop CSS uses a sticky left rail. At `max-width: 800px`, switch to a horizontally scrollable row with visible focus and no hidden scrollbar requirement.

- [ ] **Step 4: Implement source states and record disclosure**

`SourceStatusSummary` must map `not_requested`, `loading`, `ready`, `no_data`, `partial`, and `failed` to different labels. `EvidenceRecordDisclosure` must use a real button, `aria-expanded`, and an `id`/`aria-controls` pair; raw records start closed.

```jsx
<button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
  {open ? closeLabel : `${openLabel} (${records.length})`}
</button>
<div id={panelId} hidden={!open}>{records.map(renderRecord)}</div>
```

- [ ] **Step 5: Run E2E at desktop and mobile widths**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: identity appears once; chapter selection works; disclosure works by keyboard; widths 1440 and 375 have `document.documentElement.scrollWidth === window.innerWidth`.

- [ ] **Step 6: Commit shared dossier primitives**

```powershell
git add frontend/src/components/search-results frontend/src/components/search-results/SearchResultsWorkbench.css scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: add accessible dossier navigation"
```

## Task 5: Implement overview, sensory, and threshold chapters

**Files:**
- Create: `frontend/src/components/search-results/chapters/OverviewChapter.jsx`
- Create: `frontend/src/components/search-results/chapters/SensorySourcesChapter.jsx`
- Create: `frontend/src/components/search-results/chapters/ThresholdEvidenceChapter.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `frontend/src/searchWorkbenchModel.test.mjs`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add a failing unit test for independent chapter filters**

```js
test('threshold filter changes do not mutate sensory defaults', () => {
  const before = structuredClone(DEFAULT_CHAPTER_FILTERS);
  const nextThresholds = { ...before.thresholds, media: ['水'] };
  assert.deepEqual(before.sensory.sources, ['fema', 'flavordb2']);
  assert.deepEqual(nextThresholds.media, ['水']);
});
```

- [ ] **Step 2: Add failing E2E checks for chapter-local filters and empty-filter copy**

```js
await page.getByRole('button', { name: /阈值证据/ }).click();
await page.getByRole('button', { name: '空气' }).click();
await expectText(page, '当前筛选下无记录');
await page.getByRole('button', { name: /感官与天然来源/ }).click();
assert.equal(await page.getByRole('button', { name: 'FEMA' }).getAttribute('aria-pressed'), 'true');
```

- [ ] **Step 3: Implement controlled local filters**

Keep `chapterFilters` in `SearchResultsWorkbench`, keyed by chapter ID. Reset it only when `dossier.identity.cas` or the normalized query identity changes:

```jsx
const [chapterFilters, setChapterFilters] = useState(() => structuredClone(DEFAULT_CHAPTER_FILTERS));
useEffect(() => setChapterFilters(structuredClone(DEFAULT_CHAPTER_FILTERS)), [dossier.identity.entityKey]);
const updateChapterFilter = (chapterId, patch) => setChapterFilters(current => ({
  ...current, [chapterId]: { ...current[chapterId], ...patch },
}));
```

- [ ] **Step 4: Render source-labelled sensory groups and threshold records**

`SensorySourcesChapter` must never merge FEMA and FlavorDB2 labels. `ThresholdEvidenceChapter` must render `medium`, `thresholdType`, `value`, `unit`, `source`, and `originalText`; values without source display a visible “来源未记录” state rather than an empty string.

- [ ] **Step 5: Verify unit and E2E coverage**

Run: `cd frontend && pnpm run test:search-workbench`

Expected: all model tests PASS.

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: chapter filters remain independent, a new compound resets filters, and threshold provenance is visible after disclosure.

- [ ] **Step 6: Commit the core scientific chapters**

```powershell
git add frontend/src/components/search-results/chapters frontend/src/components/search-results/SearchResultsWorkbench.jsx frontend/src/components/search-results/SearchResultsWorkbench.css frontend/src/searchWorkbenchModel.test.mjs scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: add sensory and threshold dossier chapters"
```

## Task 6: Integrate spectra, mechanism, citation, and export chapters

**Files:**
- Create: `frontend/src/components/search-results/chapters/SpectraChapter.jsx`
- Create: `frontend/src/components/search-results/chapters/MechanismChapters.jsx`
- Create: `frontend/src/components/search-results/chapters/CitationExportChapter.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/App.jsx:580-647,983-1100,1682-2235`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add failing E2E checks for separation and lazy spectrum mounting**

```js
assert.equal(await page.locator('[data-testid="spectrum-workbench"]').count(), 0);
await page.getByRole('button', { name: /谱图与鉴定/ }).click();
assert.equal(await page.locator('[data-testid="spectrum-workbench"]').count(), 1);
await page.getByRole('button', { name: /生化关系/ }).click();
await expectText(page, 'Rhea');
await page.getByRole('button', { name: /活性与靶点/ }).click();
await expectText(page, 'PubChem BioAssay');
await page.getByRole('button', { name: /蛋白结构/ }).click();
await expectText(page, 'PDB');
```

- [ ] **Step 2: Verify failure before wiring chapters**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: FAIL at the spectrum or mechanism chapter selector.

- [ ] **Step 3: Reuse existing scientific components through chapter boundaries**

`SpectraChapter` should mount existing spectrum components only when it is the active chapter. `MechanismChapters.jsx` exports three components (`BiochemistryChapter`, `BioactivityChapter`, `ProteinStructuresChapter`) and delegates to existing `BiochemicalRelationships`, `BioactivityEvidence`, and protein-structure components without merging their headings or status models.

- [ ] **Step 4: Pass existing export callbacks rather than duplicating CSV logic**

```jsx
<CitationExportChapter
  citationText={citationExampleText}
  onExportCompact={() => exportCSV('compact')}
  onExportDetailed={() => exportCSV('detailed')}
  isEnglish={isEnglish}
/>
```

Do not move `exportCSV` into a display component in this task. The new and classic views must call the same callback.

- [ ] **Step 5: Verify lazy mounting, chapter separation, and equal export output**

Extend E2E to download compact and detailed CSV once from each view and compare file bytes after normalizing only the generated filename. Expected: new/classic outputs are byte-identical for the same selection.

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: PASS; no spectrum component before its chapter; all mechanism headings remain separate; both export modes match classic output.

- [ ] **Step 6: Commit the remaining chapters**

```powershell
git add frontend/src/components/search-results/chapters frontend/src/components/search-results/SearchResultsWorkbench.jsx frontend/src/App.jsx scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: connect scientific evidence chapters"
```

## Task 7: Implement batch review table and list-state restoration

**Files:**
- Create: `frontend/src/components/search-results/BatchReviewTable.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `frontend/src/searchWorkbenchModel.test.mjs`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add failing unit tests for stable batch row IDs and sorting**

```js
test('duplicate batch inputs receive stable occurrence-aware row IDs', () => {
  const rows = buildBatchReviewRows(['141-78-6', '141-78-6'], [threshold]);
  assert.deepEqual(rows.map(row => row.id), ['141-78-6:0', '141-78-6:1']);
});
```

Add and export a pure `sortBatchRows(rows, { key, direction })` function. Verify unmatched rows sort before candidates and exact matches when `key === 'reviewPriority'`.

- [ ] **Step 2: Add failing E2E checks for review and restoration**

```js
await page.getByRole('button', { name: '批量匹配' }).click();
await page.getByLabel('批量输入').fill('141-78-6\n64-17-5\nunknown');
await page.getByRole('button', { name: '仅看未匹配' }).click();
const scrollBefore = await page.evaluate(() => window.scrollY);
await page.getByRole('button', { name: /查看档案/ }).first().click();
await page.getByRole('button', { name: '返回批量结果' }).click();
assert.equal(await page.getByRole('button', { name: '仅看未匹配' }).getAttribute('aria-pressed'), 'true');
assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
```

- [ ] **Step 3: Implement table state as a single serializable object**

```jsx
const [batchState, setBatchState] = useState({
  status: 'all', sortKey: 'inputOrder', sortDirection: 'asc', page: 1, selectedRowId: null, scrollY: 0,
});
```

Before opening a dossier, store `window.scrollY` and the selected row ID. On return, render the table first, then restore scroll in `requestAnimationFrame`. Do not store this state in `localStorage`; it belongs to the current batch session only.

- [ ] **Step 4: Render a semantic, responsive review table**

Use `<table>` at desktop widths. At mobile widths preserve header associations with an accessible table inside a horizontally bounded container, or switch to a labelled row list only if all column labels remain programmatically available. Include original input, normalized identity, CAS, match status, chapter coverage, issue state, and dossier action.

- [ ] **Step 5: Run unit and E2E verification**

Run: `cd frontend && pnpm run test:search-workbench`

Expected: stable duplicate IDs and deterministic sorting PASS.

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: exact/candidate/unmatched rows render; filters, sort, and scroll restore after returning from a dossier; no multiple full dossiers render simultaneously.

- [ ] **Step 6: Commit batch review**

```powershell
git add frontend/src/components/search-results/BatchReviewTable.jsx frontend/src/components/search-results/SearchResultsWorkbench.jsx frontend/src/components/search-results/SearchResultsWorkbench.css frontend/src/searchWorkbenchModel.js frontend/src/searchWorkbenchModel.test.mjs scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: add batch compound review workflow"
```

## Task 8: Complete loading, empty, partial-failure, and retry behavior

**Files:**
- Modify: `frontend/src/components/search-results/SourceStatusSummary.jsx`
- Modify: `frontend/src/components/search-results/ChapterPanel.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/App.jsx:455-647`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add route-fixture scenarios for every state**

Add deterministic fixtures to the E2E script:

```js
const sourceScenarios = {
  partial: { PubChem: { status: 'ok' }, MassBank: { status: 'timeout' }, ChEMBL: { status: 'upstream_unavailable' } },
  empty: { PubChem: { status: 'no_data' } },
  loading: { PubChem: { status: 'loading' } },
};
```

Assert distinct visible copy: `尚未请求`, `正在获取`, `该来源无记录`, `部分来源暂不可用`, and `请求失败`.

- [ ] **Step 2: Verify state assertions fail**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: FAIL because current UI conflates at least two source states.

- [ ] **Step 3: Add source-level retry callbacks**

Pass a map of existing/reusable loaders into the workbench:

```jsx
const retrySource = sourceId => {
  const retry = sourceRetryHandlers[sourceId];
  if (retry) retry();
};
<SearchResultsWorkbench onRetrySource={retrySource} ... />
```

The retry action must call only the failed source loader. It must not clear `queryMatchedResults`, switch views, or restart completed source requests.

- [ ] **Step 4: Implement global failure only for missing identity/core service**

The workbench renders an overall error only when the core match model cannot be created. A failed enrichment source renders inside its chapter. Preserve input fields and presentation preference in both cases.

- [ ] **Step 5: Verify partial data survives retries**

Run: `node scripts/e2e/verify_search_results_workbench.mjs`

Expected: successful source cards remain visible during a failed-source retry; route request counts show only the failed endpoint was repeated.

- [ ] **Step 6: Commit state handling**

```powershell
git add frontend/src/components/search-results/SourceStatusSummary.jsx frontend/src/components/search-results/ChapterPanel.jsx frontend/src/components/search-results/SearchResultsWorkbench.jsx frontend/src/App.jsx scripts/e2e/verify_search_results_workbench.mjs
git commit -m "feat: distinguish search evidence states"
```

## Task 9: Final responsive, accessibility, classic, and platform regression

**Files:**
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `frontend/src/index.css`
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add the complete regression matrix to E2E**

Cover these cases in one browser launch:

```js
const widths = [1440, 1024, 768, 375];
const queries = [
  { mode: 'single', value: '141-78-6', exact: true },
  { mode: 'single', value: 'ethyl acetate', exact: false },
  { mode: 'bulk', value: '141-78-6\n64-17-5\nunknown', exact: true },
];
```

For each relevant combination, assert no horizontal overflow, no clipped action, a visible focus ring, and no duplicate React-key or uncaught Promise errors. Visit the home and Shimadzu routes once and assert their primary headings and key controls remain present.

- [ ] **Step 2: Add a dedicated package script**

Add to `frontend/package.json`:

```json
"test:e2e:search-workbench": "node ../scripts/e2e/verify_search_results_workbench.mjs"
```

- [ ] **Step 3: Run lint and fix only search-workbench findings**

Run: `cd frontend && pnpm run lint`

Expected: exit 0. If unrelated pre-existing lint failures exist, record them verbatim and run ESLint on the changed files; do not reformat or repair unrelated Shimadzu code.

- [ ] **Step 4: Run all focused and existing frontend tests**

```powershell
cd frontend
pnpm run test:search-workbench
pnpm run test:book-search
pnpm run test:static-routes
pnpm run test:shimadzu
pnpm run build
```

Expected: all tests PASS and Vite build exits 0. If the isolated baseline intentionally excludes unmerged Shimadzu work, run `test:shimadzu` only after merging the completed Shimadzu baseline; do not manufacture missing files.

- [ ] **Step 5: Run the full search-workbench E2E**

Run: `cd frontend && pnpm run test:e2e:search-workbench`

Expected: exit 0; screenshots and JSON results are written under `_local/verification/`; zero page errors, duplicate-key errors, page-level overflow, or failed assertions.

- [ ] **Step 6: Review the final diff for scope**

Run:

```powershell
git diff --check
git status --short
git diff --name-only HEAD
```

Expected: only the files listed in this plan are changed. No home-page content, Shimadzu component, proxy service, cache, or scientific source fixture is modified.

- [ ] **Step 7: Commit final QA and responsive polish**

```powershell
git add frontend/src/components/search-results/SearchResultsWorkbench.css frontend/src/index.css frontend/package.json scripts/e2e/verify_search_results_workbench.mjs
git commit -m "test: verify search results workbench"
```

## Completion criteria

The implementation is complete only when:

- new view is the default and classic view remains visually and behaviorally unchanged;
- switching presentation does not repeat data requests or alter CSV output;
- single search opens one chapter-based dossier;
- batch search opens a review table and restores state after dossier inspection;
- all eight chapters exist, with biochemical, activity, and protein evidence separate;
- threshold records retain medium, type, value, unit, source, and original evidence;
- chapter filters are independent and reset on a new compound;
- not-requested, loading, no-data, partial, and failed states remain distinct;
- widths 1440, 1024, 768, and 375 pass overflow and interaction checks;
- home and Shimadzu workbench regression checks pass;
- the final diff contains no unrelated user-owned changes.
