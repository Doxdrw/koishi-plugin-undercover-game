import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { it } from 'node:test'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertPublicContent, exportPublicTree, publicFiles, validateExportTarget } from '../scripts/public-release.mjs'

it('exports only audited public files and never deletes a nonempty or overlapping target', () => {
  const temp = mkdtempSync(join(tmpdir(), 'release-boundary-'))
  const root = join(temp, 'private')
  const target = join(temp, 'public')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'example.txt'), 'ExamplePlayer')
  writeFileSync(join(root, 'src', 'local.txt'), 'private fixture')
  const config = { publicEntries: ['src'], privateEntries: ['data'], publicExcludedPaths: ['src/local.txt'] }
  try {
    assert.deepEqual(publicFiles(root, config), ['src/example.txt'])
    for (const invalid of [root, temp, dirname(temp), parse(temp).root, join(root, 'child')]) {
      assert.throws(() => validateExportTarget(root, invalid), /祖先或子目录/)
    }
    assert.equal(exportPublicTree(root, target, config), 1)
    assert.equal(readFileSync(join(target, 'src', 'example.txt'), 'utf8'), 'ExamplePlayer')
    assert.throws(() => exportPublicTree(root, target, config), /不会删除/)
    const forced = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/export-public.mjs', import.meta.url)), target, '--force'], { encoding: 'utf8' })
    assert.notEqual(forced.status, 0)
    assert.match(forced.stderr, /--force 已移除/)
    assert.equal(readFileSync(join(target, 'src', 'example.txt'), 'utf8'), 'ExamplePlayer')
    for (const bad of ['../escape', '/absolute', 'src/../../escape', 'src\\escape', 'C:escape']) {
      assert.throws(() => publicFiles(root, { ...config, publicEntries: [bad] }), /非法发布清单路径/)
      assert.throws(() => publicFiles(root, { ...config, publicExcludedPaths: [bad] }), /非法发布清单路径/)
    }
    assert.throws(() => publicFiles(root, { ...config, privateEntries: ['src'] }), /私有路径/)
    const link = join(temp, 'linked-root')
    symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => validateExportTarget(root, join(link, 'child')), /祖先或子目录/)
    symlinkSync(target, join(root, 'src', 'external'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => publicFiles(root, config), /目录链接/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

it('checks text and binary content while allowing attribution only in designated fields', () => {
  const secretName = ['Synthetic', 'PrivateName'].join('')
  assert.throws(() => assertPublicContent('src/example.ts', secretName, [secretName]), /私有检查值/)
  assertPublicContent('package.json', JSON.stringify({ author: secretName, description: 'Example' }), [secretName])
  assert.throws(() => assertPublicContent('package.json', JSON.stringify({ author: secretName, description: secretName }), [secretName]), /私有检查值/)
  assertPublicContent('LICENSE', 'Copyright ' + secretName, [secretName])
  assert.throws(() => assertPublicContent('README.md', 'Copyright ' + secretName, [secretName]), /私有检查值/)
  const localPath = ['C:', 'Users', 'ExampleAccount', 'config'].join('\\')
  assert.throws(() => assertPublicContent('lib/example.js', localPath), /机器路径/)
  assert.throws(() => assertPublicContent('card.png', Buffer.from('\0' + localPath)), /机器路径/)
  assert.throws(() => assertPublicContent('README.md', 'npm_' + 'a'.repeat(36)), /凭据/)
  assertPublicContent('README.md', '示例玩家')
})

it('inspects compressed PNG text but does not mistake compressed pixels for private text', () => {
  const value = ['Synthetic', 'PrivateName'].join('')
  function chunk(type: string, data: Buffer) {
    const result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length)
    result.write(type, 4)
    data.copy(result, 8)
    return result
  }
  const signature = Buffer.from('89504e470d0a1a0a', 'hex')
  assertPublicContent('card.png', Buffer.concat([signature, chunk('IDAT', Buffer.from(value))]), [value])
  const metadata = Buffer.concat([Buffer.from('Comment'), Buffer.alloc(2), deflateSync(Buffer.from(value))])
  assert.throws(() => assertPublicContent('card.png', Buffer.concat([signature, chunk('zTXt', metadata)]), [value]), /私有检查值/)
})
