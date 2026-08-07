# Shimadzu failure retention and administrator controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make local Shimadzu browser analysis fail cleanly with downloadable partial evidence, expose detailed causes, support owner/admin result deletion, and provide an admin-wide task and input-download console without changing scientific computation.

**Architecture:** Extend the existing Worker error envelope and IndexedDB task record; package the stages already produced before a gate failure. Add additive Supabase job/storage metadata and owner-or-admin policies, then expose owner and administrator controls through the existing Shimadzu page. Keep the V2 core and stage contracts unchanged.

**Tech Stack:** React 19, Vite, Web Worker, JSZip, Supabase JS, Supabase SQL migrations, Node test runner.

---

### Task 1: Preserve structured Worker failures and partial archives

**Files:**
- Modify: `frontend/src/workers/shimadzuPipeline.js`
- Modify: `frontend/src/workers/shimadzu.worker.js`
- Modify: `frontend/src/lib/shimadzuWorkerClient.js`
- Test: `frontend/src/workers/shimadzuPipeline.test.mjs`
- Test: `frontend/src/lib/shimadzuWorkerClient.test.mjs`

- [ ] **Step 1: Write failing pipeline tests** for a stage-gate failure returning a structured error with stage, issues and a partial archive containing the already emitted stage files.
- [ ] **Step 2: Run the focused tests** with `pnpm exec node --test src/workers/shimadzuPipeline.test.mjs src/lib/shimadzuWorkerClient.test.mjs`; confirm the new assertions fail because details/partial archive are currently discarded.
- [ ] **Step 3: Implement the minimal failure envelope**. Keep completed stage data in the ZIP, add the failed stage report/manifest, compute archive hash, and throw an error object carrying `code`, `details`, `archiveBytes`, `archiveSha256`, `archiveSize`, and `fileName`. Do not alter any imported V2 core module.
- [ ] **Step 4: Preserve details in the Worker and client**. Transfer the partial archive buffer when posting the error and reconstruct the rejected client error with `details` and archive metadata.
- [ ] **Step 5: Re-run focused tests** and confirm PASS.

### Task 2: Persist failure evidence and expose detailed errors in the page

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`
- Modify: `frontend/src/lib/shimadzuTaskStore.js`
- Modify: `frontend/src/lib/shimadzuWorkerClient.js` if Task 1 requires a shared error helper
- Test: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`
- Test: `frontend/src/lib/shimadzuTaskStore.test.mjs`

- [ ] **Step 1: Add failing tests** for a failed task retaining error details/partial archive metadata and for the page rendering stage, issue code, sample/CAS and a partial-result download action.
- [ ] **Step 2: Run focused tests** and confirm the new assertions fail.
- [ ] **Step 3: Implement failure handling** in `runTask`: always set `failed`, stop submission, persist the existing IndexedDB task plus structured error and partial archive bytes, create a local download URL, upload partial evidence when cloud storage is configured, and update the cloud job as failed. Keep retry and new-task actions available.
- [ ] **Step 4: Add an accessible error-details panel** under the job bar, with a summary alert and an expandable list. Add a “下载已完成数据” button when a partial archive exists. Keep the generic code but show the human-readable issue details.
- [ ] **Step 5: Run focused tests and a manual static review** of the failure rendering contract.

### Task 3: Add result/input retention metadata, deletion, and admin storage policies

**Files:**
- Create: `supabase/migrations/20260807100000_shimadzu_result_admin_controls.sql`
- Modify: `frontend/src/lib/shimadzuCloud.js`
- Test: `frontend/src/lib/shimadzuCloud.test.mjs`

- [ ] **Step 1: Write failing cloud contract tests** for raw-input upload paths, partial-result upload metadata, owner/admin result deletion, admin job listing, and signed downloads.
- [ ] **Step 2: Run the focused cloud tests** and confirm they fail because the methods and metadata do not exist.
- [ ] **Step 3: Add the additive migration** with result kind, raw/sample paths, hashes, sizes, raw expiry, owner-or-admin storage policies, and an owner/admin deletion function that removes only result objects and result metadata. Preserve the 7-day result and 90-day record cleanup; raw inputs expire after 90 days.
- [ ] **Step 4: Extend `createShimadzuCloud`** with `uploadInputs`, `uploadPartialResult`, `deleteResult`, `listAdminJobs`, `listProfiles`, and scoped download helpers. Preserve existing methods and response shapes.
- [ ] **Step 5: Re-run focused cloud tests** and inspect the migration for owner/admin authorization and no raw-file access for ordinary users.

### Task 4: Add owner result deletion and administrator task console

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`
- Test: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`

- [ ] **Step 1: Add failing UI contract assertions** for owner-only result delete, admin task table, result/raw/sample downloads, and no cross-user actions for ordinary users.
- [ ] **Step 2: Run the focused UI test** and confirm the new assertions fail.
- [ ] **Step 3: Add owner deletion** to `HistoryPanel`; refresh history after deletion and retain the task row with “结果已删除”.
- [ ] **Step 4: Add `AdminTaskPanel`** under the signed-in admin account section. Load all jobs/profiles, show status/current stage/progress/error summary, and expose only admin-scoped result/raw/sample downloads and result deletion.
- [ ] **Step 5: Add responsive styles and accessible labels** without changing the existing analysis form or workflow layout.
- [ ] **Step 6: Re-run focused UI tests** and confirm PASS.

### Task 5: Integrate the full workflow and verify

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx` if integration wiring remains
- Modify: `supabase/migrations/20260807100000_shimadzu_result_admin_controls.sql` if static review finds a policy gap

- [ ] **Step 1: Run `pnpm run test:shimadzu` from `frontend` and record the result.**
- [ ] **Step 2: Run `pnpm run test:shimadzu-browser` from `frontend` and record the result.**
- [ ] **Step 3: Run `pnpm run lint` from `frontend` and fix only issues introduced by this work.**
- [ ] **Step 4: Run `pnpm run build` from `frontend` and verify the static route build succeeds.**
- [ ] **Step 5: Inspect `git diff --check`, changed-file scope, and the final migration; confirm no V2 scientific core files changed.**
