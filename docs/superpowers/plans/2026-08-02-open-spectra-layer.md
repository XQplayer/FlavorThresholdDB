# Open Spectra Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add traceable MassBank and GNPS public-spectrum search, permitted downloads, and transparent pairwise comparison to each resolved compound.

**Architecture:** Extend the Python proxy with source adapters and a unified spectrum contract, then add a focused React workbench that consumes only the unified endpoints. Fetch search metadata eagerly and peaks lazily; enforce identity, compatibility, provenance, and record-level licensing in the backend.

**Tech Stack:** Python standard library proxy and unittest, React 19, native SVG, Node test runner, ESLint, Vite.

---

### Task 1: Unified spectrum contract and identity matching

**Files:**
- Create: `spectra_service.py`
- Create: `scripts/tests/test_spectra_service.py`

- [x] Write failing tests for normalized records, full/connectivity InChIKey matching, CAS matching, name-only candidates, peak validation, and provenance fields.
- [x] Run `python -m unittest scripts.tests.test_spectra_service -v` and confirm failures are caused by the missing service.
- [x] Implement `normalize_spectrum_record`, `rank_identity_match`, and peak normalization with explicit validation.
- [x] Re-run the focused test and confirm all cases pass.

### Task 2: Compatibility and similarity engine

**Files:**
- Modify: `spectra_service.py`
- Modify: `scripts/tests/test_spectra_service.py`

- [x] Add failing tests for EI/EI, MS2/MS2, incompatible EI/MS2, ion-mode warnings, tolerance boundaries, unique peak assignment, cosine score, and bilateral coverage.
- [x] Confirm the new tests fail for missing comparison behavior.
- [x] Implement `assess_compatibility`, `match_peaks`, and `compare_spectra` without hidden classification thresholds.
- [x] Re-run the focused tests and confirm they pass.

### Task 3: MassBank adapter

**Files:**
- Create: `spectra_massbank.py`
- Create: `scripts/tests/fixtures/massbank_search.json`
- Create: `scripts/tests/fixtures/massbank_record.json`
- Create: `scripts/tests/test_spectra_massbank.py`

- [x] Add fixture-backed failing tests for search parsing, one-record peak parsing, experimental metadata, identity evidence, upstream errors, and license state.
- [x] Confirm failures before implementation.
- [x] Implement the official MassBank API adapter with injected fetchers and conversion to the unified contract.
- [x] Run adapter and service tests.

### Task 4: GNPS adapter

**Files:**
- Create: `scripts/spectra/rebuild_gnps_index.py`
- Create: `spectra_gnps.py`
- Create: `scripts/tests/fixtures/gnps_search.json`
- Create: `scripts/tests/fixtures/gnps_record.json`
- Create: `scripts/tests/test_spectra_gnps.py`

- [ ] Add fixture-backed failing tests for library discovery, incremental SQLite indexing, atomic per-library replacement, InChIKey lookup, SpectrumID, USI, peaks, precursor, ion mode, adduct, instrument, identity evidence, imported-library license caution, and upstream errors.
- [ ] Confirm failures before implementation.
- [ ] Implement the GNPS2 slim-metadata indexer and documented single-spectrum adapters with injected fetchers. Store the generated database under `_local/indexes` and never commit it.
- [ ] Run adapter and service tests.

### Task 5: Unified proxy routes and cache policy

**Files:**
- Modify: `fema_proxy_server.py`
- Create: `scripts/tests/test_spectra_proxy.py`

- [ ] Add failing handler/service tests for `/spectra/search`, one-spectrum detail, permitted downloads, comparison, partial-source failure, invalid input, and restricted download.
- [ ] Confirm endpoint tests fail for absent routes.
- [ ] Add source aggregation, lazy detail loading, schema-versioned cache keys, 24-hour search TTL, 30-day permitted-peak TTL, and memory-only handling for unclear licenses.
- [ ] Implement JSON, CSV, MSP, and MGF serialization with provenance headers.
- [ ] Run all Python tests.

### Task 6: Frontend data model and state transitions

**Files:**
- Create: `frontend/src/spectra/spectrumContract.js`
- Create: `frontend/src/spectra/spectrumCompatibility.js`
- Create: `frontend/src/spectra/spectrumFilters.js`
- Create: `frontend/src/spectra/spectra.test.mjs`

- [ ] Add failing Node tests for response normalization, count derivation, filters, compatibility labels, and one-click A/B replacement state.
- [ ] Confirm failures before implementation.
- [ ] Implement the minimal pure functions.
- [ ] Run `node --test frontend/src/spectra/spectra.test.mjs`.

### Task 7: Open Spectra workbench

**Files:**
- Create: `frontend/src/components/spectra/OpenSpectraWorkbench.jsx`
- Create: `frontend/src/components/spectra/SpectraSummary.jsx`
- Create: `frontend/src/components/spectra/SpectraFilters.jsx`
- Create: `frontend/src/components/spectra/SpectrumRecordList.jsx`
- Create: `frontend/src/components/spectra/SpectrumViewer.jsx`
- Create: `frontend/src/components/spectra/SpectrumMetadata.jsx`
- Create: `frontend/src/components/spectra/SpectrumDownloadMenu.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`

- [ ] Add source-level assertions to `frontend/src/releaseHardening.test.mjs` for module boundaries, accessible controls, lazy detail fetch, and mutually exclusive download menus.
- [ ] Confirm the assertions fail before components exist.
- [ ] Implement summary, filters, responsive list/detail layout, SVG stick spectrum, scrollable peak table, metadata, provenance, and license-aware downloads.
- [ ] Integrate the workbench after the compound archive without moving existing sections.
- [ ] Run frontend tests, lint, and production build.

### Task 8: Mirror comparison UI

**Files:**
- Create: `frontend/src/components/spectra/SpectrumComparison.jsx`
- Create: `frontend/src/components/spectra/MirrorSpectrumPlot.jsx`
- Modify: `frontend/src/components/spectra/OpenSpectraWorkbench.jsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/releaseHardening.test.mjs`

- [ ] Add failing assertions for A/B replacement, compatibility warnings, tolerance controls, mirror orientation, matched-peak emphasis, and comparison exports.
- [ ] Confirm failures before implementation.
- [ ] Implement the comparison controls and accessible SVG mirror plot using backend metrics.
- [ ] Run frontend tests, lint, and build.

### Task 9: End-to-end verification and documentation

**Files:**
- Modify: `scripts/e2e/verify_release_candidate.mjs`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `PROJECT_HISTORY.md`

- [ ] Add E2E checks for ethyl acetate, partial-source failure, record selection, permitted download, and comparison.
- [ ] Run all Python tests, all frontend tests, ESLint, production build, and E2E verification against `127.0.0.1:5174` plus proxy `127.0.0.1:8787`.
- [ ] Record exact endpoints, fields, license rules, cache policy, and verification evidence in project documentation.
- [ ] Review `git diff` to ensure the legacy `fema_flavor_cache.json` runtime change is excluded from feature commits.
