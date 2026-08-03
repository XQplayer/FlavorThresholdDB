import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const distDirectory = path.resolve(process.argv[2] ?? 'dist')
const source = path.join(distDirectory, 'index.html')

for (const route of ['aroma-threshold', 'shimadzu-analysis']) {
  const routeDirectory = path.join(distDirectory, route)
  await mkdir(routeDirectory, { recursive: true })
  await copyFile(source, path.join(routeDirectory, 'index.html'))
}
