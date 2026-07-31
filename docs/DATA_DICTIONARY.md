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

## CSV contracts

- Compact export: one compound per row, identity fields first, then selected
  media threshold summaries in separate columns.
- Detailed export: one threshold observation per row with all selected source,
  medium, type, value, unit, and traceability fields.
- CAS values must use an Excel-safe text representation.
