import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

function publicText(input) {
  if (!Buffer.isBuffer(input)) return String(input)
  if (input.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return input.toString('utf8')
  const parts = []
  let offset = 8
  while (offset + 12 <= input.length) {
    const size = input.readUInt32BE(offset)
    if (offset + 12 + size > input.length) throw new Error('PNG 元数据截断。')
    const type = input.toString('ascii', offset + 4, offset + 8)
    const data = input.subarray(offset + 8, offset + 8 + size)
    // Compressed pixels can coincidentally contain short names: inspect metadata,
    // not IDAT bytes. Asset structure/hash validation is a separate release gate.
    if (type === 'zTXt') {
      const end = data.indexOf(0)
      if (end < 0 || data[end + 1] !== 0) throw new Error('PNG 文本压缩格式无效。')
      parts.push(data.subarray(0, end), inflateSync(data.subarray(end + 2), { maxOutputLength: 1048576 }))
    } else if (type === 'iTXt') {
      const keyword = data.indexOf(0)
      const language = data.indexOf(0, keyword + 3)
      const translated = data.indexOf(0, language + 1)
      if (keyword < 0 || language < 0 || translated < 0) throw new Error('PNG 国际文本格式无效。')
      const text = data.subarray(translated + 1)
      parts.push(data.subarray(0, translated), data[keyword + 1] === 1
        ? inflateSync(text, { maxOutputLength: 1048576 }) : text)
    } else if (type !== 'IDAT') parts.push(data)
    offset += size + 12
  }
  parts.push(input.subarray(offset))
  return parts.map(part => part.toString('utf8')).join('\n')
}

function below(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel))
}

function safeEntry(entry) {
  if (typeof entry !== 'string' || !entry || entry.includes('\\') || entry.includes(':')
    || isAbsolute(entry) || entry.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('非法发布清单路径。')
  }
  return entry
}

export function loadReleaseConfig(root) {
  const config = JSON.parse(readFileSync(join(root, 'release.config.json'), 'utf8'))
  const localPath = join(root, 'release.local.json')
  if (!existsSync(localPath)) return config
  const local = JSON.parse(readFileSync(localPath, 'utf8'))
  for (const key of ['publicExcludedPaths', 'localTests', 'workspaceTests']) {
    const entries = local[key] ?? []
    if (!Array.isArray(entries)) throw new Error('本地维护清单必须是路径数组：' + key)
    config[key] = [...new Set([...(config[key] ?? []), ...entries.map(safeEntry)])]
  }
  return config
}

function canonicalDestination(path) {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  if (parent === path) throw new Error('无法确认导出目录的真实路径。')
  return join(canonicalDestination(parent), relative(parent, path))
}

export function validateExportTarget(root, rawTarget) {
  const source = realpathSync(root)
  const target = canonicalDestination(resolve(rawTarget))
  if (target === parse(target).root || below(source, target) || below(target, source)) {
    throw new Error('导出目录不得是根目录、源目录、源目录祖先或子目录。')
  }
  if (existsSync(target) && (!lstatSync(target).isDirectory() || readdirSync(target).length)) {
    throw new Error('导出目录必须不存在或为空；不会删除已有内容，--force 也不可覆盖。')
  }
  return target
}

export function publicFiles(root, config) {
  const source = realpathSync(root)
  const entries = config.publicEntries.map(safeEntry)
  const privateEntries = config.privateEntries.map(safeEntry)
  const excluded = (config.publicExcludedPaths ?? []).map(safeEntry)
  const contains = (parent, child) => child === parent || child.startsWith(parent + '/')
  const skip = name => excluded.some(entry => contains(entry, name))
  const files = new Set()
  function walk(name) {
    if (skip(name)) return
    if (privateEntries.some(entry => contains(entry, name))) throw new Error('公开清单包含私有路径：' + name)
    const path = join(source, name)
    if (!existsSync(path)) throw new Error('公开导出项不存在：' + name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !below(source, realpathSync(path))) throw new Error('公开导出不允许目录链接：' + name)
    if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) walk(name + '/' + safeEntry(child))
    } else if (stat.isFile()) files.add(name)
    else throw new Error('公开导出只允许普通文件：' + name)
  }
  for (const entry of entries) walk(entry)
  return [...files].sort()
}

export function assertPublicContent(name, input, privateValues = []) {
  let text = publicText(input)
  // Attribution is an intentional public field, not an exemption for examples elsewhere.
  if (name === 'package.json') {
    const metadata = JSON.parse(text)
    delete metadata.author
    text = JSON.stringify(metadata)
  }
  if (/^(?:LICENSE(?:\.md)?|uc-pics\/ASSET-LICENSE\.md)$/.test(name)) {
    text = text.replace(/^.*(?:Copyright|版权).*$/gmi, '')
  }
  if (privateValues.some(value => typeof value === 'string' && value.length > 0 && text.includes(value))) {
    throw new Error('公开内容包含私有检查值：' + name)
  }
  const rules = [
    /[A-Z]:[\\/]+(?:Users|dev)[\\/]+[A-Za-z0-9_.-]+/i,
    /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{32,})\b/,
  ]
  if (rules.some(rule => rule.test(text))) throw new Error('公开内容包含疑似机器路径或凭据：' + name)
}

export function privateReleaseValues() {
  const values = JSON.parse(process.env.PUBLIC_RELEASE_PRIVATE_VALUES_JSON ?? '[]')
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)) {
    throw new Error('私有发布检查值必须是非空字符串数组。')
  }
  return values
}

export function auditPublicFiles(root, files, privateValues = privateReleaseValues()) {
  for (const name of files) assertPublicContent(name, readFileSync(join(root, name)), privateValues)
}

export function exportPublicTree(root, rawTarget, config) {
  const files = publicFiles(root, config)
  auditPublicFiles(root, files)
  const target = validateExportTarget(root, rawTarget)
  mkdirSync(target, { recursive: true })
  for (const name of files) {
    const destination = join(target, name)
    mkdirSync(dirname(destination), { recursive: true })
    // Reject replacement even if another writer races the empty-directory preflight.
    copyFileSync(join(root, name), destination, constants.COPYFILE_EXCL)
  }
  auditPublicFiles(target, files)
  return files.length
}
