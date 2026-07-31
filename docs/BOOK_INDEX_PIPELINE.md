# Book OCR and knowledge-index pipeline

This repository contains the complete local workflow used to rebuild the *Wine Flavor Chemistry* search index from the enhanced scan.

## Directory layout

- `data/raw/books/`: original and enhanced book PDFs plus the earlier threshold handbook.
- `data/raw/threshold_sources/`: the air, water, and other-medium source PDFs.
- `data/work/book_index_rebuild/images/`: 150 dpi rendered pages used for OCR.
- `data/work/book_index_rebuild/ocr_pages/`: resumable per-page RapidOCR JSON output with boxes and confidence.
- `data/processed/`: generated entity index, full-text index, QA report, and threshold/reference datasets.
- `scripts/book_index/`: book rendering, OCR, structure recovery, entity extraction, threshold parsing, and tests.
- `scripts/threshold_import/`: the earlier three-PDF threshold extraction and merge utilities.
- `frontend/public/`: browser-ready datasets loaded by the application.

The `data/` directory is intentionally ignored by Git because it includes licensed source PDFs and large reproducible local artifacts. Back it up separately.

## Rebuild from the migrated OCR cache

From the repository root:

```powershell
python -m pip install -r scripts/book_index/requirements.txt
python scripts/book_index/rebuild_book_knowledge_index.py --skip-render --skip-ocr --keep-images
```

This uses the enhanced PDF in `data/raw/books/` and the 640 cached page images and OCR JSON files in `data/work/book_index_rebuild/`.

## Rebuild OCR from the enhanced PDF

Install Poppler so `pdftoppm` is on `PATH`, then run:

```powershell
python scripts/book_index/rebuild_book_knowledge_index.py --keep-images
```

Alternatively pass `--pdftoppm C:\path\to\pdftoppm.exe`. OCR is resumable because each completed page is saved independently.

## Output and normalization rules

The pipeline writes the complete index to both `data/processed/` and `frontend/public/`. It also refreshes the copy under `frontend/dist/` when that directory exists.

Core rules:

- Normalize OCR unit variants such as `|ig/L`, `pLg/L`, `ug/L`, `pug/L`, and `μug/g` to `μg` forms.
- Preserve ambiguous literal `pg` units and alcohol percentages for source review instead of silently rewriting them; source-verified literal `pg` values remain unchanged and are removed from the unresolved review queue with an explicit verification marker.
- Preserve page, bounding-box-derived paragraph blocks, chapter, section, and source text.
- Preserve cross-page compound context across running chapter headers, while true chapter starts still reset context.
- Extract CAS, Chinese name, English names, aliases, FEMA number, and RI groups.
- Repair OCR-only whitespace inside otherwise valid CAS numbers before entity matching.
- Recover canonical entities from an exact CAS even when brackets or OCR layout prevent full source-profile parsing; mark these entries with `canonical_cas_fallback`.
- Reset inherited CAS context when a new CAS-less compound profile begins and retain its source name as a name-only identity across continuation blocks.
- Split threshold statements by medium and retain only structured records containing parsed values and units.
- Preserve alcohol strength as `medium_detail`, split OCR-broken medium clauses, and distinguish model wine and food matrices.
- Separate threshold values from matrix components and sample concentrations while retaining the latter as contextual evidence.
- Apply only record-level corrections listed in `book_threshold_source_corrections.json`, each backed by a checked source page; retain the original OCR text and correction reason.
- Record entity-association method and confidence; preserve explicit peptide and other name-only subjects when no CAS exists, including same-block subject inheritance across semicolon-separated threshold statements.
- Attach review status and machine-readable flags for unknown media, ambiguous units, missing subjects, and suspicious magnitudes.
- Classify source/master name disagreements as name variants, likely OCR errors, insufficient extraction, or identity conflicts.
- Apply source-page and PubChem-verified CAS/name resolutions from `book_identity_conflict_resolutions.json` without rewriting the book's printed identity.
- Apply source-page record identity overlays from `book_record_identity_corrections.json` when OCR drops a CAS line, and retain the corrected CAS, page-image evidence, and reason on every affected website record.
- Split transition blocks where a leading threshold belongs to the prior compound but a later profile introduces a new CAS in the same OCR block.
- Use the threshold master dataset to enrich aliases only when the CAS/name evidence is compatible.
- Preserve source/master disagreements as `canonical_conflict`; never silently overwrite the book identity.
- Merge duplicate/overlapping same-page frontend results and rank CAS/entity matches above plain substring matches.
- Extract numbered-table metadata (table number, title, unit and source locator); attach source-verified row/column data from `book_table_structured_rows.json` where available and keep unverified tables explicitly marked as linearized OCR.
- Include verified table cells in the search corpus so corrected row labels remain searchable even when the linear OCR text is damaged.
- Show threshold association confidence, concrete review reasons, page/block/record locators and source-verified corrections in website book-result cards.
- Grade source/master differences as informational name variants, likely OCR errors, or high-risk identity conflicts.

## Verification

```powershell
python -m unittest discover -s scripts/book_index -p "test_*.py" -v
cd frontend
pnpm run test:book-search
pnpm run lint
pnpm run build
```

The fixed regression set includes CAS, Chinese names, English aliases, peptide name-only subjects, specialized media, contextual concentrations, source-verified corrections, literal units and high magnitudes, CAS fallback recovery, source-verified missing-CAS overlays, cross-page peptide-subject continuation, CAS-less profile switching, transition-block splitting, source-resolved identity conflicts, verified table rows, running-header context, source/master conflict classes, sensory route parsing, source-verified medium and subject resolution, duplicate-threshold elimination, and source-verified cross-block supplements. The current expected summary is 640 pages, 4,863 text records, 628 entities, 1,970 structured thresholds (after removing duplicates and adding four page-audited cross-block threshold groups), 17 numbered-table entries with 180 source-verified rows, zero target unit-pattern errors, zero unresolved ambiguous-unit, missing-entity, suspicious-magnitude, unknown-medium, or high-risk canonical-identity flags, 6/6 gold-standard identities passing, 95/95 source-page-verified threshold cases passing, and no fixed query without a hit. `book_index_quality_gates.json` makes these coverage floors and anomaly ceilings build-blocking.
