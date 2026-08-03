const DEFAULT_API_BASE = 'http://127.0.0.1:8787'

export const buildShimadzuUrl = (base = DEFAULT_API_BASE, path = '') => (
  `${base.replace(/\/$/, '')}/shimadzu/${path.replace(/^\//, '')}`
)

const parseResponse = async response => {
  if (response.ok) return response.json()
  let payload = {}
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }
  const error = new Error(payload.error || `请求失败 (${response.status})`)
  error.code = payload.code || 'REQUEST_FAILED'
  error.status = response.status
  throw error
}

export const getStageProgress = job => {
  const stages = job?.stages || []
  const completed = stages.filter(stage => ['PASS', 'WARN', 'REVIEW'].includes(stage.status)).length
  return { completed, total: stages.length }
}

export const isActiveJob = job => ['queued', 'running'].includes(job?.status)

export const getEnginePresentation = capabilities => {
  if (!capabilities) {
    return {
      state: 'checking',
      title: '正在连接分析引擎',
      detail: '正在检测本机运行时与已部署 skill。',
      chip: 'ENGINE CHECK',
    }
  }
  if (capabilities.available) {
    return {
      state: 'ready',
      title: '本地分析引擎已就绪',
      detail: 'OAV 暂未启用，结果保留完整审计链。',
      chip: 'ENGINE ONLINE',
    }
  }
  return {
    state: 'unavailable',
    title: '当前部署未连接分析引擎',
    detail: '可下载模板；正式分析请在本地工作台运行。',
    chip: 'ENGINE LOCAL ONLY',
  }
}

export const getMonitorStageIndex = (job, totalStages = 7) => {
  if (!job) return 0
  const active = job.stages?.findIndex(stage => stage.status === 'running') ?? -1
  if (active >= 0) return active
  const failed = job.stages?.findIndex(stage => stage.status === 'FAIL') ?? -1
  if (failed >= 0) return failed
  const pending = Math.min(job.next_stage ?? 0, totalStages - 1)
  if (job.status === 'waiting_review') return Math.max(0, pending - 1)
  if (job.status === 'complete') return totalStages - 1
  return pending
}

export const createShimadzuApi = (base = DEFAULT_API_BASE) => ({
  async capabilities() {
    return parseResponse(await fetch(buildShimadzuUrl(base, '/capabilities')))
  },
  async createJob({ rawFile, samplesFile, name, mode }) {
    const form = new FormData()
    form.append('raw', rawFile)
    form.append('samples', samplesFile)
    form.append('options', JSON.stringify({ name, mode }))
    return parseResponse(await fetch(buildShimadzuUrl(base, '/jobs'), { method: 'POST', body: form }))
  },
  async run(jobId) {
    return parseResponse(await fetch(buildShimadzuUrl(base, `/jobs/${encodeURIComponent(jobId)}/run`), { method: 'POST' }))
  },
  async continueJob(jobId) {
    return parseResponse(await fetch(buildShimadzuUrl(base, `/jobs/${encodeURIComponent(jobId)}/continue`), { method: 'POST' }))
  },
  async getJob(jobId) {
    return parseResponse(await fetch(buildShimadzuUrl(base, `/jobs/${encodeURIComponent(jobId)}`)))
  },
  downloadUrl(jobId) {
    return buildShimadzuUrl(base, `/jobs/${encodeURIComponent(jobId)}/download`)
  },
  templateUrl(templateId) {
    return buildShimadzuUrl(base, `/templates/${encodeURIComponent(templateId)}`)
  },
})
