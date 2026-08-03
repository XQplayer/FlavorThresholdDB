function issueList(issues) {
  if (!Array.isArray(issues)) throw new TypeError("issues must be an array");
  return issues;
}

export function stageStatus(issues) {
  const rows = issueList(issues);
  if (rows.some((issue) => issue?.severity === "FAIL")) return "FAIL";
  if (rows.some((issue) => issue?.severity === "REVIEW")) return "REVIEW";
  if (rows.some((issue) => issue?.severity === "WARN")) return "WARN";
  return "PASS";
}

export function summarizeHit1Sample(sample, result) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new TypeError("sample must be an object");
  if (!result || !Array.isArray(result.records) || !Array.isArray(result.lineage)) throw new TypeError("result must contain records and lineage arrays");
  const issues = issueList(result.issues);
  const missing = issues.filter((issue) => issue.code === "HIT1_NOT_FOUND");
  const duplicateHit1 = issues.filter((issue) => issue.code === "REVIEW_Duplicate_Hit1");
  const count = (severity) => issues.filter((issue) => issue.severity === severity).length;
  return {
    sampleName: String(sample.sampleName ?? "").trim(),
    sampleGroup: String(sample.sampleGroup ?? "").trim(),
    input: result.records.length + missing.length,
    removed: missing.length,
    merged: 0,
    imputed: 0,
    retained: result.records.length,
    warn: count("WARN"),
    review: count("REVIEW"),
    fail: count("FAIL"),
    duplicateHit1Spectra: duplicateHit1.length,
    duplicateHit1ExtraRows: duplicateHit1.reduce((sum, issue) => sum + Math.max(0, (issue.sourceRows?.length ?? 0) - 1), 0),
    duplicatePeaks: issues.filter((issue) => issue.code === "REVIEW_Duplicate_Peak").length,
    structuralAnomalies: issues.filter((issue) => String(issue.code ?? "").startsWith("FAIL_")).length,
    status: stageStatus(issues),
  };
}

export function groupConfiguredSamples(samples) {
  if (!Array.isArray(samples)) throw new TypeError("samples must be an array");
  const groups = new Map();
  const names = new Set();
  for (const sample of samples) {
    const sampleName = String(sample?.sampleName ?? "").trim();
    const sampleGroup = String(sample?.sampleGroup ?? "").trim();
    if (!sampleName || !sampleGroup) throw Object.assign(new Error("MISSING_SAMPLE_GROUP_FIELD"), { code: "MISSING_SAMPLE_GROUP_FIELD" });
    if (names.has(sampleName)) throw Object.assign(new Error("DUPLICATE_SAMPLE_NAME"), { code: "DUPLICATE_SAMPLE_NAME", sampleName });
    names.add(sampleName);
    groups.set(sampleGroup, [...(groups.get(sampleGroup) ?? []), sample]);
  }
  return [...groups].map(([sampleGroup, rows]) => ({ sampleGroup, samples: rows }));
}
