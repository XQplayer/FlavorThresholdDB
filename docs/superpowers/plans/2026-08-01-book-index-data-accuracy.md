# Book Index Data Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ambiguous OCR-derived threshold data visible and traceable while only applying deterministic text corrections.

**Architecture:** Extend the existing Python rebuild pipeline with pure validation helpers that attach review flags to threshold records and aggregate those flags in the QA report. Preserve source OCR JSON and PDFs; regenerate only derived JSON outputs after focused test-first changes.

**Tech Stack:** Python 3.12 standard library, `unittest`, existing RapidOCR-derived JSON pipeline, Node.js frontend regression tests.

---

### Task 1: Preserve ambiguous units and validate threshold records

**Files:**
- Modify: `scripts/book_index/test_book_index_pipeline.py`
- Modify: `scripts/book_index/rebuild_book_knowledge_index.py`

- [x] **Step 1: Write failing tests** for preserving literal `pg/L`, flagging ambiguous units, unknown media, missing entities, and suspicious magnitudes.
- [x] **Step 2: Run the focused Python tests** with the bundled Python runtime and confirm failures reflect the missing validation behavior.
- [x] **Step 3: Implement minimal pure helpers** for deterministic unit normalization and threshold review flags, then attach `review_flags` and `review_status` to extracted threshold records.
- [x] **Step 4: Run the focused and full Python tests** and confirm they pass.

### Task 2: Report entity conflicts and threshold anomalies

**Files:**
- Modify: `scripts/book_index/test_book_index_pipeline.py`
- Modify: `scripts/book_index/rebuild_book_knowledge_index.py`

- [x] **Step 1: Write failing QA tests** asserting machine-readable anomaly items with category, severity, page, record identifier, evidence, and status.
- [x] **Step 2: Run tests and confirm the intended failure.**
- [x] **Step 3: Add record identifiers to thresholds** and aggregate threshold flags plus existing `canonical_conflict` entries into QA anomaly summaries.
- [x] **Step 4: Run all Python tests** and confirm clean output.

### Task 3: Add a compact gold-standard regression fixture

**Files:**
- Create: `scripts/book_index/book_index_gold_standard.json`
- Modify: `scripts/book_index/test_book_index_pipeline.py`
- Modify: `scripts/book_index/rebuild_book_knowledge_index.py`

- [x] **Step 1: Add failing tests** for exact entity resolution and negative compound-name/CAS mismatches for ethyl acetate, ethyl propanoate, ethyl hexanoate, and 2-phenylethanol.
- [x] **Step 2: Run tests and confirm the fixture exposes current mismatches.**
- [x] **Step 3: Implement the smallest exact-identity validation helper** and add gold-standard results to the QA report without rewriting ambiguous source text.
- [x] **Step 4: Run all Python tests** and confirm the checked cases pass.

### Task 4: Rebuild and verify derived artifacts

**Files:**
- Regenerate: `data/processed/book_flavor_chemistry_index.json`
- Regenerate: `data/processed/book_flavor_chemistry_entities.json`
- Regenerate: `data/processed/book_index_qa_report.json`
- Regenerate: `frontend/public/book_flavor_chemistry_index.json`
- Regenerate: `frontend/public/book_flavor_chemistry_entities.json`

- [x] **Step 1: Rebuild from the 640 cached OCR pages** using `--skip-render --skip-ocr --keep-images`.
- [x] **Step 2: Verify source immutability** by comparing PDF and OCR-cache hashes or timestamps before and after rebuild.
- [x] **Step 3: Inspect QA totals** for pages, records, entities, thresholds, deterministic corrections, and unresolved flags.
- [x] **Step 4: Run Python tests, frontend book-search tests, lint, and build** using bundled Python and Node runtimes.
- [x] **Step 5: Review the final diff** to ensure only planned code, tests, documentation, and derived index artifacts changed.
