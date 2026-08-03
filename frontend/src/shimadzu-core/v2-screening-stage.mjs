import { resolveDuplicateCas } from "./duplicate-cas.mjs";
import { filterCompoundsBeforeDuplicate } from "./filtering.mjs";
import { HIT1_OUTPUT_COLUMNS } from "./parse-shimadzu.mjs";
import { stageStatus } from "./v2-hit1-stage.mjs";

function fail(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

function visibleRecord(row) {
  return Object.fromEntries(HIT1_OUTPUT_COLUMNS.map((column) => [column, row?.[column] ?? "NA"]));
}

function severityCount(issues, severity) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function reasonCategory(reason) {
  return String(reason).startsWith("FORMULA_CONTAINS_") ? "element" : "invalid";
}

export function screenStage2Sample({ sampleName, sampleGroup, records, lineage }) {
  if (!Array.isArray(records) || !Array.isArray(lineage)) throw new TypeError("records and lineage must be arrays");
  if (records.length !== lineage.length) throw fail("STAGE1_RECORD_LINEAGE_LENGTH_MISMATCH", { sampleName, records: records.length, lineage: lineage.length });

  const workingRows = records.map((record, index) => ({
    ...clone(record),
    originalRowOrder: Number(lineage[index]?.originalRowOrder ?? index + 1),
  }));
  const lineageByOrder = new Map(workingRows.map((row, index) => [row.originalRowOrder, clone(lineage[index])]));
  const screened = filterCompoundsBeforeDuplicate(workingRows);
  const resolved = resolveDuplicateCas(screened.retained);
  if (resolved.ineligible.length || resolved.issues.length) {
    throw fail("POST_SCREEN_DUPLICATE_INVARIANT_FAILED", { sampleName, ineligible: resolved.ineligible, issues: resolved.issues });
  }

  const removals = screened.removed.map((entry) => ({
    sampleName,
    sampleGroup,
    reason: entry.reason,
    category: reasonCategory(entry.reason),
    row: visibleRecord(entry.row),
    lineage: clone(lineageByOrder.get(entry.row.originalRowOrder)),
  }));
  const reviews = screened.review.map((entry) => ({
    sampleName,
    sampleGroup,
    reason: entry.reason,
    row: visibleRecord(entry.row),
    lineage: clone(lineageByOrder.get(entry.row.originalRowOrder)),
  }));
  const duplicateDecisions = resolved.decisionLog.map((decision) => ({
    sampleName,
    sampleGroup,
    ...clone(decision),
    sourceLineage: decision.sourceRows.map((order) => clone(lineageByOrder.get(order))),
    chosenLineage: clone(lineageByOrder.get(decision.chosenMetadataRow)),
  }));
  const issues = reviews.map((entry) => ({
    severity: "REVIEW",
    code: entry.reason,
    sampleName,
    sampleGroup,
    sourceRow: entry.lineage?.originalRowOrder ?? "NA",
    message: entry.reason,
  }));

  const duplicateReduction = duplicateDecisions.reduce((sum, decision) => sum + decision.sourceRows.length - 1, 0);
  const mergedAbsorbed = duplicateDecisions.reduce((sum, decision) => sum + decision.absorbedSourceRows.length, 0);
  const duplicateDiscarded = duplicateDecisions.reduce((sum, decision) => sum + decision.discardedSourceRows.length, 0);
  const elementRemoved = removals.filter((entry) => entry.category === "element").length;
  const invalidRemoved = removals.length - elementRemoved;
  const summary = {
    sampleName,
    sampleGroup,
    input: records.length,
    elementRemoved,
    invalidRemoved,
    screeningRemoved: removals.length,
    duplicateGroups: duplicateDecisions.length,
    duplicateReduction,
    mergedAbsorbed,
    duplicateDiscarded,
    retained: resolved.kept.length,
    warn: severityCount(issues, "WARN"),
    review: severityCount(issues, "REVIEW"),
    fail: severityCount(issues, "FAIL"),
    status: stageStatus(issues),
  };
  if (summary.input !== summary.screeningRemoved + summary.duplicateReduction + summary.retained) {
    throw fail("STAGE2_COUNT_RECONCILIATION_FAILED", { sampleName, summary });
  }

  return clone({
    sampleName,
    sampleGroup,
    columns: [...HIT1_OUTPUT_COLUMNS],
    records: resolved.kept.map(visibleRecord),
    lineage: resolved.kept.map((row) => clone(lineageByOrder.get(row.originalRowOrder))),
    originalRecords: records,
    originalLineage: lineage,
    removals,
    reviews,
    duplicateDecisions,
    issues,
    summary,
  });
}
