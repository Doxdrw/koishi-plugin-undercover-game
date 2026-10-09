import { GameUserError } from './errors'
import { $, type Context } from 'koishi'
import type { HistorySnapshot, HistoryIdentity } from './history-snapshot'
import type { HistoryViewer } from './history-query'
type Header = Omit<HistorySnapshot, 'phases' | 'deerChoices'>

/** Staged original-group disclosure boundary; no dependence on the active game. */
export class DeerHistoryControls {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly database: Context['database'],
    private readonly currentPerson: (platform: string, userId: string) => Promise<number | undefined> = async () => undefined,
    private readonly canonical: (id: number) => Promise<number | undefined> = async id => id) {}
  private scope(viewer: HistoryViewer) {
    if (viewer.isDirect || !viewer.guildId) throw new GameUserError('请在这局鹿模式的原群使用选人记录功能。')
    return { platform: viewer.platform, selfId: viewer.selfId, guildId: viewer.guildId, mode: 'deer' }
  }
  private async matches(viewer: HistoryViewer, identity: HistoryIdentity, current: number | undefined) {
    if (identity.erased) return false
    if (viewer.platform === identity.platform && viewer.userId === identity.userId) return true
    return current !== undefined && identity.personId !== undefined && await this.canonical(identity.personId) === current
  }
  private async find(database: Context['database'], viewer: HistoryViewer, id?: number) {
    const scope = this.scope(viewer)
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new GameUserError('对局编号须为正整数。')
    const row = (await database.get('undercover_history_game', { ...scope,
      disposition: { $in: ['completed', 'aborted', 'deer-aborted'] }, ...(id === undefined ? {} : { id }) }, { sort: { endedAt: 'desc', id: 'desc' }, limit: 1 }))[0]
    if (!row) throw new GameUserError('本群没有对应的已结束鹿模式选人记录。')
    const header = JSON.parse(row.payload) as Header
    if (!header.topics || header.mode !== 'deer') throw new GameUserError('鹿模式题面记录不完整。')
    return { row, header }
  }
  async list(viewer: HistoryViewer, page = 1) {
    const scope = this.scope(viewer)
    if (!Number.isSafeInteger(page) || page < 1) throw new GameUserError('页码须为正整数。')
    const query = { ...scope, disposition: { $in: ['completed', 'aborted', 'deer-aborted'] } }
    const total = await this.database.eval('undercover_history_game', row => $.count(row.id), query)
    const pages = Math.max(1, Math.ceil(total / 10))
    if (page > pages) throw new GameUserError(`当前只有${pages}页。`)
    const rows = await this.database.get('undercover_history_game', query, { sort: { endedAt: 'desc', id: 'desc' }, limit: 10, offset: (page - 1) * 10 })
    return { page, pages, total, entries: rows.map(row => ({ id: row.id, endedAt: row.endedAt, aborted: row.disposition !== 'completed' })) }
  }
  private serial<T>(task: () => Promise<T>) { const result = this.tail.then(task); this.tail = result.catch(() => undefined); return result }
  change(viewer: HistoryViewer, operation: 'hide' | 'reveal', id?: number) {
    const copy = { ...viewer }
    return this.serial(async () => {
      this.scope(copy)
      if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new GameUserError('对局编号须为正整数。')
      return this.database.transact(async db => {
      const { row, header } = await this.find(db, copy, id)
      const current = await this.currentPerson(copy.platform, copy.userId)
      const isHost = await this.matches(copy, header.host, current)
      const own = []
      for (const p of header.participants) if (await this.matches(copy, p.identity, current)) own.push(p.tenureId)
      if (operation === 'hide' && !own.length) throw new GameUserError('只有该局实际参赛玩家可以隐藏自己的选人。')
      if (operation === 'reveal' && !isHost && !own.length) throw new GameUserError('只有该局主持人或参赛玩家可以公布选人。')
      if (operation === 'hide') {
        for (const tenureId of own) await db.set('undercover_history_choice', { gameId: row.gameId, tenureId }, { hidden: true })
        return `已隐藏对局#${row.id}中你的选人；仅影响主持人之后的公布，不能撤回已发送内容。`
      }
      // Host publication never unhides anyone; participant self-publication does.
      if (!isHost) for (const tenureId of own) await db.set('undercover_history_choice', { gameId: row.gameId, tenureId }, { hidden: false })
      const choices = await db.get('undercover_history_choice', { gameId: row.gameId,
        ...(isHost ? { hidden: false } : { tenureId: { $in: own } }) })
      const selected = new Map(choices.map(c => [c.tenureId, c]))
      const lines = []
      for (const p of header.participants) {
        // White players have no choice, but may have an explicit null record.
        // Missing/hidden rows are not listed or named in the host response.
        const choice = selected.get(p.tenureId)
        if (!choice) continue
        const camp = p.initialCamp === 'white' ? '白板' : p.initialCamp === 'undercover' ? '卧底' : '好人'
        const rule = p.initialCamp === 'white' ? '仅易混' : p.initialCamp === 'undercover' ? header.topics!.undercover : header.topics!.good
        lines.push(`${p.seat}号 ${p.identity.nickname}${p.replacedTenureId ? '（补位）' : ''}｜${camp}｜规则：${rule}｜选人：${p.initialCamp === 'white' ? '无需选人' : choice.choice ?? '未通过'}`)
      }
      return lines.length ? `鹿模式选人公布 #${row.id}${row.disposition !== 'completed' ? '（中止局）' : ''}，易混：${header.topics!.publicText}\n` + lines.join('\n')
        : `对局#${row.id}当前没有可公布的选人。`
      })
    })
  }
}
