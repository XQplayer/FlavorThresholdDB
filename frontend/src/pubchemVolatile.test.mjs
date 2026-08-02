import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getVolatilePropertySections,
  rankVolatileRecords,
} from './pubchemVolatile.js'

const expectedKeys = [
  'boiling_point',
  'vapor_pressure',
  'henrys_law_constant',
  'water_solubility',
  'experimental_logp',
  'density',
  'melting_point',
  'physical_state',
]

const expectedChineseLabels = [
  '沸点',
  '蒸气压',
  '亨利定律常数',
  '水溶解度',
  '实验 LogP',
  '密度',
  '熔点',
  '物理状态',
]

const expectedEnglishLabels = [
  'Boiling Point',
  'Vapor Pressure',
  "Henry's Law Constant",
  'Water Solubility',
  'Experimental LogP',
  'Density',
  'Melting Point',
  'Physical State',
]

test('getVolatilePropertySections follows the fixed scientific order', () => {
  const sections = getVolatilePropertySections({
    density: [{ raw_value: '0.79 g/mL' }],
    boiling_point: [{ raw_value: '77 °C' }],
  }, false)

  assert.deepEqual(sections.map(({ key }) => key), ['boiling_point', 'density'])
  assert.equal(sections[0].label, '沸点')
})

test('getVolatilePropertySections supplies all Chinese and English labels', () => {
  const properties = Object.fromEntries(expectedKeys.map((key) => [key, [{}]]))

  assert.deepEqual(
    getVolatilePropertySections(properties, false).map(({ label }) => label),
    expectedChineseLabels,
  )
  assert.deepEqual(
    getVolatilePropertySections(properties, true).map(({ label }) => label),
    expectedEnglishLabels,
  )
})

test('getVolatilePropertySections safely ignores missing or empty properties', () => {
  assert.deepEqual(getVolatilePropertySections(undefined, false), [])
  assert.deepEqual(getVolatilePropertySections({}, true), [])
  assert.deepEqual(getVolatilePropertySections({ boiling_point: [] }, false), [])
})

test('rankVolatileRecords ranks more complete records first', () => {
  const sparse = { raw_value: '77 °C', source: '' }
  const complete = {
    raw_value: '77.1 °C at 760 mmHg',
    source: 'HSDB',
    temperature: '77.1 °C',
  }

  assert.deepEqual(rankVolatileRecords([sparse, complete]), [complete, sparse])
})

test('rankVolatileRecords is stable when completeness is tied', () => {
  const first = { raw_value: '100 °C', source: 'Z source' }
  const second = { raw_value: '1 °C', source: 'A source' }

  assert.deepEqual(rankVolatileRecords([first, second]), [first, second])
})

test('numeric magnitude does not affect record ranking', () => {
  const low = { raw_value: '1 °C' }
  const high = { raw_value: '999 °C' }

  assert.deepEqual(rankVolatileRecords([low, high]), [low, high])
})

test('helpers do not mutate properties, arrays, or records', () => {
  const first = { raw_value: '77 °C' }
  const second = { raw_value: '77.1 °C', source: 'HSDB' }
  const records = [first, second]
  const properties = { boiling_point: records }

  const ranked = rankVolatileRecords(records)
  const sections = getVolatilePropertySections(properties, false)

  assert.deepEqual(records, [first, second])
  assert.equal(properties.boiling_point, records)
  assert.notEqual(ranked, records)
  assert.notEqual(sections[0].records, records)
})
