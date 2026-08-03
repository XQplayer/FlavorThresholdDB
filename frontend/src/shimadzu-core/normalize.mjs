const CAS_PATTERN = /^(\d{2,7})-(\d{2})-(\d)$/;

const UNIT_DEFINITIONS = new Map([
  ["ng/L", { dimension: "concentration", factor: 1e-9 }],
  ["ug/L", { dimension: "concentration", factor: 1e-6 }],
  ["mg/L", { dimension: "concentration", factor: 1e-3 }],
  ["ug/mL", { dimension: "concentration", factor: 1e-3 }],
  ["mg/mL", { dimension: "concentration", factor: 1 }],
  ["uL", { dimension: "volume", factor: 1e-6 }],
  ["mL", { dimension: "volume", factor: 1e-3 }],
]);

/**
 * Remove whitespace around CAS separators without correcting any digits.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCas(value) {
  return String(value ?? "").trim().replace(/\s*-\s*/g, "-");
}

/**
 * Check a syntactically standard CAS Registry Number check digit.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function casChecksumValid(value) {
  const normalized = normalizeCas(value);
  const match = CAS_PATTERN.exec(normalized);
  if (!match) return false;

  const body = `${match[1]}${match[2]}`;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[body.length - 1 - index]) * (index + 1);
  }
  return sum % 10 === Number(match[3]);
}

/**
 * Infer a technical replicate from a supported terminal suffix.
 *
 * @param {unknown} value
 * @returns {{group: string, replicate: 1|2|3}|null}
 */
export function inferReplicate(value) {
  if (typeof value !== "string") return null;
  const sampleName = value.trim();
  const match = /^(.*?)(?:[-_]?)([123])$/.exec(sampleName);
  if (!match || match[1] === "") return null;
  const group = match[1].replace(/[-_]$/, "");
  if (group === "") return null;
  return { group, replicate: Number(match[2]) };
}

/**
 * Produce an auditable original-to-match-name mapping.
 *
 * @param {unknown} value
 * @param {{separatorsEquivalent?: boolean}} [options]
 * @returns {{original: unknown, normalized: string}}
 */
export function normalizeNameForMatching(value, { separatorsEquivalent = true } = {}) {
  const original = value;
  let normalized = String(value ?? "").trim();
  if (separatorsEquivalent) normalized = normalized.replace(/_/g, "-");
  return { original, normalized };
}

function canonicalUnit(unit) {
  if (typeof unit !== "string") throw new TypeError("Unit must be text");
  const compact = unit.trim().replace(/[μµ]/g, "u").replace(/\s+/g, "").toLowerCase();
  const aliases = new Map([
    ["ng/l", "ng/L"],
    ["ug/l", "ug/L"],
    ["mg/l", "mg/L"],
    ["ug/ml", "ug/mL"],
    ["mg/ml", "mg/mL"],
    ["ul", "uL"],
    ["ml", "mL"],
  ]);
  const canonical = aliases.get(compact);
  if (!canonical) throw new Error(`Unsupported unit: ${unit}`);
  return canonical;
}

/**
 * Parse a finite numeric value followed by a supported concentration or volume unit.
 *
 * @param {unknown} input
 * @returns {{value: number, unit: string}}
 */
export function parseQuantity(input) {
  if (typeof input !== "string") throw new TypeError("Quantity must be text with a unit");
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(\S(?:.*\S)?)\s*$/i.exec(input);
  if (!match) throw new Error(`Invalid quantity: ${input}`);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`Invalid quantity: ${input}`);
  return { value, unit: canonicalUnit(match[2]) };
}

/**
 * Convert within concentration or volume dimensions only.
 *
 * @param {{value: number, unit: string}|string} quantity
 * @param {string} targetUnit
 * @returns {number}
 */
export function convertQuantity(quantity, targetUnit) {
  const parsed = typeof quantity === "string" ? parseQuantity(quantity) : quantity;
  if (!parsed || typeof parsed !== "object" || !Number.isFinite(parsed.value)) {
    throw new TypeError("Quantity must contain a finite numeric value and unit");
  }

  const sourceUnit = canonicalUnit(parsed.unit);
  const destinationUnit = canonicalUnit(targetUnit);
  const source = UNIT_DEFINITIONS.get(sourceUnit);
  const destination = UNIT_DEFINITIONS.get(destinationUnit);
  if (source.dimension !== destination.dimension) {
    throw new Error(`Incompatible unit conversion: ${sourceUnit} to ${destinationUnit}`);
  }
  return (parsed.value * source.factor) / destination.factor;
}
