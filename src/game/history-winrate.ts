import { GameUserError } from './errors'
import type { HistoryIdentity, HistoryParticipant, HistorySnapshot, HistoryPhase } from './history-snapshot'

export type DepartureReason = Extract<HistoryPhase['events'][number], { kind: 'departure' }>['reason']
export type WinrateHeader = Omit<HistorySnapshot, 'phases' | 'deerChoices'> & {
  departureReasons?: Array<{ tenureId: string; reason: DepartureReason }>
}
export interface WinrateFilter { mode?: HistorySnapshot['mode']; camp?: 'good' | 'undercover' | 'white'; heroId?: number | null; from?: number; until?: number }
export interface WinrateCount { wins: number; games: number }
export interface WinrateEntry extends WinrateCount { nickname: string }
type Entry = { key: string; nickname: string; endedAt: number; camp: HistoryParticipant['finalCamp']; mode: HistorySnapshot['mode']; heroId: number | null; win: boolean }
const excluded = new Set<DepartureReason>(['kick', 'self-exit', 'timeout'])
const add = (count: WinrateCount, win: boolean) => { count.games++; if (win) count.wins++ }
export const winrateText = ({ wins, games }: WinrateCount) => games ? `${Math.round(wins * 1000 / games) / 10}%（${wins}/${games}）` : '暂无对局'

/** Per-query aggregation: no persistent identity/statistics cache to invalidate. */
export class WinrateAccumulator {
  private readonly rows: Entry[] = []
  private readonly games = new Set<string>()
  private readonly identities = new Map<string, Promise<string | undefined>>()
  private readonly accounts = new Map<string, string>()
  constructor(private readonly currentPerson: (platform: string, userId: string) => Promise<number | undefined> = async () => undefined,
    private readonly canonical: (personId: number) => Promise<number | undefined> = async id => id) {}

  private identityKey(identity: HistoryIdentity): Promise<string | undefined> {
    if (identity.erased || !identity.userId) return Promise.resolve(undefined)
    const account = JSON.stringify([identity.platform, identity.userId])
    const cacheKey = JSON.stringify([account, identity.personId])
    if (!this.identities.has(cacheKey)) this.identities.set(cacheKey, (async () => {
      const person = identity.personId === undefined ? await this.currentPerson(identity.platform, identity.userId) : await this.canonical(identity.personId)
      return person === undefined ? 'account:' + account : 'person:' + person
    })())
    return this.identities.get(cacheKey)!
  }

  async add(header: WinrateHeader, departures: readonly { tenureId: string; reason: DepartureReason }[]) {
    if (this.games.has(header.gameId) || header.sandbox || header.ending.kind !== 'completed' || header.ending.winner === 'none') return
    this.games.add(header.gameId)
    const finalSeats = new Map<number, HistoryParticipant>()
    for (const participant of header.participants) finalSeats.set(participant.seat, participant)
    const reasons = new Map(departures.map(d => [d.tenureId, d.reason]))
    const seen = new Set<string>()
    for (const participant of [...finalSeats.values()].sort((a, b) => a.seat - b.seat)) {
      if (excluded.has(reasons.get(participant.tenureId)!)) continue
      const key = await this.identityKey(participant.identity)
      if (!key || seen.has(key)) continue
      this.accounts.set(JSON.stringify([participant.identity.platform, participant.identity.userId]), key)
      seen.add(key)
      this.rows.push({ key, nickname: participant.identity.nickname, endedAt: header.endedAt, camp: participant.finalCamp, mode: header.mode,
        heroId: participant.heroId, win: participant.finalCamp === header.ending.winner })
    }
  }

  private filtered(filter: WinrateFilter) {
    return this.rows.filter(row => (!filter.mode || row.mode === filter.mode) && (!filter.camp || row.camp === filter.camp)
      && (filter.heroId === undefined || row.heroId === filter.heroId)).sort((a, b) => b.endedAt - a.endedAt)
  }

  async summary(platform: string, target: { userId?: string; nickname?: string }, filter: WinrateFilter = {}) {
    const rows = this.filtered(filter)
    let key: string | undefined
    if (target.nickname !== undefined) {
      const keys = new Set(rows.filter(row => row.nickname === target.nickname).map(row => row.key))
      if (keys.size > 1) throw new GameUserError('有多名同昵称玩家，请用 @ 指定玩家。')
      key = keys.values().next().value
    } else if (target.userId) key = this.accounts.get(JSON.stringify([platform, target.userId]))
      ?? await this.identityKey({ platform, userId: target.userId, nickname: '' })
    const selected = rows.filter(row => key !== undefined && row.key === key)
    const total: WinrateCount = { wins: 0, games: 0 }
    const camps = new Map<string, WinrateCount>(), modes = new Map<string, WinrateCount>(), heroes = new Map<number | null, WinrateCount>()
    for (const row of selected) {
      add(total, row.win)
      for (const [map, value] of [[camps, row.camp], [modes, row.mode], [heroes, row.heroId]] as const) {
        const count = (map as Map<any, WinrateCount>).get(value) ?? { wins: 0, games: 0 }
        add(count, row.win); (map as Map<any, WinrateCount>).set(value, count)
      }
    }
    return { nickname: selected[0]?.nickname ?? target.nickname, total, camps, modes, heroes }
  }

  leaderboard(filter: WinrateFilter = {}, minimumGames = 5, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1) throw new GameUserError('页码须为正整数。')
    const players = new Map<string, WinrateEntry>()
    for (const row of this.filtered(filter)) {
      const entry = players.get(row.key) ?? { nickname: row.nickname, wins: 0, games: 0 }
      add(entry, row.win); players.set(row.key, entry)
    }
    const sorted = [...players.values()].filter(row => row.games >= minimumGames).sort((a, b) => {
      const difference = BigInt(b.wins) * BigInt(a.games) - BigInt(a.wins) * BigInt(b.games)
      return difference > 0n ? 1 : difference < 0n ? -1 : b.games - a.games || a.nickname.localeCompare(b.nickname, 'zh-CN')
    })
    const pages = Math.max(1, Math.ceil(sorted.length / 10))
    if (page > pages) throw new GameUserError(`当前只有${pages}页。`)
    return { entries: sorted.slice((page - 1) * 10, page * 10), total: sorted.length, page, pages }
  }
}
