# Book Index Continuous Optimization Design

## Goal

Turn the *Wine Flavor Chemistry* OCR index into a research-grade, source-traceable knowledge layer and integrate it into the FlavorThresholdDB website. The system must prefer explicit uncertainty over silent guesses and must preserve immutable source PDFs and OCR caches.

## Stopping criteria

The optimization program is complete only when all high-value checks have stable automated coverage, the production site consumes the rebuilt artifacts, and remaining anomalies are either reviewed or explicitly presented as unresolved. Completion requires passing Python and frontend tests, lint, production build, 640-page rebuild verification, source immutability checks, and browser-level inspection of book results.

## Phases

### 1. Semantic value classification

Every extracted concentration receives a role: `threshold`, `matrix_component`, `sample_concentration`, `physical_property`, or `uncertain`. Only `threshold` values populate structured threshold values. Other values remain traceable as contextual values.

### 2. Entity association and identity quality

Associate blocks using exact in-block CAS first, exact entity names second, nearest preceding entity within a bounded section third, and cross-page inheritance only when no structural boundary intervenes. Record the method and confidence. Split canonical conflicts into name variants, likely OCR character errors, true identity conflicts, and unresolved conflicts.

### 3. Index and table quality

Build exact CAS/name/alias indexes, preserve chapter and section facets, restore table row/column context where possible, and maintain negative-match regressions for derivative names and isomers. Search ranking must prefer exact identity evidence over substring mentions.

### 4. Website integration

The website consumes review metadata and structured values. Results display source page, association confidence, review status, medium, threshold type, value, unit, and raw evidence. Low-confidence data is visible but clearly marked. Users can navigate from a result to the corresponding source-page context.

## Quality gates

- No deterministic rule rewrites ambiguous `pg`, alcohol percentage, compound identity, or source value.
- Matrix components and sample concentrations are excluded from threshold values.
- Every threshold has a record identifier, page, raw evidence, review status, and association metadata.
- Gold-standard cases cover representative compound classes, media, tables, low-unit values, cross-page text, and negative identity matches.
- QA reports counts and rates for every anomaly class and records changes between rebuilds.
- Source PDF and OCR-cache hashes or equivalent immutable signals remain unchanged.
