# Data Sources and Use Boundaries

FlavorThresholdDB combines locally curated literature records with live or
cached external database results. Source attribution must remain visible in the
UI and exports.

## Sources

| Source | Primary use | Traceability requirement |
| --- | --- | --- |
| Van Gemert (2011), *Flavour Thresholds* | Odor and taste threshold records | Preserve citation, medium, value, unit, and threshold type. |
| Fan & Xu (2020), *Wine Flavor Chemistry* | Flavor chemistry context and book excerpts | Preserve book title, page, and excerpt context. Do not publish the full book index without confirming rights. |
| FEMA Flavor Ingredient Library | Common name and flavor profile | Preserve FEMA number, source label, link, and access date. |
| PubChem PUG REST | Chemical identity and structure records | Preserve CID, PubChem link, and access date. |
| FlavorDB | Flavor descriptors and related compound data | Preserve source attribution, record link, and the license information returned by the integration. |

## Publication rules

1. Do not commit source PDFs, books, credentials, or private local indexes.
2. Do not remove source distinctions merely to simplify the display.
3. Do not imply that a third-party database result was independently validated.
4. Record access dates for dynamic web sources in citations.
5. Re-check redistribution rights before publishing derived datasets or caches.
6. Keep experimental GC-MS processing data outside this product repository.

The repository is intended for personal study and academic exchange. External
source terms remain controlling for their respective records.
