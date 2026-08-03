import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptRoot, '..', '..');
const frontendRoot = path.join(root, 'frontend');
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
  const pageErrors = [];
  const apiRequests = [];
  const failedScientificRequests = [];
  let selectedCandidateRequestEvidence = null;
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
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
        title: isSelectedCandidate ? 'Selected Bourgeonal' : 'Ethyl acetate',
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
  await page.route('**/spectra/search?**', route => route.fulfill({
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
  }));
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

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
      0,
      'delegated chapter navigation does not show a synthetic count or request status',
    );
  }
  const assertNoDelegatedPanelMeta = async (chapterName) => {
    const panelHeader = workbench.locator('.chapter-panel__header');
    assert.equal(await panelHeader.locator('.chapter-panel__status').count(), 0, `${chapterName} omits the delegated outer status`);
    assert.equal(await panelHeader.locator('.chapter-panel__count').count(), 0, `${chapterName} omits the delegated outer count`);
  };
  const heavyRequests = () => apiRequests.filter(request => classicEndpointPrefixes.some(prefix => request.path.startsWith(prefix)));
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByTestId('spectrum-workbench').count(), 0, 'overview does not mount the spectrum workbench');
  assert.equal(heavyRequests().length, 0, 'overview performs no chapter-specific heavy requests');

  const spectraChapter = chapterNavigation.getByRole('button', { name: /光谱/ });
  await spectraChapter.click();
  await page.getByTestId('spectrum-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('MassBank · MB-FIXTURE-1', { exact: true }).waitFor({ state: 'visible' });
  await workbench.getByRole('link', { name: 'EI 质谱' }).waitFor({ state: 'visible' });
  await assertNoDelegatedPanelMeta('spectra');
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
  await workbench.getByText(/A · MassBank · MB-FIXTURE-1/).waitFor({ state: 'visible', timeout: 5_000 });
  await workbench.getByRole('region', { name: '可滚动谱图峰表' }).waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await workbench.getByText('正在加载峰表…', { exact: true }).count(), 0, 'comparison detail does not leave the record detail loading');
  assert.equal(
    failedScientificRequests.filter(request => request.path === '/spectra/MassBank/MB-FIXTURE-1').length,
    0,
    'record detail and comparison detail complete independently',
  );

  const biochemistryChapter = chapterNavigation.getByRole('button', { name: /生化关系/ });
  await biochemistryChapter.click();
  assert.equal(await page.getByTestId('spectrum-workbench').count(), 0, 'leaving spectra unmounts the spectrum workbench');
  await workbench.getByText('RHEA:10020', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('ATF2', { exact: true }).waitFor({ state: 'visible' });
  await assertNoDelegatedPanelMeta('biochemistry');
  assert.equal(await workbench.locator('.bioactivity-evidence').count(), 0, 'biochemistry does not mount bioactivity');
  assert.equal(await workbench.locator('.structure-evidence').count(), 0, 'biochemistry does not mount protein structures');

  const bioactivityChapter = chapterNavigation.getByRole('button', { name: /活性与靶点/ });
  await bioactivityChapter.click();
  await workbench.getByRole('tab', { name: /PubChem BioAssay/ }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('Fixture cell viability assay', { exact: true }).waitFor({ state: 'visible' });
  await workbench.getByRole('tab', { name: /ChEMBL/ }).click();
  await workbench.getByText('Fixture ChEMBL target', { exact: true }).waitFor({ state: 'visible' });
  await assertNoDelegatedPanelMeta('bioactivity');
  assert.equal(await workbench.locator('.biochemical-relationships').count(), 0, 'bioactivity does not mount biochemistry');
  assert.equal(await workbench.locator('.biological-context').count(), 0, 'bioactivity does not mount biological context');

  const structuresChapter = chapterNavigation.getByRole('button', { name: /蛋白结构/ });
  await structuresChapter.click();
  await workbench.getByText('PDB 1ABC', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await workbench.getByText('AF-P12345-F1', { exact: true }).waitFor({ state: 'visible' });
  await assertNoDelegatedPanelMeta('protein structures');
  assert.equal(await workbench.locator('.bioactivity-evidence').count(), 0, 'protein structures do not mount bioactivity');
  assert.equal(await workbench.locator('.biochemical-relationships').count(), 0, 'protein structures do not mount biochemistry');

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
  await workbench.getByText(/A · MassBank · MB-FIXTURE-1/).waitFor({ state: 'visible' });
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
  assert.equal(detailWasAborted, true, 'leaving spectra aborts a pending record detail request');
  assert.equal(compareWasAborted, true, 'leaving spectra aborts a pending comparison request');
  await workbench.getByRole('heading', { name: '引用与导出', level: 4 }).waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__clipboardFixture = { pending: [], resetTimerCreations: 0 };
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => new Promise((resolve, reject) => window.__clipboardFixture.pending.push({ resolve, reject })),
    });
  });
  await workbench.getByRole('button', { name: '复制引用' }).click();
  await workbench.getByRole('button', { name: '复制引用' }).click();
  await page.waitForFunction(() => window.__clipboardFixture.pending.length === 2);
  await page.evaluate(() => window.__clipboardFixture.pending[1].reject(new Error('latest clipboard request denied')));
  await workbench.getByText('复制失败', { exact: true }).waitFor({ state: 'visible' });
  await page.evaluate(() => window.__clipboardFixture.pending[0].resolve());
  await page.waitForTimeout(50);
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
  await page.waitForTimeout(50);
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
  await thresholdChapter.click();
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

  const assertNoPageOverflow = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.scrollWidth <= dimensions.clientWidth,
      `${width}px viewport has no page-level horizontal overflow (${dimensions.scrollWidth} <= ${dimensions.clientWidth})`,
    );
    if (width === 375) {
      const switchHeights = await page.locator('.result-view-switch button').evaluateAll(
        buttons => buttons.map(button => button.getBoundingClientRect().height),
      );
      assert.ok(switchHeights.every(height => height >= 44), 'mobile result-view controls are at least 44px high');
      const chapterHeights = await chapterButtons.evaluateAll(
        buttons => buttons.map(button => button.getBoundingClientRect().height),
      );
      assert.ok(chapterHeights.every(height => height >= 44), 'mobile chapter controls are at least 44px high');
      const filterHeights = await thresholdPanel.locator('.chapter-filter-group__buttons button').evaluateAll(
        buttons => buttons.map(button => button.getBoundingClientRect().height),
      );
      assert.ok(filterHeights.every(height => height >= 44), 'mobile threshold filters are at least 44px high');
      const workbenchDimensions = await workbench.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      assert.ok(
        workbenchDimensions.scrollWidth <= workbenchDimensions.clientWidth,
        'mobile workbench contains horizontal scrolling within its chapter selector',
      );
      const mobileDisclosureShadow = await rawRecordButton.locator('..').evaluate(
        element => getComputedStyle(element).boxShadow,
      );
      assert.match(mobileDisclosureShadow, /rgb\(255, 255, 255\)/, 'mobile disclosure focus keeps its white inner ring');
      assert.match(mobileDisclosureShadow, /rgb\(30, 58, 138\)/, 'mobile disclosure focus keeps its cobalt outer ring');
    }
  };
  await assertNoPageOverflow(1440);
  await assertNoPageOverflow(375);
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
  await classicButton.click();
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
  assert.equal(Buffer.compare(newExports.compact.bytes, classicCompact.bytes), 0, 'new and classic compact CSV exports are byte-identical');
  assert.equal(Buffer.compare(newExports.detailed.bytes, classicDetailed.bytes), 0, 'new and classic detailed CSV exports are byte-identical');
  assertScientificQueries(apiRequests, 'classic and new dossier requests');
  const pubchemFilter = page.locator('[data-filter-key="pubchem"]');
  const bookFilter = page.locator('[data-filter-key="book"]');
  assert.equal(await pubchemFilter.getAttribute('aria-pressed'), 'true', 'classic PubChem filter starts enabled');
  assert.equal(await bookFilter.getAttribute('aria-pressed'), 'true', 'classic book filter starts enabled');
  await pubchemFilter.click();
  await bookFilter.click();

  await newButton.click();
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
  await secondCandidate.click();
  await workbench.getByText('CAS 18127-01-0', { exact: true }).waitFor({ state: 'visible' });
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
  await classicButton.click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.getByRole('button', { name: '经典版' }).getAttribute('aria-pressed'), 'true', 'classic preference survives reload');

  await page.getByRole('button', { name: '新版档案' }).click();
  await page.getByTestId('search-results-workbench').waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.getByRole('button', { name: '新版档案' }).getAttribute('aria-pressed'), 'true', 'new dossier preference survives reload');

  assert.deepEqual(pageErrors, [], 'page errors');
  assert.deepEqual(consoleErrors, [], 'console errors');
  await context.close();
  console.log(JSON.stringify({
    ok: true,
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
      compact: 'byte-identical',
      detailed: 'byte-identical',
      distinctModes: Buffer.compare(newExports.compact.bytes, newExports.detailed.bytes) !== 0,
      new: Object.fromEntries(Object.entries(newExports).map(([mode, download]) => [mode, { bytes: download.bytes.length, filename: download.suggestedFilename }])),
      classic: {
        compact: { bytes: classicCompact.bytes.length, filename: classicCompact.suggestedFilename },
        detailed: { bytes: classicDetailed.bytes.length, filename: classicDetailed.suggestedFilename },
      },
    },
    selectedCandidateRequestEvidence,
    firstClassicMountRequestCount: classicRequestsAfterMount.length,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  for (const record of [...children].reverse()) await stop(record);
}
