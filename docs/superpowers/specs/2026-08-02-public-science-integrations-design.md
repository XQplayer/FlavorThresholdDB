# Public Scientific Integrations Design

## Purpose

Extend FlavorThresholdDB from compound thresholds and public spectra into a
traceable scientific evidence workbench. The delivery consists of four ordered
subprojects: spectrum export and peak inspection, deployable spectrum-index
distribution, NIST WebBook presence links, and ChEBI–Rhea–UniProt biochemical
relationships.

Each subproject must remain useful when later sources are unavailable. Dynamic
records retain identifiers, source URLs, retrieval times, identity evidence,
and license state. The tracked repository never contains the local GNPS index,
downloaded public databases, or unclear-license peak tables.

## Delivery order and boundaries

### Phase 1: Spectrum PNG export and peak table

The existing aligned SVG mirror plot remains the authoritative vector view.
PNG export is generated locally in the browser by serializing that SVG,
rendering it to a high-density canvas, and downloading the resulting PNG. The
export includes a solid background, readable labels, both spectrum identifiers,
the tolerance setting, and a legend for matched peaks. No spectrum is sent to a
third-party rendering service.

The single-spectrum and comparison panels gain a scrollable peak table. The
table exposes m/z, normalized intensity, spectrum side, matched state, partner
m/z, delta Da, and delta ppm. Columns use semantic table markup, a sticky
header, keyboard-accessible scrolling, and a bounded height on desktop and
mobile. Peak rows may be sorted by m/z or intensity without mutating source
records.

Exports remain JSON, matched-peak CSV, SVG, and PNG. PNG and SVG represent the
currently displayed mirror plot; JSON and CSV retain provenance and numerical
comparison settings.

### Phase 2: Public GNPS/MassBank index distribution

The 1.04 GB local index stays at
`_local/indexes/gnps_spectra.sqlite`. `_local/` remains ignored and a release
guard fails if an index, SQLite journal, downloaded archive, or decompressed
asset is tracked by Git.

A deterministic build command creates a public slim SQLite database containing
only fields required for identity lookup and result summaries. It excludes peak
tables and records that cannot be safely represented under the site's metadata
and license policy. The builder runs SQLite integrity checks, records schema and
source versions, vacuums the database, compresses the artifact, and computes
SHA-256.

The compressed database is uploaded as a GitHub Release Asset. Git tracks only
a small manifest containing schema version, index version, release URL,
compression, compressed and uncompressed sizes, SHA-256, source library count,
record count, build time, and minimum proxy version.

At startup, the proxy validates an existing local public index against the
manifest. If absent or stale, it downloads to a temporary file, verifies size
and SHA-256, decompresses to a temporary SQLite file, runs schema and integrity
checks, then atomically promotes it. A failed update never deletes a valid old
index. If no valid index exists, MassBank live search, direct GNPS SpectrumID or
USI lookup, and original-source links remain available with a visible degraded
status.

Release assets are distribution artifacts, not Git history. Uploading an asset
and changing the manifest are separate explicit operations; neither is part of
ordinary frontend deployment.

### Phase 3: NIST WebBook links and presence

NIST integration is link-and-presence only. CAS is used to construct the
WebBook compound page. The proxy may inspect the returned page for stable
section links or markers corresponding to EI mass spectrum, IR spectrum, gas
chromatography, vapor pressure, Henry's law constant, and thermochemistry.

The normalized result contains CAS, WebBook URL, retrieval time, request status,
and a list of available sections. Each section contains a controlled type,
display label, and direct NIST URL. The proxy does not copy, cache, transform,
or offer downloads for NIST spectra. A missing section means only that the
section was not detected in the checked page; it is not scientific evidence of
absence.

Presence results use a schema-versioned short TTL. Transport failure and parser
drift are reported separately from a valid page with no detected sections.
The frontend presents compact availability badges and an explicit “View at
NIST” action rather than embedding the spectrum.

### Phase 4: ChEBI–Rhea–UniProt biochemical relationships

The relationship chain is built in three traceable steps:

1. Resolve a compound to ChEBI using exact structure identifiers when
   available, then CAS, then exact normalized name. Name-only candidates remain
   unverified until the user follows the source record.
2. Query Rhea for reactions containing the resolved ChEBI entity. Preserve the
   master reaction identifier, directional identifiers, equation, participants,
   transport status, and source URL.
3. Query UniProt for reviewed entries curated to the Rhea reaction. Preserve
   accession, protein name, gene names, organism, taxonomy ID, EC numbers,
   reviewed status, evidence fields returned by the API, and source URL.

The proxy returns one graph-shaped contract with `compound`, `chebi`,
`reactions`, `proteins`, `edges`, `sources`, `retrieved_at`, and per-source
status. Stable identifiers form edges; names never form hidden joins. One source
failure does not erase successfully resolved upstream nodes.

The frontend renders a layered evidence card: ChEBI identity, Rhea reaction
rows, then expandable UniProt proteins grouped by reaction. It does not claim
that a listed enzyme produces an aroma compound in a particular food, beverage,
microbe, or tissue unless that context is explicitly present in source data.

## API surface

Existing routes remain backward compatible. Planned additions are:

- `GET /spectra/index-status` for manifest, installed version, validation, and
  degraded-mode state.
- `GET /nist-webbook?cas=<CAS>` for WebBook presence metadata and links.
- `GET /biochemistry/resolve?inchikey=<key>&cas=<cas>&name=<name>` for the
  ChEBI–Rhea–UniProt evidence graph.

Spectrum comparison continues to use `POST /spectra/compare`. PNG generation is
client-side and does not require a new proxy route.

## Caching and storage

- Spectrum search metadata: 24 hours.
- Explicitly permitted spectrum peaks: 30 days on disk.
- Unclear-license spectrum peaks: memory only.
- NIST link presence: seven days, with parser and schema versions.
- ChEBI identity: 30 days.
- Rhea reactions and UniProt reviewed mappings: seven days.
- Public spectrum index: versioned by manifest rather than TTL.

All runtime data is written below `_local/` in development or the configured
runtime data directory in deployment. Writes use temporary files and atomic
replacement. Cache failures must not modify the legacy tracked
`fema_flavor_cache.json`.

## Error and degradation model

Every source exposes `ok`, `no_data`, `invalid_query`,
`upstream_unavailable`, or `invalid_response`. The index distributor additionally
exposes `missing`, `downloading`, `ready`, `stale`, and `invalid`. The UI shows
source-specific states and continues rendering local threshold, book, FEMA,
FlavorDB2, PubChem, and any successful scientific-source results.

Invalid identity evidence prevents automatic downstream expansion. It does not
prevent the user from opening candidate source pages. Download controls remain
disabled whenever record-level rights are unclear.

## Testing and acceptance

All implementation follows red–green TDD with fixture-backed adapters.

Phase 1 acceptance requires deterministic PNG dimensions, SVG/PNG labels,
scrollable accessible tables, matched-peak mapping, mobile overflow checks, and
browser download verification.

Phase 2 acceptance requires reproducible manifests, SHA-256 rejection tests,
truncated archive rejection, SQLite integrity and schema checks, atomic update
rollback, old-index reuse, and degraded live-query behavior. CI must prove that
no SQLite database or release payload is tracked.

Phase 3 acceptance requires fixture tests for each presence type, valid empty
pages, parser drift, timeout isolation, cache expiry, and direct NIST links. No
test fixture or export may contain a redistributed NIST spectrum.

Phase 4 acceptance requires exact and candidate ChEBI resolution, multi-reaction
Rhea parsing, directional-reaction normalization, reviewed UniProt mappings,
organism and EC preservation, partial-source failures, empty results, and
identity-safe graph edges.

Final verification runs all Python and frontend tests, ESLint, production build,
desktop/mobile E2E, live smoke checks with ethyl acetate, and a Git diff review
that excludes runtime caches and local indexes.

## Official source boundaries

- GNPS public metadata, SpectrumID, USI, MGF/MSP endpoints, and record licensing
  follow the official GNPS documentation. Direct GNPS contributions default to
  CC0; imported third-party libraries require separate verification.
- MassBank access follows its official API and release documentation and retains
  accession and record license metadata.
- NIST WebBook remains an original-site link layer because some spectra are not
  downloadable under NIST's displayed restrictions.
- ChEBI public REST, Rhea REST, and UniProt REST are queried dynamically and
  retain their source identifiers and links.
