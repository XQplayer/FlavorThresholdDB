import assert from 'node:assert/strict'
import test from 'node:test'

import { createShimadzuWorkerClient } from './shimadzuWorkerClient.js'

class FakeWorker {
  static latest
  constructor() { FakeWorker.latest = this; this.messages = []; this.terminated = false }
  postMessage(message, transfer) { this.messages.push({ message, transfer }) }
  terminate() { this.terminated = true }
  emit(data) { this.onmessage?.({ data }) }
}

test('transfers workbook buffers and resolves the completed archive', async () => {
  const events = []
  const client = createShimadzuWorkerClient({ WorkerCtor: FakeWorker, workerUrl: 'worker.js' })
  const rawBytes = new Uint8Array([1, 2]).buffer
  const sampleBytes = new Uint8Array([3, 4]).buffer
  const pending = client.run({ rawBytes, sampleBytes, name: '测试', resumeFromStage: 2, onEvent: event => events.push(event) })
  assert.equal(FakeWorker.latest.messages[0].message.type, 'start')
  assert.equal(FakeWorker.latest.messages[0].message.resumeFromStage, 2)
  assert.deepEqual(FakeWorker.latest.messages[0].transfer, [rawBytes, sampleBytes])
  FakeWorker.latest.emit({ type: 'stage-complete', stage: 0, progress: 14 })
  const archive = new Uint8Array([9, 8]).buffer
  FakeWorker.latest.emit({ type: 'complete', fileName: 'result.zip', archiveBytes: archive, archiveSha256: 'abc' })
  const result = await pending
  assert.equal(result.fileName, 'result.zip')
  assert.deepEqual(events.map(event => event.type), ['stage-complete', 'complete'])
  client.dispose()
  assert.equal(FakeWorker.latest.terminated, true)
})

test('cancel rejects an active browser analysis', async () => {
  const client = createShimadzuWorkerClient({ WorkerCtor: FakeWorker, workerUrl: 'worker.js' })
  const pending = client.run({ rawBytes: new ArrayBuffer(1), sampleBytes: new ArrayBuffer(1) })
  client.cancel()
  await assert.rejects(pending, /ANALYSIS_CANCELLED/)
  assert.equal(FakeWorker.latest.messages.at(-1).message.type, 'cancel')
})

test('dispose reports an interruption so page unload does not erase resumable inputs', async () => {
  const client = createShimadzuWorkerClient({ WorkerCtor: FakeWorker, workerUrl: 'worker.js' })
  const pending = client.run({ rawBytes: new ArrayBuffer(1), sampleBytes: new ArrayBuffer(1) })
  client.dispose()
  await assert.rejects(pending, error => error.code === 'ANALYSIS_INTERRUPTED')
})
