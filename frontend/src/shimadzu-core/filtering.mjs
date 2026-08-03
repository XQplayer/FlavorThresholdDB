const FORMULA_TOKEN = /[A-Z][a-z]?/g;
const CAS_FORMAT = /^\d{2,7}-\d{2}-\d$/;

function clone(value) {
  return structuredClone(value);
}

function field(row, camelName, sourceName) {
  return row?.[camelName] ?? row?.[sourceName];
}

function isMissing(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isStrictNonnegativeNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return false;
  return Number.isFinite(Number(text));
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function casChecksumPasses(cas) {
  const [prefix, middle, checkText] = cas.split("-");
  const digits = `${prefix}${middle}`.split("").reverse();
  const sum = digits.reduce((total, digit, index) => total + Number(digit) * (index + 1), 0);
  return sum % 10 === Number(checkText);
}

function removed(row, reason) {
  return { row: clone(row), reason };
}

function review(row, reason) {
  return { row: clone(row), reason };
}

function forbiddenFormulaReason(row) {
  const formula = normalizedText(field(row, "formula", "Mol.Form"));
  if (formula === "") return null;
  const elements = new Set(formula.match(FORMULA_TOKEN) ?? []);
  return [["Si", "FORMULA_CONTAINS_SI"], ["F", "FORMULA_CONTAINS_F"], ["Cl", "FORMULA_CONTAINS_CL"]]
    .find(([element]) => elements.has(element))?.[1] ?? null;
}

function invalidCasReason(row) {
  const cas = normalizedText(field(row, "cas", "CAS #"));
  if (cas === "") return "BLANK_CAS";
  if (cas === "0-00-0") return "SENTINEL_CAS";
  if (!CAS_FORMAT.test(cas)) return "MALFORMED_CAS";
  return null;
}

function invalidRiReason(row) {
  const retIndex = field(row, "retIndex", "Ret. Index");
  const libraryIndex = field(row, "libraryIndex", "Retention Index");
  if (isMissing(retIndex)) return "MISSING_RET_INDEX";
  if (!isStrictNonnegativeNumber(retIndex)) return "INVALID_RET_INDEX";
  if (isMissing(libraryIndex)) return "MISSING_LIBRARY_RETENTION_INDEX";
  if (!isStrictNonnegativeNumber(libraryIndex)) return "INVALID_LIBRARY_RETENTION_INDEX";
  return null;
}

function invalidAreaReason(row) {
  const area = field(row, "area", "Area");
  if (isMissing(area) || !isStrictNonnegativeNumber(area)) return "INVALID_AREA";
  return null;
}

/** Apply the V2 pre-duplicate screen without mutating Stage 1 records. */
export function filterCompoundsBeforeDuplicate(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");

  const retained = [];
  const removedRows = [];
  const reviewRows = [];
  for (const sourceRow of rows) {
    const row = clone(sourceRow);
    const reason = forbiddenFormulaReason(row)
      ?? invalidCasReason(row)
      ?? invalidRiReason(row)
      ?? invalidAreaReason(row);
    if (reason) {
      removedRows.push(removed(row, reason));
      continue;
    }

    const formula = normalizedText(field(row, "formula", "Mol.Form"));
    const cas = normalizedText(field(row, "cas", "CAS #"));
    if (formula === "") reviewRows.push(review(row, "REVIEW_BLANK_FORMULA"));
    if (!casChecksumPasses(cas)) reviewRows.push(review(row, "REVIEW_CAS_Checksum"));
    retained.push(row);
  }

  const counts = { input: rows.length, retained: retained.length, removed: removedRows.length, review: reviewRows.length };
  if (counts.input !== counts.retained + counts.removed) throw new Error("V2 screening count reconciliation failed");
  return clone({ retained, removed: removedRows, review: reviewRows, counts });
}

/** Apply post-duplicate RI, formula, and CAS filters without mutating source rows. */
export function filterCompounds(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");

  const retained = [];
  const removedRows = [];
  const reviewRows = [];

  for (const sourceRow of rows) {
    const row = clone(sourceRow);
    const retIndex = field(row, "retIndex", "Ret. Index");
    const libraryIndex = field(row, "libraryIndex", "Retention Index");
    if (isMissing(retIndex)) {
      removedRows.push(removed(row, "MISSING_RET_INDEX"));
      continue;
    }
    if (!isStrictNonnegativeNumber(retIndex)) {
      removedRows.push(removed(row, "INVALID_RET_INDEX"));
      continue;
    }
    if (isMissing(libraryIndex)) {
      removedRows.push(removed(row, "MISSING_LIBRARY_RETENTION_INDEX"));
      continue;
    }
    if (!isStrictNonnegativeNumber(libraryIndex)) {
      removedRows.push(removed(row, "INVALID_LIBRARY_RETENTION_INDEX"));
      continue;
    }

    const formula = normalizedText(field(row, "formula", "Mol.Form"));
    const formulaReviewReason = formula === "" ? "REVIEW_BLANK_FORMULA" : null;
    if (formula !== "") {
      const elements = new Set(formula.match(FORMULA_TOKEN) ?? []);
      const forbidden = [["Si", "FORMULA_CONTAINS_SI"], ["F", "FORMULA_CONTAINS_F"], ["Cl", "FORMULA_CONTAINS_CL"]]
        .find(([element]) => elements.has(element));
      if (forbidden) {
        removedRows.push(removed(row, forbidden[1]));
        continue;
      }
    }

    const cas = String(field(row, "cas", "CAS #") ?? "").trim();
    if (cas === "") {
      removedRows.push(removed(row, "BLANK_CAS"));
      continue;
    }
    if (cas === "0-00-0") {
      removedRows.push(removed(row, "SENTINEL_CAS"));
      continue;
    }
    if (!CAS_FORMAT.test(cas)) {
      removedRows.push(removed(row, "MALFORMED_CAS"));
      continue;
    }
    if (formulaReviewReason) reviewRows.push(review(row, formulaReviewReason));
    if (!casChecksumPasses(cas)) reviewRows.push(review(row, "REVIEW_CAS_Checksum"));
    retained.push(row);
  }

  const counts = {
    input: rows.length,
    retained: retained.length,
    removed: removedRows.length,
    review: reviewRows.length,
  };
  if (counts.input !== counts.retained + counts.removed) {
    throw new Error("filter count reconciliation failed");
  }
  return clone({ retained, removed: removedRows, review: reviewRows, counts });
}
