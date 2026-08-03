import { HIT1_OUTPUT_COLUMNS } from "./parse-shimadzu.mjs";

export const APPROVED_OCTANOL_INTERNAL_STANDARDS = Object.freeze(["123-96-6", "589-62-8"]);
export const STAGE3_SAMPLE_COLUMNS = Object.freeze([...HIT1_OUTPUT_COLUMNS, "Area_Status", "Area_Source"]);

function fail(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

function normalizedCas(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function validArea(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function dValue(record) {
  const measured = Number(record?.["Ret. Index"]);
  const library = Number(record?.["Retention Index"]);
  return Number.isFinite(measured) && Number.isFinite(library) ? Math.abs(measured - library) : Number.POSITIVE_INFINITY;
}

function lowerDEntry(entries, sampleOrder) {
  return [...entries].sort((left, right) => dValue(left.record) - dValue(right.record)
    || sampleOrder.indexOf(left.sampleName) - sampleOrder.indexOf(right.sampleName))[0];
}

function sourceRecord(record, { area, status, source }) {
  return {
    ...Object.fromEntries(HIT1_OUTPUT_COLUMNS.map((column) => [column, record?.[column] ?? "NA"])),
    Area: area,
    Area_Status: status,
    Area_Source: source,
  };
}

function syntheticRecord(donor, cas, { area, status, source }) {
  const row = sourceRecord(donor, { area, status, source });
  row["Peak#"] = "NA";
  row["Spectrum#"] = "NA";
  row["Hit #"] = "NA";
  row["CAS #"] = cas;
  return row;
}

function groupColumns(sampleNames) {
  const columns = ["CAS #", "Name", "Mol.Form", "Mol.Weight", "Proc.To", "Ret. Index", "Retention Index"];
  for (const sampleName of sampleNames) columns.push(`${sampleName} Area`, `${sampleName} Area_Status`);
  return columns;
}

function groupTableRow(cas, metadataRecord, sampleNames, processedBySample) {
  const row = Object.fromEntries(["CAS #", "Name", "Mol.Form", "Mol.Weight", "Proc.To", "Ret. Index", "Retention Index"]
    .map((column) => [column, column === "CAS #" ? cas : metadataRecord?.[column] ?? "NA"]));
  for (const sampleName of sampleNames) {
    const record = processedBySample[sampleName];
    row[`${sampleName} Area`] = record?.Area ?? "NA";
    row[`${sampleName} Area_Status`] = record?.Area_Status ?? "Not_Detected";
  }
  return row;
}

function prepareSamples(group, sampleResults, sampleConfigs) {
  const prepared = {};
  for (const sampleName of group.sampleNames) {
    const result = sampleResults?.[sampleName];
    const config = sampleConfigs?.[sampleName];
    if (!result || !config) throw fail("STAGE3_SAMPLE_OR_CONFIG_MISSING", { sampleName });
    if (!Array.isArray(result.records) || !Array.isArray(result.lineage) || result.records.length !== result.lineage.length) throw fail("STAGE3_RECORD_LINEAGE_MISMATCH", { sampleName });
    const byCas = new Map();
    for (const [index, record] of result.records.entries()) {
      const cas = normalizedCas(record["CAS #"]);
      if (byCas.has(cas)) throw fail("STAGE3_DUPLICATE_CAS_IN_SAMPLE", { sampleName, cas });
      byCas.set(cas, { record: clone(record), lineage: clone(result.lineage[index]) });
    }
    prepared[sampleName] = { result, config: clone(config), byCas };
  }
  return prepared;
}

function configuredParameters(config) {
  return {
    stockUgMl: config.stockUgMl,
    spikeUl: config.spikeUl,
    systemMl: config.systemMl,
    volumeBasis: config.volumeBasis,
    includeSpikeVolume: config.includeSpikeVolume,
  };
}

function resolveStandards(group, prepared) {
  const internalStandards = {};
  const processed = {};
  const logs = [];
  for (const sampleName of group.sampleNames) {
    const config = prepared[sampleName].config;
    const configuredCas = normalizedCas(config.internalStandardCas);
    const configuredName = config.internalStandardName;
    const exact = prepared[sampleName].byCas.get(configuredCas);
    const alternativeCas = APPROVED_OCTANOL_INTERNAL_STANDARDS.includes(configuredCas)
      ? APPROVED_OCTANOL_INTERNAL_STANDARDS.find((cas) => cas !== configuredCas)
      : null;
    const alternative = alternativeCas ? prepared[sampleName].byCas.get(alternativeCas) : null;
    if (exact && alternative) {
      logs.push({
        sampleGroup: group.sampleGroup,
        sampleName,
        action: "Removed_NonConfigured_Octanol",
        configuredCas,
        detectedCas: alternativeCas,
        area: alternative.record.Area,
        record: clone(alternative.record),
        lineage: clone(alternative.lineage),
      });
    }
    if (exact && validArea(exact.record.Area)) {
      processed[sampleName] = sourceRecord(exact.record, { area: exact.record.Area, status: "Measured_Internal_Standard", source: sampleName });
      internalStandards[sampleName] = {
        sampleName,
        configuredCas,
        configuredName,
        detectedCas: configuredCas,
        area: exact.record.Area,
        status: "Measured_Internal_Standard",
        configuredParameters: configuredParameters(config),
        lineage: clone(exact.lineage),
      };
    } else if (alternative && validArea(alternative.record.Area)) {
      const substituted = sourceRecord(alternative.record, {
        area: alternative.record.Area,
        status: "Substituted_Internal_Standard_Area",
        source: `${sampleName}:${alternativeCas}`,
      });
      substituted["CAS #"] = configuredCas;
      substituted.Name = configuredName;
      processed[sampleName] = substituted;
      internalStandards[sampleName] = {
        sampleName,
        configuredCas,
        configuredName,
        detectedCas: alternativeCas,
        area: alternative.record.Area,
        status: "Substituted_Internal_Standard_Area",
        configuredParameters: configuredParameters(config),
        lineage: clone(alternative.lineage),
      };
      logs.push({
        sampleGroup: group.sampleGroup,
        sampleName,
        action: "Substituted_Internal_Standard_Area",
        configuredCas,
        configuredName,
        detectedCas: alternativeCas,
        area: alternative.record.Area,
        configuredParameters: configuredParameters(config),
        lineage: clone(alternative.lineage),
      });
    } else {
      internalStandards[sampleName] = {
        sampleName,
        configuredCas,
        configuredName,
        detectedCas: "NA",
        area: "NA",
        status: "Internal_Standard_Missing",
        configuredParameters: configuredParameters(config),
      };
    }
  }

  const validDonorStatuses = new Set(["Measured_Internal_Standard", "Substituted_Internal_Standard_Area"]);
  for (const sampleName of group.sampleNames) {
    if (internalStandards[sampleName].status !== "Internal_Standard_Missing") continue;
    const donors = group.sampleNames.filter((candidate) => candidate !== sampleName && validDonorStatuses.has(internalStandards[candidate].status));
    const configuredCas = internalStandards[sampleName].configuredCas;
    const configuredName = internalStandards[sampleName].configuredName;
    if (donors.length === 2) {
      const donorEntries = donors.map((donorSample) => ({ sampleName: donorSample, record: processed[donorSample] }));
      const metadataSource = lowerDEntry(donorEntries, group.sampleNames);
      const donorAreas = donors.map((donorSample) => internalStandards[donorSample].area);
      const area = (donorAreas[0] + donorAreas[1]) / 2;
      const imputed = syntheticRecord(metadataSource.record, configuredCas, {
        area,
        status: "Imputed_Internal_Standard_Area",
        source: `Mean(${donors.join(",")})`,
      });
      imputed.Name = configuredName;
      processed[sampleName] = imputed;
      internalStandards[sampleName] = {
        ...internalStandards[sampleName],
        area,
        status: "Imputed_Internal_Standard_Area",
        donorSamples: donors,
        donorAreas,
        donorDValues: donorEntries.map((entry) => dValue(entry.record)),
        metadataSourceSample: metadataSource.sampleName,
        sourceLineage: donors.map((donorSample) => clone(internalStandards[donorSample].lineage)),
      };
      logs.push({
        sampleGroup: group.sampleGroup,
        sampleName,
        action: "Imputed_Internal_Standard_Area",
        configuredCas,
        configuredName,
        donorSamples: donors,
        donorAreas,
        imputedArea: area,
        donorDValues: donorEntries.map((entry) => dValue(entry.record)),
        metadataSourceSample: metadataSource.sampleName,
        sourceLineage: donors.map((donorSample) => clone(internalStandards[donorSample].lineage)),
      });
    } else {
      const metadataSource = donors.length ? processed[donors[0]] : null;
      const missing = syntheticRecord(metadataSource, configuredCas, {
        area: "NA",
        status: "Internal_Standard_Missing_Insufficient_Donors",
        source: donors.length ? donors[0] : "NA",
      });
      missing.Name = configuredName;
      processed[sampleName] = missing;
      internalStandards[sampleName] = {
        ...internalStandards[sampleName],
        status: "Internal_Standard_Missing_Insufficient_Donors",
        donorSamples: donors,
        donorAreas: donors.map((donorSample) => internalStandards[donorSample].area),
      };
      logs.push({
        sampleGroup: group.sampleGroup,
        sampleName,
        action: "Internal_Standard_Missing_Insufficient_Donors",
        configuredCas,
        configuredName,
        donorSamples: donors,
        donorAreas: donors.map((donorSample) => internalStandards[donorSample].area),
      });
    }
  }
  return { internalStandards, processed, logs };
}

/** Process one configured three-replicate group at the peak-area layer. */
export function processV2ReplicateGroup({ group, sampleResults, sampleConfigs }) {
  if (!group || !Array.isArray(group.sampleNames) || group.sampleNames.length !== 3) throw fail("STAGE3_REQUIRES_THREE_REPLICATES");
  const inputSnapshot = { group: clone(group), sampleResults: clone(sampleResults), sampleConfigs: clone(sampleConfigs) };
  const prepared = prepareSamples(group, sampleResults, sampleConfigs);
  const standardResolution = resolveStandards(group, prepared);
  const configuredStandardSet = new Set(group.sampleNames.map((sampleName) => normalizedCas(prepared[sampleName].config.internalStandardCas)));
  const excludedStandardSet = new Set([...APPROVED_OCTANOL_INTERNAL_STANDARDS, ...configuredStandardSet]);
  const casOrder = [];
  for (const sampleName of group.sampleNames) {
    for (const cas of prepared[sampleName].byCas.keys()) {
      if (!excludedStandardSet.has(cas) && !casOrder.includes(cas)) casOrder.push(cas);
    }
  }

  const processedRowsBySample = Object.fromEntries(group.sampleNames.map((sampleName) => [sampleName, []]));
  const groupRows = [];
  const logs = { internalStandard: standardResolution.logs, imputedTwoOfThree: [], removedOneOfThree: [], metadataSources: [] };

  const standardCasOrder = [...configuredStandardSet];
  for (const configuredCas of standardCasOrder) {
    const entries = group.sampleNames
      .map((sampleName) => standardResolution.internalStandards[sampleName].configuredCas === configuredCas && standardResolution.processed[sampleName]
        ? ({ sampleName, record: standardResolution.processed[sampleName] }) : null)
      .filter(Boolean);
    const metadata = entries.length ? lowerDEntry(entries, group.sampleNames).record : null;
    const perSample = {};
    for (const sampleName of group.sampleNames) {
      const record = standardResolution.internalStandards[sampleName].configuredCas === configuredCas
        ? standardResolution.processed[sampleName] : undefined;
      if (record) processedRowsBySample[sampleName].push(record);
      perSample[sampleName] = record;
    }
    groupRows.push(groupTableRow(configuredCas, metadata, group.sampleNames, perSample));
  }

  for (const cas of casOrder) {
    const entries = group.sampleNames.map((sampleName) => {
      const source = prepared[sampleName].byCas.get(cas);
      return source && validArea(source.record.Area) ? { sampleName, ...source } : null;
    }).filter(Boolean);
    if (!entries.length) continue;
    const metadataSource = lowerDEntry(entries, group.sampleNames);
    const processed = {};
    if (entries.length === 3) {
      for (const entry of entries) processed[entry.sampleName] = sourceRecord(entry.record, { area: entry.record.Area, status: "Measured", source: entry.sampleName });
    } else if (entries.length === 2) {
      const imputedArea = (entries[0].record.Area + entries[1].record.Area) / 2;
      const missingSample = group.sampleNames.find((sampleName) => !entries.some((entry) => entry.sampleName === sampleName));
      for (const entry of entries) processed[entry.sampleName] = sourceRecord(entry.record, { area: entry.record.Area, status: "Measured", source: entry.sampleName });
      processed[missingSample] = syntheticRecord(metadataSource.record, cas, {
        area: imputedArea,
        status: "Imputed_Two_of_Three_Area",
        source: `Mean(${entries.map((entry) => entry.sampleName).join(",")})`,
      });
      logs.imputedTwoOfThree.push({
        sampleGroup: group.sampleGroup,
        cas,
        targetSample: missingSample,
        donorSamples: entries.map((entry) => entry.sampleName),
        donorAreas: entries.map((entry) => entry.record.Area),
        donorDValues: entries.map((entry) => dValue(entry.record)),
        imputedArea,
        metadataSourceSample: metadataSource.sampleName,
        sourceLineage: entries.map((entry) => clone(entry.lineage)),
      });
    } else {
      const only = entries[0];
      for (const sampleName of group.sampleNames) {
        const source = prepared[sampleName].byCas.get(cas);
        const base = source?.record ?? only.record;
        processed[sampleName] = sourceRecord(base, { area: "NA", status: "Removed_One_of_Three", source: only.sampleName });
        if (!source) {
          processed[sampleName]["Peak#"] = "NA";
          processed[sampleName]["Spectrum#"] = "NA";
          processed[sampleName]["Hit #"] = "NA";
        }
      }
      logs.removedOneOfThree.push({
        sampleGroup: group.sampleGroup,
        cas,
        detectedSample: only.sampleName,
        rawArea: only.record.Area,
        rawRecord: clone(only.record),
        sourceLineage: clone(only.lineage),
      });
    }
    for (const sampleName of group.sampleNames) processedRowsBySample[sampleName].push(processed[sampleName]);
    groupRows.push(groupTableRow(cas, metadataSource.record, group.sampleNames, processed));
    logs.metadataSources.push({ sampleGroup: group.sampleGroup, cas, sourceSample: metadataSource.sampleName, d: dValue(metadataSource.record) });
  }

  const samples = Object.fromEntries(group.sampleNames.map((sampleName) => [sampleName, {
    sampleName,
    sampleGroup: group.sampleGroup,
    columns: [...STAGE3_SAMPLE_COLUMNS],
    rawRecords: clone(prepared[sampleName].result.records),
    rawLineage: clone(prepared[sampleName].result.lineage),
    records: processedRowsBySample[sampleName],
  }]));
  const summary = {
    sampleGroup: group.sampleGroup,
    inputRows: group.sampleNames.reduce((sum, sampleName) => sum + prepared[sampleName].result.records.length, 0),
    casRows: groupRows.length,
    imputedTwoOfThree: logs.imputedTwoOfThree.length,
    removedOneOfThree: logs.removedOneOfThree.length,
    internalStandardActions: logs.internalStandard.length,
  };
  return clone({
    sampleGroup: group.sampleGroup,
    sampleNames: [...group.sampleNames],
    samples,
    groupTable: { columns: groupColumns(group.sampleNames), rows: groupRows },
    internalStandards: standardResolution.internalStandards,
    logs,
    summary,
    inputEvidence: inputSnapshot,
  });
}
