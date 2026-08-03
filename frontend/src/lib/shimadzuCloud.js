import { RECORD_RETENTION_DAYS, RESULT_RETENTION_DAYS, expiryFrom } from './shimadzuBrowserContract.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requireClient = client => {
  if (!client) throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'), { code: 'SUPABASE_NOT_CONFIGURED' })
  return client
}
const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

export function resultObjectPath(userId, jobId) {
  if (!UUID.test(userId) || !UUID.test(jobId)) throw Object.assign(new Error('INVALID_STORAGE_ID'), { code: 'INVALID_STORAGE_ID' })
  return `${userId}/${jobId}/result.zip`
}

export function retentionColumns(now = new Date().toISOString()) {
  return {
    result_expires_at: expiryFrom(now, RESULT_RETENTION_DAYS),
    record_expires_at: expiryFrom(now, RECORD_RETENTION_DAYS),
  }
}

export function createShimadzuCloud(client) {
  return {
    configured: Boolean(client),
    async session() {
      if (!client) return null
      return unwrap(await client.auth.getSession())?.session ?? null
    },
    onAuthChange(callback) {
      if (!client) return () => {}
      const { data } = client.auth.onAuthStateChange((_event, session) => callback(session))
      return () => data.subscription.unsubscribe()
    },
    async signUp(email, password, displayName, redirectTo) {
      return unwrap(await requireClient(client).auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: redirectTo } }))
    },
    async signIn(email, password) {
      return unwrap(await requireClient(client).auth.signInWithPassword({ email, password }))
    },
    async signOut() {
      return unwrap(await requireClient(client).auth.signOut())
    },
    async profile(userId) {
      return unwrap(await requireClient(client).from('profiles').select('*').eq('id', userId).single())
    },
    async listJobs() {
      return unwrap(await requireClient(client).from('shimadzu_jobs').select('*').order('created_at', { ascending: false }).limit(100)) || []
    },
    async createJob({ id, userId, name, mode, sourceNames }) {
      const now = new Date().toISOString()
      return unwrap(await requireClient(client).from('shimadzu_jobs').insert({
        id, user_id: userId, name, mode, status: 'running', current_stage: 0, progress: 0,
        source_names: sourceNames, ...retentionColumns(now),
      }).select().single())
    },
    async updateJob(id, patch) {
      return unwrap(await requireClient(client).from('shimadzu_jobs').update(patch).eq('id', id).select().single())
    },
    async uploadResult({ userId, jobId, archiveBytes, sha256 }) {
      const path = resultObjectPath(userId, jobId)
      const body = archiveBytes instanceof Blob ? archiveBytes : new Blob([archiveBytes], { type: 'application/zip' })
      unwrap(await requireClient(client).storage.from('shimadzu-results').upload(path, body, { contentType: 'application/zip', upsert: true }))
      return this.updateJob(jobId, { result_path: path, result_sha256: sha256, result_size: body.size, status: 'complete', progress: 100, completed_at: new Date().toISOString() })
    },
    async downloadUrl(path) {
      return unwrap(await requireClient(client).storage.from('shimadzu-results').createSignedUrl(path, 300))?.signedUrl
    },
    async pendingUsers() {
      return unwrap(await requireClient(client).from('profiles').select('id,display_name,approval_status,requested_at,reviewed_at').eq('approval_status', 'pending').order('requested_at')) || []
    },
    async reviewUser(userId, status) {
      return unwrap(await requireClient(client).rpc('review_shimadzu_user', { target_user_id: userId, target_status: status }))
    },
    async claimFirstAdmin(bootstrapCode) {
      return unwrap(await requireClient(client).rpc('claim_first_shimadzu_admin', { bootstrap_code: bootstrapCode }))
    },
  }
}
