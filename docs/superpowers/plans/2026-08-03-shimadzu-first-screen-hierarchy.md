# Shimadzu First-Screen Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shimadzu analysis page easier to scan and start without changing any scientific or analysis behavior.

**Architecture:** Keep the existing component and CSS architecture. Add UI-only readiness derivation inside the page using the existing workbook validator, reorder existing sections, and revise local typography/layout rules without touching Worker, API, Supabase, or output contracts.

**Tech Stack:** React, existing GSAP integration, CSS, Node test runner, Vite, ESLint

---

### Task 1: Protect the requested information architecture

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.layout.test.mjs`

- [ ] **Step 1: Write failing source-contract tests**

Add assertions for the exact Hero title, setup-before-workflow order, user-facing start feedback, and absence of `skill`/`manifest` from the page component.

- [ ] **Step 2: Verify the tests fail for the expected missing UI behavior**

Run: `pnpm run test:shimadzu-browser`

Expected: the new layout tests fail while existing browser-pipeline tests remain passing.

### Task 2: Implement the minimal React changes

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`

- [ ] **Step 1: Derive file-readiness feedback with the existing validator**

Use `assertWorkbookFile` for both selected files, produce missing/invalid/ready messages, and keep `canAnalyze` as the permission gate.

- [ ] **Step 2: Update the title, section order, button label, aria-live feedback, and plain-language copy**

Render input/settings before the workflow, place the idle monitor after it, and preserve all existing account, job, history, download, and review functions.

- [ ] **Step 3: Run the focused tests until green**

Run: `pnpm run test:shimadzu-browser`

Expected: all browser tests pass.

### Task 3: Establish the local type scale and responsive spacing

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`

- [ ] **Step 1: Reduce Hero vertical dimensions by about 20%**

Adjust desktop and mobile Hero min-height/padding without changing its two-column purpose or engine status.

- [ ] **Step 2: Make local mode compact and update the setup/workflow/monitor spacing**

Change only `.shimadzu-account.local` and the Shimadzu setup/grid rules; retain the full cloud login and admin controls.

- [ ] **Step 3: Replace sub-minimum font sizes**

Set ordinary copy to at least 14px, helper copy to at least 12px, and state/index/log text to at least 11px, including responsive overrides.

- [ ] **Step 4: Verify all target viewports**

Inspect 375, 768, 1024, and 1440px captures for horizontal overflow and reading order; confirm `prefers-reduced-motion` remains in the stylesheet.

### Task 4: Run the full requested verification

**Files:**
- Verify only: `frontend/`

- [ ] **Step 1: Run lint and production build**

Run: `pnpm run lint` and `pnpm run build`

Expected: exit code 0 for both.

- [ ] **Step 2: Run both Shimadzu suites**

Run: `pnpm run test:shimadzu` and `pnpm run test:shimadzu-browser`

Expected: zero failures.

- [ ] **Step 3: Review the diff against the scope boundary**

Confirm no Worker, API, Supabase, contract, or output files changed and report remaining second-round visual issues separately.
