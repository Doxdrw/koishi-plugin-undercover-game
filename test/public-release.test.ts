import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { it } from 'node:test'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertPublicContent, auditPublicFiles, exportPublicTree, publicFiles, validateExportTarget } from '../scripts/public-release.mjs'
import { png } from './image-fixtures'

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

function withCardAssets(check: (root: string, manifest: any) => void) {
  const root = mkdtempSync(join(tmpdir(), 'release-card-assets-'))
  const dir = join(root, 'uc-pics')
  const image = png(1)
  const manifest = {
    schemaVersion: 1, setId: 'default-heroes-v1', status: 'final', width: 1, height: 1,
    cards: [{ heroId: 0, heroKey: 'example-hero', heroName: '示例武将', fileName: '示例武将卡面.png',
      sha256: createHash('sha256').update(image).digest('hex') }],
  }
  mkdirSync(dir)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'ASSET-LICENSE.md'), 'Example asset license')
  writeFileSync(join(dir, manifest.cards[0].fileName), image)
  try { check(root, manifest) }
  finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('release-card-assets-'))
    rmSync(root, { recursive: true, force: true })
  }
}

const auditCards = (root: string) => auditPublicFiles(root, ['uc-pics/manifest.json'])

it('accepts a complete card set at the public export and extracted-package boundary', () => {
  withCardAssets(root => assert.doesNotThrow(() => auditCards(root)))
})

it('rejects a referenced card omitted from an extracted package', () => {
  withCardAssets((root, manifest) => {
    rmSync(join(root, 'uc-pics', manifest.cards[0].fileName))
    assert.throws(() => auditCards(root), /卡面目录与清单不一致/)
  })
})

it('rejects cards or design files absent from the public card manifest', () => {
  withCardAssets(root => {
    writeFileSync(join(root, 'uc-pics', 'unlisted.png'), png(2))
    assert.throws(() => auditCards(root), /卡面目录与清单不一致/)
  })
})

it('rejects a packaged card whose bytes no longer match its manifest', () => {
  withCardAssets((root, manifest) => {
    writeFileSync(join(root, 'uc-pics', manifest.cards[0].fileName), png(2))
    assert.throws(() => auditCards(root), /卡面哈希校验失败/)
  })
})

it('rejects card dimensions that disagree with the manifest', () => {
  withCardAssets((root, manifest) => {
    manifest.width = 2
    writeFileSync(join(root, 'uc-pics', 'manifest.json'), JSON.stringify(manifest))
    assert.throws(() => auditCards(root), /卡面PNG尺寸与清单不符/)
  })
})

it('rejects unsafe filenames and reordered identities in a card manifest', () => {
  withCardAssets((root, manifest) => {
    manifest.cards[0].fileName = '../outside.png'
    writeFileSync(join(root, 'uc-pics', 'manifest.json'), JSON.stringify(manifest))
    assert.throws(() => auditCards(root), /卡面清单文件名无效/)
    manifest.cards[0].fileName = '示例武将卡面.png'
    manifest.cards[0].heroId = 1
    writeFileSync(join(root, 'uc-pics', 'manifest.json'), JSON.stringify(manifest))
    assert.throws(() => auditCards(root), /卡面清单身份映射无效/)
  })
})
