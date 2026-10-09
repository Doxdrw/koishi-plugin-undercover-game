import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPublicFiles, exportPublicTree, loadReleaseConfig, publicFiles } from './public-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = loadReleaseConfig(root)
if (process.argv.includes('--force')) throw new Error('--force 已移除；请提供新的或空的导出目录。')
if (process.argv.includes('--check')) {
  const files = publicFiles(root, config)
  auditPublicFiles(root, files)
  console.log('Public export paths and contents passed: ' + files.length + ' files.')
} else {
  const target = process.argv[2]
  if (!target || target.startsWith('--')) throw new Error('请提供公开镜像导出目录，或使用 --check。')
  console.log('Exported public repository files: ' + exportPublicTree(root, target, config))
}
