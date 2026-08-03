import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptRoot, '..', '..');
const frontendRoot = path.join(root, 'frontend');
const screenshotRoot = path.join(root, '_local', 'verification');
mkdirSync(screenshotRoot, { recursive: true });
const resultsPath = path.join(screenshotRoot, 'search-workbench-results.json');
const runId = randomUUID();
const startedAt = new Date().toISOString();
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const atomicWriteJson = (target, value) => {
  const temporary = `${target}.${runId}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
};
for (const filename of readdirSync(screenshotRoot)) {
  if (/^search-workbench(?:-.*\.png|-results\.json(?:\..*\.tmp)?)$/.test(filename)) {
    rmSync(path.join(screenshotRoot, filename), { force: true });
  }
}
atomicWriteJson(resultsPath, { ok: false, status: 'running', runId, startedAt, gitHead });
const node = process.env.CODEX_E2E_NODE || process.execPath;
const python = process.env.CODEX_E2E_PYTHON || path.resolve(path.dirname(node), '..', '..', 'python', 'python.exe');
const playwrightPath = path.resolve(path.dirname(node), '..', 'node_modules', 'playwright', 'index.mjs');
const playwrightModule = process.env.CODEX_E2E_PLAYWRIGHT || pathToFileURL(playwrightPath).href;
const { chromium } = await import(playwrightModule);
const viteEntry = path.join(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort(preferred, excluded = new Set()) {
  if (!excluded.has(preferred) && await isPortFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error
        ? reject(error)
        : (excluded.has(port) ? choosePort(preferred, excluded).then(resolve, reject) : resolve(port)));
    });
  });
}

function start(command, args, options) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, label: options.label, stderr: '', exited: false, error: null };
  child.stdout.on('data', chunk => process.stderr.write(`[${options.label}] ${chunk}`));
  child.stderr.on('data', chunk => {
    record.stderr += chunk;
    process.stderr.write(`[${options.label}] ${chunk}`);
  });
  child.once('error', error => { record.error = error; });
  child.once('exit', (code, signal) => {
    record.exited = true;
    record.exitCode = code;
    record.signal = signal;
  });
  children.push(record);
  return record;
}

async function waitForUrl(url, records, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    for (const record of records) {
      if (record.error) throw new Error(`${record.label} failed to start: ${record.error.message}`);
      if (record.exited) throw new Error(`${record.label} exited before readiness (code=${record.exitCode}, signal=${record.signal})\n${record.stderr}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function stop(record) {
  if (!record?.child || record.child.exitCode !== null) return;
  record.child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => record.child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited) record.child.kill('SIGKILL');
}

const proxyPort = await choosePort(18789);
const vitePort = await choosePort(5177, new Set([proxyPort]));
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const appRootUrl = `http://127.0.0.1:${vitePort}/FlavorThresholdDB/`;
const baseUrl = `http://127.0.0.1:${vitePort}/FlavorThresholdDB/aroma-threshold/`;
const classicEndpointPrefixes = [
  '/spectra/',
  '/nist-webbook',
  '/biochemistry/resolve',
  '/biological-context/resolve',
  '/bioactivity/resolve',
  '/structures/resolve',
];
const biochemicalFixture = {
  chebi: { chebi_id: 'CHEBI:27750', name: 'ethyl acetate', formula: 'C4H8O2', source_url: 'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:27750', identity_match: { type: 'inchikey_exact', verified: true } },
  reactions: [{ rhea_id: 'RHEA:10020', equation: 'ethyl acetate + water = ethanol + acetate', source_url: 'https://www.rhea-db.org/rhea/10020' }],
  proteins: [{ accession: 'P12345', protein_name: 'Evidence-linked esterase', organism: { scientific_name: 'Saccharomyces cerevisiae', taxon_id: 4932 }, rhea_id: 'RHEA:10020', source_url: 'https://www.uniprot.org/uniprotkb/P12345/entry' }],
  sources: { ChEBI: { status: 'ok' }, Rhea: { status: 'ok' }, UniProt: { status: 'ok' } },
};
const biologicalContextFixture = {
  genes: [{ gene_id: '559295', symbol: 'ATF2', organism: 'Saccharomyces cerevisiae', source_url: 'https://www.ncbi.nlm.nih.gov/gene/559295', evidence: { uniprot_accession: 'P12345' } }],
  taxa: [{ taxon_id: 4932, scientific_name: 'Saccharomyces cerevisiae', rank: 'species', source_url: 'https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=4932' }],
  studies: [{ accession: 'MTBLS1', source_url: 'https://www.ebi.ac.uk/metabolights/MTBLS1' }],
  sources: { 'NCBI Gene': { status: 'ok' }, 'NCBI Taxonomy': { status: 'ok' }, MetaboLights: { status: 'ok' } },
  links: {},
};
const bioactivityFixture = {
  pubchem_assays: [{ aid: '421', outcome: 'Inactive', assay_name: 'Fixture cell viability assay', source_url: 'https://pubchem.ncbi.nlm.nih.gov/bioassay/421' }],
  chembl_activities: [{ activity_id: 7, target_name: 'Fixture ChEMBL target', type: 'IC50', value: '10', units: 'uM', source_url: 'https://www.ebi.ac.uk/chembl/explore/activity/7' }],
  gtopdb_interactions: [], bindingdb_interactions: [],
  sources: { 'PubChem BioAssay': { status: 'ok', total: 1 }, ChEMBL: { status: 'ok', total: 1 }, GtoPdb: { status: 'no_data' }, BindingDB: { status: 'no_data' } },
};
const structureFixture = {
  experimental_structures: [{ pdb_id: '1ABC', accession: 'P12345', source_url: 'https://www.rcsb.org/structure/1ABC' }],
  predicted_models: [{ model_id: 'AF-P12345-F1', accession: 'P12345', global_plddt: 91.2, version: 6, source_url: 'https://alphafold.ebi.ac.uk/entry/AF-P12345-F1' }],
  gpcr_proteins: [],
  sources: { 'RCSB PDB': { status: 'ok' }, 'AlphaFold DB': { status: 'ok' }, GPCRdb: { status: 'no_data' } },
};

const parseCsvLine = line => {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
};

const rgbaChannels = (value) => {
  const hex = String(value).trim().match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [...[0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)), 1];
  const channels = String(value).match(/[\d.]+/g)?.map(Number);
  assert.ok(channels?.length >= 3, `expected an RGB color, received ${value}`);
  return [...channels.slice(0, 3), channels[3] ?? 1];
};

const composite = (foreground, background) => {
  const [fr, fg, fb, alpha] = rgbaChannels(foreground);
  const [br, bg, bb] = Array.isArray(background) ? background : rgbaChannels(background);
  return [fr * alpha + br * (1 - alpha), fg * alpha + bg * (1 - alpha), fb * alpha + bb * (1 - alpha)];
};
const compositeBackground = layers => [...layers].reverse().reduce((background, layer) => composite(layer, background), [255, 255, 255]);
const relativeLuminance = (value) => (Array.isArray(value) ? value : rgbaChannels(value).slice(0, 3))
  .map(channel => channel / 255)
  .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

const contrastRatio = (foreground, backgroundLayers) => {
  const background = compositeBackground(backgroundLayers);
  const renderedForeground = composite(foreground, background);
  const [lighter, darker] = [relativeLuminance(renderedForeground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

async function inspectAccessibility(page, scopeSelector = '.search-view') {
  const audit = await page.evaluate((selector) => {
    const scope = document.querySelector(selector) || document;
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const unnamedButtons = [...scope.querySelectorAll('button')]
      .filter(visible)
      .filter(button => !(button.getAttribute('aria-label') || button.textContent.trim()))
      .map(button => button.outerHTML.slice(0, 180));
    const missingControls = [...scope.querySelectorAll('[aria-controls]')]
      .filter(element => !document.getElementById(element.getAttribute('aria-controls')))
      .map(element => element.getAttribute('aria-controls'));
    const illegalBooleanAria = [...scope.querySelectorAll('[aria-expanded], [aria-pressed]')]
      .filter(element => ['aria-expanded', 'aria-pressed'].some(attribute => (
        element.hasAttribute(attribute) && !['true', 'false', 'mixed'].includes(element.getAttribute(attribute))
      )))
      .map(element => element.outerHTML.slice(0, 180));
    const illegalCurrent = [...scope.querySelectorAll('[aria-current]')]
      .filter(element => !['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(element.getAttribute('aria-current')))
      .map(element => element.getAttribute('aria-current'));
    const invalidHeaders = [...scope.querySelectorAll('table th')]
      .filter(visible)
      .filter(header => !['col', 'row', 'colgroup', 'rowgroup'].includes(header.getAttribute('scope')))
      .map(header => header.textContent.trim());
    const liveRegions = [...scope.querySelectorAll('[aria-live], [role="status"], [role="alert"]')]
      .filter(visible)
      .map(element => ({ role: element.getAttribute('role'), live: element.getAttribute('aria-live'), text: element.textContent.trim().slice(0, 80) }));
    return { duplicateIds, unnamedButtons, missingControls, illegalBooleanAria, illegalCurrent, invalidHeaders, liveRegions };
  }, scopeSelector);
  assert.deepEqual(audit.duplicateIds, [], 'rendered document IDs are unique');
  assert.deepEqual(audit.unnamedButtons, [], 'every visible button has an accessible name');
  assert.deepEqual(audit.missingControls, [], 'every aria-controls target exists');
  assert.deepEqual(audit.illegalBooleanAria, [], 'aria-expanded and aria-pressed values are legal');
  assert.deepEqual(audit.illegalCurrent, [], 'aria-current values are legal');
  assert.deepEqual(audit.invalidHeaders, [], 'every rendered table header declares scope');
  assert.ok(audit.liveRegions.length >= 1, 'the rendered workbench exposes at least one live region');
  assert.ok(audit.liveRegions.length <= 3, `visible live regions are bounded (${audit.liveRegions.length} <= 3)`);
  return audit;
}

async function inspectViewport(page, width, { screenshot, requireChapterScroll = false, requireTableScroll = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(expectedWidth => (
    window.innerWidth === expectedWidth
    && document.documentElement.clientWidth === expectedWidth
    && document.querySelector('[data-testid="search-results-workbench"]')?.getBoundingClientRect().width > 0
  ), width);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const box = selector => {
      const element = document.querySelector(selector);
      return element ? { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth } : null;
    };
    const allowedScrollers = new Set(['chapter-navigation', 'batch-review__table-scroll', 'peak-table-scroll']);
    const clipped = [...document.querySelectorAll('[data-testid="search-results-workbench"] *')]
      .filter(visible)
      .filter(element => !String(element.className).includes('sr-only'))
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .filter(element => {
        const overflow = getComputedStyle(element).overflowX;
        return ['hidden', 'clip'].includes(overflow)
          && ![...allowedScrollers].some(className => element.classList.contains(className));
      })
      .filter(element => !element.matches('.evidence-record-disclosure__summary strong'))
      .map(element => ({ tag: element.tagName, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    const workbench = document.querySelector('[data-testid="search-results-workbench"]');
    const longContent = workbench ? [...workbench.querySelectorAll('h2, strong, dd, pre, td, .evidence-record-disclosure__summary')]
      .filter(visible)
      .filter(element => element.textContent.trim().length >= 24) : [];
    const buttons = workbench ? [...workbench.querySelectorAll('button')].filter(visible) : [];
    const overlaps = [];
    for (const content of longContent) {
      const contentRect = content.getBoundingClientRect();
      for (const button of buttons) {
        if (content.contains(button) || button.contains(content)) continue;
        const buttonRect = button.getBoundingClientRect();
        if (contentRect.left < buttonRect.right && contentRect.right > buttonRect.left
          && contentRect.top < buttonRect.bottom && contentRect.bottom > buttonRect.top) {
          overlaps.push({ content: content.textContent.trim().slice(0, 60), button: button.textContent.trim().slice(0, 40) });
        }
      }
    }
    const mobileTargets = [...document.querySelectorAll('.search-view button, .search-view input, .search-view textarea, .search-view select, .search-view [tabindex="0"]')]
      .filter(visible)
      .map(element => ({ name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40) || element.id, tag: element.tagName, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    const filterTops = [...document.querySelectorAll('.chapter-filter-group__buttons button')]
      .filter(visible)
      .map(element => Math.round(element.getBoundingClientRect().top));
    return {
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      workbench: box('[data-testid="search-results-workbench"]'),
      chapter: box('.chapter-navigation'),
      table: box('.batch-review__table-scroll'),
      clipped,
      overlaps,
      mobileTargets,
      filterRows: new Set(filterTops).size,
    };
  });
  assert.ok(metrics.document.scrollWidth <= metrics.document.clientWidth, `${width}px document has no horizontal overflow`);
  if (metrics.workbench) assert.ok(metrics.workbench.scrollWidth <= metrics.workbench.clientWidth, `${width}px workbench contains its own overflow`);
  assert.deepEqual(metrics.clipped, [], `${width}px workbench descendants are not unintentionally clipped`);
  assert.deepEqual(metrics.overlaps, [], `${width}px long content does not overlap workbench buttons`);
  if (requireChapterScroll) assert.ok(metrics.chapter?.scrollWidth > metrics.chapter?.clientWidth, `${width}px chapter navigation owns horizontal scrolling`);
  if (requireTableScroll) assert.ok(metrics.table?.scrollWidth > metrics.table?.clientWidth, `${width}px batch table owns horizontal scrolling`);
  if (width === 375) {
    const undersized = metrics.mobileTargets.filter(target => target.height < 44 || target.width < 44);
    assert.deepEqual(undersized, [], '375px visible controls expose at least a 44 by 44px touch target');
    if (metrics.filterRows > 0) assert.ok(metrics.filterRows > 1, '375px chapter filters wrap to multiple rows');
  }
  if (screenshot) await page.screenshot({ path: path.join(screenshotRoot, screenshot), fullPage: true });
  const compactMetrics = {
    ...metrics,
    touchTargets: {
      count: metrics.mobileTargets.length,
      minimumWidth: metrics.mobileTargets.length ? Math.min(...metrics.mobileTargets.map(target => target.width)) : null,
      minimumHeight: metrics.mobileTargets.length ? Math.min(...metrics.mobileTargets.map(target => target.height)) : null,
    },
  };
  delete compactMetrics.mobileTargets;
  return compactMetrics;
}

async function inspectContrast(page) {
  const tokens = await page.evaluate(() => {
    const sample = (selector, pseudo = null) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element, pseudo);
      const backgroundLayers = [];
      for (let backgroundElement = element; backgroundElement; backgroundElement = backgroundElement.parentElement) {
        backgroundLayers.push(getComputedStyle(backgroundElement).backgroundColor);
      }
      return { color: style.color, backgroundLayers };
    };
    return {
      body: sample('.search-results-workbench p'),
      label: sample('.search-field-label'),
      placeholder: sample('#compound-search', '::placeholder'),
      focus: { ...sample('.search-control-panel'), color: getComputedStyle(document.querySelector('.search-main')).getPropertyValue('--focus-ring').trim() },
    };
  });
  const ratios = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, contrastRatio(value.color, value.backgroundLayers)]));
  assert.ok(ratios.body >= 4.5, `body text contrast is ${ratios.body.toFixed(2)}:1`);
  assert.ok(ratios.label >= 4.5, `label contrast is ${ratios.label.toFixed(2)}:1`);
  assert.ok(ratios.placeholder >= 4.5, `placeholder contrast is ${ratios.placeholder.toFixed(2)}:1`);
  assert.ok(ratios.focus >= 3, `focus indicator contrast is ${ratios.focus.toFixed(2)}:1`);
  return { tokens, ratios };
}

async function verifyEvidenceStateRetries(browser, { baseUrl, proxyOrigin }) {
  const coreFixture = readFileSync(path.join(frontendRoot, 'public', 'aroma_data_merged.json'), 'utf8');
  const bookFixture = readFileSync(path.join(frontendRoot, 'public', 'book_flavor_chemistry_index.json'), 'utf8');
const successfulCompound = {
    pubchem: {
      found: true,
      cid: 8857,
      title: 'Ethyl acetate',
      molecular_formula: 'C4H8O2',
      smiles: 'CCOC(=O)C',
      inchi_key: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
    },
    pubchem_volatile: { found: false, status: 'no_data', properties: {} },
    flavordb: { found: true, cid: 8857, flavor_profile: ['fruity'] },
    flavordb2_entities: { found: false, entities: [] },
  };
  const evidence = {};
  const expectedFixtureFailures = [];
  const openScenario = async ({ name, expected503 = [], femaHandler, compoundHandler, coreHandler, bookHandler } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.requestIdleCallback = callback => window.setTimeout(
        () => callback({ didTimeout: false, timeRemaining: () => 50 }),
        2_000,
      );
      window.cancelIdleCallback = id => window.clearTimeout(id);
    });
    const diagnostics = { pageErrors: [], consoleErrors: [], network503ConsoleErrors: [], expected503Responses: [], unexpected503Responses: [] };
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (/^Failed to load resource: the server responded with a status of 503/.test(message.text())) {
        diagnostics.network503ConsoleErrors.push(message.text());
      } else {
        diagnostics.consoleErrors.push(message.text());
      }
    });
    page.on('response', response => {
      if (response.status() !== 503) return;
      const endpoint = new URL(response.url()).pathname;
      const expected = expected503.some(fixture => fixture.endpoint === endpoint);
      (expected ? diagnostics.expected503Responses : diagnostics.unexpected503Responses).push(endpoint);
    });
    const counts = { core: 0, book: 0, fema: 0, compound: 0 };
    const requestUrls = { core: [], book: [], fema: [], compound: [] };
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/aroma_data_merged.json')) { counts.core += 1; requestUrls.core.push(url); }
      if (url.pathname.endsWith('/book_flavor_chemistry_index.json')) { counts.book += 1; requestUrls.book.push(url); }
      if (url.pathname.endsWith('/fema')) requestUrls.fema.push(url);
      if (url.pathname.endsWith('/compound')) requestUrls.compound.push(url);
    });
    if (coreHandler) await page.route('**/aroma_data_merged.json*', route => coreHandler(route, counts));
    if (bookHandler) await page.route('**/book_flavor_chemistry_index.json*', route => bookHandler(route, counts));
    await page.route('**/fema?**', route => {
      counts.fema += 1;
      return (femaHandler || (currentRoute => currentRoute.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ found: true, name: 'Ethyl acetate', flavor_profile: 'fruity' }),
      })))(route, counts);
    });
    await page.route('**/compound?**', route => {
      counts.compound += 1;
      return (compoundHandler || (currentRoute => currentRoute.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successfulCompound),
      })))(route, counts);
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    return { name, expected503, context, page, counts, requestUrls, diagnostics };
  };
  const closeScenario = async (scenario) => {
    const actualCounts = Object.fromEntries(scenario.expected503.map(({ endpoint }) => [
      endpoint,
      scenario.diagnostics.expected503Responses.filter(actual => actual === endpoint).length,
    ]));
    assert.deepEqual(
      actualCounts,
      Object.fromEntries(scenario.expected503.map(({ endpoint, count }) => [endpoint, count])),
      `${scenario.name} receives only the declared number of expected fixture 503 responses`,
    );
    assert.deepEqual(scenario.diagnostics.unexpected503Responses, [], `${scenario.name} has no unexpected 503 response URLs`);
    assert.equal(
      scenario.diagnostics.network503ConsoleErrors.length,
      scenario.diagnostics.expected503Responses.length,
      `${scenario.name} generic browser 503 diagnostics correspond one-for-one with declared fixture responses`,
    );
    assert.deepEqual(scenario.diagnostics.pageErrors, [], 'state scenario has no page errors or unhandled rejections');
    assert.deepEqual(scenario.diagnostics.consoleErrors, [], 'state scenario has no console errors');
    expectedFixtureFailures.push({ scenario: scenario.name, endpoints: actualCounts });
    await scenario.context.close();
  };

  const compoundScenario = await openScenario({
    name: 'compound-retry',
    expected503: [{ endpoint: '/compound', count: 1 }],
    compoundHandler: async (route, counts) => {
      if (counts.compound === 1) return route.fulfill({ status: 503, body: 'fixture compound failure' });
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(successfulCompound) });
    },
  });
  try {
    const { page, counts, requestUrls } = compoundScenario;
    await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
    const workbench = page.getByTestId('search-results-workbench');
    await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor();
    const summary = workbench.getByLabel('来源状态');
    const local = summary.getByRole('listitem').filter({ hasText: '本地阈值' });
    await local.getByText('可用', { exact: true }).waitFor();
    const pubchem = summary.getByRole('listitem').filter({ hasText: 'PubChem' });
    const flavordb = summary.getByRole('listitem').filter({ hasText: 'FlavorDB2' });
    await pubchem.getByText('失败', { exact: true }).waitFor();
    await flavordb.getByText('失败', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-failed.png'), fullPage: true });
    await workbench.getByRole('button', { name: '引用与导出' }).click();
    const exportWarning = workbench.locator('.citation-export-chapter__source-warning');
    await exportWarning.waitFor();
    assert.match(await exportWarning.textContent(), /PubChem.*FlavorDB2/, 'enabled failed export sources are listed in the warning');
    const [failedExport] = await Promise.all([
      page.waitForEvent('download'),
      workbench.getByRole('button', { name: '导出精简版 CSV' }).click(),
    ]);
    const failedCsv = readFileSync(await failedExport.path(), 'utf8');
    const [failedHeader, failedRow] = failedCsv.replace(/^\uFEFF/, '').split(/\r?\n/);
    const classificationIndex = parseCsvLine(failedHeader).findIndex(cell => cell.includes('化合物类别'));
    assert.ok(classificationIndex >= 0, 'failed compound export includes classification column');
    assert.equal(parseCsvLine(failedRow)[classificationIndex], '', 'failed compound classification exports blank');
    assert.doesNotMatch(failedRow, /其他类|Others/, 'failed compound classification never falls back to Others');
    await page.getByRole('button', { name: '经典版' }).click();
    for (const key of ['pubchem', 'flavordb']) {
      const filter = page.locator(`[data-filter-key="${key}"]`);
      if (await filter.getAttribute('aria-pressed') === 'true') await filter.click();
    }
    await page.getByRole('button', { name: '新版档案' }).click();
    await workbench.getByRole('button', { name: '引用与导出' }).click();
    assert.equal(await workbench.locator('.citation-export-chapter__source-warning').count(), 0, 'disabled failed export sources do not produce a warning');
    await workbench.getByRole('button', { name: '概览' }).click();
    const beforeRetry = { ...counts };
    assert.deepEqual(beforeRetry, { core: 1, book: 1, fema: 1, compound: 1 }, 'compound scenario starts each source exactly once');
    await pubchem.getByRole('button', { name: '重试', exact: true }).click();
    await pubchem.getByRole('button', { name: '重试中…', exact: true }).waitFor();
    assert.equal(await pubchem.getByRole('button').isDisabled(), true, 'compound retry button is disabled while loading');
    const retryLiveText = (await summary.textContent()).replace(/\s+/g, ' ').trim();
    assert.match(retryLiveText, /PubChem.*失败.*重试中/, 'source live region announces the active PubChem retry');
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-disabled.png'), fullPage: true });
    assert.match(await local.textContent(), /可用/, 'local thresholds remain visible during compound retry');
    await workbench.getByText('8857', { exact: true }).waitFor({ timeout: 30_000 });
    await pubchem.getByText('可用', { exact: true }).waitFor();
    const retryCompletionAnnouncement = await summary.locator('.source-status-summary__announcement').textContent();
    assert.equal(retryCompletionAnnouncement.trim(), 'PubChem: 可用', 'source live region announces the completed PubChem retry');
    assert.equal(await pubchem.evaluate(node => document.activeElement === node), true, 'successful retry restores focus to source status');
    assert.ok(requestUrls.compound[1].searchParams.has('_retry'), 'compound retry cache-busts its second request');
    assert.doesNotMatch(await summary.textContent(), /PubChem失败|FlavorDB2失败/, 'compound failures clear after retry');
    assert.deepEqual(counts, {
      core: beforeRetry.core,
      book: beforeRetry.book,
      fema: beforeRetry.fema,
      compound: beforeRetry.compound + 1,
    }, 'compound retry increments only the shared compound endpoint');
    evidence.compound = {
      ...counts,
      liveRegion: { retry: retryLiveText, completion: retryCompletionAnnouncement.trim() },
    };
  } finally {
    await closeScenario(compoundScenario);
  }

  const partialCompoundScenario = await openScenario({
    name: 'partial-compound-retry',
    compoundHandler: async (route, counts) => {
      if (counts.compound === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...successfulCompound,
            flavordb: { found: false, status: 'upstream_unavailable', error: 'fixture FlavorDB failure' },
          }),
        });
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(successfulCompound) });
    },
  });
  try {
    const { page, counts } = partialCompoundScenario;
    await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
    const workbench = page.getByTestId('search-results-workbench');
    await workbench.getByText('8857', { exact: true }).waitFor({ timeout: 30_000 });
    const summary = workbench.getByLabel('来源状态');
    const pubchem = summary.getByRole('listitem').filter({ hasText: 'PubChem' });
    const flavordb = summary.getByRole('listitem').filter({ hasText: 'FlavorDB2' });
    await pubchem.getByText('可用', { exact: true }).waitFor();
    await flavordb.getByText('失败', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-partial.png'), fullPage: true });
    assert.deepEqual(counts, { core: 1, book: 1, fema: 1, compound: 1 }, 'partial compound scenario starts each source exactly once');
    await flavordb.getByRole('button', { name: '重试', exact: true }).click();
    await flavordb.getByRole('button', { name: '重试中…', exact: true }).waitFor();
    assert.match(await pubchem.textContent(), /可用/, 'successful PubChem evidence remains ready during shared compound retry');
    assert.equal(await pubchem.getByRole('button').count(), 0, 'successful PubChem does not expose a retry button');
    await flavordb.getByText('可用', { exact: true }).waitFor();
    assert.deepEqual(counts, { core: 1, book: 1, fema: 1, compound: 2 }, 'partial retry increments only the shared compound endpoint');
    evidence.partialCompound = { ...counts, pubchemRetained: true };
  } finally {
    await closeScenario(partialCompoundScenario);
  }

  const scientificScenario = await openScenario({
    name: 'scientific-state-truth',
    compoundHandler: async (route) => {
      const cas = new URL(route.request().url()).searchParams.get('cas');
      const isEthanol = cas === '64-17-5';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...successfulCompound,
          pubchem: {
            ...successfulCompound.pubchem,
            cid: isEthanol ? 702 : 8857,
            title: isEthanol ? 'Ethanol' : 'Ethyl acetate',
          },
        }),
      });
    },
  });
  try {
    const { page } = scientificScenario;
    const bioactivityRequestCounts = new Map();
    let staleRetrySettledResolve;
    const staleRetrySettled = new Promise(resolve => { staleRetrySettledResolve = resolve; });
    await page.route('**/bioactivity/resolve?**', async (route) => {
      const cid = new URL(route.request().url()).searchParams.get('cid');
      const requestCount = (bioactivityRequestCounts.get(cid) || 0) + 1;
      bioactivityRequestCounts.set(cid, requestCount);
      if (cid === '702' && requestCount === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            pubchem_assays: [],
            chembl_activities: [], gtopdb_interactions: [], bindingdb_interactions: [],
            sources: { 'PubChem BioAssay': { status: 'ok', total: 1 }, ChEMBL: { status: 'upstream_unavailable' }, GtoPdb: { status: 'no_data' }, BindingDB: { status: 'no_data' } },
          }),
        });
      }
      if (cid === '702') {
        await new Promise(resolve => setTimeout(resolve, 900));
        try {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              pubchem_assays: [{ aid: 'ETHANOL-STALE', outcome: 'Active', assay_name: 'Stale ethanol retry assay', source_url: 'https://pubchem.ncbi.nlm.nih.gov/bioassay/2' }],
              chembl_activities: [], gtopdb_interactions: [], bindingdb_interactions: [],
              sources: { 'PubChem BioAssay': { status: 'ok', total: 1 }, ChEMBL: { status: 'ok', total: 0 }, GtoPdb: { status: 'no_data' }, BindingDB: { status: 'no_data' } },
            }),
          });
        } catch {
          // Correct identity changes may abort the old retry before the fixture can settle.
        } finally {
          staleRetrySettledResolve();
        }
        return;
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pubchem_assays: [], chembl_activities: [], gtopdb_interactions: [], bindingdb_interactions: [],
          sources: { 'PubChem BioAssay': { status: 'no_data', total: 0 }, ChEMBL: { status: 'no_data', total: 0 }, GtoPdb: { status: 'no_data' }, BindingDB: { status: 'no_data' } },
        }),
      });
    });

    const input = page.getByLabel('化合物名称或 CAS 号');
    const workbench = page.getByTestId('search-results-workbench');
    const bioactivityChapter = page.getByRole('navigation', { name: '档案章节' }).getByRole('button', { name: /活性与靶点/ });
    const assertNavigationPanelStatus = async (status, label, owner) => {
      const panelStatus = workbench.locator(`.chapter-panel__status[data-status="${status}"]`);
      await panelStatus.waitFor({ state: 'visible', timeout: 30_000 });
      const navigationText = (await bioactivityChapter.locator('.chapter-navigation__meta').innerText()).trim();
      const panelText = (await panelStatus.innerText()).trim();
      assert.equal(navigationText, label, `${owner} navigation exposes the truthful ${status} label`);
      assert.equal(panelText, navigationText, `${owner} navigation and panel status text stay identical`);
    };

    await input.fill('64-17-5');
    await workbench.getByText('CAS 64-17-5', { exact: true }).waitFor({ state: 'visible' });
    const partialResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/bioactivity/resolve' && url.searchParams.get('cid') === '702';
    });
    await bioactivityChapter.click();
    const partialResponse = await partialResponsePromise;
    assert.equal(partialResponse.status(), 200, 'HTTP 200 scientific payload can truthfully resolve to partial');
    await assertNavigationPanelStatus('partial', '部分可用', 'HTTP 200 partial bioactivity');
    const retryButton = workbench.getByRole('button', { name: '重试活性聚合端点中失败的来源', exact: true });
    const retryRequestPromise = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname === '/bioactivity/resolve' && url.searchParams.get('cid') === '702';
    });
    await retryButton.click();
    await retryRequestPromise;
    assert.equal(bioactivityRequestCounts.get('702'), 2, 'partial scientific state retries its owning endpoint once');

    await input.fill('141-78-6');
    await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await workbench.getByText('Stale ethanol retry assay', { exact: true }).count(), 0, 'switching CAS clears retry-era records immediately');
    const noDataResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/bioactivity/resolve' && url.searchParams.get('cid') === '8857';
    });
    await bioactivityChapter.click();
    const noDataResponse = await noDataResponsePromise;
    assert.equal(noDataResponse.status(), 200, 'scientific no-data is represented by an HTTP 200 response');
    await assertNavigationPanelStatus('no_data', '暂无数据', 'scientific no-data');
    await staleRetrySettled;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await workbench.getByText('Stale ethanol retry assay', { exact: true }).count(), 0, 'late retry data from the previous CAS cannot repopulate the panel');
    assert.ok(bioactivityRequestCounts.get('8857') >= 1, 'new CAS owns its scientific endpoint request independently');
    evidence.scientificTruth = {
      endpoint: '/bioactivity/resolve',
      partialHttpStatus: partialResponse.status(),
      noDataHttpStatus: noDataResponse.status(),
      requestsByCid: Object.fromEntries(bioactivityRequestCounts),
      staleRetryIgnored: true,
      navigationPanelStatusParity: true,
    };
  } finally {
    await closeScenario(scientificScenario);
  }

  const femaScenario = await openScenario({
    name: 'fema-retry',
    expected503: [{ endpoint: '/fema', count: 2 }],
    femaHandler: async (route, counts) => {
      if (counts.fema <= 2) {
        if (counts.fema === 2) await new Promise(resolve => setTimeout(resolve, 250));
        return route.fulfill({ status: 503, body: 'fixture FEMA failure' });
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: true, name: 'Ethyl acetate', flavor_profile: 'fruity' }) });
    },
  });
  try {
    const { page, counts, requestUrls } = femaScenario;
    await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
    const workbench = page.getByTestId('search-results-workbench');
    await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor();
    const summary = workbench.getByLabel('来源状态');
    const fema = summary.getByRole('listitem').filter({ hasText: 'FEMA' });
    await fema.getByText('失败', { exact: true }).waitFor();
    await workbench.getByText('8857', { exact: true }).waitFor({ timeout: 30_000 });
    const beforeRetry = { ...counts };
    assert.deepEqual(beforeRetry, { core: 1, book: 1, fema: 1, compound: 1 }, 'FEMA scenario starts each source exactly once');
    await fema.getByRole('button', { name: '重试', exact: true }).focus();
    await page.keyboard.press('Enter');
    await fema.getByRole('button', { name: '重试中…', exact: true }).waitFor();
    assert.equal(await workbench.getByText('8857', { exact: true }).count(), 1, 'compound identity stays visible during FEMA retry');
    const retainedRetry = fema.getByRole('button', { name: '重试', exact: true });
    await retainedRetry.waitFor();
    assert.equal(await retainedRetry.evaluate(node => document.activeElement === node), true, 'failed retry retains and focuses its retry button');
    assert.ok(requestUrls.fema[1].searchParams.has('_retry'), 'failed FEMA retry cache-busts its second request');
    await retainedRetry.click();
    await fema.getByText('可用', { exact: true }).waitFor();
    assert.equal(await fema.evaluate(node => document.activeElement === node), true, 'FEMA retry restores focus to source status');
    assert.ok(requestUrls.fema[2].searchParams.has('_retry'), 'successful FEMA retry cache-busts its request');
    assert.deepEqual(counts, {
      core: beforeRetry.core,
      book: beforeRetry.book,
      fema: beforeRetry.fema + 2,
      compound: beforeRetry.compound,
    }, 'FEMA retry increments only the FEMA endpoint');
    evidence.fema = { ...counts };
  } finally {
    await closeScenario(femaScenario);
  }

  let bookAttempt = 0;
  const bookScenario = await openScenario({
    name: 'book-retry',
    expected503: [{ endpoint: '/FlavorThresholdDB/book_flavor_chemistry_index.json', count: 1 }],
    bookHandler: async (route) => {
      bookAttempt += 1;
      if (bookAttempt === 1) return route.fulfill({ status: 503, body: 'fixture book failure' });
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: bookFixture });
    },
  });
  try {
    const { page, counts } = bookScenario;
    await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
    const workbench = page.getByTestId('search-results-workbench');
    await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor();
    const summary = workbench.getByLabel('来源状态');
    const book = summary.getByRole('listitem').filter({ hasText: '书籍证据' });
    await book.getByText('失败', { exact: true }).waitFor();
    assert.deepEqual(counts, { core: 1, book: 1, fema: 1, compound: 1 }, 'book scenario starts each source exactly once');
    await book.getByRole('button', { name: '重试', exact: true }).click();
    await book.getByRole('button', { name: '重试中…', exact: true }).waitFor();
    assert.equal(await book.getByRole('button').isDisabled(), true, 'book retry is disabled while loading');
    await book.getByText('可用', { exact: true }).waitFor({ timeout: 30_000 });
    assert.deepEqual(counts, { core: 1, book: 2, fema: 1, compound: 1 }, 'book retry increments only the book request');
    evidence.book = { ...counts };
  } finally {
    await closeScenario(bookScenario);
  }

  let coreAttempt = 0;
  const coreScenario = await openScenario({
    name: 'core-retry',
    expected503: [{ endpoint: '/FlavorThresholdDB/aroma_data_merged.json', count: 1 }],
    coreHandler: async (route) => {
      coreAttempt += 1;
      if (coreAttempt === 1) await new Promise(resolve => setTimeout(resolve, 500));
      return coreAttempt === 1
        ? route.fulfill({ status: 503, body: 'fixture core failure' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: coreFixture });
    },
  });
  try {
    const { page, counts, requestUrls } = coreScenario;
    const input = page.getByLabel('化合物名称或 CAS 号');
    await input.fill('141-78-6');
    const loadingLiveRegion = page.locator('[aria-live="polite"]').filter({ hasText: '正在建立化合物档案' }).first();
    await loadingLiveRegion.getByText('正在建立化合物档案', { exact: true }).waitFor();
    const loadingLiveText = (await loadingLiveRegion.textContent()).replace(/\s+/g, ' ').trim();
    assert.match(loadingLiveText, /正在建立化合物档案.*正在载入本地检索数据/, 'loading live region contains the active loading announcement');
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-loading.png'), fullPage: true });
    const error = page.getByTestId('core-search-error');
    await error.getByText('暂时无法完成检索', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-core-error.png'), fullPage: true });
    await page.getByRole('button', { name: '经典版' }).click();
    assert.equal(await input.inputValue(), '141-78-6', 'core error preserves the query');
    assert.equal(await page.getByRole('button', { name: '经典版' }).getAttribute('aria-pressed'), 'true', 'core error preserves the selected result view');
    await error.getByRole('button', { name: '重试本地数据库' }).click();
    await error.waitFor({ state: 'hidden' });
    await page.getByTestId('classic-search-results').waitFor();
    assert.equal(counts.core, 2, 'core retry reloads the local identity JSON once');
    assert.ok(requestUrls.core[1].searchParams.has('_retry'), 'core retry cache-busts its second request');
    await page.getByRole('button', { name: '新版档案' }).click();
    await page.getByTestId('search-results-workbench').getByText('CAS 141-78-6', { exact: true }).waitFor();
    const coreCompletionLiveText = (await page.getByLabel('来源状态').textContent()).replace(/\s+/g, ' ').trim();
    assert.match(coreCompletionLiveText, /本地阈值.*可用/, 'source live region updates after the core retry completes');
    await input.fill('definitely missing compound');
    await page.getByText('未找到可确认的化合物身份', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, 'search-workbench-state-no-match.png'), fullPage: true });
    evidence.core = {
      core: counts.core,
      inputPreserved: true,
      viewPreserved: true,
      noMatchDistinguished: true,
      liveRegion: { loading: loadingLiveText, completion: coreCompletionLiveText },
    };
  } finally {
    await closeScenario(coreScenario);
  }

  evidence.expectedFixtureFailures = expectedFixtureFailures;
  return evidence;
}

async function inspectClassicLayout(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const classic = page.getByTestId('classic-search-results');
  await classic.waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await classic.evaluate((element) => {
    const renderedDescendants = [...element.querySelectorAll('*')].filter(child => {
      const childRect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      return style.display !== 'none' && style.visibility !== 'hidden' && childRect.width > 0 && childRect.height > 0;
    });
    const descendantRects = renderedDescendants.map(child => child.getBoundingClientRect());
    const bounds = {
      left: Math.min(...descendantRects.map(rect => rect.left)),
      right: Math.max(...descendantRects.map(rect => rect.right)),
    };
    const ownedHorizontalScrollers = [...element.querySelectorAll('*')]
      .filter(child => child.scrollWidth > child.clientWidth + 1)
      .filter(child => ['auto', 'scroll'].includes(getComputedStyle(child).overflowX))
      .map(child => ({ className: String(child.className), clientWidth: child.clientWidth, scrollWidth: child.scrollWidth }));
    const targets = [...document.querySelectorAll('.search-view button, .search-view input, .search-view select')]
      .filter(target => {
        const targetRect = target.getBoundingClientRect();
        return getComputedStyle(target).display !== 'none' && targetRect.width > 0 && targetRect.height > 0;
      })
      .map(target => ({ tag: target.tagName, className: String(target.className), type: target.type, width: target.getBoundingClientRect().width, height: target.getBoundingClientRect().height }));
    return {
      displayMode: getComputedStyle(element).display,
      visibleDescendantCount: renderedDescendants.length,
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      renderedBounds: bounds,
      ownedHorizontalScrollers,
      touchTargets: {
        count: targets.length,
        minimumWidth: targets.length ? Math.min(...targets.map(target => target.width)) : null,
        minimumHeight: targets.length ? Math.min(...targets.map(target => target.height)) : null,
        meets44px: targets.length ? targets.every(target => target.width >= 44 && target.height >= 44) : null,
        undersized: targets.filter(target => target.width < 44 || target.height < 44).map(target => ({ tag: target.tagName, className: target.className, type: target.type, width: target.width, height: target.height })),
      },
    };
  });
  assert.ok(metrics.visibleDescendantCount > 0, `${width}px classic display-contents container renders visible result descendants`);
  assert.ok(metrics.renderedBounds.left >= 0 && metrics.renderedBounds.right <= width, `${width}px classic rendered result bounds stay within the viewport`);
  assert.ok(metrics.document.scrollWidth <= metrics.document.clientWidth, `${width}px classic page has no document-level horizontal overflow`);
  if (width === 375) assert.equal(metrics.touchTargets.meets44px, true, `375px classic visible controls meet the 44px touch-target contract: ${JSON.stringify(metrics.touchTargets.undersized)}`);
  return metrics;
}
let browser;

try {
  const proxy = start(python, ['fema_proxy_server.py'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(proxyPort) },
    label: 'proxy',
  });
  const vite = start(node, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: frontendRoot,
    env: { ...process.env, VITE_FEMA_API_URL: proxyOrigin },
    label: 'vite',
  });
  await waitForUrl(`${proxyOrigin}/health`, [proxy, vite]);
  await waitForUrl(baseUrl, [proxy, vite]);

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const expectedNetwork503Errors = [];
  const expectedCompare503Responses = [];
  const pageErrors = [];
  const apiRequests = [];
  const failedScientificRequests = [];
  let selectedCandidateRequestEvidence = null;
  let bulkLimitRequestEvidence = null;
  const batchReviewEvidence = {};
  const e2eStages = [];
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 503/.test(message.text())) {
      expectedNetwork503Errors.push(message.text());
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (response.status() === 503 && url.pathname === '/spectra/compare') {
      expectedCompare503Responses.push(url.pathname);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().startsWith(proxyOrigin) && request.url().includes('/spectra/')) {
      failedScientificRequests.push({
        path: new URL(request.url()).pathname,
        errorText: request.failure()?.errorText || '',
      });
    }
  });
  page.on('request', request => {
    if (request.url().startsWith(proxyOrigin)) {
      apiRequests.push({ method: request.method(), path: new URL(request.url()).pathname, url: request.url() });
    }
  });
  await page.route(`${proxyOrigin}/**`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.route('**/fema?**', route => {
    const cas = new URL(route.request().url()).searchParams.get('cas');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cas === '18127-01-0'
        ? { found: true, name: 'Selected Bourgeonal FEMA' }
        : cas === '141-78-6'
          ? { found: true, name: 'FEMA   CANONICAL NAME (Natural)', flavor_profile: 'fruity, pineapple', source: 'FEMA Flavor Library' }
          : { found: false }),
    });
  });
  await page.route('**/compound?**', route => {
    const cas = new URL(route.request().url()).searchParams.get('cas');
    const isSelectedCandidate = cas === '18127-01-0';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
      pubchem: {
        found: true,
        cid: isSelectedCandidate ? 18127010 : 8857,
        title: isSelectedCandidate ? 'Selected Bourgeonal' : 'Ethyl acetate with an intentionally extended English identity label for responsive workbench verification',
        molecular_formula: isSelectedCandidate ? 'C11H14O' : 'C4H8O2',
        smiles: 'CCOC(=O)C',
        inchi_key: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N',
        url: `https://pubchem.ncbi.nlm.nih.gov/compound/${isSelectedCandidate ? 18127010 : 8857}`,
      },
      pubchem_volatile: { found: false, status: 'no_data', properties: {} },
      flavordb: isSelectedCandidate
        ? { found: false }
        : { found: true, cid: 999999, common_name: 'FlavorDB fallback name', flavor_profile: ['fruity'], odor: ['pineapple'], taste: ['sweet'], source: 'FlavorDB2' },
      flavordb2_entities: isSelectedCandidate
        ? { found: false, entities: [] }
        : { found: true, entities: [{ id: 12, name: 'Pineapple', natural_source: { name: 'Ananas comosus' } }] },
    }),
    });
  });
  const bookFixture = JSON.parse(readFileSync(
    path.join(frontendRoot, 'public', 'book_flavor_chemistry_index.json'),
    'utf8',
  ));
  const lineageThreshold = bookFixture.thresholds.find(record => (
    record.entity_cas === '141-78-6'
    && record.raw_text === '水中觉察嗅阈值0.6μg/L，识别 '
  ));
  assert.ok(lineageThreshold, 'book lineage fixture target exists');
  lineageThreshold.raw_text += '；用于验证超长中文阈值原始记录在窄屏下能够自然换行且不会覆盖重试、复制或导出按钮。';
  lineageThreshold.source_corrections = [{
    source_text: '0.6pg/L',
    corrected_text: '0.6μg/L',
    reason: 'verified_against_source_page',
  }];
  lineageThreshold.subject_resolution = {
    subject_label: '乙酸乙酯',
    resolution_type: 'source_verified_context_subject',
    source_page_evidence: 'page-182.jpg',
  };
  await page.route('**/book_flavor_chemistry_index.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(bookFixture),
  }));
  await page.route('**/spectra/search?**', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      records: [1, 2, 3].map(index => ({
        source: 'MassBank',
        spectrum_id: `MB-FIXTURE-${index}`,
        spectrum_type: 'EI',
        ion_mode: 'positive',
        instrument: 'GC-EI-MS',
        source_url: `https://massbank.eu/MassBank/RecordDisplay?id=MB-FIXTURE-${index}`,
      })),
      summary: { total: 3, massbank: 3, gnps: 0, ei: 3, ms2: 0 },
      sources: { MassBank: { status: 'ok' }, GNPS: { status: 'no_data' } },
    }),
    });
  });
  const detailRequestCounts = new Map();
  await page.route('**/spectra/MassBank/MB-FIXTURE-*', async route => {
    const spectrumId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    const requestCount = (detailRequestCounts.get(spectrumId) || 0) + 1;
    detailRequestCounts.set(spectrumId, requestCount);
    if (spectrumId === 'MB-FIXTURE-1' && requestCount <= 2) {
      await new Promise(resolve => setTimeout(resolve, requestCount === 1 ? 800 : 400));
    }
    if (spectrumId === 'MB-FIXTURE-2' && requestCount === 1) {
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{fixture detail failure' });
      } catch {
        // The browser may abort the routed request while switching chapters.
      }
      return;
    }
    if (spectrumId === 'MB-FIXTURE-3') {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source: 'MassBank', spectrum_id: spectrumId, spectrum_type: 'EI', ion_mode: 'positive',
          instrument: 'GC-EI-MS', peaks: [[43, 100], [61, 50]], license: 'CC BY 4.0',
          source_url: `https://massbank.eu/MassBank/RecordDisplay?id=${spectrumId}`,
        }),
      });
    } catch {
      // Expected when an AbortController cancels a pending detail request.
    }
  });
  await page.route('**/spectra/compare', async route => {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    try {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture compare failure' }) });
    } catch {
      // Expected when the comparison owner unmounts.
    }
  });
  await page.route('**/nist-webbook?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', url: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C141786', sections: [{ type: 'ei_ms', label: 'Mass spectrum', url: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C141786&Mask=200' }] }),
  }));
  await page.route('**/biochemistry/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(biochemicalFixture) }));
  await page.route('**/biological-context/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(biologicalContextFixture) }));
  await page.route('**/bioactivity/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bioactivityFixture) }));
  await page.route('**/structures/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structureFixture) }));

  await page.addInitScript(() => {
    window.requestIdleCallback = callback => window.setTimeout(
      () => callback({ didTimeout: false, timeRemaining: () => 50 }),
      2_000,
    );
    window.cancelIdleCallback = id => window.clearTimeout(id);
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: '跳到检索区域' });
  assert.equal(await skipLink.evaluate(element => document.activeElement === element), true, 'first Tab reaches the skip link');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main-content').evaluate(element => document.activeElement === element || location.hash === '#main-content'), true, 'skip link targets the search main region');
  const searchModeGroup = page.locator('.search-mode-tabs');
  const bulkModeKeyboard = searchModeGroup.getByRole('button', { name: '批量匹配' });
  const singleModeKeyboard = searchModeGroup.getByRole('button', { name: '单物质检索' });
  await bulkModeKeyboard.focus();
  await page.keyboard.press('Enter');
  assert.equal(await bulkModeKeyboard.getAttribute('aria-pressed'), 'true', 'Enter activates bulk search mode');
  await singleModeKeyboard.focus();
  await page.keyboard.press('Enter');
  assert.equal(await singleModeKeyboard.getAttribute('aria-pressed'), 'true', 'Enter restores single search mode');
  const keyboardMatchMode = page.getByRole('group', { name: '匹配方式' });
  const fuzzyKeyboard = keyboardMatchMode.getByRole('button', { name: '模糊', exact: true });
  const exactKeyboard = keyboardMatchMode.getByRole('button', { name: '精确', exact: true });
  await fuzzyKeyboard.focus();
  await page.keyboard.press('Enter');
  assert.equal(await fuzzyKeyboard.getAttribute('aria-pressed'), 'true', 'Enter activates fuzzy matching');
  await exactKeyboard.focus();
  await page.keyboard.press('Enter');
  assert.equal(await exactKeyboard.getAttribute('aria-pressed'), 'true', 'Enter restores exact matching');
  const input = page.getByLabel('化合物名称或 CAS 号');
  await input.waitFor({ timeout: 30_000 });
  await input.fill('141-78-6');

  const workbench = page.getByTestId('search-results-workbench');
  await workbench.waitFor({ timeout: 30_000 });
  await workbench.getByText(/匹配\s*\d+\s*条/).waitFor({ timeout: 30_000 });

  const newButton = page.getByRole('button', { name: '新版档案' });
  const classicButton = page.getByRole('button', { name: '经典版' });
  assert.equal(await newButton.getAttribute('aria-pressed'), 'true', 'new dossier is the default view');

  const identityCas = page.getByText('CAS 141-78-6', { exact: true });
  await identityCas.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await identityCas.count(), 1, 'new dossier renders the complete CAS identity exactly once');
  const identityNames = await workbench.locator('.compound-identity-header').evaluate((header) => {
    const preferred = header.querySelector('h2')?.textContent?.trim() || '';
    const aliases = [...header.querySelectorAll('.compound-identity-header__aliases span')].map((alias) => {
      const label = alias.querySelector('strong')?.textContent?.trim() || '';
      return { label, value: alias.textContent.slice(label.length).trim() };
    });
    return { preferred, aliases };
  });
  const normalizeIdentityName = value => value.trim().toLowerCase();
  assert.ok(identityNames.aliases.length > 0, 'a distinct bilingual alias remains visible');
  assert.ok(
    identityNames.aliases.every(({ value }) => normalizeIdentityName(value) !== normalizeIdentityName(identityNames.preferred)),
    'aliases do not repeat the preferred heading',
  );
  assert.equal(
    new Set(identityNames.aliases.map(({ value }) => normalizeIdentityName(value))).size,
    identityNames.aliases.length,
    'normalized aliases are unique',
  );
  const sourceSummary = workbench.getByLabel('来源状态');
  assert.equal(await sourceSummary.count(), 1, 'observed source states are connected to the dossier');
  const localThresholdState = sourceSummary.getByRole('listitem').filter({ hasText: '本地阈值' });
  assert.equal(await localThresholdState.count(), 1, 'local threshold source is listed');
  assert.match(await localThresholdState.textContent(), /可用/, 'local threshold records report a ready state');

  const chapterNavigation = page.getByRole('navigation', { name: '档案章节' });
  const chapterButtons = chapterNavigation.getByRole('button');
  assert.equal(await chapterButtons.count(), 8, 'new dossier exposes eight chapter buttons');
  const delegatedChapterButtons = [
    chapterNavigation.getByRole('button', { name: /光谱/ }),
    chapterNavigation.getByRole('button', { name: /生化关系/ }),
    chapterNavigation.getByRole('button', { name: /活性与靶点/ }),
    chapterNavigation.getByRole('button', { name: /蛋白结构/ }),
  ];
  for (const button of delegatedChapterButtons) {
    assert.equal(
      await button.locator('.chapter-navigation__meta').count(),
      1,
      'lazy scientific chapter navigation exposes its request state',
    );
    assert.match(await button.textContent(), /点击章节加载/, 'unvisited scientific chapter explains how to start loading');
    assert.match(await button.textContent(), /加载数据/, 'unvisited scientific chapter exposes an explicit load action');
  }
  const assertDelegatedPanelMeta = async (chapterName) => {
    const panelHeader = workbench.locator('.chapter-panel:visible .chapter-panel__header');
    assert.equal(await panelHeader.locator('.chapter-panel__status').count(), 1, `${chapterName} exposes the delegated request status`);
    assert.equal(await panelHeader.locator('.chapter-panel__count').count(), 0, `${chapterName} omits the delegated outer count`);
  };
  const heavyRequests = () => apiRequests.filter(request => classicEndpointPrefixes.some(prefix => request.path.startsWith(prefix)));
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByTestId('spectrum-workbench').count(), 0, 'overview does not mount the spectrum workbench');
  assert.equal(heavyRequests().length, 0, 'overview performs no chapter-specific heavy requests');

  const spectraChapter = chapterNavigation.getByRole('button', { name: /光谱/ });
  await spectraChapter.click();
  await workbench.getByText(/预计需要 5–15 秒/).waitFor({ state: 'visible' });
  assert.equal(await workbench.locator('.chapter-panel__loading-spinner').count(), 1, 'chapter click immediately shows a loading indicator');
  await page.getByTestId('spectrum-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('MassBank · MB-FIXTURE-1', { exact: true }).waitFor({ state: 'visible' });
  await workbench.getByRole('link', { name: 'EI 质谱' }).waitFor({ state: 'visible' });
  await assertDelegatedPanelMeta('spectra');
  assert.ok(apiRequests.some(request => request.path === '/spectra/search'), 'spectra request starts only after entering the spectra chapter');
  assert.ok(apiRequests.some(request => request.path === '/nist-webbook'), 'NIST presence request starts only in the spectra chapter');
  assert.equal(apiRequests.filter(request => request.path === '/biochemistry/resolve').length, 0, 'spectra does not mount biochemistry');
  assert.equal(apiRequests.filter(request => request.path === '/bioactivity/resolve').length, 0, 'spectra does not mount bioactivity');
  assert.equal(apiRequests.filter(request => request.path === '/structures/resolve').length, 0, 'spectra does not mount structures');
  const detailRequestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/spectra/MassBank/MB-FIXTURE-1');
  await workbench.locator('.spectrum-record-main').first().click();
  await detailRequestStarted;
  const comparisonDetailStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/spectra/MassBank/MB-FIXTURE-1');
  await workbench.getByRole('button', { name: '加入比较' }).first().click();
  await comparisonDetailStarted;
  await workbench.getByText(/A · MassBank · MB-FIXTURE-1/).first().waitFor({ state: 'visible', timeout: 5_000 });
  await workbench.getByRole('region', { name: '可滚动谱图峰表' }).waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await workbench.getByText('正在加载峰表…', { exact: true }).count(), 0, 'comparison detail does not leave the record detail loading');
  assert.equal(
    failedScientificRequests.filter(request => request.path === '/spectra/MassBank/MB-FIXTURE-1').length,
    0,
    'record detail and comparison detail complete independently',
  );

  const biochemistryChapter = chapterNavigation.getByRole('button', { name: /生化关系/ });
  await biochemistryChapter.click();
  assert.equal(await page.getByTestId('spectrum-workbench').isHidden(), true, 'leaving spectra keeps the cached spectrum workbench mounted but hidden');
  await workbench.getByText('RHEA:10020', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('ATF2', { exact: true }).waitFor({ state: 'visible' });
  await assertDelegatedPanelMeta('biochemistry');
  assert.equal(await workbench.locator('.bioactivity-evidence').isVisible(), false, 'biochemistry keeps inactive bioactivity hidden');
  assert.equal(await workbench.locator('.structure-evidence').isVisible(), false, 'biochemistry keeps inactive protein structures hidden');

  const bioactivityChapter = chapterNavigation.getByRole('button', { name: /活性与靶点/ });
  await bioactivityChapter.click();
  await workbench.getByRole('tab', { name: /PubChem BioAssay/ }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('Fixture cell viability assay', { exact: true }).waitFor({ state: 'visible' });
  await workbench.getByRole('tab', { name: /ChEMBL/ }).click();
  await workbench.getByText('Fixture ChEMBL target', { exact: true }).waitFor({ state: 'visible' });
  await assertDelegatedPanelMeta('bioactivity');
  assert.equal(await workbench.locator('.biochemical-relationships').isHidden(), true, 'bioactivity keeps cached biochemistry hidden');
  assert.equal(await workbench.locator('.biological-context').isHidden(), true, 'bioactivity keeps cached biological context hidden');

  const structuresChapter = chapterNavigation.getByRole('button', { name: /蛋白结构/ });
  await structuresChapter.click();
  await workbench.getByText('PDB 1ABC', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('AF-P12345-F1', { exact: true }).waitFor({ state: 'visible' });
  await assertDelegatedPanelMeta('protein structures');
  assert.equal(await workbench.locator('.bioactivity-evidence').isHidden(), true, 'protein structures keeps cached bioactivity hidden');
  assert.equal(await workbench.locator('.biochemical-relationships').isHidden(), true, 'protein structures keeps cached biochemistry hidden');

  const expectedScientificQueries = {
    '/spectra/search': { inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N', cas: '141-78-6', smiles: 'CCOC(=O)C', name: 'Fema canonical name' },
    '/nist-webbook': { cas: '141-78-6' },
    '/biochemistry/resolve': { inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N', cas: '141-78-6', name: 'Fema canonical name' },
    '/biological-context/resolve': { inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N', cas: '141-78-6', name: 'Fema canonical name' },
    '/bioactivity/resolve': { cid: '8857', inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N', smiles: 'CCOC(=O)C' },
    '/structures/resolve': { inchikey: 'XEKOWRVHYACXOJ-UHFFFAOYSA-N', cas: '141-78-6', name: 'Fema canonical name' },
  };
  const assertScientificQueries = (requests, owner) => {
    for (const [pathname, expected] of Object.entries(expectedScientificQueries)) {
      const matching = requests.filter(request => request.path === pathname);
      assert.ok(matching.length > 0, `${owner}: ${pathname} was requested`);
      for (const request of matching) {
        assert.deepEqual(Object.fromEntries(new URL(request.url).searchParams), expected, `${owner}: ${pathname} uses canonical query parameters`);
      }
    }
  };
  assertScientificQueries(apiRequests, 'new dossier');

  await spectraChapter.click();
  await workbench.getByText('MassBank · MB-FIXTURE-2', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const comparisonButtons = workbench.getByRole('button', { name: '加入比较' });
  await comparisonButtons.nth(0).click();
  await workbench.getByText(/A · MassBank · MB-FIXTURE-1/).first().waitFor({ state: 'visible' });
  await comparisonButtons.nth(1).click();
  await workbench.getByText(/谱图载入失败/).waitFor({ state: 'visible' });
  assert.deepEqual(pageErrors, [], 'failed comparison detail is handled without an unhandled rejection');
  const compareRequestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/spectra/compare');
  await comparisonButtons.nth(1).click();
  await compareRequestStarted;
  const compareAbortObserved = page.waitForEvent('requestfailed', {
    predicate: request => new URL(request.url()).pathname === '/spectra/compare',
    timeout: 2_500,
  }).then(() => true).catch(() => false);
  const unmountDetailStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/spectra/MassBank/MB-FIXTURE-3');
  await workbench.locator('.spectrum-record-main').nth(2).click();
  await unmountDetailStarted;
  const detailAbortObserved = page.waitForEvent('requestfailed', {
    predicate: request => new URL(request.url()).pathname === '/spectra/MassBank/MB-FIXTURE-3',
    timeout: 2_500,
  }).then(() => true).catch(() => false);

  const citationChapter = chapterNavigation.getByRole('button', { name: /引用与导出/ });
  await citationChapter.click();
  const [detailWasAborted, compareWasAborted] = await Promise.all([detailAbortObserved, compareAbortObserved]);
  assert.equal(detailWasAborted, false, 'leaving spectra keeps the cached record detail request alive');
  assert.equal(compareWasAborted, false, 'leaving spectra keeps the cached comparison request alive');
  await workbench.getByRole('heading', { name: '引用与导出', level: 4 }).waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__clipboardFixture = { pending: [], resetTimerCreations: 0 };
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => new Promise((resolve, reject) => window.__clipboardFixture.pending.push({ resolve, reject })),
    });
  });
  const copyCitationButton = workbench.getByRole('button', { name: '复制引用' });
  await copyCitationButton.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__clipboardFixture.pending.length === 2);
  await page.evaluate(() => window.__clipboardFixture.pending[1].reject(new Error('latest clipboard request denied')));
  await workbench.getByText('复制失败', { exact: true }).waitFor({ state: 'visible' });
  await page.evaluate(() => window.__clipboardFixture.pending[0].resolve());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await workbench.getByText('复制失败', { exact: true }).count(), 1, 'an older clipboard promise cannot overwrite the latest failure');
  assert.equal(await workbench.getByText('引用已复制', { exact: true }).count(), 0, 'stale clipboard success remains ignored');

  await workbench.getByRole('button', { name: '复制引用' }).click();
  await page.waitForFunction(() => window.__clipboardFixture.pending.length === 3);
  await page.evaluate(() => window.__clipboardFixture.pending[2].resolve());
  await workbench.getByRole('button', { name: '已复制' }).waitFor({ state: 'visible' });

  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 2_000) window.__clipboardFixture.resetTimerCreations += 1;
      return nativeSetTimeout(callback, delay, ...args);
    };
  });
  await workbench.getByRole('button', { name: '已复制' }).click();
  await page.waitForFunction(() => window.__clipboardFixture.pending.length === 4);
  const thresholdChapterForClipboardUnmount = chapterNavigation.getByRole('button', { name: /阈值/ });
  await thresholdChapterForClipboardUnmount.click();
  await page.evaluate(() => window.__clipboardFixture.pending[3].resolve());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__clipboardFixture.resetTimerCreations), 0, 'a clipboard promise settling after unmount creates no reset timer');
  await citationChapter.click();
  await workbench.getByRole('heading', { name: '引用与导出', level: 4 }).waitFor({ state: 'visible' });
  const captureDownload = async click => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    return {
      bytes: readFileSync(await download.path()),
      suggestedFilename: download.suggestedFilename(),
    };
  };
  const newExports = {
    compact: await captureDownload(() => workbench.getByRole('button', { name: '导出精简版 CSV' }).click()),
    detailed: await captureDownload(() => workbench.getByRole('button', { name: '导出详细版 CSV' }).click()),
  };
  for (const [mode, download] of Object.entries(newExports)) {
    assert.ok(download.bytes.length > 0, `new ${mode} export is non-empty`);
    assert.match(download.bytes.toString('utf8'), /CAS/, `new ${mode} export contains the CAS header`);
    assert.match(download.suggestedFilename, mode === 'compact' ? /(compact|精简版).*\.csv$/i : /(detailed|详细版).*\.csv$/i, `new ${mode} export filename identifies its mode`);
  }
  assert.notEqual(Buffer.compare(newExports.compact.bytes, newExports.detailed.bytes), 0, 'compact and detailed exports contain different content');

  const thresholdChapter = chapterNavigation.getByRole('button', { name: /阈值/ });
  await thresholdChapter.focus();
  await page.keyboard.press('Enter');
  assert.equal(await thresholdChapter.getAttribute('aria-current'), 'page', 'clicked chapter becomes current');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await thresholdChapter.evaluate(element => element === document.activeElement), true, 'keyboard focus returns to the active chapter');
  const focusBoxShadow = await thresholdChapter.evaluate(element => getComputedStyle(element).boxShadow);
  assert.match(focusBoxShadow, /rgb\(255, 255, 255\)/, 'focus treatment includes a white inner ring');
  assert.match(focusBoxShadow, /rgb\(30, 58, 138\)/, 'focus treatment includes a dark cobalt outer ring');

  const rawRecordButton = workbench.getByRole('button', { name: /原始记录/ }).first();
  await rawRecordButton.waitFor({ state: 'visible' });
  assert.equal(await rawRecordButton.getAttribute('aria-expanded'), 'false', 'raw evidence is collapsed by default');
  const collapsedBackmanText = await rawRecordButton.textContent();
  assert.equal(
    collapsedBackmanText.match(/Backman \(1917\)/g)?.length,
    1,
    'collapsed threshold shows the actual source once without repeating it in metadata',
  );
  assert.match(collapsedBackmanText, /本地.*空气.*识别阈/, 'collapsed threshold retains origin kind, medium, and type');
  for (let remainingControl = 0; remainingControl < 15; remainingControl += 1) {
    await page.keyboard.press('Tab');
  }
  assert.equal(
    await rawRecordButton.evaluate(element => element === document.activeElement),
    true,
    'Tab moves keyboard focus through chapter filters to the disclosure button',
  );
  const disclosureFocusStyle = await rawRecordButton.locator('..').evaluate(element => ({
    boxShadow: getComputedStyle(element).boxShadow,
    outlineStyle: getComputedStyle(element).outlineStyle,
  }));
  assert.match(disclosureFocusStyle.boxShadow, /rgb\(255, 255, 255\)/, 'disclosure boundary has a visible white inner focus ring');
  assert.match(disclosureFocusStyle.boxShadow, /rgb\(30, 58, 138\)/, 'disclosure boundary has a visible cobalt outer focus ring');
  await page.keyboard.press('Enter');
  assert.equal(await rawRecordButton.getAttribute('aria-expanded'), 'true', 'Enter expands raw evidence');
  assert.equal(
    await rawRecordButton.locator('..').getByText('结构化数值', { exact: true }).count(),
    0,
    'a threshold range does not expose a fabricated structured single value',
  );

  const thresholdPanel = workbench.locator('.threshold-evidence-chapter');
  const waterFilter = thresholdPanel.getByRole('button', { name: '水', exact: true });
  const recognitionFilter = thresholdPanel.getByRole('button', { name: /识别阈/ });
  await waterFilter.click();
  await recognitionFilter.click();
  assert.equal(await waterFilter.getAttribute('aria-pressed'), 'true', 'water medium filter is selected');
  await thresholdPanel.getByText('当前筛选下无记录', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(
    await thresholdPanel.getByText('当前匹配项暂无阈值证据。', { exact: true }).count(),
    0,
    'filter-empty state is distinct from source no-data',
  );
  const sensoryChapter = chapterNavigation.getByRole('button', { name: /感官/ });
  await sensoryChapter.click();
  const sensoryPanel = workbench.locator('.sensory-sources-chapter');
  const allSensorySources = sensoryPanel.getByRole('button', { name: '全部来源', exact: true });
  const allSensoryKinds = sensoryPanel.getByRole('button', { name: '全部信息类型', exact: true });
  const femaFilter = sensoryPanel.getByRole('button', { name: 'FEMA', exact: true });
  const flavorDbFilter = sensoryPanel.getByRole('button', { name: 'FlavorDB2', exact: true });
  const odorFilter = sensoryPanel.getByRole('button', { name: '气味', exact: true });
  assert.equal(await allSensorySources.getAttribute('aria-pressed'), 'true', 'sensory source filter starts at explicit all');
  assert.equal(await allSensoryKinds.getAttribute('aria-pressed'), 'true', 'sensory kind filter starts at explicit all');
  assert.equal(await femaFilter.getAttribute('aria-pressed'), 'false', 'specific sensory sources are distinct from explicit all');
  assert.equal(await sensoryPanel.getByRole('heading', { name: 'FEMA', exact: true }).count(), 1, 'FEMA evidence has its own group');
  assert.equal(await sensoryPanel.getByRole('heading', { name: 'FlavorDB2', exact: true }).count(), 1, 'FlavorDB2 evidence has its own group');
  await flavorDbFilter.click();
  await odorFilter.click();
  assert.equal(await flavorDbFilter.getAttribute('aria-pressed'), 'true', 'FlavorDB2 source can be selected independently');
  assert.equal(await odorFilter.getAttribute('aria-pressed'), 'true', 'odor kind can be selected independently');
  assert.equal(await sensoryPanel.getByRole('heading', { name: 'FEMA', exact: true }).count(), 0, 'source filter excludes the FEMA group');
  await sensoryPanel.getByText('pineapple', { exact: true }).waitFor({ state: 'visible' });
  await thresholdChapter.click();
  assert.equal(await waterFilter.getAttribute('aria-pressed'), 'true', 'threshold medium filter survives chapter switching');
  assert.equal(await recognitionFilter.getAttribute('aria-pressed'), 'true', 'threshold type filter survives chapter switching');
  await sensoryChapter.click();
  assert.equal(await flavorDbFilter.getAttribute('aria-pressed'), 'true', 'sensory source filter survives chapter switching');
  assert.equal(await odorFilter.getAttribute('aria-pressed'), 'true', 'sensory kind filter survives chapter switching');
  await thresholdChapter.click();
  const allMediaFilter = thresholdPanel.getByRole('button', { name: '全部介质', exact: true });
  const allTypeFilter = thresholdPanel.getByRole('button', { name: '全部类型', exact: true });
  await allMediaFilter.click();
  await allTypeFilter.click();
  const bookFilterButton = thresholdPanel.getByRole('button', { name: '书籍记录', exact: true });
  await bookFilterButton.click();
  const bookDisclosure = thresholdPanel.getByRole('button', { name: /水中觉察嗅阈值0\.6μg\/L/ }).first();
  await bookDisclosure.waitFor({ state: 'visible' });
  assert.match(
    await bookDisclosure.textContent(),
    /酒类风味化学.*第 182 页.*书籍.*水.*odor/,
    'collapsed book threshold supplies real source and page when the original title does not',
  );
  await bookDisclosure.click();
  const bookEvidence = thresholdPanel.locator('.evidence-record-disclosure').filter({ hasText: '水中觉察嗅阈值0.6μg/L' }).first();
  await bookEvidence.getByText('酒类风味化学', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('水', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('odor', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('μg/L', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('原值', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('0.6pg/L', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('修正值', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('0.6μg/L', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('verified_against_source_page', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('乙酸乙酯', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('source_verified_context_subject', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('page-182.jpg', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await bookEvidence.getByText('[object Object]', { exact: true }).count(), 0, 'lineage never stringifies objects implicitly');
  await allTypeFilter.click();
  await rawRecordButton.focus();

  const viewportMetrics = {};
  for (const width of [1440, 1024, 768, 375]) {
    viewportMetrics[width] = await inspectViewport(page, width, {
      screenshot: `search-workbench-${width}.png`,
      requireChapterScroll: width <= 768,
    });
  }
  const mobileDisclosureShadow = await rawRecordButton.locator('..').evaluate(
    element => getComputedStyle(element).boxShadow,
  );
  assert.match(mobileDisclosureShadow, /rgb\(255, 255, 255\)/, 'mobile disclosure focus keeps its white inner ring');
  assert.match(mobileDisclosureShadow, /rgb\(30, 58, 138\)/, 'mobile disclosure focus keeps its cobalt outer ring');
  const accessibilityAudit = await inspectAccessibility(page);
  const contrastAudit = await inspectContrast(page);
  await rawRecordButton.focus();
  const tabOrderEvidence = [];
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    tabOrderEvidence.push(await page.evaluate(() => {
      const active = document.activeElement;
      return `${active?.tagName || ''}:${active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 32) || active?.id || ''}`;
    }));
  }
  assert.ok(new Set(tabOrderEvidence).size >= 10, 'Tab order advances through the workbench without a focus trap');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.waitForLoadState('networkidle');
  const isClassicRequest = request => classicEndpointPrefixes.some(prefix => request.path.startsWith(prefix));
  const sharedCounts = () => Object.fromEntries(['/fema', '/compound'].map(pathname => [
    pathname,
    apiRequests.filter(request => request.path === pathname).length,
  ]));
  const newChapterRequestsBeforeClassic = apiRequests.filter(isClassicRequest);
  assert.deepEqual(
    [...new Set(newChapterRequestsBeforeClassic.map(request => request.path))].sort(),
    [
      '/bioactivity/resolve',
      '/biochemistry/resolve',
      '/biological-context/resolve',
      '/nist-webbook',
      '/spectra/MassBank/MB-FIXTURE-1',
      '/spectra/MassBank/MB-FIXTURE-2',
      '/spectra/MassBank/MB-FIXTURE-3',
      '/spectra/compare',
      '/spectra/search',
      '/structures/resolve',
    ],
    'new dossier requests each heavy source only after its owning chapter is visited',
  );
  assert.equal(await page.getByTestId('classic-search-results').count(), 0, 'classic result marker is absent in the new dossier');
  const sharedBeforeClassic = sharedCounts();
  await classicButton.focus();
  await page.keyboard.press('Enter');
  const classicResults = page.getByTestId('classic-search-results');
  await classicResults.waitFor({ state: 'attached' });
  await page.getByText('CAS 141-78-6', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const classicRequestsAfterMount = apiRequests.filter(isClassicRequest);
  assert.ok(classicRequestsAfterMount.length > newChapterRequestsBeforeClassic.length, 'classic heavy requests begin when the classic tree is first mounted');
  assert.deepEqual(sharedCounts(), sharedBeforeClassic, 'switching to classic does not repeat App-level shared lookups');
  const exportMenu = page.locator('.search-toolbar-export');
  await exportMenu.locator('.result-export-button').click();
  const classicCompact = await captureDownload(() => exportMenu.getByRole('menuitem', { name: /精简版/ }).click());
  await exportMenu.locator('.result-export-button').click();
  const classicDetailed = await captureDownload(() => exportMenu.getByRole('menuitem', { name: /详细版/ }).click());
  for (const [mode, download] of Object.entries({ compact: classicCompact, detailed: classicDetailed })) {
    assert.ok(download.bytes.length > 0, `classic ${mode} export is non-empty`);
    assert.match(download.bytes.toString('utf8'), /CAS/, `classic ${mode} export contains the CAS header`);
    assert.match(download.suggestedFilename, mode === 'compact' ? /(compact|精简版).*\.csv$/i : /(detailed|详细版).*\.csv$/i, `classic ${mode} export filename identifies its mode`);
  }
  assert.notEqual(Buffer.compare(newExports.compact.bytes, classicCompact.bytes), 0, 'new compact CSV uses its fixed dossier evidence contract');
  assert.notEqual(Buffer.compare(newExports.detailed.bytes, classicDetailed.bytes), 0, 'new detailed CSV uses its fixed dossier evidence contract');
  assertScientificQueries(apiRequests, 'classic and new dossier requests');
  const pubchemFilter = page.locator('[data-filter-key="pubchem"]');
  const bookFilter = page.locator('[data-filter-key="book"]');
  assert.equal(await pubchemFilter.getAttribute('aria-pressed'), 'true', 'classic PubChem filter starts enabled');
  assert.equal(await bookFilter.getAttribute('aria-pressed'), 'true', 'classic book filter starts enabled');
  await pubchemFilter.click();
  await bookFilter.click();

  await newButton.focus();
  await page.keyboard.press('Enter');
  await workbench.waitFor();
  await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await workbench.getByText('8857', { exact: true }).count(), 1, 'new dossier keeps PubChem identity when the classic filter is disabled');
  const citationCount = Number(await workbench
    .getByRole('button', { name: /引用与导出/ })
    .locator('.chapter-navigation__meta span')
    .first()
    .textContent());
  assert.ok(citationCount > 0, 'new dossier keeps book evidence when the classic filter is disabled');
  assert.equal(await page.getByTestId('classic-search-results').count(), 0, 'classic result marker is removed after returning to the new dossier');
  assert.equal(await page.locator('.open-spectra-workbench').count(), 0, 'classic-only components are removed after returning to the new dossier');
  assert.deepEqual(sharedCounts(), sharedBeforeClassic, 'returning to the new dossier does not repeat App-level shared lookups');
  await exportMenu.locator('.result-export-button').click();
  const newCompactAfterClassicFilters = await captureDownload(() => exportMenu.getByRole('menuitem', { name: /精简版/ }).click());
  await exportMenu.locator('.result-export-button').click();
  const newDetailedAfterClassicFilters = await captureDownload(() => exportMenu.getByRole('menuitem', { name: /详细版/ }).click());
  assert.equal(Buffer.compare(newExports.compact.bytes, newCompactAfterClassicFilters.bytes), 0, 'new compact CSV ignores hidden classic filters');
  assert.equal(Buffer.compare(newExports.detailed.bytes, newDetailedAfterClassicFilters.bytes), 0, 'new detailed CSV ignores hidden classic filters');
  assert.match(newDetailedAfterClassicFilters.bytes.toString('utf8'), /PubChem CID/, 'new detailed CSV retains fixed PubChem fields');
  assert.match(newDetailedAfterClassicFilters.bytes.toString('utf8'), /书籍来源/, 'new detailed CSV retains fixed book fields');

  await input.fill('对叔丁基苯甲醛');
  const candidateHeading = workbench.getByRole('heading', { name: '请选择匹配实体' });
  await candidateHeading.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await workbench.locator('.compound-identity-header').count(), 0, 'ambiguous matches do not render an identity before selection');
  assert.equal(await workbench.getByRole('navigation', { name: '档案章节' }).count(), 0, 'ambiguous matches do not render chapters before selection');
  const firstCandidate = workbench.getByRole('button', { name: /939-97-9/ });
  const secondCandidate = workbench.getByRole('button', { name: /18127-01-0/ });
  assert.equal(await firstCandidate.count(), 1, 'first CAS candidate is listed');
  assert.equal(await secondCandidate.count(), 1, 'second CAS candidate is listed');
  await page.waitForLoadState('networkidle');
  const requestCountFor = (pathname, cas) => apiRequests.filter(request => (
    request.path === pathname && new URL(request.url).searchParams.get('cas') === cas
  )).length;
  const requestsBeforeSelection = {
    compound: requestCountFor('/compound', '18127-01-0'),
    fema: requestCountFor('/fema', '18127-01-0'),
  };
  assert.equal(requestsBeforeSelection.compound, 0, 'second compound candidate is not prefetched');
  assert.equal(requestsBeforeSelection.fema, 0, 'second FEMA candidate is not prefetched');
  await secondCandidate.focus();
  await page.keyboard.press('Enter');
  await workbench.getByText('CAS 18127-01-0', { exact: true }).waitFor({ state: 'visible' });
  const selectedDossierHeading = workbench.locator('.compound-identity-header h2');
  assert.equal(await selectedDossierHeading.evaluate(node => document.activeElement === node), true, 'candidate selection focuses the dossier heading');
  await workbench.getByText('18127010', { exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(({ origin }) => {
    const entries = performance.getEntriesByType('resource').map(entry => entry.name);
    return entries.some(url => url.startsWith(origin) && url.includes('/fema?cas=18127-01-0'));
  }, { origin: proxyOrigin });
  const requestsAfterSelection = {
    compound: requestCountFor('/compound', '18127-01-0'),
    fema: requestCountFor('/fema', '18127-01-0'),
  };
  assert.equal(requestsAfterSelection.compound, 1, 'selected compound candidate is fetched once');
  assert.equal(requestsAfterSelection.fema, 1, 'selected FEMA candidate is fetched once');
  const singleMatchMode = page.getByRole('group', { name: '匹配方式' });
  await singleMatchMode.getByRole('button', { name: '模糊', exact: true }).click();
  await candidateHeading.waitFor({ state: 'visible' });
  assert.equal(await workbench.locator('.compound-identity-header').count(), 0, 'changing single-search match mode clears the selected identity');
  await singleMatchMode.getByRole('button', { name: '精确', exact: true }).click();
  await candidateHeading.waitFor({ state: 'visible' });
  await secondCandidate.click();
  await workbench.getByText('CAS 18127-01-0', { exact: true }).waitFor({ state: 'visible' });
  selectedCandidateRequestEvidence = {
    cas: '18127-01-0',
    beforeSelection: requestsBeforeSelection,
    afterSelection: requestsAfterSelection,
  };
  const selectedSourceSummary = workbench.getByLabel('来源状态');
  assert.equal(await selectedSourceSummary.getByText('载入中', { exact: true }).count(), 0, 'selected candidate sources leave loading state');
  assert.equal(await workbench.getByText('CAS 939-97-9', { exact: true }).count(), 0, 'selected dossier excludes the other entity identity');
  await workbench.getByRole('button', { name: /阈值/ }).click();
  const selectedThresholdPanel = workbench.locator('.threshold-evidence-chapter');
  assert.equal(
    await selectedThresholdPanel.getByRole('button', { name: '全部介质', exact: true }).getAttribute('aria-pressed'),
    'true',
    'new entity resets medium filter',
  );
  assert.equal(
    await selectedThresholdPanel.getByRole('button', { name: '全部类型', exact: true }).getAttribute('aria-pressed'),
    'true',
    'new entity resets threshold type filter',
  );
  await workbench.getByRole('button', { name: /感官/ }).click();
  const selectedSensoryPanel = workbench.locator('.sensory-sources-chapter');
  assert.equal(
    await selectedSensoryPanel.getByRole('button', { name: '全部来源', exact: true }).getAttribute('aria-pressed'),
    'true',
    'new entity resets sensory source filter',
  );
  assert.equal(
    await selectedSensoryPanel.getByRole('button', { name: '全部信息类型', exact: true }).getAttribute('aria-pressed'),
    'true',
    'new entity resets sensory kind filter',
  );
  await workbench.getByRole('button', { name: /阈值/ }).click();
  assert.equal(await workbench.getByText('939-97-9', { exact: false }).count(), 0, 'selected threshold chapter excludes the other entity CAS');

  await input.fill('164524-93-0');
  await workbench.getByText('CAS 164524-93-0', { exact: true }).waitFor({ state: 'visible' });
  await workbench.getByRole('button', { name: /阈值/ }).click();
  const crossReferenceThresholdPanel = workbench.locator('.threshold-evidence-chapter');
  assert.equal(
    await crossReferenceThresholdPanel.locator('.evidence-record-disclosure__summary').filter({ hasText: '1506-02-1' }).count(),
    0,
    'foreign target CAS is not rendered as a threshold title for the current compound',
  );

  await input.fill('141-78-6');
  await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor({ state: 'visible' });
  await input.fill('对叔丁基苯甲醛');
  await candidateHeading.waitFor({ state: 'visible' });
  assert.equal(await workbench.locator('.compound-identity-header').count(), 0, 'a new query clears the previous candidate selection');

  await page.getByRole('button', { name: '批量匹配' }).click();
  const bulkInput = page.getByLabel('请输入需要匹配的物质名单（每行一个记录）');
  await bulkInput.fill('141-78-6\n64-17-5\nunknown');
  const batchReview = workbench.getByRole('region', { name: '批量审查结果' });
  await batchReview.waitFor({ state: 'visible', timeout: 30_000 });
  const initialBatchRows = batchReview.locator('tbody tr');
  await initialBatchRows.first().waitFor({ state: 'visible' });
  assert.equal(await initialBatchRows.count(), 3, 'batch review keeps one row per non-empty raw input');
  assert.deepEqual(
    await initialBatchRows.evaluateAll(rows => rows.map(row => row.dataset.status)),
    ['exact', 'exact', 'unmatched'],
    'batch review labels exact, exact, and unmatched rows in input order',
  );
  assert.equal(await batchReview.getByRole('button', { name: '查看档案' }).count(), 2, 'only uniquely matched rows can open a dossier');
  assert.equal(await initialBatchRows.filter({ hasText: 'unknown' }).getByRole('button', { name: '查看档案' }).count(), 0, 'unmatched rows cannot open a dossier');
  assert.equal(await batchReview.getByRole('columnheader').count(), 7, 'batch results keep semantic table headers');
  e2eStages.push('batch-basic');

  await page.setViewportSize({ width: 390, height: 900 });
  const batchMobileDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(batchMobileDimensions.scrollWidth <= batchMobileDimensions.clientWidth, 'mobile batch table does not create page-level overflow');
  const batchTableDimensions = await batchReview.locator('.batch-review__table-scroll').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(batchTableDimensions.scrollWidth > batchTableDimensions.clientWidth, 'mobile batch table owns its horizontal overflow');
  const batchControlHeights = await batchReview.locator('button, select').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  assert.ok(batchControlHeights.every(height => height >= 44), 'mobile batch controls are at least 44px high');
  await page.setViewportSize({ width: 1440, height: 900 });

  const candidateFilter = batchReview.getByRole('button', { name: '候选', exact: true });
  await candidateFilter.click();
  assert.equal(await batchReview.getByText('当前筛选条件下没有结果。', { exact: true }).count(), 1, 'empty filtered state explains why no rows are shown');

  const unmatchedFilter = batchReview.getByRole('button', { name: '未匹配', exact: true });
  await unmatchedFilter.click();
  assert.equal(await unmatchedFilter.getAttribute('aria-pressed'), 'true', 'unmatched filter exposes active state');
  assert.equal(await batchReview.locator('tbody tr').count(), 1, 'unmatched filter hides matched rows');
  assert.match(await batchReview.locator('tbody tr').first().innerText(), /unknown/, 'unmatched filter retains the unresolved raw input');
  const noCoverageFilter = batchReview.getByRole('button', { name: '无数据', exact: true });
  const allCoverageFilter = batchReview.getByRole('button', { name: '全部覆盖', exact: true });
  await noCoverageFilter.click();
  assert.equal(await noCoverageFilter.getAttribute('aria-pressed'), 'true', 'no-data coverage filter exposes active state');
  assert.match(await batchReview.locator('tbody tr').first().innerText(), /unknown/, 'no-data coverage filter retains the uncovered row');
  await allCoverageFilter.click();
  const batchSort = batchReview.getByLabel('排序方式');
  await batchSort.selectOption('reviewPriority');
  assert.equal(await batchSort.inputValue(), 'reviewPriority', 'batch sort exposes the active review-priority choice');

  await bulkInput.fill('对叔丁基苯甲醛');
  const ambiguousBatchRow = batchReview.locator('tbody tr').filter({ hasText: '对叔丁基苯甲醛' });
  await ambiguousBatchRow.waitFor({ state: 'visible' });
  assert.equal(await ambiguousBatchRow.getAttribute('data-status'), 'conflict', 'same-name multi-CAS input is explicitly marked as a conflict');
  const ambiguousChoices = ambiguousBatchRow.locator('.batch-review__candidate-choice');
  assert.ok(await ambiguousChoices.count() >= 2, 'conflict exposes each distinct CAS candidate');
  const ambiguousBatchRowId = await ambiguousBatchRow.getAttribute('data-row-id');
  await ambiguousChoices.first().click();
  const ambiguousDossierButton = ambiguousBatchRow.getByRole('button', { name: '查看档案' });
  assert.equal(await ambiguousDossierButton.count(), 1, 'explicit candidate selection enables dossier opening');
  await page.waitForFunction(rowId => document.activeElement?.dataset?.batchActionRowId === rowId, ambiguousBatchRowId);
  assert.equal(await ambiguousDossierButton.evaluate(node => document.activeElement === node), true, 'conflict candidate selection focuses the newly enabled View dossier action');
  await ambiguousDossierButton.click();
  await workbench.locator('.compound-identity-header').waitFor({ state: 'visible' });
  await workbench.getByRole('button', { name: '返回批量结果' }).click();
  await batchReview.waitFor({ state: 'visible' });
  e2eStages.push('batch-ambiguous');

  const matchModeGroup = page.getByRole('group', { name: '匹配方式' });
  const exactModeButton = matchModeGroup.getByRole('button', { name: '精确', exact: true });
  const fuzzyModeButton = matchModeGroup.getByRole('button', { name: '模糊', exact: true });
  await bulkInput.fill('ethyl acetate');
  const exactEthylAcetateRow = batchReview.locator('tbody tr').filter({ hasText: 'ethyl acetate' });
  await exactEthylAcetateRow.waitFor({ state: 'visible' });
  await exactEthylAcetateRow.getByRole('button', { name: '查看档案' }).click();
  await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('返回批量结果'));

  await fuzzyModeButton.click();
  await batchReview.waitFor({ state: 'visible' });
  await batchReview.locator('tbody tr').filter({ hasText: 'ethyl acetate' }).waitFor({ state: 'visible' });
  assert.equal(await workbench.locator('.compound-identity-header').count(), 0, 'fuzzy mode starts a fresh batch review instead of reviving the exact dossier');
  assert.equal(await fuzzyModeButton.getAttribute('aria-pressed'), 'true', 'fuzzy mode exposes its active state');
  assert.equal(await fuzzyModeButton.evaluate(element => document.activeElement === element), true, 'focus remains on the fuzzy mode control after the batch session reset');

  await exactModeButton.click();
  await batchReview.waitFor({ state: 'visible' });
  const resetExactEthylAcetateRow = batchReview.locator('tbody tr').filter({ hasText: 'ethyl acetate' });
  await resetExactEthylAcetateRow.waitFor({ state: 'visible' });
  assert.equal(await workbench.locator('.compound-identity-header').count(), 0, 'returning to exact mode stays in review until the user chooses a dossier again');
  assert.equal(await exactModeButton.getAttribute('aria-pressed'), 'true', 'exact mode exposes its active state after the round trip');
  assert.equal(await exactModeButton.evaluate(element => document.activeElement === element), true, 'focus remains on the exact mode control after the batch session reset');
  await resetExactEthylAcetateRow.getByRole('button', { name: '查看档案' }).click();
  await workbench.getByText('CAS 141-78-6', { exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('返回批量结果'));
  batchReviewEvidence.matchModeRoundTrip = {
    input: 'ethyl acetate',
    exactOpened: true,
    fuzzyReturnedToReview: true,
    exactReturnedToReview: true,
    reopenedOnlyAfterClick: true,
    dossierFocus: '返回批量结果',
  };
  e2eStages.push('batch-match-mode-reset');
  await workbench.getByRole('button', { name: '返回批量结果' }).click();
  await batchReview.waitFor({ state: 'visible' });

  await fuzzyModeButton.click();
  await bulkInput.fill('ethyl acet');
  const fuzzyAmbiguousRow = batchReview.locator('tbody tr').filter({ hasText: 'ethyl acet' });
  await fuzzyAmbiguousRow.waitFor({ state: 'visible' });
  assert.equal(await fuzzyAmbiguousRow.getAttribute('data-status'), 'conflict', 'partial real-name multi-CAS input becomes a conflict');
  const fuzzyChoices = fuzzyAmbiguousRow.locator('.batch-review__candidate-choice');
  assert.ok(await fuzzyChoices.count() >= 2, 'fuzzy conflict exposes candidate choices');
  batchReviewEvidence.fuzzy = { input: 'ethyl acet', status: 'conflict', candidateCount: await fuzzyChoices.count() };
  e2eStages.push('batch-fuzzy-ambiguous');
  await exactModeButton.click();

  const compoundLimitInputs = [
    '103-84-4',
    '64-19-7',
    '108-24-7',
    '98-86-2',
    '122-00-9',
    '22047-25-2',
    '1072-83-9',
    '85213-22-5',
    '24295-03-2',
    '523-80-8',
    '29926-41-8',
  ];
  const lateSelectedCas = compoundLimitInputs.at(-1);
  await bulkInput.fill(compoundLimitInputs.join('\n'));
  const lateSelectedRow = batchReview.locator('tbody tr').filter({ hasText: lateSelectedCas });
  await lateSelectedRow.waitFor({ state: 'visible' });
  await page.waitForFunction(({ origin, expectedCas }) => {
    const requests = performance.getEntriesByType('resource').map(entry => entry.name);
    return expectedCas.every(cas => requests.some((url) => {
      if (!url.startsWith(origin) || !url.includes('/compound?')) return false;
      return new URL(url).searchParams.get('cas') === cas;
    }));
  }, { origin: proxyOrigin, expectedCas: compoundLimitInputs.slice(0, 10) });
  assert.equal(requestCountFor('/compound', lateSelectedCas), 0, 'the eleventh bulk CAS is outside the initial compound prefetch');
  await lateSelectedRow.getByRole('button', { name: '查看档案' }).click();
  await workbench.getByText(`CAS ${lateSelectedCas}`, { exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(({ origin, cas }) => performance.getEntriesByType('resource').some((entry) => {
    if (!entry.name.startsWith(origin) || !entry.name.includes('/compound?')) return false;
    return new URL(entry.name).searchParams.get('cas') === cas;
  }), { origin: proxyOrigin, cas: lateSelectedCas });
  await page.waitForFunction(() => {
    const summary = document.querySelector('[aria-label="来源状态"]');
    return summary && !summary.textContent.includes('载入中');
  });
  assert.equal(requestCountFor('/compound', lateSelectedCas), 1, 'opening the eleventh bulk row requests its compound profile once');
  bulkLimitRequestEvidence = {
    cas: lateSelectedCas,
    initialPosition: 11,
    compoundRequestsBeforeSelection: 0,
    compoundRequestsAfterSelection: requestCountFor('/compound', lateSelectedCas),
    loadingCleared: true,
  };
  e2eStages.push('batch-late-selected-request');
  await workbench.getByRole('button', { name: '返回批量结果' }).click();
  await batchReview.waitFor({ state: 'visible' });

  const paginatedInputs = Array.from({ length: 50 }, (_, index) => index % 2 === 0 ? '141-78-6' : '64-17-5');
  await bulkInput.fill(paginatedInputs.join('\n'));
  const exactFilter = batchReview.getByRole('button', { name: '精确', exact: true });
  const hasCoverageFilter = batchReview.getByRole('button', { name: '有数据', exact: true });
  await exactFilter.click();
  await hasCoverageFilter.click();
  await batchSort.selectOption('coverage');
  const directionButton = batchReview.getByRole('button', { name: /排序方向/ });
  await directionButton.click();
  assert.equal(await directionButton.getAttribute('aria-pressed'), 'true', 'descending sort direction exposes active state');
  await batchReview.getByRole('button', { name: '下一页' }).click();
  await noCoverageFilter.click();
  assert.equal(await batchReview.getByTestId('batch-page-label').innerText(), '第 1 页，共 1 页', 'coverage filtering clamps an out-of-range page');
  await hasCoverageFilter.click();
  await batchReview.getByRole('button', { name: '下一页' }).click();
  const savedPageLabel = await batchReview.getByTestId('batch-page-label').innerText();
  assert.match(savedPageLabel, /第 2 页，共 2 页/, 'batch pagination reaches the second page');
  const selectedBatchRow = batchReview.locator('tbody tr').last();
  const selectedBatchRowId = await selectedBatchRow.getAttribute('data-row-id');
  await selectedBatchRow.scrollIntoViewIfNeeded();
  const savedBatchRowTop = await selectedBatchRow.evaluate(row => row.getBoundingClientRect().top);
  const savedBatchScrollY = await page.evaluate(() => window.scrollY);
  assert.ok(savedBatchScrollY > 0, 'batch dossier navigation starts from a real scrolled position');
  await selectedBatchRow.getByRole('button', { name: '查看档案' }).click();
  const batchBackButton = workbench.getByRole('button', { name: '返回批量结果' });
  await batchBackButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('返回批量结果'));
  batchReviewEvidence.dossierFocus = '返回批量结果';
  assert.equal(await workbench.locator('.compound-identity-header').count(), 1, 'batch detail renders exactly one compound identity header');
  assert.equal(await batchReview.count(), 0, 'batch table is not rendered alongside a selected full dossier');
  await page.setViewportSize({ width: 1024, height: 650 });
  await batchBackButton.click();
  await batchReview.waitFor({ state: 'visible' });
  assert.equal(await exactFilter.getAttribute('aria-pressed'), 'true', 'returning preserves the exact-status filter');
  assert.equal(await hasCoverageFilter.getAttribute('aria-pressed'), 'true', 'returning preserves the coverage filter');
  assert.equal(await batchSort.inputValue(), 'coverage', 'returning preserves the active sort');
  assert.equal(await directionButton.getAttribute('aria-pressed'), 'true', 'returning preserves sort direction');
  assert.equal(await batchReview.getByTestId('batch-page-label').innerText(), savedPageLabel, 'returning preserves the current page');
  assert.ok((await batchReview.locator('tbody tr').count()) > 0, 'returning keeps filtered rows visible');
  await page.waitForFunction(rowId => document.activeElement?.dataset?.batchActionRowId === rowId, selectedBatchRowId);
  const restoredBatchRow = batchReview.locator(`[data-row-id="${selectedBatchRowId}"]`);
  const restoredBatchPosition = await restoredBatchRow.evaluate(row => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight, scrollY: window.scrollY };
  });
  assert.ok(restoredBatchPosition.bottom > 0 && restoredBatchPosition.top < restoredBatchPosition.viewportHeight, 'resize-aware return keeps the selected row in the viewport');
  assert.ok(restoredBatchPosition.scrollY > 0, 'resize-aware return preserves a meaningful batch scroll position');
  assert.ok(Math.abs(restoredBatchPosition.top - savedBatchRowTop) < 300, 'resize-aware return keeps a reasonable row anchor after viewport change');
  batchReviewEvidence.coverage = { filter: 'withData', sort: 'coverage', page: savedPageLabel };
  batchReviewEvidence.returnFocusRowId = selectedBatchRowId;
  batchReviewEvidence.resizeRestore = restoredBatchPosition;
  await page.setViewportSize({ width: 1440, height: 900 });
  e2eStages.push('batch-coverage-focus-resize-restored');

  await page.getByRole('button', { name: '单物质检索' }).click();
  await classicButton.click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.getByRole('button', { name: '经典版' }).getAttribute('aria-pressed'), 'true', 'classic preference survives reload');

  await page.getByRole('button', { name: '新版档案' }).click();
  await page.getByTestId('search-results-workbench').waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.getByRole('button', { name: '新版档案' }).getAttribute('aria-pressed'), 'true', 'new dossier preference survives reload');

  const finalQa = { queries: {}, regressions: {}, screenshots: [], viewportMetrics };
  const finalInput = page.getByLabel('化合物名称或 CAS 号');
  await finalInput.fill('141-78-6');
  await page.getByTestId('search-results-workbench').getByText('CAS 141-78-6', { exact: true }).waitFor();
  finalQa.queries.singleCasExact = { query: '141-78-6', matched: true };

  const finalMatchMode = page.getByRole('group', { name: '匹配方式' });
  const finalExactMode = finalMatchMode.getByRole('button', { name: '精确', exact: true });
  const finalFuzzyMode = finalMatchMode.getByRole('button', { name: '模糊', exact: true });
  if (await finalExactMode.getAttribute('aria-pressed') !== 'true') {
    await finalExactMode.focus();
    await page.keyboard.press('Enter');
  }
  const fuzzyOnlyQuery = 'ethyl acet';
  await finalInput.fill(fuzzyOnlyQuery);
  const exactNoMatch = page.getByText('未找到可确认的化合物身份', { exact: true });
  await exactNoMatch.waitFor({ state: 'visible' });
  assert.equal(await finalInput.inputValue(), fuzzyOnlyQuery, 'exact no-match state belongs to the intended partial English query');
  assert.equal(await finalExactMode.getAttribute('aria-pressed'), 'true', 'partial English query does not match while exact mode is active');
  await finalFuzzyMode.focus();
  await page.keyboard.press('Enter');
  const fuzzyPressed = await finalFuzzyMode.getAttribute('aria-pressed');
  assert.equal(fuzzyPressed, 'true', 'fuzzy mode exposes its active state for the partial English query');
  await page.waitForFunction((query) => {
    const input = document.querySelector('#compound-search');
    const workbench = document.querySelector('[data-testid="search-results-workbench"]');
    if (!input || input.value !== query || !workbench) return false;
    return !workbench.textContent.includes('未找到可确认的化合物身份')
      && Boolean(workbench.querySelector('.compound-identity-header, .dossier-candidate-list button'));
  }, fuzzyOnlyQuery);
  const fuzzyCandidateCount = await page.getByTestId('search-results-workbench')
    .locator('.compound-identity-header, .dossier-candidate-list button').count();
  assert.ok(fuzzyCandidateCount >= 1, 'fuzzy mode returns at least one real candidate for a query that exact mode did not match');
  assert.equal(await finalInput.inputValue(), fuzzyOnlyQuery, 'fuzzy result remains scoped to the original partial English query');
  finalQa.queries.singleEnglishFuzzy = {
    query: fuzzyOnlyQuery,
    exactMatched: false,
    fuzzyPressed,
    candidateCount: fuzzyCandidateCount,
  };

  await page.getByRole('button', { name: '批量匹配' }).focus();
  await page.keyboard.press('Enter');
  const finalBulkMatchMode = page.getByRole('group', { name: '匹配方式' });
  await finalBulkMatchMode.getByRole('button', { name: '精确', exact: true }).focus();
  await page.keyboard.press('Enter');
  const finalBulkInput = page.getByLabel('请输入需要匹配的物质名单（每行一个记录）');
  await finalBulkInput.fill('141-78-6\n64-17-5\nunknown');
  const finalBatch = page.getByRole('region', { name: '批量审查结果' });
  await finalBatch.waitFor({ state: 'visible' });
  await finalBatch.locator('tbody tr').first().waitFor({ state: 'visible' });
  assert.deepEqual(
    await finalBatch.locator('tbody tr').evaluateAll(rows => rows.map(row => row.dataset.status)),
    ['exact', 'exact', 'unmatched'],
    'final bulk mixed exact query preserves exact and unmatched states',
  );
  const finalTableScroller = finalBatch.locator('.batch-review__table-scroll');
  await finalTableScroller.focus();
  assert.equal(await finalTableScroller.evaluate(element => document.activeElement === element), true, 'batch table scroller is keyboard focusable');
  const finalExactFilter = finalBatch.getByRole('button', { name: '精确', exact: true });
  await finalExactFilter.focus();
  await page.keyboard.press('Enter');
  assert.equal(await finalExactFilter.getAttribute('aria-pressed'), 'true', 'batch filters activate with Enter and expose selection semantically');
  finalQa.queries.bulkMixedExact = { queryCount: 3, statuses: ['exact', 'exact', 'unmatched'] };
  finalQa.batchMobile = await inspectViewport(page, 375, {
    screenshot: 'search-workbench-batch-mobile.png',
    requireTableScroll: true,
  });
  finalQa.screenshots.push('search-workbench-batch-mobile.png');

  await page.goto(appRootUrl, { waitUntil: 'domcontentloaded' });
  const homeHeading = page.getByRole('heading', { name: 'FlavorThresholdDB', level: 1 });
  await homeHeading.waitFor();
  const homeTitleMetrics = await homeHeading.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.ok(homeTitleMetrics.left >= 0 && homeTitleMetrics.right <= homeTitleMetrics.viewportWidth, 'mobile home title stays inside the viewport');
  assert.ok(homeTitleMetrics.documentScrollWidth <= homeTitleMetrics.documentClientWidth, 'mobile home route has no page-level horizontal overflow');
  finalQa.regressions.home = { heading: true, title: homeTitleMetrics };

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${appRootUrl}shimadzu-analysis/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '岛津 GC–MS 风味数据分析工作台' }).waitFor();
  await page.locator('.shimadzu-settings').scrollIntoViewIfNeeded();
  await page.locator('.shimadzu-settings').waitFor({ state: 'visible' });
  finalQa.regressions.shimadzu = { heading: true, settings: true };

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('化合物名称或 CAS 号').fill('141-78-6');
  await page.getByRole('button', { name: '经典版' }).focus();
  await page.keyboard.press('Enter');
  const classicRegression = page.getByTestId('classic-search-results');
  await classicRegression.waitFor({ state: 'visible' });
  const classicFilterCount = await page.locator('[data-filter-key]').count();
  assert.ok(classicFilterCount > 0, 'classic filters remain available');
  const classicExportButton = page.locator('.search-toolbar-export .result-export-button');
  await classicExportButton.waitFor({ state: 'visible' });
  const classicDesktop = await inspectClassicLayout(page, 1024);
  const classicMobile = await inspectClassicLayout(page, 375);
  finalQa.regressions.classic = {
    resultContainerVisible: true,
    filterCount: classicFilterCount,
    exportButtonVisible: true,
    desktop: classicDesktop,
    mobile: classicMobile,
  };

  const evidenceStateRetries = await verifyEvidenceStateRetries(browser, { baseUrl, proxyOrigin });
  finalQa.screenshots = [
    ...[1440, 1024, 768, 375].map(width => `search-workbench-${width}.png`),
    'search-workbench-batch-mobile.png',
    ...['loading', 'no-match', 'core-error', 'partial', 'failed', 'disabled']
      .map(state => `search-workbench-state-${state}.png`),
  ].map(filename => path.relative(root, path.join(screenshotRoot, filename)).split(path.sep).join('/'));

  const duplicateKeyErrors = consoleErrors.filter(message => /unique "key" prop|same key|duplicate key/i.test(message));
  assert.deepEqual(duplicateKeyErrors, [], 'PubChem and other rendered lists emit no duplicate-key diagnostics');
  assert.equal(expectedCompare503Responses.length, 1, 'the comparison failure fixture emits one expected 503 response');
  assert.equal(expectedNetwork503Errors.length, 1, 'the browser reports only the expected comparison fixture 503');
  assert.deepEqual(pageErrors, [], 'page errors');
  assert.deepEqual(consoleErrors, [], 'console errors');
  e2eStages.push('complete');
  await context.close();
  const result = {
    ok: true,
    status: 'succeeded',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    gitHead,
    resultsPath: path.relative(root, resultsPath).split(path.sep).join('/'),
    ports: { proxyPort, vitePort },
    defaultNew: {
      sharedRequests: sharedBeforeClassic,
      initialHeavyRequestCount: 0,
      visitedChapterRequestCount: newChapterRequestsBeforeClassic.length,
    },
    scientificQueryParams: expectedScientificQueries,
    abortEvidence: {
      detailComparisonRace: 'completed',
      detail: detailWasAborted,
      compare: compareWasAborted,
      failures: failedScientificRequests,
    },
    copyFeedback: { success: true, error: true, stalePromiseIgnored: true, unmountTimerCreations: 0 },
    exportComparison: {
      compact: 'view-specific-contracts',
      detailed: 'view-specific-contracts',
      newUnaffectedByClassicFilters: true,
      distinctModes: Buffer.compare(newExports.compact.bytes, newExports.detailed.bytes) !== 0,
      new: Object.fromEntries(Object.entries(newExports).map(([mode, download]) => [mode, { bytes: download.bytes.length, filename: download.suggestedFilename }])),
      classic: {
        compact: { bytes: classicCompact.bytes.length, filename: classicCompact.suggestedFilename },
        detailed: { bytes: classicDetailed.bytes.length, filename: classicDetailed.suggestedFilename },
      },
    },
    selectedCandidateRequestEvidence,
    bulkLimitRequestEvidence,
    accessibilityAudit,
    contrastAudit,
    tabOrderEvidence,
    finalQa,
    consoleDiagnostics: { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length, duplicateKeyErrors: duplicateKeyErrors.length },
    evidenceStateRetries,
    batchReviewEvidence,
    e2eStages,
    firstClassicMountRequestCount: classicRequestsAfterMount.length,
  };
  const serializedResult = JSON.stringify(result, null, 2);
  atomicWriteJson(resultsPath, result);
  console.log(serializedResult);
} catch (error) {
  atomicWriteJson(resultsPath, {
    ok: false,
    status: 'failed',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    gitHead,
    error: { name: error?.name || 'Error', message: error?.message || String(error) },
  });
  throw error;
} finally {
  if (browser) await browser.close();
  for (const record of [...children].reverse()) await stop(record);
}
