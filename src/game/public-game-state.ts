import { h } from 'koishi'
import type { GameMode } from './game-mode'

export interface GameToolSession {
  platform?: string
  selfId?: string
  guildId?: string
  isDirect?: boolean
}
export interface PublicGameEvent {
  id: number
  round: number
  phase: 'gathering' | 'setup' | 'dealing' | 'speech' | 'voting' | 'resolving' | 'adjudication'
  overtime: boolean
  text: string
}
export interface PublicGameStateQuery {
  round?: number
  phase?: PublicGameEvent['phase']
  page?: number
  limit?: number
}
export interface PublicGameTimeline {
  events: PublicGameEvent[]
  total: number
  page: number
  pages: number
  hasMore: boolean
}
export interface PublicGameStateInput {
  route: { platform: string, selfId: string, guildId: string }
  mode: GameMode
  heroesEnabled: boolean
  phase: 'gathering' | 'setup' | 'dealing' | 'speech' | 'voting' | 'resolving' | 'adjudication'
  round: number
  overtime: boolean
  hostNickname: string
  players: Array<{ seat: number, nickname: string, status: '在场' | '出局' | '待补位', revealedHero?: string }>
  publicEvents?: PublicGameEvent[]
}
export type PublicGameState = Omit<PublicGameStateInput, 'route' | 'publicEvents'> & {
  timeline: PublicGameTimeline
  truncated: boolean
}

const publicName = (value: string) => {
  const plain = (elements: h[]): string => elements.map(e => e.type === 'text' ? String(e.attrs.content ?? '') : plain(e.children)).join('')
  try { return plain(h.parse(value.slice(0, 384))).replace(/[\u0000-\u001f\u007f]/g, '').replace(/(?:https?|file|data):\S+/gi, '[链接]').trim().slice(0, 48) }
  catch { return '[昵称无法显示]' }
}

/** Convert a public message to bounded, non-sensitive text for an AI tool. */
export const publicMessageText = (value: unknown): string => {
  const walk = (elements: h[]): string => elements.map(element => {
    if (element.type === 'text') return String(element.attrs.content ?? '')
    if (element.type === 'face') return '[表情]'
    if (['img', 'audio', 'video', 'file', 'image', 'record', 'voice'].includes(element.type)) return '[媒体]'
    return walk(element.children)
  }).join('')
  try {
    const elements = typeof value === 'string' ? h.parse(value.slice(0, 12000)) : h.normalize(value as h.Fragment)
    return walk(elements).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 1200)
  }
  catch { return '[公开消息无法读取]' }
}

const projectTimeline = (events: PublicGameEvent[] | undefined, query: PublicGameStateQuery = {}): PublicGameTimeline => {
  const round = query.round === undefined ? undefined : Math.floor(query.round)
  const filtered = (events ?? []).filter(event =>
    Number.isSafeInteger(event.id) && Number.isSafeInteger(event.round) && typeof event.text === 'string'
    && (round === undefined || event.round === round) && (query.phase === undefined || event.phase === query.phase))
    .map(event => ({ ...event, text: publicMessageText(event.text) }))
    .filter(event => event.text.length > 0)
  const limit = Math.min(20, Math.max(1, Math.floor(query.limit ?? 8)))
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const pages = Math.max(1, Math.ceil(filtered.length / limit))
  const start = query.page === undefined && query.round === undefined && query.phase === undefined
    ? Math.max(0, filtered.length - limit) : (page - 1) * limit
  return { events: filtered.slice(start, start + limit).map(event => ({ ...event })), total: filtered.length,
    page, pages, hasMore: page < pages }
}

/** Current public facts only. Final speeches are not a real chat timeline. */
export function projectPublicGameState(input: PublicGameStateInput | undefined, session: GameToolSession | undefined,
  query: PublicGameStateQuery = {}): PublicGameState | undefined {
  if (!input || !session || session.isDirect || !session.guildId || session.platform !== input.route.platform
    || session.selfId !== input.route.selfId || session.guildId !== input.route.guildId) return
  const players = input.players.filter(p => Number.isSafeInteger(p.seat) && p.seat > 0)
  return {
    mode: input.mode, heroesEnabled: !!input.heroesEnabled, phase: input.phase,
    round: Math.max(0, Math.floor(input.round || 0)), overtime: !!input.overtime,
    hostNickname: publicName(input.hostNickname),
    players: players.slice(0, 64).map(p => ({ seat: p.seat, nickname: publicName(p.nickname),
      status: p.status === '在场' || p.status === '待补位' ? p.status : '出局',
      ...(p.revealedHero ? { revealedHero: publicName(p.revealedHero) } : {}),
    })),
    timeline: projectTimeline(input.publicEvents, query),
    truncated: players.length > 64,
  }
}

export class PublicGameTimelineStore {
  private events: PublicGameEvent[] = []
  private nextId = 1

  clear(): void { this.events = []; this.nextId = 1 }

  record(input: Omit<PublicGameEvent, 'id'>): void {
    const text = publicMessageText(input.text)
    if (!text) return
    this.events.push({ ...input, id: this.nextId++, text })
    // The tool is a live context window, not a second history database.
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512)
  }

  snapshot(): PublicGameEvent[] { return this.events.map(event => ({ ...event })) }
}
