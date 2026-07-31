import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('static route generator creates an index entry for aroma-threshold', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flavorthresholddb-routes-'))
  const dist = path.join(root, 'dist')
  await mkdir(dist)
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>FlavorThresholdDB</title>')

  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/create-static-routes.mjs'), dist],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    await readFile(path.join(dist, 'aroma-threshold', 'index.html'), 'utf8'),
    '<!doctype html><title>FlavorThresholdDB</title>',
  )
})

