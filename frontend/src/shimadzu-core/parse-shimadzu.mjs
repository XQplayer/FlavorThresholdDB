import { normalizeCas } from "./normalize.mjs";

const PEAK_SECTION = "[mc peak table]";
const SEARCH_SECTION = "[ms similarity search results for spectrum process table]";
const PEAK_REQUIRED_HEADERS = Object.freeze(["Peak#", "Area"]);
const SEARCH_REQUIRED_HEADERS = Object.freeze([
  "Spectrum#", "Hit #", "CAS #", "Name", "Mol.Form", "Mol.Weight", "Retention Index",
]);

export const HIT1_OUTPUT_COLUMNS = Object.freeze([
  "Peak#",
  "Spectrum#",
  "Hit #",
  "CAS #",
  "Name",
  "Mol.Form",
  "Mol.Weight",
  "Proc.To",
  "Ret. Index",
  "Retention Index",
  "Area",
]);

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function rowCells(row) {
  return Array.isArray(row) ? row : row?.cells;
}

function locateSection(rows, expectedTitle) {
  return rows.findIndex((row) => rowCells(row)?.some((cell) => normalizedText(cell) === expectedTitle));
}

function headerMap(row) {
  const map = new Map();
  for (const [index, value] of (rowCells(row) ?? []).entries()) {
    const name = normalizedText(value);
    if (name && !map.has(name)) map.set(name, index);
  }
  return map;
}

function hasHeaders(headers, required) {
  return required.every((name) => headers.has(normalizedText(name)));
}

function findHeader(rows, start, end, required) {
  for (let index = start; index < end; index += 1) {
    const headers = headerMap(rows[index]);
    if (hasHeaders(headers, required)) return { index, headers };
  }
  return null;
}

function cell(row, headers, name) {
  const index = headers.get(normalizedText(name));
  return index === undefined ? undefined : rowCells(row)?.[index];
}

function exactInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\s*\d+\s*$/.test(value)) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nextSectionIndex(rows, start) {
  for (let index = start; index < rows.length; index += 1) {
    const cells = rowCells(rows[index]) ?? [];
    if (cells.some((value) => /^\[[^\]]+\]$/.test(String(value ?? "").trim()))) return index;
  }
  return rows.length;
}

function sourceRowOf(row, fallbackIndex) {
  return Number.isInteger(row?.sourceRow) ? row.sourceRow : fallbackIndex + 1;
}

function makeRecord(peak, search) {
  const record = {
    "Peak#": peak.peakNo,
    "Spectrum#": search.spectrumNo,
    "Hit #": search.hitNo,
    "CAS #": normalizeCas(search.values["CAS #"]),
    "Name": search.values.Name,
    "Mol.Form": search.values["Mol.Form"],
    "Mol.Weight": search.values["Mol.Weight"],
    "Proc.To": search.values["Proc.To"] ?? peak.values["Proc.To"],
    "Ret. Index": search.values["Ret. Index"] ?? peak.values["Ret. Index"],
    "Retention Index": search.values["Retention Index"],
    "Area": peak.values.Area,
  };
  return Object.freeze(record);
}

function freezeIssue(issue) {
  for (const value of Object.values(issue)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  return Object.freeze(issue);
}

function frozenResult(records, lineage, issues) {
  const frozenRecords = Object.freeze(records);
  const frozenLineage = Object.freeze(lineage.map((entry) => Object.freeze(entry)));
  const frozenIssues = Object.freeze(issues.map(freezeIssue));
  return Object.freeze({
    columns: HIT1_OUTPUT_COLUMNS,
    records: frozenRecords,
    lineage: frozenLineage,
    issues: frozenIssues,
  });
}

function emptyMissingSearchResult() {
  return frozenResult([], [], [{
      severity: "FAIL",
      code: "FAIL_Missing_Search_Results",
      message: "MS similarity search results section was not found",
  }]);
}

function missingStructureResult(code, message, missingHeaders = undefined) {
  const issue = { severity: "FAIL", code, message };
  if (missingHeaders) issue.missingHeaders = missingHeaders;
  return frozenResult([], [], [issue]);
}

/**
 * Extract the Hit #1 similarity-search row matching each Peak# in source order.
 * Input rows are plain arrays or `{ sourceRow, cells }` objects.
 *
 * @param {Array<Array<unknown>|{sourceRow?: number, cells: unknown[]}>} rows
 * @returns {{columns: readonly string[], records: object[], lineage: object[], issues: object[]}}
 */
export function extractHit1(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Shimadzu sheet rows must be an array");

  const searchSectionIndex = locateSection(rows, SEARCH_SECTION);
  if (searchSectionIndex < 0) return emptyMissingSearchResult();

  const peakSectionIndex = locateSection(rows, PEAK_SECTION);
  if (peakSectionIndex < 0) {
    return missingStructureResult(
      "FAIL_Missing_Peak_Table",
      "MC peak table section was not found",
    );
  }

  const peakEnd = Math.min(searchSectionIndex, nextSectionIndex(rows, peakSectionIndex + 1));
  const searchEnd = nextSectionIndex(rows, searchSectionIndex + 1);
  const peakHeader = findHeader(rows, peakSectionIndex + 1, peakEnd, PEAK_REQUIRED_HEADERS);
  if (!peakHeader) {
    return missingStructureResult(
      "FAIL_Missing_Peak_Headers",
      `MC peak table is missing required headers: ${PEAK_REQUIRED_HEADERS.join(", ")}`,
      [...PEAK_REQUIRED_HEADERS],
    );
  }
  const searchHeader = findHeader(rows, searchSectionIndex + 1, searchEnd, SEARCH_REQUIRED_HEADERS);
  if (!searchHeader) {
    return missingStructureResult(
      "FAIL_Missing_Search_Headers",
      `MS similarity search results are missing required headers: ${SEARCH_REQUIRED_HEADERS.join(", ")}`,
      [...SEARCH_REQUIRED_HEADERS],
    );
  }

  const peaks = [];
  for (let index = peakHeader.index + 1; index < peakEnd; index += 1) {
    const peakNo = exactInteger(cell(rows[index], peakHeader.headers, "Peak#"));
    if (peakNo === null) continue;
    peaks.push({
      peakNo,
      sourceRow: sourceRowOf(rows[index], index),
      values: {
        Area: cell(rows[index], peakHeader.headers, "Area"),
        "Proc.To": cell(rows[index], peakHeader.headers, "Proc.To"),
        "Ret. Index": cell(rows[index], peakHeader.headers, "Ret. Index"),
      },
    });
  }

  const hit1Candidates = new Map();
  let hit1EncounterOrder = 0;
  for (let index = searchHeader.index + 1; index < searchEnd; index += 1) {
    const spectrumNo = exactInteger(cell(rows[index], searchHeader.headers, "Spectrum#"));
    const hitNo = exactInteger(cell(rows[index], searchHeader.headers, "Hit #"));
    if (spectrumNo === null || hitNo !== 1) continue;
    const candidate = {
      spectrumNo,
      hitNo,
      sourceRow: sourceRowOf(rows[index], index),
      encounterOrder: hit1EncounterOrder,
      values: Object.fromEntries(["CAS #", "Name", "Mol.Form", "Mol.Weight", "Proc.To", "Ret. Index", "Retention Index"].map(
        (name) => [name, cell(rows[index], searchHeader.headers, name)],
      )),
    };
    const candidates = hit1Candidates.get(spectrumNo) ?? [];
    candidates.push(candidate);
    hit1Candidates.set(spectrumNo, candidates);
    hit1EncounterOrder += 1;
  }

  const records = [];
  const lineage = [];
  const issues = [];
  const peaksByNumber = new Map();
  for (const peak of peaks) {
    const duplicates = peaksByNumber.get(peak.peakNo) ?? [];
    duplicates.push(peak);
    peaksByNumber.set(peak.peakNo, duplicates);
  }
  for (const [peakNo, duplicates] of peaksByNumber) {
    if (duplicates.length > 1) {
      issues.push({
        severity: "REVIEW",
        code: "REVIEW_Duplicate_Peak",
        message: `Peak# ${peakNo} occurs ${duplicates.length} times; every source row was retained`,
        peakNo,
        sourceRows: duplicates.map((peak) => peak.sourceRow),
      });
    }
  }
  for (const [spectrumNo, candidates] of hit1Candidates) {
    if (candidates.length > 1) {
      const chosen = [...candidates].sort(
        (left, right) => left.sourceRow - right.sourceRow || left.encounterOrder - right.encounterOrder,
      )[0];
      issues.push({
        severity: "REVIEW",
        code: "REVIEW_Duplicate_Hit1",
        message: `Spectrum# ${spectrumNo} has ${candidates.length} Hit #1 rows; the earliest source row was retained`,
        spectrumNo,
        sourceRows: candidates.map((candidate) => candidate.sourceRow),
        chosenSourceRow: chosen.sourceRow,
      });
    }
  }
  for (const peak of peaks) {
    const search = hit1Candidates.get(peak.peakNo)?.reduce((chosen, candidate) => {
      if (!chosen) return candidate;
      if (candidate.sourceRow < chosen.sourceRow) return candidate;
      if (candidate.sourceRow === chosen.sourceRow && candidate.encounterOrder < chosen.encounterOrder) return candidate;
      return chosen;
    }, null);
    if (!search) {
      issues.push({
        severity: "WARN",
        code: "HIT1_NOT_FOUND",
        message: `Hit #1 was not found for Peak# ${peak.peakNo}`,
        peakNo: peak.peakNo,
        sourceRow: peak.sourceRow,
      });
      continue;
    }
    const recordIndex = records.length;
    records.push(makeRecord(peak, search));
    lineage.push({
      recordIndex,
      sourceRow: search.sourceRow,
      peakSourceRow: peak.sourceRow,
      searchSourceRow: search.sourceRow,
      originalRowOrder: recordIndex + 1,
      peakNo: peak.peakNo,
      spectrumNo: search.spectrumNo,
      hitNo: search.hitNo,
    });
  }

  return frozenResult(records, lineage, issues);
}
