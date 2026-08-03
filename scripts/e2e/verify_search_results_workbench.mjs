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

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const apiRequests = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.url().startsWith(proxyOrigin)) apiRequests.push(`${request.method()} ${request.url()}`);
  });
  await page.route(`${proxyOrigin}/**`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.route('**/fema?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ found: false }),
  }));
  await page.route('**/compound?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      pubchem: { found: false },
      pubchem_volatile: { found: false, status: 'no_data', properties: {} },
      flavordb: { found: false },
    }),
  }));

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

  await page.waitForLoadState('networkidle');
  const beforeClassic = apiRequests.length;
  await classicButton.click();
  const classicResults = page.getByTestId('classic-search-results');
  await classicResults.waitFor({ state: 'attached' });
  assert.equal(await classicResults.getAttribute('aria-hidden'), 'false', 'classic result region is revealed');
  await page.getByText('CAS 141-78-6', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  assert.equal(apiRequests.length, beforeClassic, 'switching to classic does not issue additional API requests');

  await newButton.click();
  await workbench.waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(apiRequests.length, beforeClassic, 'switching back to the new dossier does not issue additional API requests');
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
  console.log(JSON.stringify({ ok: true, ports: { proxyPort, vitePort }, apiRequestCountBeforeClassic: beforeClassic }, null, 2));
} finally {
  if (browser) await browser.close();
  for (const record of [...children].reverse()) await stop(record);
}
