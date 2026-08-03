import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./ShimadzuAnalysisPage.jsx', import.meta.url), 'utf8')

test('keeps duplicate workflow explanations out of the hero', () => {
  assert.doesNotMatch(source, /从岛津原始工作簿出发/)
  assert.doesNotMatch(source, /shimadzu-hero-facts/)
  assert.doesNotMatch(source, /7 个审计节点|2 个 Excel 工作簿|当前浏览器处理/)
})

test('keeps the live browser engine status in the hero', () => {
  assert.match(source, /shimadzu-hero-status/)
  assert.match(source, /engine\.title/)
  assert.match(source, /engine\.detail/)
})
