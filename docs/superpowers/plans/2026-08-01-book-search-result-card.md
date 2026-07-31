# Book Search Result Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exact book search entity-strict and render matching thresholds in a source-traceable medium-system table with separate alcoholic-beverage applications.

**Architecture:** Keep entity matching, threshold ownership, medium grouping, and source aggregation as pure functions in `bookSearch.js`; cover them with Node tests before changing rendering. `App.jsx` will consume those helpers and render one card per resolved entity/page result, while `App.css` provides the desktop table and mobile stacked layout.

**Tech Stack:** React 19, Vite 8, JavaScript ES modules, Node test runner, CSS.

---

### Task 1: Exact entity filtering and verified-context ownership

**Files:**
- Modify: `frontend/src/bookSearch.test.mjs`
- Modify: `frontend/src/bookSearch.js`

- [ ] **Step 1: Write failing exact-filter tests**

Add tests proving that `searchBookIndex({ exactMatch: true })` excludes a peptide page that only mentions 氯化钠, while retaining page 607 records resolved through `subject_resolution.subject_label`. Add a direct CAS fixture and assert that direct and verified-context thresholds are returned together.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test src/bookSearch.test.mjs`

Expected: FAIL because `exactMatch` does not yet restrict page hits and verified name-only threshold ownership is not resolved.

- [ ] **Step 3: Implement minimal entity-strict helpers**

Export `resolveBookEntities`, add a normalized entity-name set, and extend `searchBookIndex` with `exactMatch = false`. In exact mode, when an entity resolves, accept only records whose `entity_cas`/`entity_cas_list` contains the target CAS or whose subject-resolution evidence identifies one of the target entity names. Extend `getThresholdsForBookHit` to accept the resolved entity and include `entity_cas === targetCas` plus verified name-only thresholds whose normalized subject matches the entity aliases.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test src/bookSearch.test.mjs`

Expected: all book-search tests pass.

### Task 2: Medium-system grouping and source summary

**Files:**
- Modify: `frontend/src/bookSearch.test.mjs`
- Modify: `frontend/src/bookSearch.js`

- [ ] **Step 1: Write failing grouping tests**

Test `groupBookThresholds` with shuffled records for air, water, ethanol-water, wine, beer, juice, and unspecified media. Assert the keys are `air`, `water`, `ethanolWater`, `wine`, `beer`, `other`; empty groups are absent; juice remains visible as its original medium. Test `summarizeBookSources` for deduplicated pages, blocks, chapters, and correction state.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test src/bookSearch.test.mjs`

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement minimal grouping helpers**

Add the fixed order constant and classify by structured `media` values, not by searching rendered prose. Return `{ key, thresholds }` only for non-empty groups. Aggregate source metadata from threshold locators without rewriting units or values.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test src/bookSearch.test.mjs`

Expected: all book-search tests pass.

### Task 3: Render the C+B hybrid card

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Pass exact-mode intent into book search**

Add `exactMatch` to the `searchBookIndex` call and dependency list. Replace the eight-record slice with the full entity-owned threshold list, then derive medium groups and source summary using the tested helpers.

- [ ] **Step 2: Replace duplicate threshold summaries with the grouped table**

Render a semantic card header containing entity name, `CAS ...`, book title, pages, chapter/section, and evidence summary. Render table columns for system, value/type, medium detail, and evidence. Remove the duplicate prose threshold groups when structured thresholds exist.

- [ ] **Step 3: Keep alcoholic-beverage applications separate**

Derive non-threshold alcoholic-beverage lines from the entity-relevant source excerpt and show them in a separate `<details>` block. Keep the original-source `<details>` at the card footer with page/block locator text.

- [ ] **Step 4: Add responsive styles**

Style the table to match the approved audit-oriented design. At narrow widths, convert each row to a labeled stacked block; preserve keyboard focus and do not require horizontal scrolling for primary content.

- [ ] **Step 5: Run lint and tests**

Run: `node --test src/bookSearch.test.mjs`

Run: `pnpm run lint`

Expected: both exit 0.

### Task 4: Full local verification

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run the Python index suite**

Run the existing book-index test command documented by the repository and confirm 60/60.

- [ ] **Step 2: Run all website tests and production build**

Run: `pnpm test:book-search`

Run: `pnpm run lint`

Run: `pnpm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Verify exact sodium-chloride behavior in the browser**

At desktop and mobile widths, search 氯化钠 in exact mode. Confirm page 607 remains, peptide pages 437/438 disappear, groups follow the fixed order, wine and other media show their original details, alcoholic applications are separate, and the original-source control is keyboard operable.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check` and `git status --short`. Confirm every changed production line traces to the approved card redesign and no deployment/publish action occurred.
