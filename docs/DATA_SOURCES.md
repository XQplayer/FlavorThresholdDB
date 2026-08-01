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
| PubChem PUG View, Experimental Properties | Third-party experimental-property aggregation and annotation | Preserve every reported record, its raw text, PubChem reference number, source name, source URL when supplied, and retrieval time. PubChem is the aggregator here, not necessarily the laboratory that performed the experiment. |

## PubChem integration boundary

The PUG View integration requests the Experimental Properties heading once per
CID and retains records for boiling point, vapor pressure, Henry's law constant,
water solubility, experimental LogP/LogKow, density, melting point, and physical
state. These values are third-party records aggregated and annotated by
PubChem; the UI must preserve each record's source link or citation and must not
describe PubChem as having performed the experiment. See the official
[PUG View documentation](https://pubchem.ncbi.nlm.nih.gov/docs/pug-view).

Computed `XLogP` from the PUG REST compound-property response is a separate
field from experimental `LogP` or `LogKow` records collected through PUG View.
They must not be merged, substituted, or presented as equivalent evidence.

PubChem CID is the primary key for PUG View and downstream FlavorDB2 lookups.
The integrated search begins with a local CAS/name match and a PubChem identity
lookup; CAS is an input/search boundary, not the PUG View property key. Where an
InChIKey is available, use it to validate compound identity rather than treating
name similarity alone as confirmation.

The proxy limits PUG View traffic to at most five requests per second, coalesces
concurrent requests for the same canonical CID into a single flight, and writes
eligible cache entries atomically. Only `ok` and `no_data` results are cached;
upstream failures and invalid responses remain isolated so they do not poison
the cache or suppress local, FEMA, FlavorDB2, or basic PubChem results.
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
