export const V2_SAMPLE_HEADERS = Object.freeze([
  "样品名称", "样品分组", "矩阵名称", "样品类型", "样品形态",
  "液体样品添加量（mL）", "固体样品添加量（g）", "内标 CAS", "内标名称",
  "内标添加浓度（μg/mL）", "内标添加量（μL）", "体系液相体积（mL）",
  "体系体积口径", "顶空体系", "是否纳入内标体积",
  "用户提供的内标终浓度（μg/mL）", "是否纳入分析", "备注",
]);

function fail(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function unavailable(value) {
  const text = cleanText(value).toUpperCase();
  return text === "" || text === "NA";
}

function nonnegative(value, code) {
  if (unavailable(value)) throw fail(code, { value });
  const normalized = typeof value === "number" ? value : Number(cleanText(value).replace(/μ|µ/g, "u").match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/)?.[0]);
  if (!Number.isFinite(normalized) || normalized < 0) throw fail(code, { value });
  return normalized;
}

function yesNo(value, defaultValue) {
  if (unavailable(value)) return defaultValue;
  const text = cleanText(value).toLowerCase();
  if (["是", "yes", "true", "1", "纳入内标体积"].includes(text)) return true;
  if (["否", "no", "false", "0", "忽略内标体积"].includes(text)) return false;
  throw fail("INVALID_BOOLEAN_FIELD", { value });
}

function basis(value) {
  if (unavailable(value)) return "pre-spike";
  const text = cleanText(value);
  if (["加内标前", "pre-spike"].includes(text)) return "pre-spike";
  if (["加内标后最终体积", "加内标后", "final"].includes(text)) return "final";
  throw fail("INVALID_VOLUME_BASIS", { value });
}

export function normalizeV2Sample(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("sample row must be an object");
  const sampleForm = cleanText(row.sampleForm);
  if (!["液体", "固体"].includes(sampleForm)) throw fail("INVALID_SAMPLE_FORM", { sampleForm });
  const liquidAmountMl = unavailable(row.liquidAmountMl) ? "NA" : nonnegative(row.liquidAmountMl, "INVALID_LIQUID_AMOUNT");
  const solidAmountG = unavailable(row.solidAmountG) ? "NA" : nonnegative(row.solidAmountG, "INVALID_SOLID_AMOUNT");
  if ((sampleForm === "液体" && (liquidAmountMl === "NA" || solidAmountG !== "NA")) || (sampleForm === "固体" && (solidAmountG === "NA" || liquidAmountMl !== "NA"))) {
    throw fail("SAMPLE_AMOUNT_FORM_CONFLICT", { sampleForm, liquidAmountMl, solidAmountG });
  }
  return {
    ...structuredClone(row),
    sampleName: cleanText(row.sampleName),
    sampleGroup: cleanText(row.sampleGroup),
    matrixName: cleanText(row.matrixName),
    sampleType: cleanText(row.sampleType),
    sampleForm,
    liquidAmountMl,
    solidAmountG,
    internalStandardCas: cleanText(row.internalStandardCas),
    internalStandardName: cleanText(row.internalStandardName),
    stockUgMl: nonnegative(row.stockUgMl, "INVALID_INTERNAL_STANDARD_CONCENTRATION"),
    spikeUl: nonnegative(row.spikeUl, "INVALID_INTERNAL_STANDARD_SPIKE"),
    systemMl: nonnegative(row.systemMl, "INVALID_SYSTEM_VOLUME"),
    volumeBasis: basis(row.volumeBasis),
    headspaceSystem: cleanText(row.headspaceSystem),
    includeSpikeVolume: yesNo(row.includeSpikeVolume, true),
    userFinalUgMl: unavailable(row.userFinalUgMl) ? "NA" : nonnegative(row.userFinalUgMl, "INVALID_USER_FINAL_CONCENTRATION"),
    includeInAnalysis: yesNo(row.includeInAnalysis, true),
    notes: cleanText(row.notes),
  };
}

export function validateV2Samples(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw fail("MISSING_SAMPLE_ROWS");
  const normalized = rows.map(normalizeV2Sample);
  const names = new Set();
  for (const row of normalized) {
    if (![row.sampleName, row.sampleGroup, row.matrixName, row.internalStandardCas, row.internalStandardName].every(Boolean)) throw fail("MISSING_REQUIRED_SAMPLE_FIELD", { sampleName: row.sampleName });
    if (names.has(row.sampleName)) throw fail("DUPLICATE_SAMPLE_NAME", { sampleName: row.sampleName });
    names.add(row.sampleName);
  }
  return normalized;
}

export function finalInternalStandardConcentration(sample) {
  const spikeMl = sample.spikeUl / 1000;
  const denominator = sample.volumeBasis === "final" ? sample.systemMl : sample.systemMl + (sample.includeSpikeVolume ? spikeMl : 0);
  if (!(denominator > 0)) throw fail("INVALID_FINAL_VOLUME", { sampleName: sample.sampleName });
  return sample.stockUgMl * spikeMl / denominator;
}
