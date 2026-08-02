# Data Dictionary

This document defines the stable fields used by the local threshold dataset and
the public search interface. External API fields remain source-owned and may
change independently.

## Core compound fields

| Field | Meaning | Rules |
| --- | --- | --- |
| `cas` | CAS Registry Number | Preserve as text; never coerce to a date or number. |
| `chinese_name` | Chinese compound name | Display name from the local curated dataset. |
| `english_name` | English compound name | Source English name; UI may derive a common-name display form. |
| `medium` | Measurement medium | Current normalized values are `空气`, `水`, and `其他介质`. |
| `threshold_data` | Source threshold records | Array of original record strings containing citation, type, value, and unit context. |
| `flavor_desc` | English flavor descriptors | Array; source attribution must remain available. |
| `flavor_desc_cn` | Chinese flavor descriptors | Array; do not silently treat machine translation as source text. |
| `flavor_categories` | Flavor categories | Optional array from curated source data. |

## Threshold interpretation

- `d` means detection threshold (觉察阈).
- `r` means recognition threshold (识别阈).
- The medium, value, unit, threshold type, citation, and source record together
  form one threshold observation. Do not merge observations when that would
  remove source context.
- UI ranking prioritizes newer publication years, then lower parseable numeric
  values. Ranking is for display and does not imply higher scientific quality.
- Values with different media or units must not be compared without explicit
  normalization.

## External compound fields

PubChem may provide CID, molecular formula, molecular weight, IUPAC name,
XLogP, TPSA, HBD/HBA, SMILES, 2D structure, 3D conformers, and crystal records.
FlavorDB may provide descriptors and functional-group information. FEMA may
provide a FEMA number, common name, and flavor profile.

External values must retain a source label and a verification link. A missing
external result is not evidence that the compound or property does not exist.

## PubChem experimental-property contract

`GET /pubchem-volatile?cid=<CID>` returns the same PubChem experimental-property
object embedded at `compound.pubchem_volatile` in the integrated `GET /compound`
response. The contract key is `pubchem_volatile` (not `volatile_properties`).

The response has eight stable top-level keys:

| Key | Meaning |
| --- | --- |
| `found` | `true` when at least one experimental record was retained in any property array. |
| `status` | One of `ok`, `no_data`, `invalid_cid`, `upstream_unavailable`, or `invalid_response`. |
| `cid` | Canonical decimal CID text; leading zeros are removed after validation. Invalid input is returned trimmed but is not queried. |
| `source` | Stable source label `PubChem PUG View`. |
| `url` | PubChem compound link to the Experimental Properties section. |
| `retrieved_at` | UTC retrieval timestamp for successful upstream responses and 404 `no_data` responses; it may be absent for failures occurring before a valid response. |
| `cached` | Whether this response was served from a successfully persisted cache entry. |
| `properties` | Object whose eight stable keys each contain an array of retained source records. |

The stable `properties` keys are `boiling_point`, `vapor_pressure`,
`henrys_law_constant`, `water_solubility`, `experimental_logp`, `density`,
`melting_point`, and `physical_state`. Every extracted record retains
`raw_value`, `normalized_value`, `unit`, `temperature`, `pressure`, `medium`,
`reference_number`, and `source`; `source_url` is included when PubChem supplies
one for that reference. `raw_value` is the primary evidence. There is no
separate record-level `description`, `evidence`, or `physical_state` field:
descriptive physical-state text remains in `raw_value`, under the
`properties.physical_state` array, and its conservative parsed state is stored
in `normalized_value`.

Normalization is best-effort and deliberately conservative. Empty conditions
or a null `normalized_value` do not invalidate the retained raw record. All
distinct experimental records are preserved (deduplicated only by identical
`raw_value` plus `reference_number`); values are never averaged.

Status semantics:

- `invalid_cid`: CID is missing, zero, negative, or non-decimal; HTTP 400 on
  `/pubchem-volatile`.
- `no_data`: PubChem returned 404 or a valid Experimental Properties payload
  with no retained records.
- `upstream_unavailable`: timeout, connection failure, throttling response, or
  retryable upstream HTTP failure; HTTP 502 on `/pubchem-volatile`.
- `invalid_response`: the upstream body is HTML, malformed JSON, or lacks the
  expected record object; HTTP 502 on `/pubchem-volatile`.

Only `ok` and `no_data` results are eligible for persistent caching. Cache keys
use the canonical CID, so inputs such as `000702` and `702` address the same
entry.

## CSV contracts

- Compact export: one compound per row, identity fields first, then selected
  media threshold summaries in separate columns.
- Detailed export: one threshold observation per row with all selected source,
  medium, type, value, unit, and traceability fields.
- CAS values must use an Excel-safe text representation.

## Open spectrum contract

Unified spectrum records expose `spectrum_id`, `source`, `source_url`,
`license`, `license_status`, `retrieved_at`, `compound_identity`,
`spectrum_type`, `ms_level`, `ion_mode`, `ionization`, `adduct`,
`precursor_mz`, `collision_energy`, `instrument`, and normalized `peaks`.
Each peak is `[mz, relative_intensity]`; invalid and non-positive peaks are
discarded, duplicate m/z values are merged, and the base peak is normalized to
100.

Identity evidence ranks full InChIKey, connectivity InChIKey, CAS, canonical
SMILES, then exact normalized name. Name-only matches are not marked verified.
Comparison responses include `compatibility`, `tolerance`, `similarity`,
`matched_peak_count`, `coverage_a`, `coverage_b`, and `matches`. Each match
retains both peak indices, both m/z and intensity values, `delta_da`, and
`delta_ppm` so the highlighted mirror peaks can be audited.
