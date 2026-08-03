import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import JSZip from 'jszip'

import { runShimadzuBrowserPipeline } from './shimadzuPipeline.js'

const resource = name => new URL(`../../../resources/shimadzu/templates/${name}`, import.meta.url)

test('runs the public example through browser stages 0-6 without OAV', async () => {
  const [rawBytes, sampleBytes] = await Promise.all([
    readFile(resource('Shimadzu_Raw_Workbook_Example.xlsx')),
    readFile(resource('Shimadzu_Sample_Internal_Standard_Template.xlsx')),
  ])
  const events = []
  const result = await runShimadzuBrowserPipeline({
    rawBytes,
    sampleBytes,
    rawName: 'Shimadzu_Raw_Workbook_Example.xlsx',
    sampleName: 'Shimadzu_Sample_Internal_Standard_Template.xlsx',
    name: '公开示例',
    onEvent: event => events.push(event),
  })

  assert.deepEqual(events.filter(event => event.type === 'stage-complete').map(event => event.stage), [0, 1, 2, 3, 4, 5, 6])
  assert.equal(result.stages[1].counts.input, 9)
  assert.equal(result.stages[2].counts.retained, 9)
  assert.equal(result.stages[3].counts.casRows, 3)
  assert.equal(result.stages[4].counts.concentrationCells, 9)
  assert.equal(result.stages[5].counts.finalAnalysisCas, 3)
  assert.equal(result.stages[6].counts.workbooks, 4)
  assert.equal(result.oavExecuted, false)

  const zip = await JSZip.loadAsync(result.archiveBytes)
  const paths = Object.keys(zip.files)
  assert.ok(paths.includes('00_输入配置与清单/data.json'))
  assert.ok(paths.includes('04_跨样品合并与半定量/04_全样品_峰面积与浓度.xlsx'))
  assert.ok(paths.some(path => path.endsWith('/05_04_CV30筛选后Mean浓度与SD.xlsx')))
  assert.ok(paths.includes('完整性验证/v2-completeness-verification.json'))
  assert.equal(paths.some(path => /OAV/i.test(path)), false)
})
