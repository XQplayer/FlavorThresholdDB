# Shimadzu Browser Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a no-server-cost Shimadzu GC-MS workbench where approved users run V2 stages 0–6 in their own browser, monitor progress, and retain private result archives for 7 days with task records for 90 days.

**Architecture:** A dedicated Web Worker parses `.xlsx` inputs, calls a browser-compatible snapshot of the validated V2 pure-function core, writes stage workbooks and manifests into an in-memory ZIP, and reports structured events to React. Supabase provides authentication, administrator approval, RLS-protected task metadata, and private result storage; when Supabase is absent the same runner remains available in clearly labelled local-privacy mode.

**Tech Stack:** React 19, Vite 8, Web Workers, SheetJS `xlsx`, JSZip, Web Crypto, Supabase Auth/Postgres/Storage, Node test runner, Playwright smoke tests.

---

## File map

- Create `frontend/src/lib/shimadzuBrowserContract.js`: validation, worker messages, retention constants and presentation helpers.
- Create `frontend/src/lib/shimadzuBrowserContract.test.mjs`: contract unit tests.
- Create `frontend/src/shimadzu-core/*.mjs`: hash-recorded pure V2 rule snapshot used outside React.
- Create `frontend/src/shimadzu-core/source-manifest.json`: upstream path and SHA-256 for every copied rule module.
- Create `scripts/sync_shimadzu_browser_core.ps1`: deterministic source sync and manifest generation.
- Create `frontend/src/workers/shimadzuWorkbook.js`: XLSX parse/write helpers and output naming.
- Create `frontend/src/workers/shimadzuPipeline.js`: stages 0–6 orchestration and normalized stage data.
- Create `frontend/src/workers/shimadzu.worker.js`: Worker message boundary, cancellation and progress.
- Create `frontend/src/lib/shimadzuWorkerClient.js`: promise/event wrapper around Worker.
- Create `frontend/src/lib/shimadzuCloud.js`: auth, approval, job history and private result upload/download.
- Create `frontend/src/lib/shimadzuCloud.test.mjs`: expiry/path/permission helper tests.
- Create `frontend/src/components/shimadzu/ShimadzuAccountPanel.jsx`: login, registration and approval state.
- Create `frontend/src/components/shimadzu/ShimadzuHistoryPanel.jsx`: 90-day history and 7-day result presentation.
- Modify `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`: select local/cloud engine, Worker execution, progress, review, upload and history.
- Modify `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`: account/history/worker states.
- Modify `frontend/src/lib/supabase.js`: persistent auth session suitable for approved users.
- Create `supabase/migrations/20260803070000_shimadzu_browser_analysis.sql`: schema, trigger, RLS, private bucket and cleanup RPC.
- Modify `frontend/package.json` and `frontend/pnpm-lock.yaml`: add `xlsx` and `jszip`, add browser tests.
- Create `scripts/e2e/verify_shimadzu_browser_analysis.mjs`: anonymous/local worker and approved-user UI smoke coverage.
- Modify `README.md`: deployment variables, administrator bootstrap and retention behavior.

### Task 1: Browser contract and dependencies

- [ ] Write failing tests in `frontend/src/lib/shimadzuBrowserContract.test.mjs` for `.xlsx` validation, 50 MB limits, stage event validation, 7/90-day expiry and cloud-mode presentation.
- [ ] Run `pnpm exec node --test src/lib/shimadzuBrowserContract.test.mjs` and confirm failure because the module is missing.
- [ ] Add `xlsx` and `jszip` with `pnpm add xlsx jszip` and implement:

```js
export const RESULT_RETENTION_DAYS = 7
export const RECORD_RETENTION_DAYS = 90
export const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024
export const assertWorkbookFile = file => {
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > MAX_WORKBOOK_BYTES) {
    throw Object.assign(new Error('INVALID_XLSX_INPUT'), { code: 'INVALID_XLSX_INPUT' })
  }
  return file
}
export const expiryFrom = (date, days) => new Date(new Date(date).getTime() + days * 86400000).toISOString()
```

- [ ] Export `validateWorkerEvent`, `browserEnginePresentation`, and immutable stage definitions matching the existing seven-stage UI.
- [ ] Run the contract tests and `pnpm run lint`; expect all tests to pass and zero lint errors.
- [ ] Commit `test/feat: define Shimadzu browser runtime contract`.

### Task 2: Reusable V2 rule snapshot with drift detection

- [ ] Add a PowerShell sync test that copies only `normalize`, `parse-shimadzu`, `filtering`, `duplicate-cas`, `semiquant`, and the V2 stage pure-function modules plus their direct dependencies.
- [ ] Generate `source-manifest.json` entries shaped as:

```json
{
  "schemaVersion": "shimadzu-browser-core-1",
  "files": [{ "name": "normalize.mjs", "source": "scripts/core/normalize.mjs", "sha256": "..." }]
}
```

- [ ] Add `frontend/src/shimadzu-core/coreParity.test.mjs` that imports the copied modules and asserts the agreed duplicate-CAS, internal-standard, 2/3, 1/3, sample-SD and CV30 boundary cases.
- [ ] Run the parity test before copying and confirm it fails with missing imports.
- [ ] Sync the modules without editing scientific logic; update relative imports only if the module directory changes.
- [ ] Run parity tests and compare the manifest hashes to the source directory; expect exact matches.
- [ ] Commit `feat: vendor verified Shimadzu browser core`.

### Task 3: Browser XLSX adapter and stage archive writer

- [ ] Add tests that load `resources/shimadzu/templates/*.xlsx`, verify sheet order and typed rows, write a table workbook, reopen it, and verify headers, numeric values, NA text, four-decimal number formats and safe sheet names.
- [ ] Confirm the tests fail because `shimadzuWorkbook.js` is missing.
- [ ] Implement `readWorkbookSheets(arrayBuffer)`, `readSampleConfiguration(arrayBuffer)`, `writeTableWorkbook(sheets)`, `safeSheetName`, and `addJsonFile(zip, path, value)` using SheetJS and JSZip.
- [ ] Preserve source row numbers by returning `{ sourceRow, cells }`; use `raw: true` and `defval: null` so zero and NA are not conflated.
- [ ] Add header style, frozen first row, explicit widths, original numeric values and `0.0000` formats only for calculated concentration/SD/CV columns.
- [ ] Run workbook adapter tests and reopen every generated workbook.
- [ ] Commit `feat: add browser XLSX and archive adapters`.

### Task 4: Stage 0–6 browser orchestrator

- [ ] Add `shimadzuPipeline.test.mjs` with a synthetic three-replicate workbook covering Hit #1, Cl/F/Si removal, duplicate peak decisions, missing internal standard, 2/3 imputation, 1/3 removal, semiquantitation, Mean/SD/CV30 and matrix split.
- [ ] Assert emitted event sequence `0..6`, `oavExecuted === false`, stage manifests, full lineage and required output paths.
- [ ] Confirm failure before `runShimadzuBrowserPipeline` exists.
- [ ] Implement stage assembly with the copied pure functions:

```js
export async function runShimadzuBrowserPipeline({ rawBytes, sampleBytes, name, onEvent, signal }) {
  const context = await buildStage0(rawBytes, sampleBytes)
  const stage1 = await buildStage1(context)
  const stage2 = await buildStage2(stage1)
  const stage3 = await buildStage3(stage2, context.samples)
  const stage4 = await buildStage4(stage3, context.samples)
  const stage5 = await buildStage5(stage4)
  const stage6 = await buildStage6(stage5)
  return packageResult({ name, stages: [context, stage1, stage2, stage3, stage4, stage5, stage6] })
}
```

- [ ] At every stage write `data.json`, `manifest.json`, SHA-256 sidecars, the required report/table workbooks, and reconcile input/removed/imputed/retained counts.
- [ ] Create the completeness report and reject any OAV-named output.
- [ ] Run synthetic tests, then run the representative `CT&JX1-3.xlsx` pair read-only and compare normalized stage counts, tables, logs and QC with the accepted V2 data JSON baseline.
- [ ] Commit `feat: run Shimadzu V2 stages in the browser`.

### Task 5: Worker boundary and live monitor

- [ ] Add Worker client tests with a fake Worker for start, progress, review, cancel, error and complete messages.
- [ ] Confirm failure before the client and Worker modules exist.
- [ ] Implement `shimadzu.worker.js` so only transferable `ArrayBuffer` inputs cross the boundary; never post the raw workbook back to the main thread.
- [ ] Implement `createShimadzuWorkerClient` with `start`, `continueReview`, `cancel`, event subscription and deterministic cleanup/object URL revocation.
- [ ] Update `ShimadzuAnalysisPage.jsx` to choose browser execution whenever the public API reports unavailable, display `ENGINE BROWSER`, and drive the existing flow map and monitor from worker events.
- [ ] Keep the local API path available for local regression, but public analysis must not require it.
- [ ] Run component helper tests and browser smoke test with network interception asserting no request contains source workbook bytes.
- [ ] Commit `feat: connect browser worker to Shimadzu monitor`.

### Task 6: Supabase auth, approval and retention schema

- [ ] Add SQL contract tests/static assertions for table names, RLS enablement, ownership policies, private bucket, default pending approval, 7-day results and 90-day records.
- [ ] Create the migration with `profiles`, `shimadzu_jobs`, `shimadzu_job_events`, indexes, updated-at triggers, `is_shimadzu_admin()`, RLS policies and a protected `cleanup_expired_shimadzu_data()` RPC.
- [ ] Ensure the storage path starts with `auth.uid()::text` and normal users cannot set `is_admin` or `approval_status`.
- [ ] Update Supabase client auth to `persistSession: true` and `autoRefreshToken: true` without exposing a service-role key.
- [ ] Implement cloud helpers for sign-up/sign-in/sign-out, profile fetch, job creation/update, result upload, signed download URL and history queries.
- [ ] Run unit tests and apply the migration to a disposable/local Supabase database when available; otherwise validate SQL structure and publish the migration for the configured project deployment step.
- [ ] Commit `feat: secure Shimadzu users and retained results`.

### Task 7: Account, approval and history UI

- [ ] Add UI tests for anonymous, pending, rejected, approved, administrator and unconfigured Supabase states.
- [ ] Implement `ShimadzuAccountPanel.jsx` and `ShimadzuHistoryPanel.jsx` with approved-user gating, 7-day countdown, expired labels, signed re-download and administrator review controls.
- [ ] Integrate job lifecycle: create metadata before Worker start, update stage summaries during analysis, upload ZIP after completion, preserve local download on upload failure, and write safe failure status.
- [ ] Add local-privacy fallback that permits browser computation when Supabase is not configured and explicitly disables cloud history/approval claims.
- [ ] Extend CSS using existing Shimadzu tokens; verify desktop, mobile and reduced-motion layouts with no horizontal overflow.
- [ ] Commit `feat: add Shimadzu access and result history`.

### Task 8: Full verification, documentation and publication

- [ ] Update README with free architecture, environment variables, admin bootstrap SQL, data policy, browser-close limitation and 7/90-day cleanup.
- [ ] Run all Shimadzu/browser/core tests, all existing frontend tests, Python tests, ESLint and production build.
- [ ] Run the representative workbook parity check and capture counts/hashes without modifying the source workbooks.
- [ ] Run E2E at desktop, mobile and reduced motion; assert seven stages complete, a ZIP downloads, no original upload occurs, and zero console errors.
- [ ] Confirm `frontend/package.json` version remains `1.5.0` and no changelog/version bump exists.
- [ ] Commit final docs/tests, push the feature branch, open a PR and merge after checks pass.
- [ ] Deploy GitHub Pages and apply the Supabase migration/configuration.
- [ ] On the public URL verify anonymous gating, an approved test account, complete browser analysis, private result re-download and accurate expiry presentation.
- [ ] Preserve unrelated `fema_flavor_cache.json` and search-workbench files; do not push the local main branch's unrelated commits.
