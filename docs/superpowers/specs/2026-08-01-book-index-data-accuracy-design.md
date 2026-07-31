# Book Index Data Accuracy Design

## Objective

Improve the research reliability of the *Wine Flavor Chemistry* knowledge index without altering the licensed source PDFs or the resumable per-page OCR cache. The first iteration prioritizes preventing silent data corruption over maximizing the number of automatically corrected records.

## Scope

This iteration covers the derived book index, entity records, structured threshold records, quality-assurance reporting, and regression fixtures. It does not attempt to re-OCR the book, redesign the frontend, enrich records from new external databases, or produce a newly typeset electronic book.

## Accuracy policy

Corrections are divided into two classes:

1. Deterministic normalization may change derived text when the source form has one unambiguous interpretation, such as `ug/L` to `μg/L` or `mg/Lo` to `mg/L`.
2. Ambiguous anomalies must retain the source text and receive a review flag. Examples include `pg` versus `μg`, `己` versus `已`, uncertain molecular-formula subscripts, implausible threshold magnitudes, and compound names that conflict with a detected CAS number.

Every automated correction must remain reproducible from code and covered by a regression test. The raw OCR JSON remains immutable.

## Components and data flow

### Text normalization

Extend the existing normalization stage only for deterministic OCR patterns. The normalized record continues to preserve page and block identity so it can be traced back to the source page.

### Entity identity validation

Treat a valid CAS number as the strongest local identity signal. Chinese names, English names, and aliases may enrich an entity only when compatible with that CAS. A name conflict must not overwrite the book-derived identity and must be recorded as an anomaly.

Entity association must prefer exact CAS and exact normalized aliases over substring matches. Short names must not cause a parent compound to be confused with a longer derivative name.

### Threshold validation

Each structured threshold must retain its source page, source block, raw clause, parsed value, unit, threshold type, medium, and associated CAS where available. Validation flags cover:

- unknown or ambiguous medium;
- suspicious OCR unit tokens;
- implausible magnitude requiring review;
- threshold clauses without a reliable entity association;
- entity-name and CAS conflicts;
- table-like text where row or column association is uncertain.

Flags do not delete records. High-risk records remain searchable but are distinguishable from clean records.

### QA report

Expand the QA report with machine-readable anomaly items containing category, severity, page, record or block identifier, raw evidence, and review status. Summary counts must be derived from those items. The report must separately count deterministic corrections and unresolved review flags.

### Gold-standard regression set

Create a compact checked fixture covering representative compounds, including ethyl acetate, ethyl propanoate, ethyl hexanoate, and 2-phenylethanol. Fixtures verify CAS, Chinese and English names, page association, medium, value, unit, and known negative matches. The set is intentionally small enough to inspect against source pages.

## Error handling

The rebuild must fail clearly when OCR pages are missing, expected output schemas are invalid, or a gold-standard case regresses. Individual ambiguous records do not abort the rebuild; they appear in the QA report. No rule may silently discard a source record.

## Verification

Implementation follows test-first development:

1. Add a failing regression for one accuracy behavior.
2. Confirm that it fails for the intended reason.
3. Implement the smallest correction or validation rule.
4. Run the focused test and full book-index test suite.
5. Rebuild from the cached 640-page OCR dataset.
6. Compare page, record, entity, threshold, correction, and unresolved-flag counts.
7. Run frontend book-search tests, lint, and production build when the bundled Node runtime is available.

Success means deterministic corrections are tested, ambiguous values are surfaced rather than guessed, the gold-standard cases pass, all 640 pages remain represented, and no source OCR cache or PDF is modified.
