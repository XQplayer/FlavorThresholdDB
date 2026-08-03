import assert from 'node:assert/strict'
import test from 'node:test'

import { createShimadzuTaskStore } from './shimadzuTaskStore.js'

const memoryAdapter = () => {
  const values = new Map()
  return {
    values,
    async getMany(keys) { return keys.map(key => values.get(key)) },
    async putMany(entries) { for (const [key, value] of entries) values.set(key, structuredClone(value)) },
    async deleteMany(keys) { for (const key of keys) values.delete(key) },
  }
}

const task = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'user-1',
  userId: 'user-1',
  name: '刷新恢复测试',
  mode: 'step',
  status: 'running',
  nextStage: 2,
  rawName: 'raw.xlsx',
  sampleName: 'samples.xlsx',
  rawBytes: new Uint8Array([1, 2, 3]).buffer,
  sampleBytes: new Uint8Array([4, 5]).buffer,
  stageSummary: [{ stage: 0, status: 'PASS' }, { stage: 1, status: 'PASS' }],
  ...overrides,
})

test('stores workbook buffers separately and restores only the matching scope', async () => {
  const adapter = memoryAdapter()
  const store = createShimadzuTaskStore({ adapter, now: () => new Date('2026-08-03T00:00:00.000Z') })
  await store.save(task())

  assert.equal(adapter.values.size, 3)
  assert.equal(adapter.values.get('shimadzu-active:user-1:meta').rawBytes, undefined)
  assert.deepEqual([...new Uint8Array(adapter.values.get('shimadzu-active:user-1:raw'))], [1, 2, 3])
  assert.equal(await store.load('user-2'), null)

  const restored = await store.load('user-1')
  assert.equal(restored.name, '刷新恢复测试')
  assert.equal(restored.nextStage, 2)
  assert.deepEqual([...new Uint8Array(restored.sampleBytes)], [4, 5])
})

test('updates progress without replacing stored workbook buffers', async () => {
  const adapter = memoryAdapter()
  const store = createShimadzuTaskStore({ adapter })
  await store.save(task())
  const rawBefore = adapter.values.get('shimadzu-active:user-1:raw')
  const samplesBefore = adapter.values.get('shimadzu-active:user-1:samples')

  await store.update('user-1', { status: 'waiting_review', nextStage: 3, stageSummary: [{ stage: 2, status: 'WARN' }] })

  assert.strictEqual(adapter.values.get('shimadzu-active:user-1:raw'), rawBefore)
  assert.strictEqual(adapter.values.get('shimadzu-active:user-1:samples'), samplesBefore)
  const restored = await store.load('user-1')
  assert.equal(restored.status, 'waiting_review')
  assert.equal(restored.nextStage, 3)
})

test('clears all active-task records', async () => {
  const adapter = memoryAdapter()
  const store = createShimadzuTaskStore({ adapter })
  await store.save(task())
  await store.clear('user-1')
  assert.equal(adapter.values.size, 0)
  assert.equal(await store.load('user-1'), null)
})

test('expires stale active inputs after seven days', async () => {
  const adapter = memoryAdapter()
  const storeAtStart = createShimadzuTaskStore({ adapter, now: () => new Date('2026-08-03T00:00:00.000Z') })
  await storeAtStart.save(task())

  const storeAfterExpiry = createShimadzuTaskStore({ adapter, now: () => new Date('2026-08-10T00:00:01.000Z') })
  assert.equal(await storeAfterExpiry.load('user-1'), null)
  assert.equal(adapter.values.size, 0)
})
