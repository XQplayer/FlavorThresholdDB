# PubChem Volatile Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a traceable PubChem PUG View module for boiling point, vapor pressure, Henry's law constant, solubility, experimental LogP/LogKow, density, melting point, and physical state.

**Architecture:** The Python proxy requests the complete `Experimental Properties` PUG View heading once per CID, parses selected sections into a stable normalized contract, and caches that contract separately from PUG REST properties. A focused React component renders the normalized contract; `App.jsx` only passes data and positions the module in the compound dossier.

**Tech Stack:** Python standard library, `unittest`, PubChem PUG View JSON, React 19, Node test runner, Vite, ESLint, Playwright.

---

## File map

- Create `scripts/tests/test_pubchem_volatile.py`: parser, normalization, reference mapping, query error and cache-contract tests.
- Modify `fema_proxy_server.py`: PUG View parser, query function, endpoint and `/compound` aggregation.
- Create `frontend/src/pubchemVolatile.js`: property order, bilingual labels and display helpers.
- Create `frontend/src/pubchemVolatile.test.mjs`: frontend helper tests.
- Create `frontend/src/components/PubChemVolatileProperties.jsx`: isolated presentation and disclosure behavior.
- Modify `frontend/src/App.jsx`: mount the component after chemical identity and pass `profile.pubchem_volatile`.
- Modify `frontend/src/App.css`: responsive module styling.
- Modify `docs/DATA_DICTIONARY.md`: document the new contract and evidence boundary.
- Modify `docs/DATA_SOURCES.md`: document PUG View annotations and attribution.
- Modify `CHANGELOG.md`: record the feature under Unreleased.
- Create `.playwright-cli/verify-pubchem-volatile.mjs`: local end-to-end verification only; do not stage this local test artifact.

### Task 1: Parse selected Experimental Properties sections

**Files:**
- Create: `scripts/tests/test_pubchem_volatile.py`
- Modify: `fema_proxy_server.py`

- [ ] **Step 1: Write failing parser tests**

Add a compact fixture containing `Record.Section`, nested target headings, `Information` entries, duplicate raw values and `Record.Reference`. Assert exact stable keys and source mapping:

```python
from fema_proxy_server import parse_pubchem_volatile_properties


def test_parses_selected_sections_and_maps_references():
    payload = {
        "Record": {
            "Section": [{
                "TOCHeading": "Chemical and Physical Properties",
                "Section": [{
                    "TOCHeading": "Experimental Properties",
                    "Section": [
                        {
                            "TOCHeading": "Boiling Point",
                            "Information": [{
                                "ReferenceNumber": 42,
                                "Description": "PEER REVIEWED",
                                "Value": {"StringWithMarkup": [{"String": "77.1 °C"}]},
                            }],
                        },
                        {
                            "TOCHeading": "Vapor Pressure",
                            "Information": [{
                                "ReferenceNumber": 42,
                                "Value": {"StringWithMarkup": [{"String": "93.2 mm Hg at 25 °C"}]},
                            }],
                        },
                    ],
                }],
            }],
            "Reference": [{
                "ReferenceNumber": 42,
                "SourceName": "HSDB",
                "SourceID": "8857",
                "URL": "https://example.test/hsdb/8857",
            }],
        }
    }

    result = parse_pubchem_volatile_properties(payload, "8857")

    assert result["found"] is True
    assert result["properties"]["boiling_point"][0]["raw_value"] == "77.1 °C"
    assert result["properties"]["boiling_point"][0]["source"] == "HSDB"
    assert result["properties"]["vapor_pressure"][0]["temperature"] == "25 °C"
```

Add one test that verifies all eight keys exist even when most sections are absent, and one test that identical `raw_value + reference_number` records are deduplicated while records with different references are retained.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest scripts.tests.test_pubchem_volatile -v
```

Expected: import failure because `parse_pubchem_volatile_properties` does not exist.

- [ ] **Step 3: Implement the minimal recursive parser**

In `fema_proxy_server.py`, define the stable property map and recursively traverse sections:

```python
PUBCHEM_VOLATILE_HEADINGS = {
    "Boiling Point": "boiling_point",
    "Vapor Pressure": "vapor_pressure",
    "Henry's Law Constant": "henrys_law_constant",
    "Solubility": "water_solubility",
    "LogP": "experimental_logp",
    "Density": "density",
    "Melting Point": "melting_point",
    "Physical Description": "physical_state",
}


def parse_pubchem_volatile_properties(payload: dict, cid: int | str) -> dict:
    properties = {key: [] for key in PUBCHEM_VOLATILE_HEADINGS.values()}
    references = {
        item.get("ReferenceNumber"): item
        for item in payload.get("Record", {}).get("Reference", [])
    }

    def visit(sections):
        for section in sections or []:
            property_key = PUBCHEM_VOLATILE_HEADINGS.get(section.get("TOCHeading"))
            if property_key:
                for info in section.get("Information", []):
                    for raw_value in _pubchem_information_strings(info):
                        record = _parse_pubchem_volatile_record(raw_value, info, references)
                        if record:
                            properties[property_key].append(record)
            visit(section.get("Section", []))

    visit(payload.get("Record", {}).get("Section", []))
    for key, records in properties.items():
        properties[key] = _deduplicate_pubchem_records(records)
    return {
        "found": any(properties.values()),
        "cid": str(cid),
        "properties": properties,
        "source": "PubChem PUG View",
        "url": f"{PUBCHEM_BASE_URL}/compound/{cid}#section=Experimental-Properties",
    }
```

Implement `_pubchem_information_strings`, `_parse_pubchem_volatile_record`, and `_deduplicate_pubchem_records` next to the parser. Do not add network logic in this task.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run the command from Step 2. Expected: all parser tests pass.

- [ ] **Step 5: Commit the parser slice**

```powershell
git add -- fema_proxy_server.py scripts/tests/test_pubchem_volatile.py
git commit -m "feat: parse PubChem volatile property annotations"
```

### Task 2: Conservatively extract values and conditions

**Files:**
- Modify: `scripts/tests/test_pubchem_volatile.py`
- Modify: `fema_proxy_server.py`

- [ ] **Step 1: Add failing normalization tests**

Add table-driven tests for the exact supported patterns:

```python
def test_extracts_only_reliable_numeric_conditions():
    cases = [
        ("93.2 mm Hg at 25 °C", 93.2, "mmHg", "25 °C", ""),
        ("Henry's Law constant = 1.34X10-4 atm-cu m/mole at 25 °C", 1.34e-4, "atm·m³/mol", "25 °C", ""),
        ("In water, 8.0X10+4 mg/L at 25 °C", 8.0e4, "mg/L", "25 °C", "water"),
        ("Miscible with ethanol and ether", None, "", "", ""),
    ]
    for raw, value, unit, temperature, medium in cases:
        result = parse_pubchem_property_text(raw)
        assert result["normalized_value"] == value
        assert result["unit"] == unit
        assert result["temperature"] == temperature
        assert result["medium"] == medium
```

Add a physical-state test that recognizes an explicit liquid/solid/gas statement but keeps the full original description.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest scripts.tests.test_pubchem_volatile.PubChemVolatileParsingTests.test_extracts_only_reliable_numeric_conditions -v
```

Expected: import or assertion failure because `parse_pubchem_property_text` is absent.

- [ ] **Step 3: Implement minimal conservative normalization**

Implement only explicit numeric, unit, temperature and medium patterns. Normalize Unicode multiplication signs and scientific notation, but retain `raw_value` unchanged:

```python
def parse_pubchem_property_text(raw_value: str) -> dict:
    parsed = {
        "normalized_value": None,
        "unit": "",
        "temperature": "",
        "pressure": "",
        "medium": "",
    }
    # Recognize supported units and explicit conditions only.
    # If a value or unit is ambiguous, leave normalized fields empty.
    return parsed
```

Keep unit aliases in one module-level mapping. Do not convert between units in this phase.

- [ ] **Step 4: Run all volatile parser tests**

Expected: pass, including ambiguous-text cases with `normalized_value is None`.

- [ ] **Step 5: Commit normalization**

```powershell
git add -- fema_proxy_server.py scripts/tests/test_pubchem_volatile.py
git commit -m "feat: normalize traceable PubChem property conditions"
```

### Task 3: Query PUG View and expose proxy endpoints

**Files:**
- Modify: `scripts/tests/test_pubchem_volatile.py`
- Modify: `fema_proxy_server.py`

- [ ] **Step 1: Add failing query and error-classification tests**

Use dependency injection for the fetcher. Test the exact URL and response classification:

```python
def test_queries_experimental_properties_once():
    requested = []
    payload = {"Record": {"Section": [], "Reference": []}}

    def fetcher(url):
        requested.append(url)
        return json.dumps(payload)

    result = query_pubchem_volatile_properties("8857", fetcher=fetcher)

    assert requested == [
        "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/8857/JSON?heading=Experimental%20Properties"
    ]
    assert result["status"] == "no_data"
```

Add tests for invalid CID, HTTP 404 as `no_data`, HTTP 429/503 as `upstream_unavailable`, invalid JSON as `invalid_response`, and an HTML body as `invalid_response`.

- [ ] **Step 2: Run tests and verify RED**

Expected: `query_pubchem_volatile_properties` is missing.

- [ ] **Step 3: Implement the query function**

```python
def query_pubchem_volatile_properties(cid: int | str, fetcher=fetch_text) -> dict:
    cid_text = str(cid).strip()
    if not cid_text.isdigit():
        return _empty_pubchem_volatile(cid_text, "invalid_cid")
    url = (
        f"{PUBCHEM_BASE_URL}/rest/pug_view/data/compound/{cid_text}/JSON"
        "?heading=Experimental%20Properties"
    )
    try:
        body = fetcher(url)
        if body.lstrip().startswith("<"):
            return _empty_pubchem_volatile(cid_text, "invalid_response")
        result = parse_pubchem_volatile_properties(json.loads(body), cid_text)
        result["status"] = "ok" if result["found"] else "no_data"
        result["retrieved_at"] = datetime.now(timezone.utc).isoformat()
        return result
    except HTTPError as exc:
        status = "no_data" if exc.code == 404 else "upstream_unavailable"
        return _empty_pubchem_volatile(cid_text, status)
    except (JSONDecodeError, KeyError, TypeError):
        return _empty_pubchem_volatile(cid_text, "invalid_response")
```

Import `datetime`, `timezone`, and `JSONDecodeError`. Do not catch programming errors with a blanket exception inside the parser.

- [ ] **Step 4: Add `/pubchem-volatile` and `/compound` integration**

In `Handler.do_GET`:

```python
if parsed.path == "/pubchem-volatile":
    # Validate cid, use cache key pubchem-volatile:{cid}, return normalized contract.
```

Add `/pubchem-volatile` to the route allowlist. In `/compound`, after a PubChem CID is available, query or load `pubchem-volatile:{cid}` and include it as `pubchem_volatile`. Cache only `status in {"ok", "no_data"}`; do not cache transient or invalid responses.

- [ ] **Step 5: Run proxy tests and live endpoint smoke checks**

Run the unit tests, restart the local proxy, then run:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/pubchem-volatile?cid=8857'
Invoke-RestMethod 'http://127.0.0.1:8787/compound?cas=141-78-6'
```

Expected: HTTP 200, all eight keys present, and `/compound` includes `pubchem_volatile` without removing existing fields.

- [ ] **Step 6: Commit API integration**

```powershell
git add -- fema_proxy_server.py scripts/tests/test_pubchem_volatile.py
git commit -m "feat: expose PubChem volatile properties API"
```

### Task 4: Build frontend property helpers

**Files:**
- Create: `frontend/src/pubchemVolatile.js`
- Create: `frontend/src/pubchemVolatile.test.mjs`

- [ ] **Step 1: Write failing helper tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { getVolatilePropertySections, rankVolatileRecords } from './pubchemVolatile.js';

test('returns properties in the fixed scientific order', () => {
  const sections = getVolatilePropertySections({
    density: [{ raw_value: '0.9003 g/cm3' }],
    boiling_point: [{ raw_value: '77.1 °C' }],
  }, false);
  assert.deepEqual(sections.map(item => item.key), ['boiling_point', 'density']);
  assert.equal(sections[0].label, '沸点');
});

test('ranks information-rich records without ranking by numeric magnitude', () => {
  const records = rankVolatileRecords([
    { raw_value: '77 °C', source: '' },
    { raw_value: '77.1 °C at 760 mmHg', source: 'HSDB', temperature: '77.1 °C' },
  ]);
  assert.equal(records[0].source, 'HSDB');
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test src/pubchemVolatile.test.mjs
```

Expected: module not found.

- [ ] **Step 3: Implement fixed metadata and pure helpers**

Define the eight-property order, Chinese/English labels, and record-completeness scoring. Do not rank records by numeric value or source name.

- [ ] **Step 4: Run helper tests and verify GREEN**

Expected: both helper tests pass.

- [ ] **Step 5: Commit helpers**

```powershell
git add -- frontend/src/pubchemVolatile.js frontend/src/pubchemVolatile.test.mjs
git commit -m "feat: add PubChem volatile display helpers"
```

### Task 5: Render the volatile and partition properties module

**Files:**
- Create: `frontend/src/components/PubChemVolatileProperties.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Create the presentation component against the stable contract**

The component receives `data` and `isEnglish`. It renders distinct states for loading, `no_data`, `upstream_unavailable`, and `invalid_response`. For populated properties, render the first ranked record and a native `<details>` disclosure for remaining records:

```jsx
export default function PubChemVolatileProperties({ data, isEnglish }) {
  const sections = getVolatilePropertySections(data?.properties, isEnglish);
  if (!data || data.status === 'no_data') return <VolatileEmptyState isEnglish={isEnglish} />;
  if (!data.found) return <VolatileErrorState status={data.status} isEnglish={isEnglish} />;
  return (
    <section className="pubchem-volatile-properties">
      {/* heading, source link, eight compact property sections */}
    </section>
  );
}
```

Display `raw_value` first. Show parsed condition chips only when present. Link source names only when `source_url` exists.

- [ ] **Step 2: Integrate after chemical identity**

Import the component in `App.jsx`. Inside each integrated compound card, place it after `.integrated-content-grid` chemical/flavor content only if PubChem is enabled:

```jsx
{includePubChem && pubchem.found && (
  <PubChemVolatileProperties
    data={profile.pubchem_volatile}
    isEnglish={isEnglish}
  />
)}
```

Ensure failed-profile fallback includes a non-blocking empty `pubchem_volatile` state.

- [ ] **Step 3: Add responsive styling**

Use a two-column or four-column compact grid based on available width, light dividers, and no nested large-card shadows. At `max-width: 760px`, use one column. Add `overflow-wrap: anywhere` for raw values and links.

- [ ] **Step 4: Run lint and production build**

```powershell
$env:PATH='C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' lint
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' build
```

Expected: exit code 0. Existing RDKit/3Dmol warnings may remain; no new errors or warnings from this component.

- [ ] **Step 5: Commit the UI slice**

```powershell
git add -- frontend/src/components/PubChemVolatileProperties.jsx frontend/src/App.jsx frontend/src/App.css
git commit -m "feat: display PubChem volatile and partition properties"
```

### Task 6: Validate the complete user flow

**Files:**
- Create: `.playwright-cli/verify-pubchem-volatile.mjs` (local only)
- Modify: production files only if a failing regression test identifies a defect

- [ ] **Step 1: Write the browser regression script**

Use bundled Playwright to open the local search page, search `141-78-6`, wait for “挥发与分配性质”, assert the eight labels, expand a multi-record property, and verify a PubChem source link. Repeat with a mobile viewport and assert `scrollWidth <= clientWidth`.

- [ ] **Step 2: Run browser verification**

```powershell
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.playwright-cli\verify-pubchem-volatile.mjs'
```

Expected: eight properties visible for CID 8857, disclosure works, source link is valid, no console errors, no failed API requests, and no horizontal overflow.

- [ ] **Step 3: Verify upstream failure isolation**

Run a component fixture or intercepted Playwright response where `/pubchem-volatile` returns `upstream_unavailable`. Assert the volatile module shows a temporary-unavailable state while the compound identity and local thresholds remain visible.

- [ ] **Step 4: Run the complete regression suite**

```powershell
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest scripts.tests.test_pubchem_volatile scripts.tests.test_flavordb2_proxy -v
Push-Location scripts\book_index
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest test_book_index_pipeline
Pop-Location
Push-Location frontend
& 'C:\Users\hanxq\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test src/pubchemVolatile.test.mjs src/flavordb2.test.mjs
pnpm run test:book-search
pnpm run test:static-routes
pnpm lint
pnpm build
Pop-Location
```

Expected: all Python and Node tests pass, ESLint exits 0, and Vite build exits 0.

### Task 7: Document the contract and finish the branch

**Files:**
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document evidence boundaries**

Add the `pubchem_volatile` contract, explain computed XLogP versus experimental LogP, and state that PUG View annotations are source-attributed third-party records rather than PubChem measurements.

- [ ] **Step 2: Update Unreleased changes**

Record the PUG View integration, eight properties, traceable multi-source display and failure isolation.

- [ ] **Step 3: Run documentation and diff checks**

```powershell
git diff --check
Select-String -Path docs\DATA_DICTIONARY.md,docs\DATA_SOURCES.md,CHANGELOG.md -Pattern 'PubChem PUG View|volatile_properties|挥发'
```

Expected: no whitespace errors and all three documents contain the new integration.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/DATA_DICTIONARY.md docs/DATA_SOURCES.md CHANGELOG.md
git commit -m "docs: document PubChem volatile property evidence"
```

- [ ] **Step 5: Final verification before completion**

Re-run Task 6 Step 4 and the Playwright script. Confirm listeners on `127.0.0.1:5174` and `127.0.0.1:8787`, then inspect `git status --short`. Do not commit `.playwright-cli/`, `.superpowers/`, unrelated user changes, or runtime cache changes unless explicitly approved.
