# Public Spectrum Index Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, publish, install, and validate a versioned slim GNPS/MassBank lookup index without committing database artifacts to Git.

**Architecture:** A deterministic Python builder copies only public lookup metadata from the local SQLite index into a slim schema and emits a compressed artifact plus manifest. The proxy installer validates size, SHA-256, schema, integrity, counts, and minimum proxy version before atomic promotion; a valid old index survives every failed update.

**Tech Stack:** Python standard library, SQLite, gzip initially, unittest, GitHub Release assets, Render-compatible filesystem.

---

### Task 1: Manifest and tracked-file guards

**Files:**
- Create: `spectra_index_distribution.py`
- Create: `scripts/tests/test_spectra_index_distribution.py`
- Modify: `.gitignore`

- [ ] Write failing tests for canonical manifest validation, missing fields, unsafe URLs, malformed SHA-256, impossible sizes/counts, schema mismatch, and detection of tracked `.sqlite`, `.sqlite-wal`, `.db`, `.gz`, and index payloads.
- [ ] Confirm the focused Python test fails for the missing module.
- [ ] Implement `validate_index_manifest` and `find_forbidden_tracked_index_files`, using `git ls-files -z` only in the CLI guard and pure path validation in tests.
- [ ] Add explicit ignore rules for runtime index archives, staging directories, SQLite journals, and manifest build scratch files while retaining the committed manifest path.
- [ ] Run focused tests and commit with `git commit -m "feat: define public spectrum index manifest"`.

### Task 2: Deterministic slim-index builder

**Files:**
- Create: `scripts/spectra/build_public_spectrum_index.py`
- Create: `scripts/tests/fixtures/gnps_public_source.sqlite` through test setup code, not a binary fixture
- Modify: `scripts/tests/test_spectra_index_distribution.py`

- [ ] Add failing tests that create a temporary source database and assert exact slim columns, indexes, record deduplication, excluded peaks, source-library counts, deterministic row content, `PRAGMA integrity_check`, gzip output, and SHA-256 manifest.
- [ ] Run the focused test and confirm missing builder behavior.
- [ ] Implement streaming `INSERT … SELECT`/batched copy into a temporary database, fixed schema version, normalized connectivity InChIKey, `VACUUM`, integrity check, gzip with deterministic timestamp, and manifest emission.
- [ ] Add `--source`, `--output-dir`, `--version`, and `--asset-url` arguments. Reject paths outside explicit files; never infer a deletion target.
- [ ] Run focused tests and build a local candidate under `_local/release-assets/`.
- [ ] Commit with `git commit -m "feat: build slim public spectrum index"`.

### Task 3: Proxy installer and rollback

**Files:**
- Modify: `spectra_index_distribution.py`
- Create: `scripts/tests/test_spectra_index_installer.py`
- Modify: `fema_proxy_server.py`

- [ ] Write failing tests for first install, cache reuse, stale manifest, truncated download, hash mismatch, decompression failure, invalid SQLite, wrong schema, wrong counts, minimum proxy mismatch, atomic promotion, and preservation of a valid old index.
- [ ] Confirm focused failures before implementation.
- [ ] Implement injected fetch/clock/filesystem-friendly installer functions. Download and decompress to unique files in the configured runtime directory, validate, then use `os.replace`.
- [ ] Add startup initialization and `GET /spectra/index-status`. Do not block `/health`; expose `missing`, `downloading`, `ready`, `stale`, or `invalid` plus degradation reason.
- [ ] Route GNPS metadata search to the installed index when ready and retain direct SpectrumID/USI plus MassBank live API fallback otherwise.
- [ ] Run all Python tests and commit with `git commit -m "feat: install public spectrum index safely"`.

### Task 4: Release workflow and deployment documentation

**Files:**
- Create: `data/manifests/public_spectrum_index.json`
- Create: `scripts/spectra/publish_public_spectrum_index.ps1`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/RELEASE_CHECKLIST.md`
- Modify: `PROJECT_HISTORY.md`

- [ ] Add dry-run tests or parser assertions proving the PowerShell script refuses a dirty manifest, unverified hash, missing tag, tracked index, or absent GitHub CLI authentication.
- [ ] Implement an explicit dry-run default; require `-Publish` to create/upload a GitHub Release asset and update no file implicitly.
- [ ] Document build, inspection, asset upload, manifest update, rollback, Render runtime directory, and degraded-mode behavior.
- [ ] Run Python tests, manifest validation, `git diff --check`, and confirm the 1.04 GB source index remains ignored and untracked.
- [ ] Commit with `git commit -m "docs: add public spectrum index release workflow"`.

