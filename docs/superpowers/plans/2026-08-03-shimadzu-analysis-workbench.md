# Shimadzu Analysis Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, one-stop Shimadzu GC-MS Stage 0-6 analysis page to FlavorThresholdDB with uploads, parameter display, job monitoring, step/continuous execution, and result download.

**Architecture:** Keep the existing two-port runtime. Add a focused Python job service delegated from the 8787 proxy and an independent React feature module routed at `/FlavorThresholdDB/shimadzu-analysis/`. The service runs the deployed, validated Shimadzu skill in an ignored local runtime copy and records every job under `_local/shimadzu/jobs`.

**Tech Stack:** Python 3 standard library, `ThreadingHTTPServer`, Node.js ESM Shimadzu V2 CLI, React 19, Vite 8, Node test runner, Python `unittest`, Playwright browser verification.

---

### Task 1: Job-domain contract

**Files:**
- Create: `shimadzu_analysis_service.py`
- Create: `scripts/tests/test_shimadzu_analysis_service.py`

- [ ] **Step 1: Write failing service tests**

Cover exact stage definitions, `.xlsx` validation, fixed server-side filenames, UUID isolation, continuous and step-mode transitions, failed-stage stop, safe download gating, and path rejection. Use an injected fake command runner that writes a minimal valid stage manifest.

```python
service = ShimadzuAnalysisService(tmp_path, runner=fake_runner, skill_path=skill)
job = service.create_job(b"raw", "raw.xlsx", b"samples", "samples.xlsx", {"mode": "step"})
self.assertEqual(job["stages"][0]["status"], "pending")
service.start(job["id"])
self.assertEqual(wait_for_status(service, job["id"], "waiting_review")["next_stage"], 1)
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
python -m unittest scripts.tests.test_shimadzu_analysis_service -v
```

Expected: import failure for `shimadzu_analysis_service`.

- [ ] **Step 3: Implement the job service**

Implement `STAGES`, `ShimadzuAnalysisError`, `ShimadzuAnalysisService`, atomic `job.json`, thread-safe state updates, background execution, log capture, manifest parsing, final `verify`, and ZIP packaging. Store uploads as `input/raw.xlsx` and `input/samples.xlsx`; never derive paths from client filenames.

- [ ] **Step 4: Run service tests and confirm GREEN**

Expected: all new service tests pass with no task writing outside its UUID directory.

### Task 2: Local runtime bridge to the deployed skill

**Files:**
- Modify: `shimadzu_analysis_service.py`
- Modify: `scripts/tests/test_shimadzu_analysis_service.py`

- [ ] **Step 1: Add failing runtime tests**

Require capabilities to report the deployed skill, Node executable, bundled module directory, OAV disabled, and a stable unavailable reason when any dependency is missing.

```python
capabilities = service.capabilities()
self.assertFalse(capabilities["oav_enabled"])
self.assertEqual([stage["directory"] for stage in capabilities["stages"]], EXPECTED_STAGE_DIRS)
```

- [ ] **Step 2: Implement runtime preparation**

Resolve paths from `SHIMADZU_SKILL_PATH`, `SHIMADZU_NODE_PATH`, and `SHIMADZU_NODE_MODULES`, with local defaults. Copy only the deployed skill to `_local/shimadzu/runtime/skill`, create a Windows Junction at its `node_modules`, and invoke:

```text
node scripts/v2-cli.mjs stageN ... --output-root <job>/output
node scripts/v2-cli.mjs verify --output-root <job>/output
```

Never modify the deployed skill, shared package directory, or uploaded files.

- [ ] **Step 3: Run tests and confirm GREEN**

Expected: runtime availability and failure reasons are deterministic; fake-runner domain tests remain green.

### Task 3: HTTP API integration

**Files:**
- Modify: `fema_proxy_server.py`
- Create: `scripts/tests/test_shimadzu_proxy.py`

- [ ] **Step 1: Write failing handler/helper tests**

Test multipart parsing, 100 MB per-file limit contract, job creation, status lookup, run/continue state validation, missing-job 404, and download gating. Instantiate a handler-compatible fake service rather than running the external skill.

- [ ] **Step 2: Run the proxy tests and confirm RED**

Run:

```powershell
python -m unittest scripts.tests.test_shimadzu_proxy -v
```

Expected: missing Shimadzu routes/helpers.

- [ ] **Step 3: Add delegated routes**

Add:

```text
GET  /shimadzu/capabilities
POST /shimadzu/jobs
GET  /shimadzu/jobs/<id>
POST /shimadzu/jobs/<id>/run
POST /shimadzu/jobs/<id>/continue
GET  /shimadzu/jobs/<id>/download
```

Return JSON with stable `code` fields and use `Cache-Control: no-store` for job data and downloads. Leave all existing flavor, spectra, structure, and cache routes unchanged.

- [ ] **Step 4: Run new and existing Python tests**

Run:

```powershell
python -m unittest discover -s scripts/tests -p "test_*.py"
```

Expected: zero failures.

### Task 4: Frontend API and workbench page

**Files:**
- Create: `frontend/src/features/shimadzu/shimadzuApi.js`
- Create: `frontend/src/features/shimadzu/shimadzuApi.test.mjs`
- Create: `frontend/src/features/shimadzu/ShimadzuAnalysisPage.jsx`
- Create: `frontend/src/features/shimadzu/ShimadzuAnalysisPage.css`

- [ ] **Step 1: Write failing API contract tests**

Test endpoint construction, multipart field names, status normalization, retry-safe polling, and download URL generation.

- [ ] **Step 2: Implement the API module**

Export `getCapabilities`, `createJob`, `runJob`, `continueJob`, `getJob`, and `getDownloadUrl`; surface backend `code` and message without collapsing different scientific failures.

- [ ] **Step 3: Implement the independent page**

Build file upload, task name, continuous/step mode, locked scientific parameter summary, service readiness, seven-stage monitor, log tail, source hashes, completeness panel, and ZIP download. Persist the current job ID in `sessionStorage` and resume polling after refresh.

- [ ] **Step 4: Run focused frontend tests**

Run:

```powershell
node --test src/features/shimadzu/shimadzuApi.test.mjs
```

Expected: all focused tests pass.

### Task 5: Routing, navigation, and static build

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/scripts/create-static-routes.mjs`
- Modify: `frontend/src/staticRoutes.test.mjs`

- [ ] **Step 1: Extend the static-route test first**

Require both `aroma-threshold/index.html` and `shimadzu-analysis/index.html` to be created.

- [ ] **Step 2: Add minimal App routing**

Extend location parsing with a `shimadzu` view, render `ShimadzuAnalysisPage` outside the search page, and add the same top-nav entry to home and search views. Do not move existing search logic or modify cache behavior.

- [ ] **Step 3: Add shared navigation states and responsive rules**

Keep the existing HXQLab visual language, give the analysis route a distinct instrument-workbench surface, and preserve 44 px touch targets and keyboard focus visibility.

- [ ] **Step 4: Run tests, lint, and build**

Run:

```powershell
pnpm test:static-routes
pnpm lint
pnpm build
```

Expected: zero failures and both static paths generated.

### Task 6: Documentation and full local acceptance

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_HISTORY.md`
- Modify: `scripts/local_runtime.ps1`
- Create: `_local/verification/shimadzu-analysis-results.json` (ignored runtime evidence)

- [ ] **Step 1: Document the local-only workbench**

Describe required deployed skill paths, two uploaded workbooks, steps0-6, no-OAV boundary, job storage, and download behavior.

- [ ] **Step 2: Extend runtime health checks**

After the proxy is ready, require `GET /shimadzu/capabilities` to return HTTP 200. Do not require skill availability for the rest of FlavorThresholdDB to start; report unavailable capability on the page instead.

- [ ] **Step 3: Run a synthetic end-to-end job**

Use generated synthetic `.xlsx` fixtures, create a real job through HTTP, run steps0-6, poll to completion, download the ZIP, and assert the completeness report says PASS and `oavExecuted` is false.

- [ ] **Step 4: Perform browser acceptance**

Open `http://127.0.0.1:5174/FlavorThresholdDB/shimadzu-analysis/`; verify desktop and narrow layouts, top navigation, upload validation, seven-stage updates, failure display, refresh recovery, and download.

- [ ] **Step 5: Preserve existing worktree changes and record evidence**

Confirm `fema_flavor_cache.json` remains the user's pre-existing modification, list only intended new changes, and write the ignored verification JSON. Do not commit or publish without a separate user request.
