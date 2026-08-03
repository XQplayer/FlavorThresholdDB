import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_WORKBOOK_BYTES,
  RECORD_RETENTION_DAYS,
  RESULT_RETENTION_DAYS,
  assertWorkbookFile,
  browserEnginePresentation,
  expiryFrom,
  validateWorkerEvent,
} from './shimadzuBrowserContract.js'

test('accepts xlsx inputs within the browser size limit', () => {
  const file = { name: 'sample.XLSX', size: MAX_WORKBOOK_BYTES }
  assert.equal(assertWorkbookFile(file), file)
})

test('rejects non-xlsx and oversized workbook inputs', () => {
  assert.throws(() => assertWorkbookFile({ name: 'sample.xls', size: 10 }), /INVALID_XLSX_INPUT/)
  assert.throws(() => assertWorkbookFile({ name: 'sample.xlsx', size: MAX_WORKBOOK_BYTES + 1 }), /WORKBOOK_TOO_LARGE/)
})

test('uses seven-day result and ninety-day record retention', () => {
  assert.equal(RESULT_RETENTION_DAYS, 7)
  assert.equal(RECORD_RETENTION_DAYS, 90)
  assert.equal(expiryFrom('2026-08-03T00:00:00.000Z', 7), '2026-08-10T00:00:00.000Z')
})

test('accepts declared worker events and rejects malformed progress', () => {
  assert.deepEqual(validateWorkerEvent({ type: 'stage-progress', stage: 2, progress: 45, message: '筛查' }), {
    type: 'stage-progress', stage: 2, progress: 45, message: '筛查',
  })
  assert.throws(() => validateWorkerEvent({ type: 'stage-progress', stage: 7, progress: 120 }), /INVALID_WORKER_EVENT/)
})

test('presents the browser engine as public compute instead of local-only', () => {
  assert.deepEqual(browserEnginePresentation(), {
    state: 'ready',
    title: '浏览器分析引擎已就绪',
    detail: '计算在当前设备中执行，原始工作簿不会上传云端。',
    chip: 'ENGINE BROWSER',
  })
})
