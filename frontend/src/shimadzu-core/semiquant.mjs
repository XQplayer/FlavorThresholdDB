const RELATIVE_ERROR_LIMIT = 0.001;

export function createQcError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "QCError";
  const issue = { severity: "FAIL", code, message, ...details };
  Object.assign(error, issue, { issues: [issue] });
  return error;
}

function qcFailure(code, message, details = {}) {
  return {
    status: "FAIL",
    issues: [{ severity: "FAIL", code, message, ...details }],
  };
}

function requireNonNegativeNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw createQcError(
      "INVALID_NUMERIC_PARAMETER",
      `${name} must be a normalized finite non-negative number`,
      { parameter: name },
    );
  }
}

function requirePositiveNumber(value, name) {
  requireNonNegativeNumber(value, name);
  if (value === 0) {
    throw createQcError("INVALID_NUMERIC_PARAMETER", `${name} must be greater than zero`, { parameter: name });
  }
}

function relativeError(actual, expected) {
  if (expected === 0) return actual === 0 ? 0 : null;
  const difference = Math.abs(actual - expected);
  if (!Number.isFinite(difference)) return null;
  const error = difference / Math.abs(expected);
  if (!Number.isFinite(error)) return null;
  return Math.abs(error - RELATIVE_ERROR_LIMIT) <= Number.EPSILON * 8
    ? RELATIVE_ERROR_LIMIT
    : error;
}

function auditEncoding(value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { type: "number", display: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity" };
  }
  if (value !== null && typeof value === "object") {
    let display;
    try { display = JSON.stringify(value); } catch { display = String(value); }
    return { type: Array.isArray(value) ? "array" : "object", display };
  }
  if (value === undefined) return { type: "undefined", display: "undefined" };
  return value;
}

function auditDescription(value) {
  const encoded = auditEncoding(value);
  if (encoded && typeof encoded === "object" && "type" in encoded) return encoded;
  return { type: value === null ? "null" : typeof value, display: String(value) };
}

/**
 * Calculate the internal-standard concentration in normalized ug/mL, uL and mL units.
 * A supplied final concentration is authoritative only after the 0.1% reconciliation gate.
 */
export function finalIsConcentration({
  stockUgMl,
  spikeUl,
  systemMl,
  basis,
  method,
  userFinalUgMl,
}) {
  requireNonNegativeNumber(stockUgMl, "stockUgMl (ug/mL)");
  requireNonNegativeNumber(spikeUl, "spikeUl (uL)");
  requirePositiveNumber(systemMl, "systemMl (mL)");
  const spikeMl = spikeUl / 1000;

  let calculated;
  if (basis === "pre-spike" && method === "include") {
    calculated = stockUgMl * spikeMl / (systemMl + spikeMl);
  } else if (basis === "pre-spike" && method === "ignore") {
    calculated = stockUgMl * spikeMl / systemMl;
  } else if (basis === "final" && method === "include") {
    calculated = stockUgMl * spikeMl / systemMl;
  } else {
    throw createQcError(
      "UNCONFIRMED_VOLUME_METHOD",
      `Unsupported concentration basis/method: ${String(basis)}/${String(method)}`,
      { basis: String(basis), method: String(method) },
    );
  }

  if (!Number.isFinite(calculated)) {
    throw createQcError(
      "NON_FINITE_CALCULATION",
      "Internal-standard concentration calculation produced a non-finite result",
    );
  }

  if (userFinalUgMl === undefined) return calculated;
  requireNonNegativeNumber(userFinalUgMl, "userFinalUgMl (ug/mL)");
  const error = relativeError(userFinalUgMl, calculated);
  if (error === null || error > RELATIVE_ERROR_LIMIT) {
    throw createQcError(
      "FINAL_IS_CONCENTRATION_MISMATCH",
      "User-provided final internal-standard concentration differs from the calculated value by more than 0.1%",
      { calculatedUgMl: calculated, userFinalUgMl, relativeError: error ?? "NA" },
    );
  }
  return userFinalUgMl;
}

/** Calculate one analyte using AreaAnalyte / AreaIS * CIS with a fixed RRF of 1. */
export function semiquantify({ analyteArea, isArea, isConcentration, rrf = 1 }) {
  requireNonNegativeNumber(analyteArea, "analyteArea");
  requireNonNegativeNumber(isConcentration, "isConcentration (ug/mL)");
  if (rrf !== 1) {
    throw createQcError("RRF_MUST_EQUAL_ONE", "Semiquantitation requires RRF=1");
  }
  if (typeof isArea !== "number" || !Number.isFinite(isArea) || isArea <= 0) {
    return {
      value: "NA",
      ...qcFailure(
        "INVALID_INTERNAL_STANDARD_AREA",
        "Internal-standard area must be a finite number greater than zero",
      ),
    };
  }
  if (analyteArea === 0) return { value: "NA", status: "Zero_Area_Not_Quantifiable" };
  const value = analyteArea / isArea * isConcentration;
  if (!Number.isFinite(value)) {
    throw createQcError(
      "NON_FINITE_CALCULATION",
      "Semiquantitation calculation produced a non-finite result",
    );
  }
  return {
    value,
    status: "Calculated",
  };
}

/**
 * Quantify one replicate whose internal-standard area is missing.
 * Exactly two positive donor areas are required; source values are never overwritten.
 */
export function concentrationWithImputedIs({ otherIsAreas, analyteArea, isConcentration }) {
  if (!Array.isArray(otherIsAreas)) {
    throw createQcError("INVALID_INTERNAL_STANDARD_DONORS", "otherIsAreas must be an array");
  }
  requireNonNegativeNumber(analyteArea, "analyteArea");
  requireNonNegativeNumber(isConcentration, "isConcentration (ug/mL)");
  const encodedDonors = otherIsAreas.map(auditEncoding);
  const raw = { analyteArea, isArea: "NA", isConcentration, otherIsAreas: encodedDonors };
  const donors = structuredClone(otherIsAreas);
  const donorValue = (donor) => {
    if (typeof donor === "number") return donor;
    if (donor && typeof donor === "object" && donor.status === "Measured") return donor.value;
    return undefined;
  };
  const invalidDonors = donors.flatMap((donor, index) => {
    const value = donorValue(donor);
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? []
      : [{ index, ...auditDescription(donor) }];
  });
  const validDonors = donors.map(donorValue)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (donors.length !== 2 || validDonors.length !== 2) {
    const issues = invalidDonors.map(({ index, type, display }) => ({
      severity: "FAIL",
      code: "INVALID_INTERNAL_STANDARD_DONOR",
      message: "Internal-standard donor area must be a finite number greater than zero",
      index,
      type,
      display,
    }));
    if (donors.length !== 2) issues.push({
      severity: "FAIL", code: "INVALID_INTERNAL_STANDARD_DONOR_COUNT",
      message: "Exactly two internal-standard donor areas are required", count: donors.length,
    });
    return {
      raw,
      processed: { analyteArea, isArea: "NA", isConcentration, value: "NA" },
      status: "Internal_Standard_Missing_Insufficient_Donors",
      audit: { sourceIsAreas: encodedDonors, invalidDonors },
      issues,
    };
  }
  const isArea = (validDonors[0] + validDonors[1]) / 2;
  if (!Number.isFinite(isArea)) {
    throw createQcError("NON_FINITE_CALCULATION", "Internal-standard area imputation produced a non-finite result");
  }
  const quantified = semiquantify({ analyteArea, isArea, isConcentration });
  return {
    raw,
    processed: { analyteArea, isArea, isConcentration, value: quantified.value },
    status: quantified.status === "Calculated" ? "Calculated_With_Imputed_IS_Area" : quantified.status,
    audit: { sourceIsAreas: donors },
  };
}

/** Normalize valid compound areas independently within one replicate. */
export function normalizeAreas(areas) {
  if (!Array.isArray(areas)) throw createQcError("INVALID_AREA_VECTOR", "areas must be an array");
  const input = structuredClone(areas);
  const raw = input.map(auditEncoding);
  const valid = input.map((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const missing = input.map((value) => value === "NA" || value === null || value === undefined);
  const total = input.reduce((sum, value, index) => valid[index] ? sum + value : sum, 0);
  if (!Number.isFinite(total)) {
    throw createQcError("NON_FINITE_CALCULATION", "Area normalization total produced a non-finite result");
  }
  const processed = input.map((value, index) => {
    if (!valid[index] || total === 0) return "NA";
    return value / total * 100;
  });
  const status = input.map((value, index) => {
    if (missing[index]) return "Not_Detected";
    if (!valid[index]) return "QC_Failed";
    if (total === 0) return "Normalization_Total_Area_Zero";
    return value === 0 ? "Zero_Area_Not_Quantifiable" : "Normalized";
  });
  const audit = input.flatMap((value, index) => (!valid[index] && !missing[index]
    ? [{ index, ...auditDescription(value) }]
    : []));
  const issues = audit.map(({ index, type, display }) => ({
    severity: "FAIL", code: "INVALID_NORMALIZATION_AREA",
    message: "Normalization area must be a finite non-negative number or NA", index, type, display,
  }));
  const out = { raw, processed, status };
  if (audit.length) Object.assign(out, { audit, issues });
  return out;
}

/** Apply the 0.1% internal-standard self-backcalculation QC gate. */
export function validateIsBackcalculation({ expectedUgMl, backcalculatedUgMl }) {
  requireNonNegativeNumber(expectedUgMl, "expectedUgMl (ug/mL)");
  requireNonNegativeNumber(backcalculatedUgMl, "backcalculatedUgMl (ug/mL)");
  const error = relativeError(backcalculatedUgMl, expectedUgMl);
  if (error !== null && error <= RELATIVE_ERROR_LIMIT) return { status: "PASS", relativeError: error };
  return {
    relativeError: error ?? "NA",
    ...qcFailure(
      "INTERNAL_STANDARD_BACKCALC_MISMATCH",
      "Internal-standard self-backcalculation differs from its set concentration by more than 0.1%",
    ),
  };
}
