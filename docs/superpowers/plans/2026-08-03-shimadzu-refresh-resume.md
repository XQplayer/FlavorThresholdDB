# Shimadzu Browser Refresh Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an active Shimadzu browser-analysis task across refresh or page closure and automatically restore its monitor and computation when the same browser reopens the page, without adding a paid compute service or changing scientific outputs.

**Architecture:** Store only the active task metadata and the two input workbook buffers in origin-scoped IndexedDB. On reopening, restore the task for the current user, rebuild completed-stage state, rerun the deterministic pipeline from the stored inputs, and skip already acknowledged review gates. Cloud history remains metadata/result storage only; a cloud task with no matching local inputs is shown as interrupted instead of falsely appearing to run.

**Tech Stack:** React 19, browser IndexedDB, Web Worker, Supabase job metadata, Node test runner, Vite.

---

### Task 1: Active-task persistence

**Files:**
- Create: `frontend/src/lib/shimadzuTaskStore.js`
- Create: `frontend/src/lib/shimadzuTaskStore.test.mjs`

- [ ] **Step 1: Write failing tests** for storing metadata separately from both ArrayBuffers, restoring only the matching user scope, updating progress without replacing buffers, clearing all records, and expiring stale active inputs after seven days.
- [ ] **Step 2: Run `node --test src/lib/shimadzuTaskStore.test.mjs` from `frontend`; expect module-not-found failure.**
- [ ] **Step 3: Implement `createShimadzuTaskStore`, backed by an injectable key-value adapter and a default IndexedDB adapter using one `readwrite` transaction for multi-key writes/deletes.**
- [ ] **Step 4: Rerun the test and require all assertions to pass.**

### Task 2: Review-safe worker restart

**Files:**
- Modify: `frontend/src/lib/shimadzuWorkerClient.js`
- Modify: `frontend/src/lib/shimadzuWorkerClient.test.mjs`
- Modify: `frontend/src/workers/shimadzu.worker.js`

- [ ] **Step 1: Add a failing client test asserting `resumeFromStage` is sent in the worker start message.**
- [ ] **Step 2: Run the focused test and confirm the missing field fails.**
- [ ] **Step 3: Forward `resumeFromStage`; in step mode, resolve review gates for stages lower than that value and pause normally on the first not-yet-reviewed stage.**
- [ ] **Step 4: Rerun the focused client test and the Shimadzu browser suite.**

### Task 3: Page restoration and honest cloud history

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`

- [ ] **Step 1: Add failing source-contract tests for IndexedDB task-store integration, automatic restoration, a visible recovery notice, and an interrupted-history state for jobs without local inputs.**
- [ ] **Step 2: Run the layout tests and verify the new assertions fail.**
- [ ] **Step 3: Refactor fresh and restored runs through one execution function. Persist inputs before worker transfer; persist completed-stage summaries; restore once per approved user or local scope; clear the cache only after completion, cancellation, or explicit reset.**
- [ ] **Step 4: For true analysis failures, retain error details and offer an explicit retry. For legacy cloud `running`/`waiting_review` jobs without matching IndexedDB inputs, render `已中断，需重新运行` and provide a user action that marks the cloud record failed.**
- [ ] **Step 5: Add concise copy explaining that refreshing/reopening resumes automatically, while no computation occurs during the time the page is closed. Keep keyboard/ARIA behavior and responsive layouts.**
- [ ] **Step 6: Run the layout test and full browser test suite.**

### Task 4: Verify and publish without changing version

**Files:**
- Modify only files already listed in this plan and the existing first-screen UI files.

- [ ] **Step 1: Run `pnpm run lint`, `pnpm run build`, `pnpm run test:shimadzu`, and `pnpm run test:shimadzu-browser` from `frontend`; require zero failures.**
- [ ] **Step 2: Inspect `git diff --check`, `git status --short`, and the complete staged diff; do not change `frontend/package.json` version.**
- [ ] **Step 3: Commit the intended UI and recovery changes, push the branch, merge into `main`, and allow the existing GitHub Pages workflow to deploy.**
- [ ] **Step 4: Verify the Pages workflow succeeded and the public page serves a new asset containing the recovery markers. Verify the live route returns HTTP 200 and the public package still reports version 1.5.0.**
