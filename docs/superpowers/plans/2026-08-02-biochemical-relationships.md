# ChEBI Rhea UniProt Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve compounds to ChEBI and expose traceable Rhea reactions and reviewed UniProt proteins as an identity-safe biochemical evidence graph.

**Architecture:** Three isolated adapters normalize each official API into stable records. An orchestration service joins only stable identifiers, preserves per-source status, and stops automatic expansion for unverified name-only ChEBI candidates. The React card consumes only the normalized graph.

**Tech Stack:** Python standard library REST clients, unittest JSON/TSV fixtures, React, Node tests, E2E.

---

### Task 1: ChEBI identity adapter

**Files:**
- Create: `biochemistry_chebi.py`
- Create: `scripts/tests/fixtures/chebi_search.json`
- Create: `scripts/tests/fixtures/chebi_entity.json`
- Create: `scripts/tests/test_biochemistry_chebi.py`

- [ ] Write failing tests for exact InChIKey, CAS, exact name, connectivity candidate, name-only unverified candidate, no result, malformed payload, and upstream failure.
- [ ] Confirm missing-module failure.
- [ ] Implement injected official REST calls, identity ranking compatible with the existing spectrum identity rules, and normalized entity fields: ChEBI ID, names, formula, charge, InChIKey, source URL, match evidence, and retrieval time.
- [ ] Run focused tests and commit with `git commit -m "feat: resolve compounds through ChEBI"`.

### Task 2: Rhea reaction adapter

**Files:**
- Create: `biochemistry_rhea.py`
- Create: `scripts/tests/fixtures/rhea_reactions.tsv`
- Create: `scripts/tests/test_biochemistry_rhea.py`

- [ ] Write failing tests for ChEBI queries, master/directional IDs, equations, participant IDs, transport reactions, multiple reactions, valid empty TSV, malformed rows, and failure status.
- [ ] Confirm failures before implementation.
- [ ] Implement TSV parsing and master-reaction normalization. Preserve directional IDs as aliases and build participant edges from identifiers, never names.
- [ ] Run focused tests and commit with `git commit -m "feat: map ChEBI entities to Rhea reactions"`.

### Task 3: UniProt reviewed-protein adapter

**Files:**
- Create: `biochemistry_uniprot.py`
- Create: `scripts/tests/fixtures/uniprot_rhea.json`
- Create: `scripts/tests/test_biochemistry_uniprot.py`

- [ ] Write failing tests for reviewed Rhea query syntax, pagination, accession, protein/gene names, organism, taxonomy ID, EC numbers, evidence fields, multiple Rhea annotations, valid empty results, and upstream errors.
- [ ] Confirm failures before implementation.
- [ ] Implement official UniProt REST pagination with injected fetcher and conservative field extraction. Default to reviewed entries and preserve the exact query URL.
- [ ] Run focused tests and commit with `git commit -m "feat: map Rhea reactions to UniProt proteins"`.

### Task 4: Evidence-graph orchestration and proxy

**Files:**
- Create: `biochemistry_service.py`
- Create: `scripts/tests/test_biochemistry_service.py`
- Modify: `fema_proxy_server.py`

- [ ] Write failing tests for verified expansion, blocked name-only expansion, graph node/edge identifiers, per-source partial failure, deduplication, cache TTLs, and `GET /biochemistry/resolve` validation.
- [ ] Confirm focused failures.
- [ ] Implement `compound`, `chebi`, `reactions`, `proteins`, `edges`, `sources`, and `retrieved_at`. Cache ChEBI 30 days and Rhea/UniProt seven days with parser versions.
- [ ] Add the route and keep `/compound` backward compatible until frontend integration is verified.
- [ ] Run all Python tests and commit with `git commit -m "feat: expose biochemical evidence graph"`.

### Task 5: Layered biochemical evidence card

**Files:**
- Create: `frontend/src/components/BiochemicalRelationships.jsx`
- Create: `frontend/src/lib/biochemicalRelationships.js`
- Create: `frontend/src/lib/biochemicalRelationships.test.mjs`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/releaseHardening.test.mjs`

- [ ] Write failing tests for graph normalization, ChEBI evidence label, reaction grouping, protein grouping, partial states, external links, and prohibited food/microbe causality wording.
- [ ] Confirm failures before implementation.
- [ ] Implement ChEBI identity header, Rhea reaction rows, expandable UniProt proteins, source-specific states, and evidence caveat. Keep long equations and protein names within scroll/overflow boundaries.
- [ ] Run frontend tests, lint, and build; commit with `git commit -m "feat: show biochemical relationship evidence"`.

### Task 6: End-to-end and documentation

**Files:**
- Modify: `scripts/e2e/verify_release_candidate.mjs`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `PROJECT_HISTORY.md`

- [ ] Add fixture-backed E2E routing for deterministic ChEBI/Rhea/UniProt rendering plus a live smoke test that tolerates valid no-data.
- [ ] Verify keyboard expansion, external links, mobile overflow, and one-source failure isolation.
- [ ] Run all Python and frontend tests, ESLint, build, E2E, and `git diff --check`.
- [ ] Confirm runtime caches and local indexes are excluded, then commit with `git commit -m "test: verify biochemical relationship layer"`.

