import assert from 'node:assert/strict'
import test from 'node:test'

import { buildShimadzuUrl, createShimadzuApi, getEnginePresentation, getMonitorStageIndex, getStageProgress, isActiveJob } from './lib/shimadzuApi.js'

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

test('engine presentation distinguishes loading, local-ready, and unavailable deployments', () => {
  assert.equal(getEnginePresentation(null).state, 'checking')
  assert.equal(getEnginePresentation({ available: true }).title, '本地分析引擎已就绪')
  assert.deepEqual(getEnginePresentation({ available: false }), {
    state: 'unavailable',
    title: '当前部署未连接分析引擎',
    detail: '可下载模板；正式分析请在本地工作台运行。',
    chip: 'ENGINE LOCAL ONLY',
  })
})
