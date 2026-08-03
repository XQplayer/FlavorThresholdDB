function clone(value) {
  return structuredClone(value);
}

function normalizedCas(row) {
  return String(row?.cas ?? row?.["CAS #"] ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function strictNonnegativeNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function originalOrder(row, inputIndex) {
  return strictNonnegativeNumber(row?.originalRowOrder ?? row?.Original_Row_Order) ?? inputIndex + 1;
}

function byEarliest(left, right) {
  return left.order - right.order || left.inputIndex - right.inputIndex;
}

function chooseMinD(items) {
  return [...items].sort((left, right) => left.d - right.d || byEarliest(left, right))[0];
}

function chooseLargestArea(items) {
  return [...items].sort((left, right) => right.areaNumber - left.areaNumber || byEarliest(left, right))[0];
}

function rowWithArea(entry, area) {
  const output = clone(entry.row);
  if (Object.hasOwn(output, "area") || !Object.hasOwn(output, "Area")) output.area = area;
  else output.Area = area;
  return output;
}

function representative(chosen, contributors, discarded, action) {
  const areaNumber = contributors.reduce((sum, entry) => sum + entry.areaNumber, 0);
  return {
    ...chosen,
    row: contributors.length > 1 ? rowWithArea(chosen, areaNumber) : clone(chosen.row),
    areaNumber,
    contributors: [...contributors],
    discarded: [...discarded],
    runAction: action,
  };
}

function resolveAdjacentRun(run) {
  if (run.length === 1) return representative(run[0], run, [], null);
  const minimum = chooseMinD(run);
  if (run.length === 2) {
    const deltaD = Math.abs(run[0].d - run[1].d);
    if (deltaD <= 20) return representative(minimum, run, [], "MERGE_ADJACENT_WITHIN_20");
    return representative(minimum, [minimum], run.filter((entry) => entry !== minimum), "KEEP_LOWER_D_ADJACENT_ABOVE_20");
  }
  const contributors = run.filter((entry) => entry.d - minimum.d <= 20);
  return representative(
    minimum,
    contributors,
    run.filter((entry) => !contributors.includes(entry)),
    "MERGE_ADJACENT_RUN_FROM_MIN_D",
  );
}

function splitRuns(group) {
  const runs = [];
  for (const entry of group) {
    const current = runs.at(-1);
    if (!current || entry.position !== current.at(-1).position + 1) runs.push([entry]);
    else current.push(entry);
  }
  return runs;
}

function chooseAcrossRuns(representatives) {
  if (representatives.length === 1) {
    return { chosen: representatives[0], action: representatives[0].runAction };
  }
  const minimum = chooseMinD(representatives);
  if (representatives.length === 2) {
    const deltaD = Math.abs(representatives[0].d - representatives[1].d);
    if (deltaD > 20) {
      return { chosen: minimum, action: "RESOLVE_RUNS_THEN_KEEP_LOWER_D_NONADJACENT_ABOVE_20" };
    }
    return {
      chosen: chooseLargestArea(representatives),
      action: "RESOLVE_RUNS_THEN_KEEP_LARGER_AREA_NONADJACENT_WITHIN_20",
    };
  }
  const candidates = representatives.filter((entry) => entry.d - minimum.d <= 20);
  return {
    chosen: chooseLargestArea(candidates),
    action: "RESOLVE_RUNS_THEN_KEEP_LARGEST_AREA_NONADJACENT_FROM_MIN_D",
  };
}

function resolveGroup(group) {
  const runs = splitRuns(group);
  const representatives = runs.map(resolveAdjacentRun);
  const selection = chooseAcrossRuns(representatives);
  const chosen = selection.chosen;
  const contributingIndexes = new Set(chosen.contributors.map((entry) => entry.inputIndex));
  const mergedSourceRows = chosen.contributors.map((entry) => entry.order);
  const discardedSourceRows = group.filter((entry) => !contributingIndexes.has(entry.inputIndex)).map((entry) => entry.order);
  const minimum = chooseMinD(group);

  return {
    output: clone(chosen.row),
    outputOrder: chosen.order,
    log: {
      cas: group[0].cas,
      sourceRows: group.map((entry) => entry.order),
      dValues: group.map((entry) => entry.d),
      deltaDFromMinimum: group.map((entry) => entry.d - minimum.d),
      deltaD: group.length === 2 ? Math.abs(group[0].d - group[1].d) : null,
      action: runs.some((run) => run.length > 1)
        ? selection.action
        : selection.action.replace("RESOLVE_RUNS_THEN_", ""),
      chosenMetadataRow: chosen.order,
      mergedSourceRows,
      absorbedSourceRows: mergedSourceRows.filter((sourceRow) => sourceRow !== chosen.order),
      discardedSourceRows,
      runActions: representatives.map((entry) => entry.runAction).filter(Boolean),
    },
  };
}

function invalidIssue(code, entry, fields) {
  return {
    severity: "WARN",
    code,
    sourceRow: entry.order,
    fields,
    message: code === "INVALID_RI"
      ? "Ret. Index and Retention Index must be finite nonnegative numbers"
      : "Area must be a finite nonnegative number",
  };
}

/** Resolve duplicate CAS records while retaining complete audit lineage. */
export function resolveDuplicateCas(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");

  const ordered = rows.map((row, inputIndex) => ({ row, inputIndex, order: originalOrder(row, inputIndex) }))
    .sort(byEarliest)
    .map((entry, position) => ({ ...entry, position }));
  const ineligible = [];
  const issues = [];
  const eligible = [];

  for (const entry of ordered) {
    const retIndex = strictNonnegativeNumber(entry.row?.retIndex ?? entry.row?.["Ret. Index"]);
    const libraryIndex = strictNonnegativeNumber(entry.row?.libraryIndex ?? entry.row?.["Retention Index"]);
    if (retIndex === null || libraryIndex === null) {
      ineligible.push(clone(entry.row));
      issues.push(invalidIssue("INVALID_RI", entry, ["retIndex", "libraryIndex"]));
      continue;
    }
    const areaNumber = strictNonnegativeNumber(entry.row?.area ?? entry.row?.Area);
    if (areaNumber === null) {
      ineligible.push(clone(entry.row));
      issues.push(invalidIssue("INVALID_AREA", entry, ["area"]));
      continue;
    }
    eligible.push({ ...entry, cas: normalizedCas(entry.row), d: Math.abs(retIndex - libraryIndex), areaNumber });
  }

  const groups = new Map();
  for (const entry of eligible) {
    const group = groups.get(entry.cas) ?? [];
    group.push(entry);
    groups.set(entry.cas, group);
  }

  const outputs = [];
  const decisionLog = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      outputs.push({ row: clone(group[0].row), order: group[0].order, inputIndex: group[0].inputIndex });
      continue;
    }
    const resolved = resolveGroup(group);
    outputs.push({ row: resolved.output, order: resolved.outputOrder, inputIndex: group[0].inputIndex });
    decisionLog.push(resolved.log);
  }

  outputs.sort((left, right) => left.order - right.order || left.inputIndex - right.inputIndex);
  decisionLog.sort((left, right) => Math.min(...left.sourceRows) - Math.min(...right.sourceRows));
  return clone({ kept: outputs.map((entry) => entry.row), ineligible, issues, decisionLog });
}
