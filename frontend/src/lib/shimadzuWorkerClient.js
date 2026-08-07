import { validateWorkerEvent } from './shimadzuBrowserContract.js'

const cancelledError = () => Object.assign(new Error('ANALYSIS_CANCELLED'), { code: 'ANALYSIS_CANCELLED' })
const interruptedError = () => Object.assign(new Error('ANALYSIS_INTERRUPTED'), { code: 'ANALYSIS_INTERRUPTED' })

export function createShimadzuWorkerClient({
  WorkerCtor,
  workerUrl,
} = {}) {
  let worker
  let active

  const ensureWorker = () => {
    if (worker) return worker
    if (WorkerCtor) worker = new WorkerCtor(workerUrl, { type: 'module' })
    else if (globalThis.Worker) worker = new Worker(new URL('../workers/shimadzu.worker.js', import.meta.url), { type: 'module' })
    else throw new Error('WEB_WORKER_UNAVAILABLE')
    worker.onmessage = ({ data }) => {
      if (!active) return
      try {
        validateWorkerEvent(data)
        active.onEvent(data)
        if (data.type === 'complete') {
          const resolve = active.resolve
          active = null
          resolve(data)
        } else if (data.type === 'error' || data.type === 'cancelled') {
          const reject = active.reject
          active = null
          reject(Object.assign(new Error(data.message || data.code || data.type), {
            code: data.code || data.type,
            details: data.details,
            archiveBytes: data.archiveBytes,
            archiveSha256: data.archiveSha256,
            archiveSize: data.archiveSize,
            fileName: data.fileName,
          }))
        }
      } catch (error) {
        const reject = active?.reject
        active = null
        reject?.(error)
      }
    }
    worker.onerror = event => {
      const reject = active?.reject
      active = null
      reject?.(Object.assign(new Error(event.message || 'WORKER_RUNTIME_ERROR'), { code: 'WORKER_RUNTIME_ERROR' }))
    }
    return worker
  }

  return {
    run({ rawBytes, sampleBytes, rawName, sampleName, name, mode = 'continuous', resumeFromStage = 0, onEvent = () => {} }) {
      if (active) return Promise.reject(new Error('ANALYSIS_ALREADY_RUNNING'))
      const instance = ensureWorker()
      return new Promise((resolve, reject) => {
        active = { resolve, reject, onEvent }
        instance.postMessage({ type: 'start', rawBytes, sampleBytes, rawName, sampleName, name, mode, resumeFromStage }, [rawBytes, sampleBytes])
      })
    },
    cancel() {
      if (!active) return
      worker?.postMessage({ type: 'cancel' })
      const reject = active.reject
      active = null
      reject(cancelledError())
    },
    continueReview() {
      worker?.postMessage({ type: 'continue' })
    },
    dispose() {
      if (active) {
        active.reject(interruptedError())
        active = null
      }
      worker?.terminate()
      worker = null
    },
  }
}
