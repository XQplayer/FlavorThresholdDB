# Progressive Scientific Preload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scientific-source loading self-explanatory, progressively preload the four heavy chapters, retain entity-scoped results across chapter visits, and report empty FlavorDB2 results accurately.

**Architecture:** Add a small pure preload-state module that decides which chapter starts next and whether a click must promote a chapter. `SearchResultsWorkbench` owns entity-scoped started chapters and keeps started scientific components mounted, while navigation and panels consume the same status vocabulary. Existing scientific request-key, generation, and abort guards remain responsible for preventing cross-entity responses.

**Tech Stack:** React 19, JavaScript modules, Node test runner, CSS, Playwright E2E.

---

### Task 1: Preload state contract

**Files:**
- Create: `frontend/src/scientificChapterPreload.js`
- Create: `frontend/src/scientificChapterPreload.test.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write failing tests** for ordered selection, terminal-state advancement, click promotion, entity reset, and no duplicate starts.
- [ ] **Step 2: Run** `node --test src/scientificChapterPreload.test.mjs` and confirm failures are caused by the missing module.
- [ ] **Step 3: Implement** immutable helpers around the fixed order `spectra`, `biochemistry`, `bioactivity`, `structures`.
- [ ] **Step 4: Run the focused tests** and confirm all pass.
- [ ] **Step 5: Commit** the helper and tests.

### Task 2: Truthful source and loading labels

**Files:**
- Modify: `frontend/src/searchWorkbenchModel.js`
- Modify: `frontend/src/searchWorkbenchModel.test.mjs`
- Modify: `frontend/src/components/search-results/ChapterNavigation.jsx`
- Modify: `frontend/src/components/search-results/ChapterPanel.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`

- [ ] **Step 1: Add failing tests** proving FlavorDB2 `found:false` and empty entities normalize to `no_data` while actual errors remain `failed`.
- [ ] **Step 2: Run** `pnpm run test:search-workbench` and confirm the new assertions fail against the current source-state mapping.
- [ ] **Step 3: Implement** “点击章节加载 / Click to load chapter”, “加载数据 / Load data”, spinner, and the 5–15 second loading message with `aria-live` and reduced-motion handling.
- [ ] **Step 4: Run** search-workbench tests and ESLint.
- [ ] **Step 5: Commit** the status and presentation changes.

### Task 3: Entity-scoped progressive preload and cache

**Files:**
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.jsx`
- Modify: `frontend/src/components/search-results/SearchResultsWorkbench.css`
- Modify: `frontend/src/scientificChapterPreload.test.mjs`

- [ ] **Step 1: Extend failing tests** for the scheduler contract: core-ready idle start, one ordered background start at a time, active-click priority, terminal advancement, and entity reset.
- [ ] **Step 2: Run focused tests** and verify the new scheduler assertions fail.
- [ ] **Step 3: Implement** idle-callback scheduling with timeout fallback, entity-scoped started chapters, active-click promotion, and persistent mounting of started scientific chapters.
- [ ] **Step 4: Verify** same-entity revisits preserve component state and entity changes reset mounted chapters.
- [ ] **Step 5: Run** unit tests, lint, and build.
- [ ] **Step 6: Commit** the preload integration.

### Task 4: Browser regression and public delivery

**Files:**
- Modify: `scripts/e2e/verify_search_results_workbench.mjs`

- [ ] **Step 1: Add failing E2E assertions** for initial load labels, ordered progressive requests, click loading feedback, no repeated requests after revisits, entity isolation, and FlavorDB2 no-match text.
- [ ] **Step 2: Run** `pnpm run test:e2e:search-workbench` and confirm the old UI fails the new contract.
- [ ] **Step 3: Adjust only the implementation needed** for failing browser assertions.
- [ ] **Step 4: Run** all unit suites, lint, build, workbench E2E, release E2E, and `git diff --check`.
- [ ] **Step 5: Commit and push**, open a PR, wait for GitHub quality checks, merge to `main`, wait for GitHub Pages, and verify the live page in a clean browser context.
