# Changelog

All notable changes to FlavorThresholdDB are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [1.3.1] - 2026-08-01

### Added

- Rebuilt the Wine Flavor Chemistry book index with source-page traceability.
- Added merged CAS entity cards with threshold media grouping and per-source excerpts.
- Added English-name and Chinese-name exact matching backed by canonical CAS filtering.

### Fixed

- Prevented related ester compounds from appearing in exact book searches.
- Added separate expandable source excerpts, stable card layout, and overflow-safe evidence display.
- Unified book-card identity typography and added English names beside Chinese names and CAS.

## [Unreleased]

## [1.5.0] - 2026-08-02

### Added

- Added evidence-bound NCBI Gene and NCBI Taxonomy records derived only from verified ChEBI–Rhea–UniProt protein relationships.
- Added public MetaboLights study discovery with stable study accessions and original-record links.
- Added BRENDA EC-number links and an HMDB link-only integration that explicitly preserves redistribution restrictions.
- Added a responsive biological-context card with per-source failure isolation, bounded lists, and desktop/mobile E2E coverage.
- Added exact-identity PubChem BioAssay and ChEMBL activity records, plus identity-gated GtoPdb and exact-structure BindingDB searches.
- Added a source-tabbed, bounded bioactivity evidence card with assay identifiers, target links, measurement context, and causal-interpretation warnings.
- Added UniProt-linked RCSB PDB experimental structures, AlphaFold DB predicted models, and exact-accession GPCRdb records with explicit evidence-type separation.

## [1.4.0] - 2026-08-02

- Added project history and maintainership documentation.
- Established local-only release-candidate and backup directories.
- Upgraded the live flavor-data integration from FlavorDB to FlavorDB2.
- Added natural food-source relationships, food-entity search, taxonomy details, and food-to-compound records.
- Added one-request PubChem PUG View retrieval for eight experimental-property groups: boiling point, vapor pressure, Henry's law constant, water solubility, experimental LogP/LogKow, density, melting point, and physical state.
- Added responsive, keyboard-accessible multi-source property evidence in the compound UI, preserving raw records, source citations, and links instead of averaging experimental values.
- Isolated PubChem experimental-property failures so local records, FEMA, FlavorDB2, and basic PubChem identity and structure data remain available.
- Versioned PubChem experimental-property cache entries by schema and parser, with a 30-day expiry for automatic scientific-rule refresh.
- Suspended Excel upload and removed the vulnerable SheetJS production dependency; text batch input and CSV export remain available.
- Standardized hidden single-instance local startup on frontend port 5174 and proxy port 8787, with project ownership and health checks.
- Promoted desktop/mobile/failure-isolation Playwright coverage to a repository-owned E2E command and isolated generated artifacts under `_local/`.
- Added MassBank and GNPS open-spectrum search, license-gated downloads, peak tables, mirror comparison, PNG/SVG/CSV/JSON exports, and a separately distributed GNPS metadata index.
- Added NIST Chemistry WebBook original-page availability links without copying restricted spectra.
- Added identity-safe ChEBI to Rhea to reviewed UniProt biochemical relationships with source-specific caching, pagination, partial-failure isolation, and evidence caveats.

## [1.3.0] - 2026-07-31

### Added

- Compound dossier integrating FEMA, PubChem, and FlavorDB records.
- PubChem 2D, 3D, crystal-structure, image, and record downloads.
- RDKit SMARTS-based primary compound classification.
- Source-specific descriptor presentation and traceability links.
- Threshold sorting by publication year and numeric value.

## [1.2.0] - 2026-07-30

### Added

- Supabase-backed visits, active users, search totals, and daily searches.
- Popular-compound treemap with direct search navigation.

## [1.1.0] - 2026-07-30

### Changed

- Unified the public home, navigation, and search workbench design.
- Added bilingual UI, responsive behavior, metadata, and route fallback.

[Unreleased]: https://github.com/XQplayer/FlavorThresholdDB/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.5.0
[1.4.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.4.0
[1.3.1]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.3.1
[1.3.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.3.0
[1.2.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.2.0
[1.1.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.1.0
