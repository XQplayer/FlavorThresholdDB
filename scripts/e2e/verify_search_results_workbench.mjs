import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const apiRequests = [];
  let selectedCandidateRequestEvidence = null;
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
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
          ? { found: true, flavor_profile: 'fruity, pineapple', source: 'FEMA Flavor Library' }
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
        : { found: true, flavor_profile: ['fruity'], odor: ['pineapple'], taste: ['sweet'], source: 'FlavorDB2' },
      flavordb2_entities: isSelectedCandidate
        ? { found: false, entities: [] }
        : { found: true, entities: [{ id: 12, name: 'Pineapple', natural_source: { name: 'Ananas comosus' } }] },
    }),
    });
  });

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
  const femaFilter = sensoryPanel.getByRole('button', { name: 'FEMA', exact: true });
  const flavorDbFilter = sensoryPanel.getByRole('button', { name: 'FlavorDB2', exact: true });
  assert.equal(await femaFilter.getAttribute('aria-pressed'), 'true', 'FEMA starts selected independently');
  assert.equal(await flavorDbFilter.getAttribute('aria-pressed'), 'true', 'FlavorDB2 starts selected independently');
  assert.equal(await sensoryPanel.getByRole('heading', { name: 'FEMA', exact: true }).count(), 1, 'FEMA evidence has its own group');
  assert.equal(await sensoryPanel.getByRole('heading', { name: 'FlavorDB2', exact: true }).count(), 1, 'FlavorDB2 evidence has its own group');
  await thresholdChapter.click();
  assert.equal(await waterFilter.getAttribute('aria-pressed'), 'true', 'threshold medium filter survives chapter switching');
  assert.equal(await recognitionFilter.getAttribute('aria-pressed'), 'true', 'threshold type filter survives chapter switching');
  const allMediaFilter = thresholdPanel.getByRole('button', { name: '全部介质', exact: true });
  const allTypeFilter = thresholdPanel.getByRole('button', { name: '全部类型', exact: true });
  await allMediaFilter.click();
  await allTypeFilter.click();
  const bookFilterButton = thresholdPanel.getByRole('button', { name: '书籍记录', exact: true });
  await bookFilterButton.click();
  const bookDisclosure = thresholdPanel.getByRole('button', { name: /水中觉察嗅阈值0\.6μg\/L/ }).first();
  await bookDisclosure.waitFor({ state: 'visible' });
  await bookDisclosure.click();
  const bookEvidence = thresholdPanel.locator('.evidence-record-disclosure').filter({ hasText: '水中觉察嗅阈值0.6μg/L' }).first();
  await bookEvidence.getByText('酒类风味化学', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('水', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('odor', { exact: true }).waitFor({ state: 'visible' });
  await bookEvidence.getByText('μg/L', { exact: true }).waitFor({ state: 'visible' });
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
  const defaultNewClassicRequests = apiRequests.filter(isClassicRequest);
  assert.equal(defaultNewClassicRequests.length, 0, 'default new dossier does not mount or request classic-only result modules');
  assert.equal(await page.getByTestId('classic-search-results').count(), 0, 'classic result marker is absent in the new dossier');
  const sharedBeforeClassic = sharedCounts();
  await classicButton.click();
  const classicResults = page.getByTestId('classic-search-results');
  await classicResults.waitFor({ state: 'attached' });
  await page.getByText('CAS 141-78-6', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const classicRequestsAfterMount = apiRequests.filter(isClassicRequest);
  assert.ok(classicRequestsAfterMount.length > 0, 'classic-only requests begin when the classic tree is first mounted');
  assert.deepEqual(sharedCounts(), sharedBeforeClassic, 'switching to classic does not repeat App-level shared lookups');
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
    .getByRole('button', { name: /引文/ })
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
  assert.equal(await workbench.getByText('939-97-9', { exact: false }).count(), 0, 'selected threshold chapter excludes the other entity CAS');

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
      classicOnlyRequestCount: defaultNewClassicRequests.length,
    },
    selectedCandidateRequestEvidence,
    firstClassicMountRequestCount: classicRequestsAfterMount.length,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  for (const record of [...children].reverse()) await stop(record);
}
