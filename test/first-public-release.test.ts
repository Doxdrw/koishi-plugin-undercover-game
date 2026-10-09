import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { loadReleaseConfig, publicFiles } from '../scripts/public-release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

it('presents one first public release without local database history', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  assert.deepEqual(changelog.match(/^## .+$/gm), [`## ${pkg.version}`])
  for (const path of ['README.md', 'CHANGELOG.md', 'GAME_GUIDE.md', 'test/README.md']) {
    const text = readFileSync(join(root, path), 'utf8')
    assert.doesNotMatch(text, /迁移|legacy|旧版|旧(?:表|库|数据|日志|实例)|账号存储切换|停机备份并|沿原流程|沿用原有|原有格式/, path)
  }
})

it('exports only current public tools and keeps local maintenance outside the public tree', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const files = publicFiles(root, loadReleaseConfig(root))
  assert.ok(!files.includes('release.local.json'))
  assert.ok(!files.some((file: string) => /migration|migrate|legacy-cleanup/.test(file)))
  assert.doesNotMatch(JSON.stringify(pkg.bin ?? {}), /migrate|migration/)
  assert.doesNotMatch(readFileSync(join(root, 'release.config.json'), 'utf8'), /migration|migrate|legacy-cleanup/i)
  assert.deepEqual(pkg.bin ?? {}, {})
  assert.ok(!pkg.files.some((file: string) => file.startsWith('scripts/')))
})

it('validates optional local-only exclusions without changing the public configuration file', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'release-local-scope-'))
  const raw = JSON.stringify({ publicEntries: ['test'], privateEntries: [], publicExcludedPaths: [] })
  try {
    writeFileSync(join(fixture, 'release.config.json'), raw)
    assert.deepEqual(loadReleaseConfig(fixture).publicExcludedPaths, [])
    writeFileSync(join(fixture, 'release.local.json'), JSON.stringify({
      publicExcludedPaths: ['test/local-only.test.ts'], localTests: ['test/local-only.test.ts'],
    }))
    assert.deepEqual(loadReleaseConfig(fixture).publicExcludedPaths, ['test/local-only.test.ts'])
    assert.equal(readFileSync(join(fixture, 'release.config.json'), 'utf8'), raw)
    writeFileSync(join(fixture, 'release.local.json'), '{"publicExcludedPaths":["../escape"]}')
    assert.throws(() => loadReleaseConfig(fixture), /非法发布清单路径/)
    writeFileSync(join(fixture, 'release.local.json'), '{"localTests":"invalid"}')
    assert.throws(() => loadReleaseConfig(fixture), /路径数组/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
