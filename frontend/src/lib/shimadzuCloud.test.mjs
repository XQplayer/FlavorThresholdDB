import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { resultObjectPath, retentionColumns } from './shimadzuCloud.js'

test('scopes every retained result to its user and job', () => {
  assert.equal(
    resultObjectPath('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/result.zip',
  )
  assert.throws(() => resultObjectPath('../owner', 'job'), /INVALID_STORAGE_ID/)
})

test('sets result retention to seven days and records to ninety days', () => {
  assert.deepEqual(retentionColumns('2026-08-03T00:00:00.000Z'), {
    result_expires_at: '2026-08-10T00:00:00.000Z',
    record_expires_at: '2026-11-01T00:00:00.000Z',
  })
})

test('migration enforces approval, RLS, private storage and cleanup', async () => {
  const sql = await readFile(new URL('../../../supabase/migrations/20260803070000_shimadzu_browser_analysis.sql', import.meta.url), 'utf8')
  for (const required of [
    'enable row level security', "approval_status = 'approved'", "'shimadzu-results'", 'cleanup_expired_shimadzu_data',
    'result_expires_at', 'record_expires_at', 'review_shimadzu_user',
  ]) assert.match(sql.toLowerCase(), new RegExp(required.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(sql, /service[_-]?role[^\n]*frontend/i)
})
