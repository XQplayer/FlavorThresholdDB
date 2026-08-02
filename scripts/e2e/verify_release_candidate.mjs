import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptRoot, '..', '..');
const frontendRoot = path.join(root, 'frontend');
const node = process.env.CODEX_E2E_NODE || process.execPath;
const python = process.env.CODEX_E2E_PYTHON || path.resolve(path.dirname(node), '..', '..', 'python', 'python.exe');
const defaultPlaywright = path.resolve(path.dirname(node), '..', 'node_modules', 'playwright', 'index.mjs');
const playwrightModule = process.env.CODEX_E2E_PLAYWRIGHT || pathToFileURL(defaultPlaywright).href;
const { chromium } = await import(playwrightModule);
const viteEntry = path.join(frontendRoot, 'node_modules/vite/bin/vite.js');
const verificationDir = path.join(root, '_local', 'verification');
const screenshotsDir = path.join(verificationDir, 'screenshots');
const resultPath = path.join(verificationDir, 'release-candidate-results.json');
const propertyKeys = ['boiling_point', 'vapor_pressure', 'henrys_law_constant', 'water_solubility', 'experimental_logp', 'density', 'melting_point', 'physical_state'];
const propertyLabels = { boiling_point: '沸点', vapor_pressure: '蒸气压', henrys_law_constant: '亨利定律常数', water_solubility: '水溶解度', experimental_logp: '实验 LogP', density: '密度', melting_point: '熔点', physical_state: '物理状态' };
const children = [];

const biochemicalFixture = {
  chebi: { chebi_id: 'CHEBI:27750', name: 'ethyl acetate', formula: 'C4H8O2', source_url: 'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:27750', identity_match: { type: 'inchikey_exact', verified: true } },
  reactions: [
    { rhea_id: 'RHEA:10020', equation: 'a very long biochemical participant name + CHEBI:27750 = another very long biochemical participant name + CHEBI:12345', source_url: 'https://www.rhea-db.org/rhea/10020' },
    { rhea_id: 'RHEA:20020', equation: 'CHEBI:27750 = CHEBI:54321', source_url: 'https://www.rhea-db.org/rhea/20020' },
  ],
  proteins: [{ accession: 'P12345', protein_name: 'A deliberately long reviewed enzyme name used to verify bounded responsive rendering without horizontal page overflow', organism: { scientific_name: 'Homo sapiens', taxon_id: 9606 }, ec_numbers: ['1.1.1.1'], rhea_id: 'RHEA:10020', source_url: 'https://www.uniprot.org/uniprotkb/P12345/entry' }],
  sources: { ChEBI: { status: 'ok', cached: true }, Rhea: { status: 'ok', cached: false }, UniProt: { status: 'partial_failure', requests: [{ rhea_id: 'RHEA:10020', status: 'ok' }, { rhea_id: 'RHEA:20020', status: 'upstream_unavailable' }] } },
  retrieved_at: '2026-08-02T00:00:00Z',
};

const biologicalContextFixture = {
  genes: [{ gene_id: '559295', symbol: 'ATF2', description: 'alcohol acetyltransferase', taxon_id: 4932, organism: 'Saccharomyces cerevisiae', source_url: 'https://www.ncbi.nlm.nih.gov/gene/559295', evidence: { uniprot_accession: 'P12345' } }],
  taxa: [{ taxon_id: 4932, scientific_name: 'Saccharomyces cerevisiae', rank: 'species', source_url: 'https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=4932' }],
  studies: [{ accession: 'MTBLS1', source_url: 'https://www.ebi.ac.uk/metabolights/MTBLS1' }],
  study_hit_count: 78,
  sources: { 'NCBI Gene': { status: 'ok' }, 'NCBI Taxonomy': { status: 'ok' }, MetaboLights: { status: 'ok' } },
  links: { BRENDA: [{ ec_number: '1.1.1.1', source_url: 'https://www.brenda-enzymes.org/enzyme.php?ecno=1.1.1.1' }], HMDB: { integration_mode: 'link_only', source_url: 'https://www.hmdb.ca/unearth/q?query=141-78-6&searcher=metabolites' } },
};

const bioactivityFixture = {
  pubchem_assays: [{ aid: '421', outcome: 'Inactive', assay_name: 'Cell viability assay', source_url: 'https://pubchem.ncbi.nlm.nih.gov/bioassay/421' }],
  chembl_activities: [{ activity_id: 7, target_name: 'Example target', type: 'IC50', value: '10', units: 'uM', source_url: 'https://www.ebi.ac.uk/chembl/explore/activity/7' }],
  gtopdb_interactions: [], bindingdb_interactions: [],
  sources: { 'PubChem BioAssay': { status: 'ok', total: 606 }, ChEMBL: { status: 'ok', total: 41 }, GtoPdb: { status: 'no_data' }, BindingDB: { status: 'no_data', match_mode: 'exact_structure' } },
};

const structureFixture = {
  experimental_structures: [{ pdb_id: '1ABC', accession: 'P12345', evidence_type: 'experimental_structure', source_url: 'https://www.rcsb.org/structure/1ABC' }],
  predicted_models: [{ model_id: 'AF-P12345-F1', accession: 'P12345', evidence_type: 'predicted_structure', global_plddt: 91.2, version: 6, source_url: 'https://alphafold.ebi.ac.uk/entry/AF-P12345-F1' }],
  gpcr_proteins: [], sources: { 'RCSB PDB': { status: 'ok' }, 'AlphaFold DB': { status: 'ok' }, GPCRdb: { status: 'no_data' } },
};

async function installBiochemicalFixture(page) {
  await page.route('**/biochemistry/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(biochemicalFixture) }));
  await page.route('**/biological-context/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(biologicalContextFixture) }));
  await page.route('**/bioactivity/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bioactivityFixture) }));
  await page.route('**/structures/resolve?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structureFixture) }));
}

async function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort(preferred, excluded = new Set()) {
  if (!excluded.has(preferred) && await portIsFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : (excluded.has(port) ? choosePort(preferred, excluded).then(resolve, reject) : resolve(port)));
    });
  });
}

function start(command, args, options) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, label: options.label, stderr: '', error: null, exited: false };
  child.stdout.on('data', chunk => process.stderr.write(`[${options.label}] ${chunk}`));
  child.stderr.on('data', chunk => { record.stderr += chunk; process.stderr.write(`[${options.label}] ${chunk}`); });
  child.once('error', error => { record.error = error; });
  child.once('exit', (code, signal) => { record.exited = true; record.exitCode = code; record.signal = signal; });
  children.push(record);
  return record;
}

async function waitForUrl(url, serverRecords, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    for (const record of serverRecords) {
      if (record.error) throw new Error(`${record.label} failed to start: ${record.error.message}\n${record.stderr}`);
      if (record.exited) throw new Error(`${record.label} exited before readiness (code=${record.exitCode}, signal=${record.signal})\n${record.stderr}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      if (response.ok) return;
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopChild(record) {
  const child = record?.child;
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, 5_000)) return;
  child.kill('SIGKILL');
  if (!await waitForExit(child, 5_000)) throw new Error(`${record.label} did not exit after SIGKILL`);
}

async function waitForPortRelease(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

function classifyTracebacks(stderr) {
  const marker = 'Traceback (most recent call last):';
  const starts = [];
  for (let index = stderr.indexOf(marker); index !== -1; index = stderr.indexOf(marker, index + marker.length)) starts.push(index);
  const blocks = starts.map((start, index) => stderr.slice(start, starts[index + 1] ?? stderr.length));
  return blocks.map(block => ({ block, allowed: /ConnectionAbortedError:\s*\[WinError 10053\]/.test(block) }));
}

function assertOnlyAllowedTracebacks(stderr, label) {
  const tracebacks = classifyTracebacks(stderr);
  const unexpected = tracebacks.filter(item => !item.allowed);
  if (unexpected.length) throw new Error(`${label} emitted ${unexpected.length} unexpected traceback block(s):\n${unexpected.map(item => item.block).join('\n---\n')}`);
  return tracebacks.length;
}

// Guard the classifier itself: an allowed abort followed by an unrelated traceback must fail classification.
const mixedTracebackFixture = `Traceback (most recent call last):\nConnectionAbortedError: [WinError 10053] client abort\nTraceback (most recent call last):\nRuntimeError: unexpected`;
assert.throws(() => assertOnlyAllowedTracebacks(mixedTracebackFixture, 'mixed fixture'), /1 unexpected traceback block/, 'mixed traceback classifier self-test');

function installObservers(page, proxyOrigin) {
  const observed = { consoleErrors: [], pageErrors: [], failedRequests: [], failedApiResponses: [] };
  page.on('console', message => { if (message.type() === 'error') observed.consoleErrors.push(message.text()); });
  page.on('pageerror', error => observed.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText || '';
    if (errorText === 'net::ERR_ABORTED') return;
    observed.failedRequests.push(`${request.method()} ${request.url()} :: ${errorText}`);
  });
  page.on('response', response => {
    if (response.url().startsWith(proxyOrigin) && !response.ok()) observed.failedApiResponses.push(`${response.status()} ${response.url()}`);
  });
  return observed;
}

function assertClean(name, observed) {
  assert.deepEqual(observed.consoleErrors, [], `${name}: console errors`);
  assert.deepEqual(observed.pageErrors, [], `${name}: page errors`);
  assert.deepEqual(observed.failedRequests, [], `${name}: failed requests`);
  assert.deepEqual(observed.failedApiResponses, [], `${name}: failed API responses`);
}

async function search(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('化合物名称或 CAS 号');
  await input.waitFor({ timeout: 30_000 });
  await input.fill('141-78-6');
  await page.getByRole('heading', { name: '挥发与分配性质' }).waitFor({ timeout: 60_000 });
}

async function runViewport(browser, name, viewport, baseUrl, proxyOrigin) {
  const context = await browser.newContext({ viewport });
  let payloadTimer;
  try {
    const page = await context.newPage();
    const observed = installObservers(page, proxyOrigin);
  await installBiochemicalFixture(page);
  let resolvePayload;
  let rejectPayload;
  let payloadSettled = false;
  const settlePayload = (method, value) => {
    if (payloadSettled) return;
    payloadSettled = true;
    method(value);
  };
  const payloadPromise = new Promise((resolve, reject) => { resolvePayload = resolve; rejectPayload = reject; });
  const handledPayloadPromise = payloadPromise.then(value => ({ value }), error => ({ error }));
  const payloadTimeoutMs = Number(process.env.CODEX_E2E_PAYLOAD_TIMEOUT_MS || 60_000);
  payloadTimer = setTimeout(() => settlePayload(rejectPayload, new Error(`${name}: timed out waiting ${payloadTimeoutMs}ms for compound payload`)), payloadTimeoutMs);
  page.once('close', () => settlePayload(rejectPayload, new Error(`${name}: page closed before compound payload arrived`)));
  page.on('response', async response => {
    const url = new URL(response.url());
    const expectedCas = process.env.CODEX_E2E_RESPONSE_CAS || '141-78-6';
    if (`${url.protocol}//${url.host}` !== proxyOrigin || url.pathname !== '/compound' || url.searchParams.get('cas') !== expectedCas) return;
    if (!response.ok()) return settlePayload(rejectPayload, new Error(`${name}: compound response failed with HTTP ${response.status()}`));
    try { settlePayload(resolvePayload, await response.json()); }
    catch (error) { settlePayload(rejectPayload, new Error(`${name}: compound JSON parse failed: ${error.message}`)); }
  });
  await search(page, baseUrl);
  const payloadOutcome = await handledPayloadPromise;
  if (payloadOutcome.error) throw payloadOutcome.error;
  const payload = payloadOutcome.value;
  assert.deepEqual(Object.keys(payload.pubchem_volatile.properties).sort(), [...propertyKeys].sort(), `${name}: volatile contract keys`);
  const populatedKeys = propertyKeys.filter(key => payload.pubchem_volatile.properties[key].length > 0);
  const spectraPanel = page.locator('.open-spectra-workbench');
  await spectraPanel.getByRole('heading', { name: '开放光谱' }).waitFor({ timeout: 60_000 });
  const spectrumRecords = spectraPanel.locator('.spectrum-record-list article');
  await spectrumRecords.first().waitFor({ timeout: 60_000 });
  assert.ok(await spectrumRecords.count() >= 2, `${name}: ethyl acetate has comparable public spectra`);
  await spectraPanel.getByLabel('谱库来源').selectOption('massbank');
  assert.ok(await spectrumRecords.count() >= 2, `${name}: source filter retains MassBank spectra`);
  for (const text of await spectrumRecords.locator('.spectrum-record-main strong').allTextContents()) assert.match(text, /^MassBank ·/);
  await spectraPanel.getByLabel('谱图类型').selectOption('ei');
  assert.ok(await spectrumRecords.count() >= 2, `${name}: type filter retains EI spectra`);
  await spectraPanel.getByRole('button', { name: '重置' }).click();
  await spectrumRecords.nth(0).getByRole('button', { name: '加入比较' }).click();
  await spectrumRecords.nth(1).getByRole('button', { name: '加入比较' }).click();
  await spectraPanel.locator('.mirror-spectrum-plot').waitFor({ timeout: 30_000 });
  await spectraPanel.getByText(/共有峰/).waitFor({ timeout: 30_000 });
  await spectraPanel.getByRole('button', { name: 'CSV' }).waitFor();
  const peakTable = spectraPanel.locator('.spectrum-comparison-panel .peak-table-scroll');
  await peakTable.waitFor();
  const peakSearch = spectraPanel.locator('.spectrum-comparison-panel').getByLabel('检索峰');
  await peakSearch.fill('40-80');
  assert.ok(await peakTable.locator('tbody tr').count() >= 1, `${name}: peak range search keeps matching rows`);
  await peakSearch.fill('');
  await spectraPanel.locator('.spectrum-comparison-panel').getByRole('button', { name: '复制' }).waitFor();
  await peakTable.focus();
  assert.equal(await peakTable.evaluate(element => document.activeElement === element), true, `${name}: peak table keyboard focus`);
  assert.equal(await peakTable.evaluate(element => element.scrollHeight >= element.clientHeight), true, `${name}: peak table bounded scroll region`);
  const pngDownloadPromise = page.waitForEvent('download');
  await spectraPanel.getByRole('button', { name: 'PNG' }).click();
  const pngDownload = await pngDownloadPromise;
  assert.match(pngDownload.suggestedFilename(), /^spectra-mirror_.*\.png$/);
  assert.equal(await pngDownload.failure(), null, `${name}: PNG download`);
  const biochemicalPanel = page.locator('.biochemical-relationships');
  await biochemicalPanel.getByRole('heading', { name: '生化关系证据' }).waitFor();
  await biochemicalPanel.getByText('部分 UniProt 请求失败；其他反应中已核验的结果仍保留显示。', { exact: true }).waitFor();
  assert.equal(await biochemicalPanel.locator('.biochemical-source-status [data-status="partial_failure"]').count(), 1, `${name}: partial source status`);
  const reaction = biochemicalPanel.locator('details').first();
  await reaction.locator('summary').click();
  await reaction.getByText('P12345', { exact: false }).waitFor();
  const biologicalPanel = page.locator('.biological-context');
  await biologicalPanel.getByRole('heading', { name: '基因、物种与代谢组研究' }).waitFor();
  await biologicalPanel.getByText('ATF2', { exact: true }).waitFor();
  await biologicalPanel.getByText('MTBLS1', { exact: true }).waitFor();
  assert.equal(await biologicalPanel.locator('[data-status="ok"]').count(), 3, `${name}: biological source states`);
  assert.equal(await biologicalPanel.getByText('HMDB · 仅链接检索', { exact: true }).count(), 1, `${name}: HMDB license gate`);
  const activityPanel = page.locator('.bioactivity-evidence');
  await activityPanel.getByRole('heading', { name: '生物活性与靶点证据' }).waitFor();
  await activityPanel.getByText('Cell viability assay', { exact: true }).waitFor();
  await activityPanel.getByRole('tab', { name: /ChEMBL/ }).click();
  await activityPanel.getByText('Example target', { exact: true }).waitFor();
  await activityPanel.getByRole('tab', { name: /BindingDB/ }).click();
  await activityPanel.getByText('BindingDB 仅采用结构相似度 1.0 的精确检索。', { exact: true }).waitFor();
  const structurePanel = page.locator('.structure-evidence');
  await structurePanel.getByRole('heading', { name: '实验与预测蛋白结构' }).waitFor();
  await structurePanel.getByText('PDB 1ABC', { exact: true }).waitFor();
  await structurePanel.getByText('AF-P12345-F1', { exact: true }).waitFor();
  await structurePanel.getByText('PDB 为实验结构档案；AlphaFold 为预测模型，不作为实验性配体—蛋白复合物证据。', { exact: true }).waitFor();
  const panel = page.locator('.pubchem-volatile');
  if (populatedKeys.length) await panel.locator('.pubchem-volatile-property').first().waitFor({ timeout: 30_000 });
  assert.equal(await panel.locator('.pubchem-volatile-property').count(), populatedKeys.length, `${name}: visible section count`);
  for (const key of populatedKeys) await panel.getByRole('heading', { name: propertyLabels[key], exact: true }).waitFor();
  const details = panel.locator('details').first();
  await details.locator('summary').click();
  const record = details.locator('.pubchem-volatile-record').first();
  const raw = (await record.locator('.pubchem-volatile-raw').innerText()).trim();
  assert.ok(raw);
  const link = await record.locator('.pubchem-volatile-reference a').evaluate(element => ({ href: element.href, target: element.target, rel: element.rel }));
  assert.match(link.href, /^https?:\/\//); assert.equal(link.target, '_blank'); assert.match(link.rel, /noopener/); assert.match(link.rel, /noreferrer/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, `${name}: horizontal overflow`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const fixedBottomOverlap = await page.evaluate(() => {
    const main = document.querySelector('#main-content');
    if (!main) return false;
    const mainRect = main.getBoundingClientRect();
    return [...document.querySelectorAll('body *')].some(element => {
      const style = getComputedStyle(element);
      if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      const touchesBottom = Math.abs(rect.bottom - window.innerHeight) < 2;
      return touchesBottom && rect.top < mainRect.bottom && rect.bottom > mainRect.top;
    });
  });
  assert.equal(fixedBottomOverlap, false, `${name}: fixed bottom element overlaps main content`);
  const screenshot = path.join(screenshotsDir, `pubchem-volatile-${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  assertClean(name, observed);
  return { name, populatedKeys, sectionCount: populatedKeys.length, raw, link, overflow, fixedBottomOverlap, screenshot, ...observed };
  } finally {
    if (payloadTimer) clearTimeout(payloadTimer);
    await context.close();
  }
}

async function runFailureIsolation(browser, baseUrl, proxyOrigin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const observed = installObservers(page, proxyOrigin);
  await installBiochemicalFixture(page);
  await page.route('**/compound?cas=141-78-6', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.pubchem_volatile = { found: false, status: 'upstream_unavailable', properties: Object.fromEntries(propertyKeys.map(key => [key, []])), cached: false };
    await route.fulfill({ response, json: payload });
  });
  await search(page, baseUrl);
  await page.getByText('PubChem 实验性质服务暂时不可用，其他档案数据不受影响。', { exact: true }).waitFor();
  const identityVisible = await page.getByText('141-78-6', { exact: true }).first().isVisible();
  assert.equal(identityVisible, true, 'failure isolation: compound identity remains visible');
  await page.getByRole('heading', { name: '研究文献与阈值数据记录' }).first().waitFor();
  const localThreshold = page.getByText('0.005', { exact: true }).first();
  await localThreshold.waitFor();
  const localThresholdsVisible = await localThreshold.isVisible();
  assert.equal(localThresholdsVisible, true, 'failure isolation: known local threshold 0.005 remains visible');
  const unavailableStateVisible = await page.getByText('PubChem 实验性质服务暂时不可用，其他档案数据不受影响。', { exact: true }).isVisible();
  assert.equal(unavailableStateVisible, true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, 'failure isolation: horizontal overflow');
  assertClean('failure isolation', observed);
  return { identityVisible, localThresholdsVisible, verifiedLocalThreshold: '0.005', unavailableStateVisible, overflow, ...observed };
  } finally {
    await context.close();
  }
}

await fs.mkdir(screenshotsDir, { recursive: true });
const proxyPort = await choosePort(18787);
const vitePort = await choosePort(5175, new Set([proxyPort]));
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const baseUrl = `http://127.0.0.1:${vitePort}/FlavorThresholdDB/aroma-threshold/`;
let browser;
let result;
let runError;
try {
  const proxyServer = start(python, ['fema_proxy_server.py'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(proxyPort) }, label: 'proxy' });
  const viteServer = start(node, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: frontendRoot, env: { ...process.env, VITE_FEMA_API_URL: proxyOrigin }, label: 'vite' });
  await waitForUrl(`${proxyOrigin}/health`, [proxyServer, viteServer]);
  await waitForUrl(baseUrl, [proxyServer, viteServer]);
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }); }
  result = {
    ports: { proxyPort, vitePort, usedPreferredProxyPort: proxyPort === 18787, usedPreferredVitePort: vitePort === 5175 },
    desktop: await runViewport(browser, 'desktop', { width: 1280, height: 800 }, baseUrl, proxyOrigin),
    mobile: await runViewport(browser, 'mobile', { width: 375, height: 667 }, baseUrl, proxyOrigin),
    failureIsolation: await runFailureIsolation(browser, baseUrl, proxyOrigin),
  };
} catch (error) { runError = error; }
finally {
  const cleanupErrors = [];
  if (browser) {
    try { await browser.close(); }
    catch (error) { cleanupErrors.push(new Error(`browser cleanup failed: ${error.message}`)); }
  }
  for (const record of [...children].reverse()) {
    try { await stopChild(record); }
    catch (error) { cleanupErrors.push(new Error(`${record.label} cleanup failed: ${error.message}`)); }
  }
  const cleanup = { proxyPortReleased: await waitForPortRelease(proxyPort), vitePortReleased: await waitForPortRelease(vitePort), errors: cleanupErrors.map(error => error.message), serverWarnings: [] };
  if (!cleanup.proxyPortReleased) cleanupErrors.push(new Error(`proxy port ${proxyPort} was not released`));
  if (!cleanup.vitePortReleased) cleanupErrors.push(new Error(`Vite port ${vitePort} was not released`));
  for (const record of children) {
    const tracebacks = classifyTracebacks(record.stderr);
    if (!tracebacks.length) continue;
    try {
      const count = assertOnlyAllowedTracebacks(record.stderr, record.label);
      cleanup.serverWarnings.push(`${record.label}: ${count} known client-aborted request traceback block(s), WinError 10053`);
    } catch (error) { cleanupErrors.push(error); }
  }
  cleanup.errors = cleanupErrors.map(error => error.message);
  if (result) result.cleanup = cleanup;
  if (result) { await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(result, null, 2)); }
  if (cleanupErrors.length) runError = runError
    ? new AggregateError([runError, ...cleanupErrors], `test failed and cleanup reported ${cleanupErrors.length} error(s)`, { cause: runError })
    : new AggregateError(cleanupErrors, `cleanup reported ${cleanupErrors.length} error(s)`);
}
if (runError) throw runError;
