import { runShimadzuBrowserPipeline } from './shimadzuPipeline.js'

let controller = null
let reviewResolver = null

const waitForReview = () => new Promise(resolve => { reviewResolver = resolve })

self.onmessage = async ({ data }) => {
  if (data?.type === 'cancel') {
    controller?.abort()
    reviewResolver?.()
    reviewResolver = null
    return
  }
  if (data?.type === 'continue') {
    reviewResolver?.()
    reviewResolver = null
    return
  }
  if (data?.type !== 'start' || controller) return

  controller = new AbortController()
  try {
    const resumeFromStage = Number.isInteger(data.resumeFromStage) ? Math.max(0, Math.min(6, data.resumeFromStage)) : 0
    const result = await runShimadzuBrowserPipeline({
      ...data,
      signal: controller.signal,
      onEvent: event => {
        if (event.type !== 'complete') self.postMessage(event)
      },
      reviewGate: data.mode === 'step'
        ? stage => stage < resumeFromStage ? Promise.resolve() : waitForReview()
        : undefined,
    })
    const archiveBytes = result.archiveBytes.buffer
    self.postMessage({
      type: 'complete',
      progress: 100,
      fileName: result.fileName,
      archiveBytes,
      archiveSha256: result.archiveSha256,
      archiveSize: result.archiveBytes.byteLength,
      completedAt: result.completedAt,
      stageSummaries: result.stages.map(stage => ({ stage: stage.stage, counts: stage.counts, issues: stage.issues?.length || 0 })),
    }, [archiveBytes])
  } catch (error) {
    const cancelled = controller.signal.aborted || error?.code === 'ANALYSIS_CANCELLED'
    if (cancelled) {
      self.postMessage({ type: 'cancelled', code: 'ANALYSIS_CANCELLED', message: '分析已取消' })
    } else {
      const payload = {
        type: 'error', code: error?.code || 'BROWSER_ANALYSIS_FAILED',
        message: error?.message || String(error), details: error?.details,
        archiveSha256: error?.archiveSha256, archiveSize: error?.archiveSize, fileName: error?.fileName,
      }
      const archiveBytes = error?.archiveBytes instanceof Uint8Array
        ? error.archiveBytes
        : error?.archiveBytes ? new Uint8Array(error.archiveBytes) : null
      if (archiveBytes) {
        payload.archiveBytes = archiveBytes.buffer
        self.postMessage(payload, [payload.archiveBytes])
      } else self.postMessage(payload)
    }
  } finally {
    controller = null
    reviewResolver = null
  }
}
