import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import JSZip from 'jszip'

import { createPartialFailureArchive, runShimadzuBrowserPipeline } from './shimadzuPipeline.js'

const resource = name => new URL(`../../../resources/shimadzu/templates/${name}`, import.meta.url)

test('builds a downloadable partial archive with structured gate details', async () => {
  const zip = new JSZip()
  zip.file('00_输入配置与清单/data.json', '{"status":"PASS"}\n')
  const failure = await createPartialFailureArchive({
    zip,
    name: '失败测试',
    stage: 4,
    issues: [{ severity: 'FAIL', code: 'INVALID_INTERNAL_STANDARD_AREA', sampleName: 'A-2', cas: '123-96-6' }],
    completedStages: [{ stage: 0, status: 'PASS' }],
  })

  assert.equal(failure.code, 'STAGE_GATE_FAILED')
  assert.equal(failure.details.stage, 4)
  assert.equal(failure.details.issues[0].sampleName, 'A-2')
  assert.ok(failure.archiveBytes.byteLength > 0)
  const partial = await JSZip.loadAsync(failure.archiveBytes)
  assert.ok(partial.file('失败任务/错误明细.json'))
  assert.ok(partial.file('失败任务/部分运行状态.json'))
})

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
