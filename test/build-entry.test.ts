import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mkdtemp, cp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

it('builds an executable entry with explicit paths and fails when source is missing', async () => {
  // Place under this package for dependency resolution, but never overwrite lib.
  const directory = await mkdtemp(join(process.cwd(), '.build-check-'))
  try {
    await cp(join(process.cwd(), 'src'), join(directory, 'src'), { recursive: true })
    await mkdir(join(directory, 'scripts'))
    await cp(join(process.cwd(), 'scripts/build.mjs'), join(directory, 'scripts/build.mjs'))
    await cp(join(process.cwd(), 'package.json'), join(directory, 'package.json'))
    await cp(join(process.cwd(), 'tsconfig.json'), join(directory, 'tsconfig.json'))
    const command = () => spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: directory, encoding: 'utf8' })
    const result = command()
    assert.equal(result.status, 0, result.stderr)
    const require = createRequire(join(directory, 'package.json'))
    const plugin = require(join(directory, 'lib/index.js'))
    assert.equal(plugin.name, 'undercover-game'); assert.equal(typeof plugin.apply, 'function')
    assert.ok((await readFile(join(directory, 'lib/index.js'), 'utf8')).length > 1000)
    // Compile errors propagate rather than masquerading as successful builds.
    await writeFile(join(directory, 'src/index.ts'), 'import "./does-not-exist"')
    assert.notEqual(command().status, 0)
  } finally {
    assert.ok(directory.startsWith(join(process.cwd(), '.build-check-')))
    // Windows scanners can briefly hold freshly emitted files after the child
    // exits. Retry cleanup without weakening any build/load assertions.
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
