# FlavorThresholdDB Migration Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate local development, release artifacts, backups, and documentation under the migrated project root without losing the former directory.

**Architecture:** Runtime and route behavior remain project-relative. The historical v1.3.1 release candidate is generated from Git object data, while the previous directory is retained as a timestamped recovery archive.

**Tech Stack:** PowerShell, Windows batch, Node.js, Vite, Git, GitHub Pages.

---

### Task 1: Add migration regression checks

**Files:**
- Create: `scripts/tests/test_migration_integrity.ps1`

- [x] Write checks for stale canonical paths, portable launcher behavior, and the direct-route build artifact.
- [x] Run the checks and confirm they fail for the known migration defects.

### Task 2: Repair documentation and local launcher

**Files:**
- Modify: `PROJECT_HISTORY.md`
- Modify: `RELEASE_WORKFLOW.md`
- Modify: `start_local.cmd`

- [x] Replace obsolete canonical paths with `E:\codex\Projects\FlavorThresholdDB`.
- [x] Make runtime discovery deterministic and emit actionable errors.
- [x] Re-run the applicable migration checks.

### Task 3: Make the search route deploy as HTTP 200

**Files:**
- Create: `frontend/scripts/create-static-routes.mjs`
- Create: `frontend/src/staticRoutes.test.mjs`
- Modify: `frontend/package.json`
- Modify: `.github/workflows/deploy-pages.yml`

- [x] Write and run a failing test for static route creation.
- [x] Implement the route artifact generator and integrate it with production builds.
- [x] Run the focused test and inspect `dist/aroma-threshold/index.html`.

### Task 4: Restore release-candidate continuity

**Files:**
- Create locally: `_local/release-candidates/v1.3.1-4cbe586/`

- [x] Export committed v1.3.1 sources with `git archive`.
- [x] Record commit, tag, timestamp, and SHA-256 metadata.
- [x] Mark the candidate files read-only and verify their integrity.

### Task 5: Archive the former directory

**Files:**
- Move: `E:\codex\FlavorThresholdDB`
- Create: `E:\codex\Projects\_migration-archive\FlavorThresholdDB-old-<timestamp>`

- [x] Inventory non-cache files and compare recoverable release artifacts.
- [x] Resolve and validate source and destination paths.
- [x] Archive the former directory and verify that the old path no longer exists.

### Task 6: Final verification

- [x] Run migration checks, unit tests, lint, and production build.
- [x] Verify Git root, HEAD, origin, working-tree changes, backup ZIP, release candidate, launcher diagnostics, homepage, direct search route artifact for future deployment, and API health.
- [x] Report remaining platform or publication steps without pushing or deploying.
