import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadReleaseConfig } from './public-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = loadReleaseConfig(root)
const mode = process.argv[2] ?? 'default'
const nodeMajor = Number(process.versions.node.split('.')[0])
const local = new Set(config.localTests ?? [])
const workspace = new Set(config.workspaceTests ?? [])
const all = readdirSync(join(root, 'test'))
  .filter(file => file.endsWith('.test.ts'))
  .map(file => `test/${file}`)
  .sort()

let tests
if (mode === '--local') {
  if (nodeMajor < 22) throw new Error('本地维护测试要求 Node.js 22。')
  tests = all.filter(file => local.has(file))
}
else if (mode === '--workspace') {
  tests = all.filter(file => workspace.has(file))
}
else {
  tests = all.filter(file => !workspace.has(file) && !local.has(file))
}
if (!tests.length) {
  console.log('No matching tests for ' + mode + '.')
  process.exit(0)
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
