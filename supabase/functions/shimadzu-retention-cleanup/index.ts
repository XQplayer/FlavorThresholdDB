import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'MISSING_RUNTIME_SECRET' }, 500)

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = new Date().toISOString()

  const { data: expiredResults, error: selectError } = await admin
    .from('shimadzu_jobs')
    .select('id,result_path')
    .not('result_path', 'is', null)
    .lte('result_expires_at', now)
    .limit(1000)
  if (selectError) return json({ error: selectError.message }, 500)

  const paths = (expiredResults || []).map(item => item.result_path).filter(Boolean)
  if (paths.length) {
    const { error: storageError } = await admin.storage.from('shimadzu-results').remove(paths)
    if (storageError) return json({ error: storageError.message }, 500)
    const ids = expiredResults.map(item => item.id)
    const { error: updateError } = await admin.from('shimadzu_jobs').update({
      result_path: null,
      result_sha256: null,
      result_size: null,
      status: 'expired',
    }).in('id', ids)
    if (updateError) return json({ error: updateError.message }, 500)
  }

  const { data: removedJobs, error: deleteError } = await admin
    .from('shimadzu_jobs')
    .delete()
    .lte('record_expires_at', now)
    .select('id')
  if (deleteError) return json({ error: deleteError.message }, 500)

  return json({ status: 'PASS', removed_results: paths.length, removed_jobs: removedJobs?.length || 0, checked_at: now })
})
