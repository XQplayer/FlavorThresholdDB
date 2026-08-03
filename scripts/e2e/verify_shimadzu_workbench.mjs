import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptRoot, '..', '..')
const node = process.env.CODEX_E2E_NODE || process.execPath
const playwrightModule = process.env.CODEX_E2E_PLAYWRIGHT || pathToFileURL(path.resolve(path.dirname(node), '..', 'node_modules', 'playwright', 'index.mjs')).href
const { chromium } = await import(playwrightModule)
const previewPort = Number(process.env.SHIMADZU_E2E_PORT || 4176)
const baseUrl = process.env.SHIMADZU_E2E_URL || `http://127.0.0.1:${previewPort}/FlavorThresholdDB`
const screenshots = path.join(root, '_local', 'verification', 'screenshots')
await fs.mkdir(screenshots, { recursive: true })

let browser
let preview
try {
  if (!process.env.SHIMADZU_E2E_URL) {
    const viteEntry = path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js')
    preview = spawn(node, [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(previewPort)], { cwd: path.join(root, 'frontend'), windowsHide: true, stdio: 'pipe' })
    await waitForUrl(`${baseUrl}/shimadzu-analysis/`)
  }
  try { browser = await chromium.launch({ headless: true }) }
  catch { browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }) }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto(`${baseUrl}/shimadzu-analysis/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '岛津气质数据一站式分析' }).waitFor()
  if (process.env.SHIMADZU_E2E_EMAIL) {
    await page.getByLabel('邮箱').fill(process.env.SHIMADZU_E2E_EMAIL)
    await page.getByLabel('密码').fill(process.env.SHIMADZU_E2E_PASSWORD)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    if (process.env.SHIMADZU_E2E_ADMIN_CODE) {
      await page.getByLabel('管理员初始化码').fill(process.env.SHIMADZU_E2E_ADMIN_CODE)
      await page.getByRole('button', { name: '认领管理员' }).click()
    }
    await page.locator('.shimadzu-approval.state-approved').waitFor({ timeout: 30_000 })
  }
  const workbench = page.locator('.shimadzu-page')
  assert.equal(await workbench.getAttribute('data-ui-revision'), 'instrument-console-v2')
  assert.equal(await workbench.getAttribute('data-motion'), 'full')
  await page.getByText('浏览器分析引擎已就绪').waitFor()
  await page.locator('.shimadzu-settings').scrollIntoViewIfNeeded()
  await page.getByText('连续执行').waitFor()
  await page.getByText('逐步复核').waitFor()
  await page.getByRole('heading', { name: '分析思路与七步流程' }).waitFor()
  assert.equal(await page.locator('[data-testid="workflow-node"]').count(), 7)
  await page.getByRole('link', { name: '下载原始工作簿示例' }).waitFor()
  await page.getByRole('link', { name: '下载样品信息模板' }).waitFor()
  await page.locator('.shimadzu-monitor').scrollIntoViewIfNeeded()
  await page.getByRole('heading', { name: '实时分析监控' }).waitFor()
  assert.equal((await page.getByText('OAV', { exact: false }).count()) > 0, true)
  assert.equal(await page.getByRole('button', { name: '开始一站式分析' }).isDisabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)

  const fixtureRoot = process.env.SHIMADZU_FIXTURE_ROOT || 'E:/codex/Projects/Aroma analysis/岛津/shimadzu-flavor-data-processing'
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(path.join(fixtureRoot, 'CT&JX1-3.xlsx'))
  await fileInputs.nth(1).setInputFiles(path.join(fixtureRoot, 'CT&JX1-3样品与内标信息.xlsx'))
  await page.getByRole('button', { name: '开始一站式分析' }).click()
  await page.locator('.shimadzu-job-bar .shimadzu-job-badge.complete').waitFor({ timeout: 90_000 })
  const resultLink = page.getByRole('link', { name: '下载结果包' })
  await resultLink.waitFor()
  assert.match(await resultLink.getAttribute('href'), /^blob:/)
  assert.equal(await page.locator('.shimadzu-stage-detail li.state-FAIL').count(), 0)
  assert.equal(await page.locator('.shimadzu-stage-detail li.state-PASS, .shimadzu-stage-detail li.state-WARN, .shimadzu-stage-detail li.state-REVIEW').count(), 7)
  await page.getByRole('button', { name: '新任务' }).click()
  await settleMotion(page)
  await page.screenshot({ path: path.join(screenshots, 'shimadzu-workbench-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '岛津气质数据一站式分析' }).waitFor()
  await page.locator('.shimadzu-settings').scrollIntoViewIfNeeded()
  await page.locator('.shimadzu-monitor').scrollIntoViewIfNeeded()
  await settleMotion(page)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: path.join(screenshots, 'shimadzu-workbench-mobile.png'), fullPage: true })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await workbench.getAttribute('data-motion'), 'reduced')
  for (const selector of ['.shimadzu-hero', '.shimadzu-workflow', '.shimadzu-input-region', '.shimadzu-settings', '.shimadzu-monitor']) {
    await expectVisible(page.locator(selector))
  }

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '岛津气质分析' }).click()
  await page.waitForURL('**/shimadzu-analysis/')
  await page.getByRole('heading', { name: '岛津气质数据一站式分析' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'PASS', screenshots: 2, consoleErrors: errors.length, route: page.url() }))
} finally {
  await browser?.close()
  preview?.kill()
}

async function expectVisible(locator) {
  const styles = await locator.evaluate(element => {
    const computed = window.getComputedStyle(element)
    return { opacity: computed.opacity, visibility: computed.visibility }
  })
  assert.equal(styles.opacity, '1')
  assert.notEqual(styles.visibility, 'hidden')
}

async function settleMotion(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(1600)
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (preview?.exitCode !== null) throw new Error(`preview exited before readiness: ${preview.exitCode}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) })
      if (response.ok) return
      lastError = new Error(`${response.status} ${url}`)
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`)
}
