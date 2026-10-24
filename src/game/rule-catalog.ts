import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** A view of the shipped guide, not a separately maintained set of rules. */
export function createRuleCatalog(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const headings: Array<{ depth: number, title: string, key: string, line: number }> = []
  const parents: string[] = []
  for (const [line, value] of lines.entries()) {
    const match = /^(#{2,4}) (.+)$/.exec(value)
    if (!match) continue
    const depth = match[1].length, title = match[2].trim()
    parents.length = depth - 2; parents[depth - 2] = title
    headings.push({ depth, title, key: parents.join(' / '), line })
  }
  const index = '谁是卧底规则主题目录\n' + headings.map(h => '- ' + h.key).join('\n')
  return {
    read(topic = '', page = 1): string {
      if (!topic) return index
      const heading = headings.find(h => h.key === topic.trim() || h.title === topic.trim())
      if (!heading) return '未找到该主题，请从主题目录选择。\n' + index
      const next = headings.find(h => h.line > heading.line && h.depth <= heading.depth)
      const content = lines.slice(heading.line, next?.line ?? lines.length).join('\n').trim()
      const pages = Math.max(1, Math.ceil(content.length / 6000))
      if (!Number.isSafeInteger(page) || page < 1 || page > pages) return `页码应为1至${pages}。`
      return `谁是卧底规则｜${heading.key}｜第${page}/${pages}页\n`
        + content.slice((page - 1) * 6000, page * 6000)
    },
  }
}

export function loadRuleCatalog() {
  // Fixed package-relative locations support both the bundle and source tests.
  // No tool argument is ever used as a file name or path.
  for (const path of [resolve(__dirname, '../GAME_GUIDE.md'), resolve(__dirname, '../../GAME_GUIDE.md')]) {
    try { return createRuleCatalog(readFileSync(path, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  throw new Error('Missing packaged game guide')
}
