import { h, type Context, type Session } from 'koishi'
import { HERO_NAMES } from '../heroes'
import { GameUserError, safeErrorSummary } from './errors'
import { type HistoryQueries, type HistoryViewer } from './history-query'
import { winrateText, type WinrateFilter } from './history-winrate'

type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'season'
export interface WinratePeriod { kind: PeriodKind; offset: number }
const periodKinds: Record<string, PeriodKind> = { 日: 'day', 天: 'day', 周: 'week', 月: 'month', 年: 'year', 赛季: 'season' }
const shortcuts: Record<string, [PeriodKind, number]> = { 今日: ['day', 0], 今天: ['day', 0], 昨日: ['day', 1], 昨天: ['day', 1],
  本周: ['week', 0], 上周: ['week', 1], 本月: ['month', 0], 上月: ['month', 1], 今年: ['year', 0], 本年: ['year', 0], 去年: ['year', 1], 本赛季: ['season', 0], 上赛季: ['season', 1] }
const camps = { 好人: 'good', 卧底: 'undercover', 白板: 'white' } as const
const modes = { 经典: 'classic', 经典模式: 'classic', 鹿: 'deer', 鹿模式: 'deer', 群雄逐鹿: 'deer', 龟: 'turtle', 龟模式: 'turtle', 海龟汤: 'turtle' } as const
const campLabels = { good: '好人', undercover: '卧底', white: '白板' }
const modeLabels = { classic: '经典', deer: '鹿', turtle: '龟' }

export function parseWinrateInput(input = '', board = false) {
  let text = '', userId: string | undefined
  for (const element of h.parse(input)) {
    if (element.type === 'text') text += element.attrs.content
    else if (element.type === 'at' && element.attrs.id && !userId && !board) { userId = String(element.attrs.id); text += ' ' }
    else throw new GameUserError('查询条件只支持文字；胜率详情可 @ 一名玩家。')
  }
  let period: WinratePeriod | undefined, nickname: string | undefined, page = 1
  const filter: WinrateFilter = {}, labels: string[] = []
  for (const token of text.trim().split(/\s+/u).filter(Boolean)) {
    const value = token.replace(/^(?:周期)[=：:]/u, '')
    const relative = value.match(/^前([1-9]\d*)(日|天|周|月|年|赛季)$/u)
    const previous = value.match(/^前([1-9]\d*)期$/u)
    const selection = shortcuts[value] ?? (periodKinds[value] ? [periodKinds[value], 0] as const
      : relative ? [periodKinds[relative[2]], Number(relative[1])] as const : undefined)
    if (selection) {
      if (period) throw new GameUserError('请只指定一个周期。')
      period = { kind: selection[0], offset: selection[1] }; labels.push(value); continue
    }
    if (previous && period && !period.offset) {
      period.offset = Number(previous[1]); labels.push(value); continue
    }
    if (value === '累计' || value === '全部') { if (period) throw new GameUserError('累计不能与周期同时指定。'); continue }
    const named = token.match(/^(身份|模式|武将|玩家)[=：:](.+)$/u)
    const candidate = named?.[2] ?? token
    if ((!named || named[1] === '身份') && camps[candidate]) { filter.camp = camps[candidate]; labels.push(candidate); continue }
    if ((!named || named[1] === '模式') && modes[candidate]) { filter.mode = modes[candidate]; labels.push(candidate); continue }
    const heroId = HERO_NAMES.indexOf(candidate)
    if ((!named || named[1] === '武将') && (heroId !== -1 || candidate === '无武将')) {
      filter.heroId = heroId === -1 ? null : heroId; labels.push(candidate); continue
    }
    if (board && /^(?:第)?[1-9]\d*(?:页)?$/u.test(token)) { page = Number(token.replace(/\D/g, '')); continue }
    if (!board && !userId && !nickname && (!named || named[1] === '玩家')) { nickname = candidate; continue }
    throw new GameUserError('用法：胜率 [@玩家] [上周等周期] [身份=好人] [模式=鹿] [武将=朱由检]；胜率榜可追加页码。')
  }
  if (period && (!Number.isSafeInteger(period.offset) || period.offset > 120)) throw new GameUserError('最多查询前120期。')
  if (!Number.isSafeInteger(page) || page < 1) throw new GameUserError('页码须为正整数。')
  return { period, filter, target: userId ? { userId } : nickname ? { nickname } : undefined, page, labels }
}

export function registerWinrateCommands(ctx: Context, queries: HistoryQueries, options: {
  minimumGames: number
  flush(): Promise<void>
  period(session: Session, selection: WinratePeriod): Promise<{ start: number; end: number } | undefined>
}) {
  for (const board of [false, true]) ctx.command((board ? '胜率榜' : '胜率') + ' [query:text]', board ? '查询本群胜率榜' : '查询总胜率及身份、模式、武将胜率')
    .action(async ({ session }, query) => {
      try {
        const input = parseWinrateInput(query, board)
        if (board && (session.isDirect || !session.guildId)) return '请在群内查询本群胜率榜；私聊可查询自己的胜率。'
        await options.flush()
        const viewer: HistoryViewer = { platform: session.platform, selfId: session.selfId, userId: session.userId, isDirect: session.isDirect, guildId: session.guildId }
        if (input.period) {
          const period = await options.period(session, input.period)
          if (!period) return '该积分系统尚未开启对应周期，或没有可查询的历史周期。'
          input.filter.from = period.start; input.filter.until = period.end
        }
        const data = await queries.winrates(viewer, input.filter)
        const title = input.labels.length ? input.labels.join(' · ') : '累计'
        if (board) {
          const result = data.leaderboard(input.filter, options.minimumGames, input.page)
          return h.text([`胜率榜｜${title}（至少${options.minimumGames}局）`,
            ...(result.entries.length ? result.entries.map((entry, index) => `${(result.page - 1) * 10 + index + 1}. ${entry.nickname} ${winrateText(entry)}`) : ['暂无符合条件的玩家']),
            ...(result.pages > 1 ? [`第${result.page}/${result.pages}页`] : [])].join('\n')).toString()
        }
        const target = input.target ?? { userId: session.userId }
        const result = await data.summary(session.platform, target, input.filter)
        return h.text([`${result.nickname ?? '玩家'}的胜率｜${title}`, '总胜率 ' + winrateText(result.total),
          ...[...result.camps].map(([camp, count]) => campLabels[camp] + '胜率 ' + winrateText(count)),
          ...[...result.modes].map(([mode, count]) => modeLabels[mode] + '模式 ' + winrateText(count)),
          ...[...result.heroes].map(([heroId, count]) => (heroId === null ? '无武将' : HERO_NAMES[heroId]) + ' ' + winrateText(count)),
        ].join('\n')).toString()
      } catch (error) {
        ctx.logger.warn('胜率查询未完成：%s', safeErrorSummary(error))
        return h.text(error instanceof GameUserError ? error.message : '胜率查询暂未完成，请稍后重试。').toString()
      }
    })
}
