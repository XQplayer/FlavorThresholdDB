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

- Added project history and maintainership documentation.
- Established local-only release-candidate and backup directories.
- Added one-request PubChem PUG View retrieval for eight experimental-property groups: boiling point, vapor pressure, Henry's law constant, water solubility, experimental LogP/LogKow, density, melting point, and physical state.
- Added responsive, keyboard-accessible multi-source property evidence in the compound UI, preserving raw records, source citations, and links instead of averaging experimental values.
- Isolated PubChem experimental-property failures so local records, FEMA, FlavorDB2, and basic PubChem identity and structure data remain available.

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

[Unreleased]: https://github.com/XQplayer/FlavorThresholdDB/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.3.1
[1.3.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.3.0
[1.2.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.2.0
[1.1.0]: https://github.com/XQplayer/FlavorThresholdDB/releases/tag/v1.1.0
