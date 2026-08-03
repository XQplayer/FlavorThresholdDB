const fail = (code, details = {}) => Object.assign(new Error(code), { code, ...details });

function requireTable(stage5Data, key) {
  const table = stage5Data?.[key];
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw fail("INVALID_STAGE5_TABLE", { key });
  if (table.columns[0] !== "CAS #" || table.columns[1] !== "Name") throw fail("INVALID_STAGE5_COLUMNS", { key });
  return table;
}

function projectTable(table, columns) {
  for (const column of columns) if (!table.columns.includes(column)) throw fail("MISSING_STAGE5_COLUMN", { column });
  return {
    columns: [...columns],
    rows: table.rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? "NA"]))),
  };
}

function assertSameCasOrder(tables) {
  const baseline = tables[0].rows.map((row) => String(row["CAS #"]));
  for (const table of tables.slice(1)) {
    const current = table.rows.map((row) => String(row["CAS #"]));
    if (current.length !== baseline.length || current.some((cas, index) => cas !== baseline[index])) throw fail("CAS_ORDER_MISMATCH");
  }
}

export function splitV2Matrices({ stage5Data }) {
  if (stage5Data?.stage !== "05_统计_CV_CAS与QC") throw fail("INVALID_STAGE5_DATA");
  const sampleOrder = stage5Data.sampleOrder;
  const groupOrder = stage5Data.groupOrder;
  const configs = stage5Data.sampleConfigs;
  if (!Array.isArray(sampleOrder) || !Array.isArray(groupOrder) || !Array.isArray(configs)) throw fail("INVALID_STAGE5_CONFIG");

  const configBySample = new Map();
  for (const config of configs) {
    const sampleName = String(config?.sampleName ?? "").trim();
    const sampleGroup = String(config?.sampleGroup ?? "").trim();
    const matrixName = String(config?.matrixName ?? "").trim();
    if (!sampleName || !sampleGroup || !matrixName || configBySample.has(sampleName)) throw fail("SAMPLE_CONFIG_MISMATCH", { sampleName });
    configBySample.set(sampleName, { ...config, sampleName, sampleGroup, matrixName });
  }
  if (configBySample.size !== sampleOrder.length || sampleOrder.some((sample) => !configBySample.has(sample))) throw fail("SAMPLE_CONFIG_MISMATCH");

  const beforeTriplicate = requireTable(stage5Data, "triplicateBefore");
  const beforeMean = requireTable(stage5Data, "meanSdBefore");
  const afterTriplicate = requireTable(stage5Data, "triplicateAfter");
  const afterMean = requireTable(stage5Data, "meanSdAfter");
  assertSameCasOrder([beforeTriplicate, beforeMean, afterTriplicate, afterMean]);

  const matrixOrder = [];
  for (const sample of sampleOrder) {
    const matrix = configBySample.get(sample).matrixName;
    if (!matrixOrder.includes(matrix)) matrixOrder.push(matrix);
  }

  const matrices = matrixOrder.map((matrixName) => {
    const sampleNames = sampleOrder.filter((sample) => configBySample.get(sample).matrixName === matrixName);
    const groupNames = groupOrder.filter((group) => sampleNames.some((sample) => configBySample.get(sample).sampleGroup === group));
    if (sampleNames.length === 0 || groupNames.length === 0) throw fail("EMPTY_MATRIX", { matrixName });
    const triplicateColumns = ["CAS #", "Name", ...sampleNames.map((sample) => `${sample}（μg/mL）`)];
    const meanColumns = ["CAS #", "Name", ...groupNames.map((group) => `${group} Mean（μg/mL）`)];
    return {
      matrixName,
      sampleNames,
      groupNames,
      beforeTriplicate: projectTable(beforeTriplicate, triplicateColumns),
      beforeMean: projectTable(beforeMean, meanColumns),
      afterTriplicate: projectTable(afterTriplicate, triplicateColumns),
      afterMean: projectTable(afterMean, meanColumns),
    };
  });

  return {
    schemaVersion: "shimadzu-v2-stage6-split-1",
    matrixOrder,
    matrices,
    counts: {
      matrices: matrices.length,
      workbooks: matrices.length * 4,
      casRows: beforeTriplicate.rows.length,
      samples: sampleOrder.length,
      groups: groupOrder.length,
    },
  };
}
