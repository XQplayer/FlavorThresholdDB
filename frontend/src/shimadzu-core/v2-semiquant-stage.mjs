import {
  finalIsConcentration,
  semiquantify,
  validateIsBackcalculation,
} from "./semiquant.mjs";

export const STAGE4_BASE_COLUMNS = Object.freeze([
  "CAS #", "Name", "Mol.Form", "Mol.Weight", "Proc.To", "Ret. Index", "Retention Index",
]);

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isFinitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function expectedGroupColumns(sampleNames) {
  const columns = [...STAGE4_BASE_COLUMNS];
  for (const sampleName of sampleNames) columns.push(`${sampleName} Area`, `${sampleName} Area_Status`);
  return columns;
}

function normalizeUserFinal(value) {
  return value === "NA" || value === null || value === undefined || value === "" ? undefined : value;
}

function buildSampleCalculations(stage3Data, configsByName) {
  const output = {};
  for (const sampleName of stage3Data.sampleOrder) {
    const config = configsByName.get(sampleName);
    if (!config) throw fail("MISSING_SAMPLE_CONFIGURATION", { sampleName });
    const group = stage3Data.groups[config.sampleGroup];
    if (!group?.sampleNames.includes(sampleName)) throw fail("SAMPLE_GROUP_CONFIGURATION_MISMATCH", { sampleName });
    const standard = group.internalStandards?.[sampleName];
    if (!standard) throw fail("MISSING_INTERNAL_STANDARD_AUDIT", { sampleName });
    const method = config.includeSpikeVolume ? "include" : "ignore";
    const baseParameters = {
      stockUgMl: config.stockUgMl,
      spikeUl: config.spikeUl,
      systemMl: config.systemMl,
      basis: config.volumeBasis,
      method,
    };
    const calculatedIsUgMl = finalIsConcentration(baseParameters);
    const normalizedUserFinal = normalizeUserFinal(config.userFinalUgMl);
    const finalIsUgMl = finalIsConcentration({ ...baseParameters, userFinalUgMl: normalizedUserFinal });
    const userFinalRelativeError = normalizedUserFinal === undefined
      ? "NA"
      : calculatedIsUgMl === 0
        ? (normalizedUserFinal === 0 ? 0 : "NA")
        : Math.abs(normalizedUserFinal - calculatedIsUgMl) / Math.abs(calculatedIsUgMl);
    const backcalculation = isFinitePositive(standard.area)
      ? validateIsBackcalculation({ expectedUgMl: finalIsUgMl, backcalculatedUgMl: finalIsUgMl })
      : { status: "FAIL", relativeError: "NA", issues: [{ severity: "FAIL", code: "INVALID_INTERNAL_STANDARD_AREA", message: "Internal-standard area is unavailable" }] };
    output[sampleName] = {
      sampleName,
      sampleGroup: config.sampleGroup,
      configuredCas: config.internalStandardCas,
      configuredName: config.internalStandardName,
      detectedCas: standard.detectedCas ?? "NA",
      internalStandardArea: standard.area,
      internalStandardAreaStatus: standard.status,
      stockUgMl: config.stockUgMl,
      spikeUl: config.spikeUl,
      systemMl: config.systemMl,
      volumeBasis: config.volumeBasis,
      includeSpikeVolume: config.includeSpikeVolume,
      method,
      userFinalUgMl: config.userFinalUgMl,
      calculatedIsUgMl,
      userFinalRelativeError,
      finalIsUgMl,
      backcalculation,
    };
  }
  return output;
}

function metadataD(row) {
  const measured = row["Ret. Index"];
  const library = row["Retention Index"];
  return typeof measured === "number" && Number.isFinite(measured)
    && typeof library === "number" && Number.isFinite(library)
    ? Math.abs(measured - library)
    : Number.POSITIVE_INFINITY;
}

function metadataSource(group, row, groupIndex, stage3Data) {
  const cas = row["CAS #"];
  const logged = group.logs?.metadataSources?.find((entry) => entry.cas === cas);
  const sourceSample = logged?.sourceSample
    ?? group.sampleNames.find((sampleName) => row[`${sampleName} Area`] !== "NA")
    ?? group.sampleNames[0];
  const sampleIndex = stage3Data.sampleOrder.indexOf(sourceSample);
  const sample = group.samples?.[sourceSample];
  const recordIndex = sample?.records?.findIndex((record) => record["CAS #"] === cas) ?? -1;
  const lineage = recordIndex >= 0 ? sample.rawLineage?.[recordIndex] : undefined;
  const sourceRow = lineage?.searchSourceRow ?? lineage?.sourceRow ?? Number.POSITIVE_INFINITY;
  return { sourceSample, sampleIndex: sampleIndex < 0 ? groupIndex * 3 : sampleIndex, sourceRow };
}

function collectMetadataAuthorities(stage3Data) {
  const casOrder = [];
  const candidatesByCas = new Map();
  for (const [groupIndex, groupName] of stage3Data.groupOrder.entries()) {
    const group = stage3Data.groups[groupName];
    if (!group || group.sampleGroup !== groupName || !same(group.groupTable.columns, expectedGroupColumns(group.sampleNames))) {
      throw fail("STAGE3_GROUP_TABLE_CONTRACT_MISMATCH", { groupName });
    }
    const local = new Set();
    for (const row of group.groupTable.rows) {
      const cas = row["CAS #"];
      if (local.has(cas)) throw fail("DUPLICATE_CAS_IN_STAGE3_GROUP", { groupName, cas });
      local.add(cas);
      if (!candidatesByCas.has(cas)) {
        candidatesByCas.set(cas, []);
        casOrder.push(cas);
      }
      candidatesByCas.get(cas).push({
        groupName,
        groupIndex,
        row,
        d: metadataD(row),
        ...metadataSource(group, row, groupIndex, stage3Data),
      });
    }
  }
  const authorities = [];
  const conflicts = [];
  for (const cas of casOrder) {
    const candidates = candidatesByCas.get(cas);
    const ranked = [...candidates].sort((left, right) => (
      left.d - right.d
      || left.sampleIndex - right.sampleIndex
      || left.sourceRow - right.sourceRow
      || left.groupIndex - right.groupIndex
    ));
    const chosen = ranked[0];
    authorities.push(Object.fromEntries(STAGE4_BASE_COLUMNS.map((column) => [column, chosen.row[column]])));
    const conflictingFields = STAGE4_BASE_COLUMNS.slice(1).filter((column) => (
      candidates.some((candidate) => !same(candidate.row[column], candidates[0].row[column]))
    ));
    if (conflictingFields.length) {
      conflicts.push({
        cas,
        conflictingFields,
        chosenGroup: chosen.groupName,
        chosenSample: chosen.sourceSample,
        chosenD: Number.isFinite(chosen.d) ? chosen.d : "NA",
        chosenSourceRow: Number.isFinite(chosen.sourceRow) ? chosen.sourceRow : "NA",
        candidates: candidates.map((candidate) => ({
          groupName: candidate.groupName,
          sourceSample: candidate.sourceSample,
          d: Number.isFinite(candidate.d) ? candidate.d : "NA",
          sourceRow: Number.isFinite(candidate.sourceRow) ? candidate.sourceRow : "NA",
          metadata: Object.fromEntries(STAGE4_BASE_COLUMNS.map((column) => [column, candidate.row[column]])),
        })),
      });
    }
  }
  return { authorities, conflicts };
}

function groupRowsByCas(stage3Data) {
  const output = new Map();
  for (const groupName of stage3Data.groupOrder) {
    const group = stage3Data.groups[groupName];
    for (const row of group.groupTable.rows) {
      if (!output.has(row["CAS #"])) output.set(row["CAS #"], new Map());
      output.get(row["CAS #"]).set(groupName, row);
    }
  }
  return output;
}

export function processV2SemiquantBatch({ stage3Data, sampleConfigs }) {
  const stage3 = structuredClone(stage3Data);
  const configs = structuredClone(sampleConfigs);
  if (stage3.stage !== "03_平行峰面积处理") throw fail("WRONG_STAGE3_INPUT");
  if (!Array.isArray(configs) || configs.length !== stage3.sampleOrder.length) throw fail("SAMPLE_CONFIGURATION_COUNT_MISMATCH");
  const configsByName = new Map(configs.map((config) => [config.sampleName, config]));
  if (configsByName.size !== configs.length || !same(stage3.sampleOrder, configs.map((config) => config.sampleName))) {
    throw fail("SAMPLE_CONFIGURATION_ORDER_MISMATCH");
  }

  const sampleCalculations = buildSampleCalculations(stage3, configsByName);
  const { authorities: authorityRows, conflicts: metadataConflicts } = collectMetadataAuthorities(stage3);
  const rowsByCas = groupRowsByCas(stage3);
  const columns = [...STAGE4_BASE_COLUMNS];
  for (const sampleName of stage3.sampleOrder) columns.push(`${sampleName} Area`, `${sampleName}（μg/mL）`);
  const concentrationStatus = [];
  const rows = authorityRows.map((metadata) => {
    const cas = metadata["CAS #"];
    const row = { ...metadata };
    for (const sampleName of stage3.sampleOrder) {
      const config = configsByName.get(sampleName);
      const source = rowsByCas.get(cas)?.get(config.sampleGroup);
      const area = source?.[`${sampleName} Area`] ?? "NA";
      const areaStatus = source?.[`${sampleName} Area_Status`] ?? "Not_Detected";
      let concentration = "NA";
      let status = areaStatus === "Removed_One_of_Three" ? areaStatus : "Not_Detected";
      let issues = [];
      if (typeof area === "number" && Number.isFinite(area) && area >= 0) {
        const quantified = semiquantify({
          analyteArea: area,
          isArea: sampleCalculations[sampleName].internalStandardArea,
          isConcentration: sampleCalculations[sampleName].finalIsUgMl,
        });
        concentration = quantified.value;
        status = quantified.status;
        issues = quantified.issues ?? [];
      }
      row[`${sampleName} Area`] = area;
      row[`${sampleName}（μg/mL）`] = concentration;
      concentrationStatus.push({
        cas,
        sampleName,
        sampleGroup: config.sampleGroup,
        area,
        areaStatus,
        internalStandardArea: sampleCalculations[sampleName].internalStandardArea,
        finalIsUgMl: sampleCalculations[sampleName].finalIsUgMl,
        concentration,
        status,
        issues,
      });
    }
    return row;
  });

  return {
    sampleOrder: [...stage3.sampleOrder],
    groupOrder: [...stage3.groupOrder],
    sampleCalculations,
    table: { columns, rows },
    concentrationStatus,
    metadataConflicts,
    semiquantExceptions: concentrationStatus.filter((entry) => entry.issues.length > 0),
  };
}
