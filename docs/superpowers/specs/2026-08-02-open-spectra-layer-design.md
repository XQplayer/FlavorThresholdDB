# Open Spectra Layer Design

## Scope

The first delivery adds public-library spectrum discovery, download, and comparison for MassBank Europe and GNPS. It does not accept uploaded experimental spectra. NIST remains a future link-and-presence layer because some WebBook spectra have redistribution restrictions.

## Identity and provenance

The existing PubChem compound resolution supplies CID, full InChIKey, CAS, canonical SMILES, and names. Spectrum candidates are ranked by full InChIKey, connectivity-block InChIKey, CAS, canonical SMILES, then exact normalized name. Name-only candidates remain unverified and are excluded from exact-result counts and automatic comparison.

Every normalized spectrum retains source, source record ID, source URL, retrieved time, license state, raw identifiers, experimental conditions, and the identity-match method. License is recorded per spectrum rather than inferred from the database name.

## Architecture

The Python proxy owns source adapters, normalization, caching, downloads, and comparison. The React frontend calls only the local unified API. Search returns lightweight metadata; complete peak tables are fetched on selection. One failing upstream must not erase results from the other source.

The normalized record contains compound identity, spectrum type, MS level, ion mode, ionization, adduct, precursor m/z, collision energy, instrument, peaks, provenance, license, and retrieval time.

## API

- `GET /spectra/search`: unified MassBank and GNPS metadata search.
- `GET /spectra/{source}/{id}`: one normalized spectrum with peaks.
- `GET /spectra/{source}/{id}/download?format=json|csv|msp|mgf`: permitted exports.
- `POST /spectra/compare`: compatibility assessment, peak matching, and weighted cosine metrics.
- `GET /spectra/licenses`: source and record-level license notices.

## User interface

An independent Open Spectra workbench follows the compound archive. It contains an exact-hit summary, source and experiment filters, spectrum list, single-spectrum plot and peak table, download actions, and a mirror-spectrum comparison area. Selecting spectrum A or B replaces that slot immediately.

EI is compared directly only with EI. Tandem spectra are compared with tandem spectra; differing ion mode, adduct, precursor, or collision energy produces a visible warning. EI versus ESI-MS/MS remains viewable but receives no similarity score.

## Comparison

Peaks are validated, sorted, and normalized to a base peak of 100. One-to-one peak matching uses a configurable Da or ppm tolerance. Results report weighted cosine similarity, matched-peak count, coverage for both spectra, tolerance, and experimental compatibility. Defaults are conservative and shown to the user.

## Downloads and licensing

Permitted spectra can be exported as the unified JSON contract, CSV, MSP, or MGF. Comparison exports include JSON, matched-peak CSV, PNG, and SVG. Every export embeds source identifiers, URLs, access time, license, identity-match method, comparison settings, and application version.

Unknown or restrictive licenses allow metadata and source links but disable peak-table proxy download and persistent peak caching.

## Reliability and validation

Adapters use fixture-backed contract tests. Tests cover missing identifiers, missing peaks, source failure, field drift, license restrictions, normalization, compatibility, tolerance boundaries, and one-to-one peak matching. Browser-level checks cover filtering, A/B replacement, download-menu exclusivity, scrolling, responsive overflow, and partial-source failure.

