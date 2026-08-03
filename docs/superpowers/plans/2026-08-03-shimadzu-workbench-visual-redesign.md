# Shimadzu Workbench Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing Shimadzu GC-MS analysis page as a restrained, professional scientific workflow console while preserving all analysis behavior.

**Architecture:** Keep the existing React page and API boundary. Add a scoped GSAP motion layer inside `ShimadzuAnalysisPage`, replace the page-specific CSS token system, and extend the browser test to verify the new visual contract, reduced-motion terminal state, and responsive layout.

**Tech Stack:** React 19, Vite, GSAP, `@gsap/react`, ScrollTrigger, CSS, Playwright.

---

### Task 1: Lock the visual contract with a failing browser test

**Files:**
- Modify: `scripts/e2e/verify_shimadzu_workbench.mjs`

- [x] Assert the page root exposes `data-ui-revision="instrument-console-v2"`.
- [x] Assert the pipeline contains seven nodes and the desktop workbench has no horizontal overflow.
- [x] Emulate reduced motion and assert the root exposes `data-motion="reduced"` with all primary sections visible.
- [x] Run the test and confirm it fails because the new root attributes do not exist yet.

### Task 2: Add the GSAP React runtime

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`

- [x] Add `gsap` and `@gsap/react` using the repository package manager.
- [x] Confirm both packages resolve from the frontend workspace.

### Task 3: Implement scoped, motivated motion

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`

- [x] Register `useGSAP` and `ScrollTrigger` once at module scope.
- [x] Add a page scope ref and a single reduced-motion capability probe.
- [x] Set final visible states immediately when reduced motion is requested.
- [x] Otherwise reveal the hero and first workflow surface on load, then reveal later workbench sections with top-to-bottom ScrollTriggers.
- [x] Animate only `autoAlpha`, `x`, `y`, and scale transforms; scope selectors to the page and rely on `useGSAP` cleanup.

### Task 4: Rebuild the page-specific visual system

**Files:**
- Modify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`

- [x] Replace the green palette with cold slate neutrals, graphite ink, and one cobalt accent.
- [x] Convert the hero into a compact product header with real system metadata, not a brand hero.
- [x] Rebuild the workflow as a precise instrument pipeline with stronger active and completed states.
- [x] Recompose upload, settings, and monitoring surfaces with one radius scale, translucent borders, tinted shadows, and 44px controls.
- [x] Use a dark graphite monitor with cobalt live signal and high-contrast log text.
- [x] Declare desktop, tablet, mobile, focus, and reduced-motion behavior.

### Task 5: Verify and visually inspect

**Files:**
- Verify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.jsx`
- Verify: `frontend/src/components/shimadzu/ShimadzuAnalysisPage.css`
- Verify: `scripts/e2e/verify_shimadzu_workbench.mjs`

- [x] Run ESLint, frontend unit tests, and Vite production build.
- [x] Run backend Shimadzu service tests to guard the unchanged analysis boundary.
- [x] Run the browser E2E at desktop, mobile, and reduced-motion settings.
- [x] Inspect the two screenshots for hierarchy, contrast, overflow, and visual consistency.
- [x] Run the finesse cheapness and preflight checks, then fix any shipping blocker.
