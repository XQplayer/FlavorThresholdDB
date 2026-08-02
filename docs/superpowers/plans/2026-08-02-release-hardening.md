# FlavorThresholdDB Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unsafe Excel parser, make scientific-property caches self-invalidating, standardize single-instance local startup, isolate runtime artifacts, and verify the current FlavorDB2/PubChem release candidate end to end.

**Architecture:** Keep the existing Python proxy and React application boundaries. Add a small cache-policy layer to the proxy, a project-scoped PowerShell runtime controller behind the existing CMD entry point, and static regression checks for removed or lazily loaded frontend dependencies. Preserve the current uncommitted FlavorDB2/PubChem work and avoid broad `App.jsx` restructuring.

**Tech Stack:** Python 3 `unittest`, PowerShell 7/Windows PowerShell, React 19, Vite 8, Node test runner, pnpm, Playwright.

---

## File map

- Modify `fema_proxy_server.py`: PubChem volatile cache metadata, TTL, compatibility checks.
- Modify `scripts/tests/test_pubchem_volatile.py`: cache-version and expiry regression tests.
- Modify `frontend/src/App.jsx`: remove Excel upload UI and parser flow.
- Modify `frontend/package.json` and `frontend/pnpm-lock.yaml`: remove `xlsx`.
- Create `frontend/src/releaseHardening.test.mjs`: static release-boundary tests.
- Create `scripts/local_runtime.ps1`: start, check, and stop project-owned local services.
- Modify `start_local.cmd`: compatibility wrapper for the PowerShell controller.
- Create `scripts/tests/test_local_runtime_scripts.py`: static and behavioral runtime-script tests.
- Modify `.gitignore`: ignore local orchestration and verification artifacts.
- Move reusable Playwright coverage to `scripts/e2e/verify_release_candidate.mjs` and remove personal absolute runtime imports.
- Modify `frontend/src/App.css`: fixed-footer safe spacing.
- Modify `README.md`, `CHANGELOG.md`, `docs/DATA_SOURCES.md`, `docs/RELEASE_CHECKLIST.md`, and `PROJECT_HISTORY.md`: synchronize contracts and release state.

### Task 1: Version and expire PubChem volatile cache entries

**Files:**
- Modify: `scripts/tests/test_pubchem_volatile.py`
- Modify: `fema_proxy_server.py`

- [ ] **Step 1: Write failing cache-policy tests**

Add tests that construct current, old-version, missing-metadata, and expired cache entries. The expected public helper contract is:

```python
def test_pubchem_volatile_cache_requires_current_parser_version(self):
    stale = self.make_cached_result(parser_version="0")
    self.assertFalse(proxy.is_pubchem_volatile_cache_entry_current(stale, now=self.now))

def test_pubchem_volatile_cache_expires_after_ttl(self):
    expired = self.make_cached_result(retrieved_at="2026-06-01T00:00:00Z")
    self.assertFalse(proxy.is_pubchem_volatile_cache_entry_current(expired, now=self.now))

def test_pubchem_volatile_cache_accepts_current_metadata(self):
    current = self.make_cached_result(
        schema_version=proxy.PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION,
        parser_version=proxy.PUBCHEM_VOLATILE_PARSER_VERSION,
        retrieved_at="2026-08-01T00:00:00Z",
    )
    self.assertTrue(proxy.is_pubchem_volatile_cache_entry_current(current, now=self.now))
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
& $python -m unittest scripts.tests.test_pubchem_volatile.PubChemVolatilePropertyHandlerTests -v
```

Expected: FAIL because the constants/helper do not exist and stale cache entries are still returned.

- [ ] **Step 3: Implement minimal cache metadata and validation**

Add UTC parsing and constants to `fema_proxy_server.py`:

```python
PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION = 1
PUBCHEM_VOLATILE_PARSER_VERSION = "2026-08-02-water-medium-v2"
PUBCHEM_VOLATILE_CACHE_TTL = timedelta(days=30)

def is_pubchem_volatile_cache_entry_current(entry: dict, *, now: datetime | None = None) -> bool:
    if entry.get("schema_version") != PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION:
        return False
    if entry.get("parser_version") != PUBCHEM_VOLATILE_PARSER_VERSION:
        return False
    retrieved_at = parse_utc_timestamp(entry.get("retrieved_at"))
    reference_time = now or datetime.now(timezone.utc)
    return retrieved_at is not None and reference_time - retrieved_at <= PUBCHEM_VOLATILE_CACHE_TTL
```

Stamp successful query results with both versions. In `_get_pubchem_volatile_cached`, return the cached value only when the helper returns true; otherwise query and atomically replace that one key.

- [ ] **Step 4: Run all proxy tests and verify GREEN**

Run:

```powershell
& $python -m unittest discover -s scripts/tests -p 'test_*.py' -v
```

Expected: all tests pass, including stale-cache replacement and existing single-flight/rollback tests.

- [ ] **Step 5: Commit the cache policy**

```powershell
git add fema_proxy_server.py scripts/tests/test_pubchem_volatile.py
git commit -m "fix: version PubChem volatile cache"
```

### Task 2: Pause Excel import and remove SheetJS

**Files:**
- Create: `frontend/src/releaseHardening.test.mjs`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`

- [ ] **Step 1: Write a failing static boundary test**

Create a Node test that reads `App.jsx` and `package.json`:

```js
test('release build does not expose Excel import or ship SheetJS', async () => {
  const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies?.xlsx, undefined);
  assert.doesNotMatch(app, /from ['"]xlsx['"]|XLSX\.read|handleFileUpload|file-upload/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test src/releaseHardening.test.mjs
```

Expected: FAIL because `xlsx`, `handleFileUpload`, and the upload control still exist.

- [ ] **Step 3: Remove the import flow and dependency**

Remove `XLSX`, `Upload`, `fileInputRef`, `handleFileUpload`, the hidden file input, and its label from `App.jsx`. Keep bulk text input, search, CSV export, and `FileSpreadsheet` where it still represents export actions.

Run:

```powershell
pnpm remove xlsx
```

Expected: `package.json` and `pnpm-lock.yaml` no longer contain the direct SheetJS dependency.

- [ ] **Step 4: Verify tests and production audit**

Run:

```powershell
node --test src/*.test.mjs
pnpm lint
pnpm audit --prod
```

Expected: all tests/lint pass; audit reports zero high or critical vulnerabilities.

- [ ] **Step 5: Commit the Excel suspension**

```powershell
git add frontend/src/App.jsx frontend/src/releaseHardening.test.mjs frontend/package.json frontend/pnpm-lock.yaml
git commit -m "fix: suspend unsafe Excel import"
```

### Task 3: Standardize single-instance background startup

**Files:**
- Create: `scripts/local_runtime.ps1`
- Modify: `start_local.cmd`
- Create: `scripts/tests/test_local_runtime_scripts.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing script-contract tests**

Test exact ports, hidden-window startup, strict frontend port, project-path process validation, health URLs, and check/start/stop actions:

```python
def test_runtime_controller_uses_project_ports_and_health_checks(self):
    script = RUNTIME_SCRIPT.read_text(encoding="utf-8")
    self.assertIn("[ValidateSet('start', 'check', 'stop')]", script)
    self.assertIn("5174", script)
    self.assertIn("8787", script)
    self.assertIn("--strictPort", script)
    self.assertIn("-WindowStyle Hidden", script)
    self.assertIn("/FlavorThresholdDB/aroma-threshold/", script)
    self.assertIn("/health", script)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
& $python -m unittest scripts.tests.test_local_runtime_scripts -v
```

Expected: FAIL because `scripts/local_runtime.ps1` does not exist and `start_local.cmd` still starts port 5173 directly.

- [ ] **Step 3: Implement the controller and wrapper**

`scripts/local_runtime.ps1` accepts `start`, `check`, or `stop`. It resolves the repository path, inspects listeners with `Get-NetTCPConnection`, reads owning command lines with `Get-CimInstance`, and treats a process as project-owned only when the command line contains the resolved repository path plus either `fema_proxy_server.py` or the frontend Vite entry.

For `start`, reuse healthy project-owned listeners; reject unknown owners; launch missing processes with `Start-Process -WindowStyle Hidden`; then poll all required URLs. Store only confirmed project PIDs under `_local/runtime/`.

`start_local.cmd` becomes:

```bat
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local_runtime.ps1" start
exit /b %errorlevel%
```

- [ ] **Step 4: Verify lifecycle behavior**

Run the static test, then:

```powershell
& scripts/local_runtime.ps1 stop
& scripts/local_runtime.ps1 start
& scripts/local_runtime.ps1 start
& scripts/local_runtime.ps1 check
```

Expected: the second start reports reuse; exactly one project-owned frontend listener and one proxy listener remain; all health checks return HTTP 200.

- [ ] **Step 5: Commit runtime control**

```powershell
git add scripts/local_runtime.ps1 scripts/tests/test_local_runtime_scripts.py start_local.cmd .gitignore
git commit -m "fix: make local runtime single instance"
```

### Task 4: Isolate verification artifacts and promote reusable E2E

**Files:**
- Modify: `.gitignore`
- Create: `scripts/e2e/verify_release_candidate.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Extend the failing release-boundary test**

Assert `.gitignore` contains root-scoped `/.playwright-cli/` and `/.superpowers/`, and that the package exposes `test:e2e` pointing to the repository-owned script.

- [ ] **Step 2: Run the test and verify RED**

Expected: FAIL because the temporary directories are not ignored and no stable E2E command exists.

- [ ] **Step 3: Move the reusable Playwright scenario**

Copy only the general test logic from `.playwright-cli/verify-pubchem-volatile.mjs`. Resolve Playwright and runtimes through environment variables or normal package resolution; do not hard-code `C:/Users/hanxq`. Write screenshots and JSON to `_local/verification/`.

Add:

```json
"test:e2e": "node ../scripts/e2e/verify_release_candidate.mjs"
```

- [ ] **Step 4: Run E2E and verify cleanup**

Run `pnpm run test:e2e`. Expected: desktop/mobile/failure-isolation checks pass, no horizontal overflow, and temporary ports are released.

- [ ] **Step 5: Commit artifact isolation**

```powershell
git add .gitignore scripts/e2e/verify_release_candidate.mjs frontend/package.json
git commit -m "test: promote release candidate e2e"
```

### Task 5: Verify lazy structure loading and fix footer overlap

**Files:**
- Modify: `frontend/src/releaseHardening.test.mjs`
- Modify: `frontend/src/App.css`
- Modify: `scripts/e2e/verify_release_candidate.mjs`

- [ ] **Step 1: Add failing layout and bundle-boundary checks**

Static tests require `import('3dmol')` and `import('@rdkit/rdkit')`, while prohibiting static imports of either package. The E2E test compares the last main-content rectangle with the fixed footer rectangle and requires no overlap after scrolling to the page bottom.

- [ ] **Step 2: Run tests and identify the expected RED**

Expected: lazy-load assertions already pass; footer overlap assertion fails on the current full page. This documents that no unnecessary RDKit/3Dmol rewrite is required.

- [ ] **Step 3: Add minimal safe footer spacing**

Define one footer-height variable and apply it to the application shell:

```css
:root { --fixed-footer-safe-space: 44px; }
.app-shell { padding-bottom: calc(var(--fixed-footer-safe-space) + env(safe-area-inset-bottom, 0px)); }
```

Adjust the mobile value only if the measured footer is taller.

- [ ] **Step 4: Re-run static, desktop, and mobile checks**

Expected: lazy-load boundaries pass; no content/footer overlap or horizontal overflow; no console/page/API errors.

- [ ] **Step 5: Commit the layout fix**

```powershell
git add frontend/src/App.css frontend/src/releaseHardening.test.mjs scripts/e2e/verify_release_candidate.mjs
git commit -m "fix: reserve space for fixed footer"
```

### Task 6: Synchronize project and release documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/RELEASE_CHECKLIST.md`
- Modify: `PROJECT_HISTORY.md`

- [ ] **Step 1: Add documentation consistency assertions**

Extend the release-hardening test to require the canonical local URL, proxy URL, FlavorDB2, PubChem PUG View, cache versioning, and Excel suspension in the relevant documents. Require `PROJECT_HISTORY.md` to distinguish stable `main` from the current feature branch.

- [ ] **Step 2: Run and verify RED**

Expected: FAIL on stale ports, old test totals, missing cache policy, or missing Excel suspension language.

- [ ] **Step 3: Update all documents from verified facts**

Record actual test counts only after Task 7. Keep `v1.3.1` as the last public stable release and describe the current work as an unreleased candidate. Add cache and dependency-audit checks to the release checklist.

- [ ] **Step 4: Run documentation tests and inspect the diff**

Run the static test and `git diff --check`. Expected: both pass; no document claims that the feature branch is already public.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md CHANGELOG.md docs/DATA_SOURCES.md docs/RELEASE_CHECKLIST.md PROJECT_HISTORY.md frontend/src/releaseHardening.test.mjs
git commit -m "docs: synchronize release hardening state"
```

### Task 7: Full release-candidate verification

**Files:**
- Verify all changed files
- Do not include `fema_flavor_cache.json` or `_local/` in the feature commit

- [ ] **Step 1: Run Python and book-index suites**

```powershell
& $python -m unittest discover -s scripts/tests -p 'test_*.py' -v
Push-Location scripts/book_index
& $python -m unittest test_book_index_pipeline
Pop-Location
```

Expected: zero failures and the 60 book-index tests remain green.

- [ ] **Step 2: Run frontend verification**

```powershell
Push-Location frontend
node --test src/*.test.mjs
pnpm lint
pnpm build
pnpm audit --prod
pnpm run test:e2e
Pop-Location
```

Expected: zero test/lint/build/audit failures; desktop/mobile/failure-isolation E2E passes.

- [ ] **Step 3: Verify scientific cache refresh**

Start the single runtime, query `/pubchem-volatile?cid=8857`, and confirm the returned record carries current schema/parser versions. Compare a direct fresh parse and cached response; water-solubility records must use the same current explicit-aqueous classification.

- [ ] **Step 4: Verify repository boundaries**

```powershell
git diff --check
git status --short
git diff --name-only --cached
```

Expected: no staged runtime cache, screenshots, logs, PID files, `.playwright-cli`, `.superpowers`, or `_local` artifacts.

- [ ] **Step 5: Update verified counts and create the final implementation commit**

Update only count statements that differ from measured output, rerun the affected static test, then commit the final verification adjustment:

```powershell
git add PROJECT_HISTORY.md README.md CHANGELOG.md
git commit -m "chore: finalize release hardening verification"
```

- [ ] **Step 6: Produce the handoff**

Report commits, exact verification counts, remaining third-party build warnings, current branch/worktree status, rollback commit, and whether the candidate is ready for a later merge and public deployment. Do not merge or deploy without a new explicit user instruction.
