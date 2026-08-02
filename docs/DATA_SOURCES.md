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
| FlavorDB2 | Flavor descriptors, natural sources, food entities, and food–compound relationships | Preserve source attribution, entity and molecule links, and the license information returned by the integration. Treat “contains” as a reported database relationship, not quantitative concentration evidence. |
| MassBank Europe | Open EI and tandem reference spectra, peak tables, and experimental metadata | Preserve accession, source URL, record license, retrieval time, identity evidence, and experimental conditions. |
| GNPS / GNPS2 | Public library metadata, SpectrumID/USI lookup, and tandem peak tables | Preserve library and spectrum identifiers, source URL, instrument/adduct/collision metadata, and record-level license status. Imported third-party libraries remain license-review gated. |

## Open spectra integration boundary

`GET /spectra/search` aggregates exact compound candidates from MassBank and the
local GNPS2 slim-metadata index. One unavailable source is reported separately
and does not erase records returned by the other. Peak tables are loaded lazily
through `GET /spectra/{source}/{id}`; USI lookup remains available through
`GET /spectra/usi?usi=...`.

Open-license records may be downloaded as JSON, CSV, MSP, or MGF. Records whose
license is unknown, restrictive, or still under review expose metadata and the
original link but not a proxy peak-table download. Search results use a
schema-versioned 24-hour cache. Peak records with an explicitly permitted
license use a 30-day persistent cache; unclear-license peak records are held in
memory only. Generated GNPS indexes and caches remain under `_local/` and must
not be committed.

`POST /spectra/compare` supports explicit Da or ppm tolerance, one-to-one peak
assignment, cosine similarity, bilateral coverage, matched-peak details, and
compatibility warnings. EI is scored only against EI; tandem spectra may be
scored with visible warnings for differing ion mode, adduct, precursor, or
collision energy. Comparison exports retain both source identifiers and the
displayed tolerance settings.

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

Each cached PUG View result carries a cache schema version, a parser version,
and its UTC retrieval time. Entries with missing or incompatible metadata are
refetched, and compatible entries expire after 30 days. This prevents an older
scientific parsing rule from surviving after classifications such as explicit
aqueous solubility have been corrected.

## NIST Chemistry WebBook boundary

The NIST integration checks a canonical CAS page and exposes only original-page
links plus presence flags for EI-MS, IR, GC data, vapor pressure, Henry-law
constants, and thermochemistry. FlavorThresholdDB does not copy or redistribute
NIST spectra. A presence flag means that the checked NIST page advertised the
section; it is not a local scientific validation of the underlying record.

## ChEBI, Rhea, and UniProt relationship layer

ChEBI is the identity bridge. Automatic expansion to Rhea is permitted only
after an exact structural identifier, connectivity identifier, CAS, or canonical
structure match. An exact name is retained as an unverified candidate and stops
the chain. Rhea joins use ChEBI and Rhea identifiers, and UniProt queries use
reviewed entries explicitly annotated to the Rhea reaction.

The resulting links are biochemical database evidence. They do not by themselves
establish that a compound occurs in a food, is produced by a microorganism, or
causes an aroma phenotype. Each entity and relationship retains an original
source URL, and a failure in one upstream source must not suppress unrelated
threshold, flavor, spectrum, PubChem, or NIST records.

## Public GNPS index distribution

The full local GNPS SQLite index is generated under `_local/indexes/` and is
never committed to Git. Release preparation creates a slim SQLite file, gzip
archive, SHA-256 checksum, row/library counts, schema version, and integrity
result under `_local/release-assets/`. The binary is intended for an external
release asset or object store; Git contains only code and, after an asset URL is
stable, a small manifest. The proxy verifies size and SHA-256 before atomically
installing an index under `_local/indexes/public/`, and falls back to remote GNPS
lookup when no verified public index is installed.

## Publication rules

1. Do not commit source PDFs, books, credentials, or private local indexes.
2. Do not remove source distinctions merely to simplify the display.
3. Do not imply that a third-party database result was independently validated.
4. Record access dates for dynamic web sources in citations.
5. Re-check redistribution rights before publishing derived datasets or caches.
6. Keep experimental GC-MS processing data outside this product repository.

The repository is intended for personal study and academic exchange. External
source terms remain controlling for their respective records.
