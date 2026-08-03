import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as XLSX from 'xlsx'

import {
  readSampleConfiguration,
  readWorkbookSheets,
  safeSheetName,
  writeTableWorkbook,
} from './shimadzuWorkbook.js'

const template = relative => new URL(`../../../resources/shimadzu/templates/${relative}`, import.meta.url)

test('reads Shimadzu sheets in source order with source row lineage', async () => {
  const bytes = await readFile(template('Shimadzu_Raw_Workbook_Example.xlsx'))
  const sheets = readWorkbookSheets(bytes)
  assert.deepEqual(sheets.map(sheet => sheet.name), ['SampleA-1', 'SampleA-2', 'SampleA-3'])
  assert.equal(sheets[0].rows[0].sourceRow, 1)
  assert.equal(sheets[0].rows[0].cells[0], '[Header]')
})

test('maps the approved sample template to V2 configuration fields', async () => {
  const bytes = await readFile(template('Shimadzu_Sample_Internal_Standard_Template.xlsx'))
  const result = readSampleConfiguration(bytes)
  assert.equal(result.samples.length, 3)
  assert.deepEqual(result.samples[0], {
    sampleName: 'SampleA-1', sampleGroup: 'SampleA', matrixName: '示例浓度矩阵', sampleType: '示例液体',
    sampleForm: '液体', liquidAmountMl: 5, solidAmountG: 'NA', internalStandardCas: '123-96-6',
    internalStandardName: '2-Octanol', stockUgMl: 100, spikeUl: 10, systemMl: 5,
    volumeBasis: '加内标前', headspaceSystem: '20 mL顶空瓶；5 mL饱和NaCl溶液', includeSpikeVolume: '是',
    userFinalUgMl: 'NA', includeInAnalysis: '是', notes: '虚构数据，仅用于验证模板结构', sourceRow: 2,
  })
})

test('writes reopenable workbooks while preserving zero, NA and number formats', () => {
  const bytes = writeTableWorkbook([{ name: '浓度/结果*', columns: ['CAS #', 'A（μg/mL）'], rows: [
    { 'CAS #': '64-17-5', 'A（μg/mL）': 0 }, { 'CAS #': '67-56-1', 'A（μg/mL）': 'NA' },
  ] }])
  const workbook = XLSX.read(bytes, { type: 'array', cellStyles: true })
  assert.deepEqual(workbook.SheetNames, ['浓度_结果_'])
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['浓度_结果_'], { header: 1, raw: true })
  assert.deepEqual(rows, [['CAS #', 'A（μg/mL）'], ['64-17-5', 0], ['67-56-1', 'NA']])
  assert.equal(workbook.Sheets['浓度_结果_'].B2.z, '0.0000')
})

test('sanitizes and bounds worksheet names', () => {
  assert.equal(safeSheetName('A/B:C*D?E[F]'), 'A_B_C_D_E_F_')
  assert.equal(safeSheetName('x'.repeat(40)).length, 31)
})
