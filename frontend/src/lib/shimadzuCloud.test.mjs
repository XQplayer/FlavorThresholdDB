import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  authCallbackMessage,
  createShimadzuCloud,
  resultObjectPath,
  retentionColumns,
  shimadzuAuthRedirect,
} from './shimadzuCloud.js'

test('builds a canonical Shimadzu auth callback without query or hash state', () => {
  assert.equal(
    shimadzuAuthRedirect('https://xqplayer.github.io', '/FlavorThresholdDB/'),
    'https://xqplayer.github.io/FlavorThresholdDB/shimadzu-analysis/',
  )
  assert.equal(
    shimadzuAuthRedirect('http://127.0.0.1:5174', '/FlavorThresholdDB/'),
    'http://127.0.0.1:5174/FlavorThresholdDB/shimadzu-analysis/',
  )
})

test('resends signup confirmation to the canonical analysis page', async () => {
  const calls = []
  const cloud = createShimadzuCloud({
    auth: {
      async resend(payload) {
        calls.push(payload)
        return { data: { messageId: 'sent' }, error: null }
      },
    },
  })
  const data = await cloud.resendSignup('researcher@example.com', 'https://example.test/analysis/')
  assert.deepEqual(calls, [{
    type: 'signup',
    email: 'researcher@example.com',
    options: { emailRedirectTo: 'https://example.test/analysis/' },
  }])
  assert.deepEqual(data, { messageId: 'sent' })
})

test('explains an expired confirmation callback in Chinese', () => {
  assert.equal(
    authCallbackMessage('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    '验证链接已过期或已被使用，请重新发送验证邮件，并使用最新邮件中的链接。',
  )
  assert.equal(authCallbackMessage(''), '')
})

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
  const schedule = await readFile(new URL('../../../supabase/migrations/20260803073000_shimadzu_retention_schedule.sql', import.meta.url), 'utf8')
  const bootstrap = await readFile(new URL('../../../supabase/migrations/20260803080000_shimadzu_admin_bootstrap.sql', import.meta.url), 'utf8')
  const edgeFunction = await readFile(new URL('../../../supabase/functions/shimadzu-retention-cleanup/index.ts', import.meta.url), 'utf8')
  for (const required of [
    'enable row level security', "approval_status = 'approved'", "'shimadzu-results'", 'cleanup_expired_shimadzu_data',
    'result_expires_at', 'record_expires_at', 'review_shimadzu_user',
    'shimadzu-first-admin', 'first_account',
  ]) assert.match(sql.toLowerCase(), new RegExp(required.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(sql, /service[_-]?role[^\n]*frontend/i)
  assert.match(schedule, /cron\.schedule/)
  assert.match(schedule, /17 3 \* \* \*/)
  assert.match(edgeFunction, /storage\.from\('shimadzu-results'\)\.remove/)
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(bootstrap, /claim_first_shimadzu_admin/)
  assert.match(bootstrap, /administrator already initialized/)
  assert.match(bootstrap, /digest\(coalesce\(bootstrap_code/)
  assert.doesNotMatch(bootstrap, /bootstrap_code\s*=\s*['"][a-f0-9]{32}['"]/i)
})
