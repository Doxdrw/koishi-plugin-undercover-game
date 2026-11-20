import { h } from 'koishi'

const views = ['overview', 'list', 'phases', 'phase', 'choices'] as const
const overviewSections = ['players', 'topics', 'settlement'] as const
const phaseSections = ['speech', 'votes', 'events'] as const
export interface AiHistoryQuery {
  view?: typeof views[number]
  id?: number
  page?: number
  limit?: number
  sequence?: number
  section?: typeof overviewSections[number] | typeof phaseSections[number]
}
export interface AiHistoryLimits { pageSize: number; maxChars: number }
export const defaultAiHistoryLimits = { pageSize: 5, maxChars: 2500 }
export type ArchiveHint = { gameId: string; status: '正在归档' | '归档待重试' | '归档未确认' }
export const aiHistoryToolProperties = {
  view: { type: 'string', enum: views, description: '默认 overview：最近已归档对局的摘要；list：查较早编号；phases：查阶段编号；phase：查一个阶段；choices：查已在原群公布的鹿选词' },
  id: { type: 'integer', minimum: 1, description: '对局编号；不填取本群最新已归档的完成局' },
  sequence: { type: 'integer', minimum: 1, description: 'phase 需要的阶段编号；通过 phases 获得' },
  section: { type: 'string', enum: [...overviewSections, ...phaseSections], description: 'overview 可选 players、topics、settlement；phase 可选 speech、votes、events' },
  page: { type: 'integer', minimum: 1, maximum: 1000000 },
  limit: { type: 'integer', minimum: 1, maximum: 10, description: '只能缩小服务端配置的每页条数' },
}

export function validAiHistoryQuery(input: unknown): input is AiHistoryQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !Object.hasOwn(aiHistoryToolProperties, key))) return false
  const q = input as AiHistoryQuery
  const view = q.view ?? 'overview'
  if (!views.includes(view) || q.view === null) return false
  for (const value of [q.page, q.limit, q.id, q.sequence]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) return false
  }
  if ((q.limit ?? 1) > 10 || (q.page ?? 1) > 1000000) return false
  if (view === 'list' && q.id !== undefined) return false
  if ((view === 'phase') !== (q.sequence !== undefined)) return false
  if (q.section === undefined) return true
  if (view === 'overview') return (overviewSections as readonly string[]).includes(q.section)
  return view === 'phase' && (phaseSections as readonly string[]).includes(q.section)
}

export function aiHistoryLimits(config: Partial<AiHistoryLimits> = {}): AiHistoryLimits {
  const clamp = (v: number | undefined, min: number, max: number, fallback: number) =>
    v !== undefined && Number.isSafeInteger(v) ? Math.max(min, Math.min(v, max)) : fallback
  return { pageSize: clamp(config.pageSize, 1, 10, defaultAiHistoryLimits.pageSize),
    maxChars: clamp(config.maxChars, 500, 8000, defaultAiHistoryLimits.maxChars) }
}

/** Recorded text is data; don't include executable markup or media references. */
export function aiHistoryText(text: string): string {
  const walk = (nodes: h[]): string => nodes.map(node => {
    if (node.type === 'text') return String(node.attrs.content ?? '')
    if (node.type === 'face') return '[表情]'
    if (['img', 'image', 'audio', 'voice', 'video', 'file', 'record'].includes(node.type)) return '[媒体]'
    return walk(node.children)
  }).join('')
  return walk(h.parse(text)).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/(?:https?:\/\/|file:\/\/|data:)[^\s<>]+/gi, '[链接]')
}

/** Reserve the whole JSON envelope before packing pages. Preserve all text
 * in order, including characters that take extra space when JSON-escaped. */
export function aiHistoryTextPage(base: object, lines: readonly string[], page: number, limit: number, maxChars: number): string {
  const allowance = maxChars - JSON.stringify({ ...base, items: [], nextPage: 1000001 }).length
  if (allowance < 8) return JSON.stringify({ error: '历史工具的返回预算不足。' })
  let currentPage = 1, size = 0
  let items: string[] = []
  const append = (part: string, bytes: number): string | undefined => {
    const width = bytes + 2 + (items.length ? 1 : 0)
    if (items.length >= limit || size + width > allowance) {
      if (currentPage === page) return JSON.stringify({ ...base, items, nextPage: currentPage + 1 })
      currentPage++
      items = []
      size = 0
    }
    items.push(part)
    size += bytes + 2 + (items.length > 1 ? 1 : 0)
  }
  for (const line of lines) {
    let part = '', width = 0
    for (const char of aiHistoryText(line)) {
      const length = JSON.stringify(char).length - 2
      if (width + length > allowance - 2) {
        const finished = append(part, width)
        if (finished !== undefined) return finished
        part = ''; width = 0
      }
      part += char
      width += length
    }
    if (part) {
      const finished = append(part, width)
      if (finished !== undefined) return finished
    }
  }
  return JSON.stringify({ ...base, items: currentPage === page ? items : [] })
}
