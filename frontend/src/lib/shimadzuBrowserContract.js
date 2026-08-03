export const RESULT_RETENTION_DAYS = 7
export const RECORD_RETENTION_DAYS = 90
export const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024

const WORKER_EVENT_TYPES = new Set([
  'stage-start',
  'stage-progress',
  'stage-review',
  'stage-complete',
  'warning',
  'error',
  'complete',
  'cancelled',
])

const contractError = code => Object.assign(new Error(code), { code })

export function assertWorkbookFile(file) {
  if (!file || !/\.xlsx$/i.test(String(file.name || ''))) throw contractError('INVALID_XLSX_INPUT')
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_WORKBOOK_BYTES) throw contractError('WORKBOOK_TOO_LARGE')
  return file
}

export function expiryFrom(date, days) {
  const timestamp = new Date(date).getTime()
  if (!Number.isFinite(timestamp) || !Number.isInteger(days) || days < 0) throw contractError('INVALID_EXPIRY_INPUT')
  return new Date(timestamp + days * 86_400_000).toISOString()
}

export function validateWorkerEvent(event) {
  if (!event || !WORKER_EVENT_TYPES.has(event.type)) throw contractError('INVALID_WORKER_EVENT')
  if (event.type.startsWith('stage-')) {
    if (!Number.isInteger(event.stage) || event.stage < 0 || event.stage > 6) throw contractError('INVALID_WORKER_EVENT')
  }
  if (event.progress !== undefined && (!Number.isFinite(event.progress) || event.progress < 0 || event.progress > 100)) {
    throw contractError('INVALID_WORKER_EVENT')
  }
  return event
}

export const browserEnginePresentation = () => ({
  state: 'ready',
  title: '浏览器分析引擎已就绪',
  detail: '计算在当前设备中执行，原始工作簿不会上传云端。',
  chip: 'ENGINE BROWSER',
})
