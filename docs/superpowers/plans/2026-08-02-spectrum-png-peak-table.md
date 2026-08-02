# Spectrum PNG and Peak Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic local PNG mirror exports and accessible scrollable peak tables to the existing open-spectrum workbench.

**Architecture:** Keep SVG as the canonical plot and move export/table transformations into pure frontend helpers. Rasterize the displayed SVG to a high-density canvas only after the user requests PNG; derive peak-table rows from spectra and backend comparison matches without mutating source records.

**Tech Stack:** React 19, native SVG/canvas, Node test runner, Playwright E2E, ESLint, Vite.

---

### Task 1: Pure peak-table and export helpers

**Files:**
- Create: `frontend/src/spectra/spectrumPresentation.js`
- Create: `frontend/src/spectra/spectrumPresentation.test.mjs`

- [ ] Write failing Node tests for `buildSinglePeakRows`, `buildComparisonPeakRows`, `sortPeakRows`, `buildPngFilename`, and PNG scale validation. Test unmatched and matched peaks, A/B partner values, stable sorting, unsafe identifiers, and scale bounds.
- [ ] Run `node --test src/spectra/spectrumPresentation.test.mjs` from `frontend` and confirm failure because the module does not exist.
- [ ] Implement pure helpers. Rows must contain `side`, `peak_index`, `mz`, `intensity`, `matched`, `partner_mz`, `delta_da`, and `delta_ppm`; sorting must return a new array.
- [ ] Re-run the focused test and confirm all cases pass.
- [ ] Commit with `git commit -m "feat: add spectrum presentation helpers"`.

### Task 2: Accessible scrollable peak tables

**Files:**
- Create: `frontend/src/components/spectra/SpectrumPeakTable.jsx`
- Modify: `frontend/src/components/spectra/OpenSpectraWorkbench.jsx`
- Modify: `frontend/src/components/spectra/SpectrumComparison.jsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/releaseHardening.test.mjs`

- [ ] Add failing source assertions for a semantic `<table>`, sticky header class, keyboard-focusable scroll region, m/z/intensity headings, match status, and use in both single and comparison panels.
- [ ] Run `node --test src/releaseHardening.test.mjs` and confirm the assertions fail because `SpectrumPeakTable.jsx` is absent.
- [ ] Implement one reusable component with `tabIndex="0"`, an accessible region label, empty state, stable row keys, and localized headings. Add sort controls for m/z and intensity.
- [ ] Add bounded desktop/mobile height, `overflow: auto`, sticky header, numeric tabular alignment, visible focus, and no horizontal page overflow.
- [ ] Re-run frontend tests and verify the source assertions pass.
- [ ] Commit with `git commit -m "feat: add scrollable spectrum peak tables"`.

### Task 3: Deterministic PNG mirror export

**Files:**
- Create: `frontend/src/spectra/svgPngExport.js`
- Create: `frontend/src/spectra/svgPngExport.test.mjs`
- Modify: `frontend/src/components/spectra/MirrorSpectrumPlot.jsx`
- Modify: `frontend/src/components/spectra/SpectrumComparison.jsx`
- Modify: `frontend/src/App.css`

- [ ] Write failing tests using injected serializer, image loader, canvas factory, and URL adapter. Assert 2× output dimensions, solid background, SVG draw, PNG MIME type, URL cleanup, and rejection of missing/zero-sized SVG.
- [ ] Run the focused Node test and confirm the missing module failure.
- [ ] Implement `exportSvgElementAsPng(svg, options)` without global test-only state. Clone the SVG, inject title/subtitle/legend text, serialize, load into an image, draw to canvas, and download a PNG blob.
- [ ] Add visible PNG action beside JSON/CSV/SVG, busy state, localized failure message, and filename derived from both spectra.
- [ ] Re-run focused and full frontend tests.
- [ ] Commit with `git commit -m "feat: export mirror spectra as png"`.

### Task 4: Browser validation

**Files:**
- Modify: `scripts/e2e/verify_release_candidate.mjs`

- [ ] Add E2E assertions for peak-table keyboard focus, bounded scrolling, match rows, PNG download event, non-empty PNG bytes, and desktop/mobile page overflow.
- [ ] Run `pnpm run test:e2e` and fix only failures attributable to this phase.
- [ ] Run all frontend tests, `pnpm run lint`, and `pnpm run build`.
- [ ] Review `git diff` and confirm `_local/`, `frontend/dist/`, and `fema_flavor_cache.json` are excluded.
- [ ] Commit with `git commit -m "test: verify spectrum png and peak tables"`.

