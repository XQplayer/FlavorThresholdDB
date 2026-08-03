import assert from 'node:assert/strict'
import test from 'node:test'

import { buildShimadzuUrl, createShimadzuApi, getMonitorStageIndex, getStageProgress, isActiveJob } from './lib/shimadzuApi.js'

test('buildShimadzuUrl normalizes base and encodes job identifiers', () => {
  assert.equal(buildShimadzuUrl('http://127.0.0.1:8787/', '/capabilities'), 'http://127.0.0.1:8787/shimadzu/capabilities')
  assert.equal(buildShimadzuUrl('http://127.0.0.1:8787', `/jobs/${encodeURIComponent('a b')}`), 'http://127.0.0.1:8787/shimadzu/jobs/a%20b')
})

test('stage progress counts only finished stage outcomes', () => {
  assert.deepEqual(getStageProgress({ stages: [{ status: 'PASS' }, { status: 'WARN' }, { status: 'running' }, { status: 'pending' }] }), { completed: 2, total: 4 })
})

test('active job states include queued and running only', () => {
  assert.equal(isActiveJob({ status: 'queued' }), true)
  assert.equal(isActiveJob({ status: 'running' }), true)
  assert.equal(isActiveJob({ status: 'waiting_review' }), false)
  assert.equal(isActiveJob({ status: 'complete' }), false)
})

test('template URLs use the fixed Shimadzu template route', () => {
  const api = createShimadzuApi('http://127.0.0.1:8787/')
  assert.equal(api.templateUrl('raw-example'), 'http://127.0.0.1:8787/shimadzu/templates/raw-example')
})

test('step review monitor stays on the stage just completed', () => {
  const job = { status: 'waiting_review', next_stage: 2, stages: [{ status: 'PASS' }, { status: 'WARN' }, { status: 'pending' }] }
  assert.equal(getMonitorStageIndex(job, 7), 1)
  assert.equal(getMonitorStageIndex({ status: 'running', next_stage: 3, stages: [{}, {}, { status: 'running' }] }, 7), 2)
})
