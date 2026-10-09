import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { auditPublicFiles } from './public-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'release.config.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
function runNpm(args, cwd) {
  if (process.env.npm_execpath) {
    return spawnSync(process.env.npm_node_execpath ?? process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      encoding: 'utf8',
    })
  }
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], {
      cwd,
      encoding: 'utf8',
    })
  }
  return spawnSync('npm', args, { cwd, encoding: 'utf8' })
}
const pack = runNpm(['pack', '--json'], root)
if (pack.error) throw pack.error
if (pack.status !== 0) throw new Error(pack.stderr || 'npm pack failed')
const result = JSON.parse(pack.stdout)[0]
const names = new Set(result.files.map(file => file.path.replaceAll('\\', '/')))
const tarball = join(root, result.filename)
const smoke = mkdtempSync(join(tmpdir(), 'koishi-plugin-smoke-'))
try {
  writeFileSync(join(smoke, 'package.json'), JSON.stringify({ name: 'local-package-smoke', version: '0.0.0', private: true }))
  for (const required of config.packageRequired) {
    if (!names.has(required)) throw new Error('npm 包缺少必需文件：' + required)
  }
  for (const name of names) {
    if (config.packageForbiddenPrefixes.some(prefix => name.startsWith(prefix))) {
      throw new Error('npm 包包含禁止路径：' + name)
    }
  }
  const install = runNpm([
    'install', '--prefix', smoke, '--global=false', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ], smoke)
  if (install.error) throw install.error
  if (install.status !== 0) throw new Error(install.stderr || 'tarball install failed')
  const require = createRequire(join(smoke, 'smoke.cjs'))
  // Inspect the files extracted from the actual tarball, not the source tree.
  auditPublicFiles(join(smoke, 'node_modules', pkg.name), [...names])
  const installedRoot = join(smoke, 'node_modules', pkg.name)
  const entry = require.resolve(installedRoot)
  if (!realpathSync(entry).startsWith(realpathSync(installedRoot) + sep)) {
    throw new Error('插件加载路径不是刚安装的 tarball。')
  }
  const plugin = require(installedRoot)
  if (plugin.name !== pkg.name.replace(/^koishi-plugin-/, '') || typeof plugin.apply !== 'function') {
    throw new Error('安装后的插件未导出预期 name/apply。')
  }
  console.log(`Package audit passed: ${basename(tarball)}, ${result.entryCount} files, ${result.size} bytes.`)
}
finally {
  rmSync(smoke, { recursive: true, force: true })
  rmSync(tarball, { force: true })
}
