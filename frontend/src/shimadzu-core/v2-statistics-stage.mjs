function fail(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sampleSd(values, mean) {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function aboveThreshold(value, threshold) {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(threshold)) * 16;
  return value - threshold > tolerance;
}

function table(columns, rows) {
  return { columns, rows };
}

function groupSamples(stage4Data) {
  const byGroup = new Map(stage4Data.groupOrder.map((group) => [group, []]));
  for (const sampleName of stage4Data.sampleOrder) {
    const config = stage4Data.sampleConfigs.find((entry) => entry.sampleName === sampleName);
    if (!config || !byGroup.has(config.sampleGroup)) throw fail("SAMPLE_GROUP_CONFIGURATION_MISMATCH", { sampleName });
    byGroup.get(config.sampleGroup).push(sampleName);
  }
  for (const [sampleGroup, names] of byGroup) if (names.length !== 3) throw fail("STATISTICS_REQUIRE_THREE_REPLICATES", { sampleGroup, count: names.length });
  return byGroup;
}

function imputationText(stage4Data, sampleGroup, cas) {
  const logs = stage4Data.inheritedLogs?.imputedTwoOfThree ?? [];
  const matches = logs.filter((entry) => entry.sampleGroup === sampleGroup && entry.cas === cas);
  return matches.length ? matches.map((entry) => `${entry.targetSample}=${entry.imputedArea}`).join("; ") : "NA";
}

function configuredStandards(stage4Data) {
  const seen = new Set();
  const output = [];
  for (const config of stage4Data.sampleConfigs) {
    if (!seen.has(config.internalStandardCas)) {
      seen.add(config.internalStandardCas);
      output.push(config.internalStandardCas);
    }
  }
  return output;
}

export function processV2Statistics({ stage4Data, cvThreshold = 30 }) {
  const source = structuredClone(stage4Data);
  if (source.stage !== "04_跨样品合并与半定量") throw fail("WRONG_STAGE4_INPUT");
  if (!(typeof cvThreshold === "number" && Number.isFinite(cvThreshold) && cvThreshold >= 0)) throw fail("INVALID_CV_THRESHOLD");
  if (!Array.isArray(source.sampleOrder) || !Array.isArray(source.groupOrder) || !Array.isArray(source.sampleConfigs)) throw fail("INVALID_STAGE4_STRUCTURE");
  const samplesByGroup = groupSamples(source);
  const expectedColumns = ["CAS #", "Name"];
  for (const sampleName of source.sampleOrder) expectedColumns.push(`${sampleName}（μg/mL）`);
  const meanColumns = ["CAS #", "Name"];
  for (const sampleGroup of source.groupOrder) meanColumns.push(`${sampleGroup} Mean（μg/mL）`, `${sampleGroup} SD（μg/mL）`);

  const triplicateBeforeRows = [];
  const triplicateAfterRows = [];
  const meanSdBeforeRows = [];
  const meanSdAfterRows = [];
  const groupStatistics = [];
  const cvReport = [];
  const seenCas = new Set();

  for (const sourceRow of source.table.rows) {
    const cas = sourceRow["CAS #"];
    if (seenCas.has(cas)) throw fail("DUPLICATE_CAS_IN_STAGE4_TABLE", { cas });
    seenCas.add(cas);
    const pre = { "CAS #": cas, Name: sourceRow.Name };
    const post = { "CAS #": cas, Name: sourceRow.Name };
    const meanPre = { "CAS #": cas, Name: sourceRow.Name };
    const meanPost = { "CAS #": cas, Name: sourceRow.Name };
    for (const sampleName of source.sampleOrder) {
      const value = sourceRow[`${sampleName}（μg/mL）`] ?? "NA";
      if (!(value === "NA" || numeric(value))) throw fail("INVALID_STAGE4_CONCENTRATION", { cas, sampleName, value });
      pre[`${sampleName}（μg/mL）`] = value;
      post[`${sampleName}（μg/mL）`] = value;
    }
    for (const sampleGroup of source.groupOrder) {
      const names = samplesByGroup.get(sampleGroup);
      const values = names.map((name) => pre[`${name}（μg/mL）`]);
      const valid = values.filter(numeric);
      let mean = "NA";
      let sd = "NA";
      let cv = "NA";
      let status = "All_NA";
      if (valid.length === 3) {
        mean = valid.reduce((sum, value) => sum + value, 0) / 3;
        sd = sampleSd(valid, mean);
        cv = mean === 0 ? "NA" : sd / Math.abs(mean) * 100;
        status = numeric(cv) && aboveThreshold(cv, cvThreshold)
          ? "Filtered_CV_Above_30"
          : numeric(cv) ? "Retained_CV_At_Or_Below_30" : "Retained_CV_Undefined_Zero_Mean";
      } else if (valid.length !== 0) {
        throw fail("INCONSISTENT_TRIPLICATE_CONCENTRATION_STATE", { cas, sampleGroup, values });
      }
      const imputationInfo = imputationText(source, sampleGroup, cas);
      const stats = { cas, name: sourceRow.Name, sampleGroup, sampleNames: [...names], concentrations: [...values], mean, sd, cv, cvThreshold, imputationInfo, status };
      groupStatistics.push(stats);
      meanPre[`${sampleGroup} Mean（μg/mL）`] = mean;
      meanPre[`${sampleGroup} SD（μg/mL）`] = sd;
      if (status === "Filtered_CV_Above_30") {
        for (const name of names) post[`${name}（μg/mL）`] = "NA";
        meanPost[`${sampleGroup} Mean（μg/mL）`] = "NA";
        meanPost[`${sampleGroup} SD（μg/mL）`] = "NA";
        cvReport.push({
          ...stats,
          filteredColumns: names.map((name) => `${name}（μg/mL）`),
          reason: `CV ${cv} > ${cvThreshold}%`,
        });
      } else {
        meanPost[`${sampleGroup} Mean（μg/mL）`] = mean;
        meanPost[`${sampleGroup} SD（μg/mL）`] = sd;
      }
    }
    triplicateBeforeRows.push(pre);
    triplicateAfterRows.push(post);
    meanSdBeforeRows.push(meanPre);
    meanSdAfterRows.push(meanPost);
  }

  const allScreenedRows = source.table.rows.map((row) => ({ "CAS #": row["CAS #"], Name: row.Name }));
  const finalRowsInSourceOrder = triplicateAfterRows
    .filter((row) => source.sampleOrder.some((name) => numeric(row[`${name}（μg/mL）`])))
    .map((row) => ({ "CAS #": row["CAS #"], Name: row.Name }));
  const standards = configuredStandards(source);
  const finalAnalysisRows = [
    ...standards.flatMap((cas) => finalRowsInSourceOrder.filter((row) => row["CAS #"] === cas)),
    ...finalRowsInSourceOrder.filter((row) => !standards.includes(row["CAS #"])),
  ];
  const counts = {
    samples: source.sampleOrder.length,
    groups: source.groupOrder.length,
    casRows: source.table.rows.length,
    groupStatistics: groupStatistics.length,
    numericGroups: groupStatistics.filter((entry) => numeric(entry.mean)).length,
    allNaGroups: groupStatistics.filter((entry) => entry.status === "All_NA").length,
    filteredGroups: cvReport.length,
    allScreenedCas: allScreenedRows.length,
    finalAnalysisCas: finalAnalysisRows.length,
  };
  if (counts.groupStatistics !== counts.casRows * counts.groups) throw fail("STATISTICS_COUNT_RECONCILIATION_FAILED");

  return {
    cvThreshold,
    sampleOrder: [...source.sampleOrder],
    groupOrder: [...source.groupOrder],
    sampleConfigs: structuredClone(source.sampleConfigs),
    triplicateBefore: table(expectedColumns, triplicateBeforeRows),
    meanSdBefore: table(meanColumns, meanSdBeforeRows),
    triplicateAfter: table(expectedColumns, triplicateAfterRows),
    meanSdAfter: table(meanColumns, meanSdAfterRows),
    groupStatistics,
    cvReport,
    allScreenedCas: table(["CAS #", "Name"], allScreenedRows),
    finalAnalysisCas: table(["CAS #", "Name"], finalAnalysisRows),
    counts,
  };
}
