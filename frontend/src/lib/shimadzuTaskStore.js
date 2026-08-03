const DATABASE_NAME = 'flavor-threshold-db'
const DATABASE_VERSION = 1
const OBJECT_STORE = 'shimadzu-active-tasks'
const ACTIVE_TASK_SCHEMA = 'shimadzu-active-task-1'
const ACTIVE_INPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const taskKeys = scope => {
  const prefix = `shimadzu-active:${String(scope || 'local')}`
  return [`${prefix}:meta`, `${prefix}:raw`, `${prefix}:samples`]
}

const requestValue = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('INDEXED_DB_REQUEST_FAILED'))
})

const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = () => reject(transaction.error || new Error('INDEXED_DB_TRANSACTION_ABORTED'))
  transaction.onerror = () => reject(transaction.error || new Error('INDEXED_DB_TRANSACTION_FAILED'))
})

export function createIndexedDbTaskAdapter(indexedDBApi = globalThis.indexedDB) {
  if (!indexedDBApi) throw Object.assign(new Error('当前浏览器无法保存恢复数据，不能安全启动分析。'), { code: 'INDEXED_DB_UNAVAILABLE' })

  let databasePromise
  const database = () => {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBApi.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('INDEXED_DB_OPEN_FAILED'))
      request.onblocked = () => reject(new Error('INDEXED_DB_UPGRADE_BLOCKED'))
    })
    return databasePromise
  }

  return {
    async getMany(keys) {
      const db = await database()
      const transaction = db.transaction(OBJECT_STORE, 'readonly')
      const store = transaction.objectStore(OBJECT_STORE)
      const values = await Promise.all(keys.map(key => requestValue(store.get(key))))
      await transactionDone(transaction)
      return values
    },
    async putMany(entries) {
      const db = await database()
      const transaction = db.transaction(OBJECT_STORE, 'readwrite')
      const store = transaction.objectStore(OBJECT_STORE)
      for (const [key, value] of entries) store.put(value, key)
      await transactionDone(transaction)
    },
    async deleteMany(keys) {
      const db = await database()
      const transaction = db.transaction(OBJECT_STORE, 'readwrite')
      const store = transaction.objectStore(OBJECT_STORE)
      for (const key of keys) store.delete(key)
      await transactionDone(transaction)
    },
  }
}

const workbookBuffer = value => {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  throw Object.assign(new Error('ACTIVE_TASK_WORKBOOK_BUFFER_REQUIRED'), { code: 'ACTIVE_TASK_WORKBOOK_BUFFER_REQUIRED' })
}

export function createShimadzuTaskStore({ adapter, now = () => new Date() } = {}) {
  const storage = adapter || createIndexedDbTaskAdapter()

  return {
    async save(task) {
      if (!task?.id) throw Object.assign(new Error('ACTIVE_TASK_ID_REQUIRED'), { code: 'ACTIVE_TASK_ID_REQUIRED' })
      const scope = String(task.scope || task.userId || 'local')
      const [metaKey, rawKey, samplesKey] = taskKeys(scope)
      const savedAt = now().toISOString()
      const meta = {
        ...task,
        scope,
        schemaVersion: ACTIVE_TASK_SCHEMA,
        savedAt,
        expiresAt: task.expiresAt || new Date(now().getTime() + ACTIVE_INPUT_RETENTION_MS).toISOString(),
      }
      delete meta.rawBytes
      delete meta.sampleBytes
      await storage.putMany([
        [metaKey, meta],
        [rawKey, workbookBuffer(task.rawBytes)],
        [samplesKey, workbookBuffer(task.sampleBytes)],
      ])
      return meta
    },

    async load(scope = 'local') {
      const keys = taskKeys(scope)
      const [meta, rawBytes, sampleBytes] = await storage.getMany(keys)
      if (!meta) return null
      if (meta.schemaVersion !== ACTIVE_TASK_SCHEMA || !rawBytes || !sampleBytes || new Date(meta.expiresAt).getTime() <= now().getTime()) {
        await storage.deleteMany(keys)
        return null
      }
      return { ...meta, rawBytes, sampleBytes }
    },

    async update(scope = 'local', patch = {}) {
      const [metaKey] = taskKeys(scope)
      const [current] = await storage.getMany([metaKey])
      if (!current) return null
      const next = { ...current, ...patch, scope: current.scope, schemaVersion: ACTIVE_TASK_SCHEMA, savedAt: now().toISOString() }
      delete next.rawBytes
      delete next.sampleBytes
      await storage.putMany([[metaKey, next]])
      return next
    },

    async clear(scope = 'local') {
      await storage.deleteMany(taskKeys(scope))
    },
  }
}
