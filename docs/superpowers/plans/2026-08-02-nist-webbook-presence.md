# NIST WebBook Presence Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CAS-based NIST Chemistry WebBook links and conservative section-presence metadata without redistributing NIST spectra.

**Architecture:** A small Python adapter fetches the NIST compound page with explicit requested sections and parses only stable links/markers into controlled presence types. The proxy caches normalized presence metadata for seven days; the frontend renders availability badges and original-site links only.

**Tech Stack:** Python standard library HTML parsing, unittest fixtures, React, Node tests, E2E.

---

### Task 1: NIST adapter contract

**Files:**
- Create: `nist_webbook.py`
- Create: `scripts/tests/fixtures/nist_webbook_ethyl_acetate.html`
- Create: `scripts/tests/fixtures/nist_webbook_empty.html`
- Create: `scripts/tests/test_nist_webbook.py`

- [ ] Write failing tests for CAS validation, canonical WebBook URL, EI-MS, IR, GC, vapor pressure, Henry constant, and thermochemistry links; valid no-data page; HTML drift; timeout; and provenance fields.
- [ ] Confirm failure because `nist_webbook.py` is absent.
- [ ] Implement a controlled `HTMLParser` adapter with injected fetcher. Do not retain spectral point data, images, JCAMP bodies, or large page excerpts.
- [ ] Return `found`, `status`, `cas`, `url`, `sections`, `retrieved_at`, `source`, and parser version.
- [ ] Run focused tests and commit with `git commit -m "feat: add NIST WebBook presence adapter"`.

### Task 2: Proxy route and cache

**Files:**
- Modify: `fema_proxy_server.py`
- Create: `scripts/tests/test_nist_webbook_proxy.py`

- [ ] Add failing route tests for `GET /nist-webbook?cas=`, invalid CAS, seven-day cache hit/expiry, parser-version invalidation, upstream isolation, and valid empty results.
- [ ] Confirm route failures before implementation.
- [ ] Add schema-versioned cache entries under `_local/cache`; persist only `ok` and `no_data`, never transport or parser failures.
- [ ] Implement the route without changing the `/compound` contract in the first commit.
- [ ] Run all Python tests and commit with `git commit -m "feat: expose NIST WebBook presence route"`.

### Task 3: Frontend availability card

**Files:**
- Create: `frontend/src/components/NistWebbookPresence.jsx`
- Create: `frontend/src/lib/nistWebbook.js`
- Create: `frontend/src/lib/nistWebbook.test.mjs`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/releaseHardening.test.mjs`

- [ ] Write failing tests for fixed section order, labels, safe links, empty state, and no download/embed controls.
- [ ] Confirm tests fail for missing helpers/component.
- [ ] Implement a compact card after open spectra with source label, checked time, section badges, direct links, and explicit original-site wording.
- [ ] Add responsive styles and accessible external-link labels; never render a NIST spectrum image or proxy download.
- [ ] Run frontend tests, lint, build, and commit with `git commit -m "feat: show NIST WebBook availability"`.

### Task 4: Live and E2E verification

**Files:**
- Modify: `scripts/e2e/verify_release_candidate.mjs`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/DATA_DICTIONARY.md`

- [ ] Add E2E assertions for ethyl acetate presence links, no download action, horizontal overflow, and NIST failure isolation.
- [ ] Run a live smoke check against NIST and record only section types and URLs, not spectrum contents.
- [ ] Run Python/frontend tests, ESLint, build, and E2E.
- [ ] Commit with `git commit -m "test: verify NIST presence integration"`.

