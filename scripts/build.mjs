import { build } from 'esbuild'
import { readFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Use explicit entry/output paths: platform-specific glob discovery must not
// silently report success while omitting the executable package entry.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  charset: 'utf8',
  external: Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }),
  keepNames: true,
  logLevel: 'info',
})
await access(resolve(root, pkg.main))
