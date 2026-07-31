# FlavorThresholdDB

[Public website](https://xqplayer.github.io/FlavorThresholdDB/) | [Search](https://xqplayer.github.io/FlavorThresholdDB/aroma-threshold/) | [Project history](PROJECT_HISTORY.md)

FlavorThresholdDB is a bilingual research database for traceable odor-threshold and flavor-descriptor retrieval. It supports exact and fuzzy searches by CAS number, Chinese name, or English name, plus batch matching and filter-aware CSV export.

## Version 1.3.1

This small update adds two CSV export formats while preserving the current filter-aware workflow.

- Compact export: one row per compound with CAS, Chinese and common English names, compound class, molecular formula, FEMA descriptors, and horizontally grouped threshold fields for every selected medium
- Detailed export: one row per threshold record, retaining all current compound, source, medium, threshold, database, and book-result fields
- Export filenames identify the selected format, and CAS values remain Excel-safe
- Accessible export menu with bilingual labels and concise format descriptions

## Version 1.3.0

This release expands FlavorThresholdDB from a threshold lookup interface into a multi-source compound research workspace.

- Unified compound profiles with Chinese name, common English name, CAS, and PubChem CID
- PubChem 2D structures, interactive 3D conformers, crystal records, physicochemical properties, and structure downloads
- SMARTS-based compound classification powered by RDKit
- FEMA and FlavorDB descriptors displayed separately with source-specific colors
- Threshold records prioritized by publication year and threshold value, with additional records collapsed
- Filter-aware CSV export for selected media, threshold types, databases, and book results
- Excel-safe CAS export to prevent values such as `60-12-8` from becoming dates
- Updated scientific color system and consistent source/result-card styling
- Live activity metrics and popular-compound visualization backed by Supabase

## Data sources

- Van Gemert (2011), *Flavour Thresholds* (2nd ed.)
- Fan, W. L., & Xu, Y. (2020), *Wine Flavor Chemistry*
- FEMA Flavor Ingredient Library
- PubChem PUG REST
- FlavorDB

The interface preserves the original source, measurement medium, threshold type, value, and unit where available. Linked source pages are provided for verification.

FlavorDB-derived records retain their source attribution and CC BY-NC-SA 3.0 license. This repository is intended for personal study and academic exchange. Verify redistribution rights before publishing local book indexes or derived datasets.

## Public deployment

The official GitHub Pages site is built automatically from `main` by `.github/workflows/deploy-pages.yml`.

The public external-data API is already deployed at:

```text
https://flavorthresholddb-api.onrender.com
```

The repository variable `FEMA_API_URL` points to that service. The same API supplies the frontend with FEMA, PubChem, and FlavorDB results through `/fema`, `/compound`, `/pubchem`, and `/flavordb`.

When deploying a fork, create a new Render service with the included Blueprint and set the fork's GitHub Actions variable `FEMA_API_URL` to the generated HTTPS URL:

[Deploy the API to Render](https://render.com/deploy?repo=https://github.com/XQplayer/FlavorThresholdDB)

## Local development

Requirements:

- Node.js 20 or later
- pnpm 11 or later
- Python 3.10 or later for the optional local external-data proxy

Install and run the frontend:

```bash
cd frontend
pnpm install
pnpm run dev
```

Vite prints the actual local URL when it starts. With the configured base path, it is typically:

```text
http://127.0.0.1:5173/FlavorThresholdDB/
```

To use the local proxy instead of the public API, run from the repository root:

```bash
python fema_proxy_server.py
```

The local proxy listens on `http://127.0.0.1:8787`. This address is for development only and is not required by visitors to the public website.

## Quality checks

```bash
cd frontend
pnpm run lint
pnpm run build
```

The deployment workflow also creates `dist/404.html` so routed pages can load through GitHub Pages.

## Project documentation

- [Changelog](CHANGELOG.md)
- [Project history](PROJECT_HISTORY.md)
- [Release workflow](RELEASE_WORKFLOW.md)
- [Data dictionary](docs/DATA_DICTIONARY.md)
- [Data sources and use boundaries](docs/DATA_SOURCES.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Book OCR and knowledge-index pipeline](docs/BOOK_INDEX_PIPELINE.md)
- [Migration from Aroma analysis](docs/MIGRATION_FROM_AROMA_ANALYSIS.md)

## References

- [FEMA Flavor Ingredient Library](https://www.femaflavor.org/flavor-library)
- [PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest)
- [FlavorDB](https://cosylab.iiitd.edu.in/flavordb/)
