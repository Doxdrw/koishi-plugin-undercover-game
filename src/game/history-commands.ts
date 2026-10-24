import { h, type Context, type Session } from 'koishi'
import { randomBytes } from 'node:crypto'
import { GameUserError, safeErrorSummary } from './errors'
import { HistoryQueries, historyTextPages, historyContentPages, type HistoryViewer } from './history-query'
import type { DeerHistoryControls } from './history-deer'
import type { HistoryStore } from './history-store'

const viewer = (s: Session): HistoryViewer => ({ platform: s.platform, selfId: s.selfId, userId: s.userId,
  guildId: s.guildId, isDirect: s.isDirect })
const scopeKey = (s: Session) => JSON.stringify([s.platform, s.selfId, s.channelId, s.userId])
const date = (value?: string) => {
  if (value === undefined) return undefined
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw new GameUserError('日期请用 YYYY-MM-DD 或带时区的 ISO 时间。')
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new GameUserError('日期不存在。')
  const result = Date.parse(value.length === 10 ? value + 'T00:00:00+08:00' : value)
  if (!Number.isFinite(result)) throw new GameUserError('日期无效。')
  return result
}
export function registerHistoryCommands(ctx: Context, queries: HistoryQueries, deer: DeerHistoryControls,
  store: HistoryStore, flush: () => Promise<void>, ephemeralDeer?: (session: Session, op: 'hide' | 'reveal') => Promise<string | undefined>,
  afterErase?: () => Promise<void>) {
  const confirmations = new Map<string, { actor: string; expires: number; rows: Array<{ gameId: string; digest: string }> }>()
  const safe = async (action: () => Promise<string | void>) => {
    try { await flush(); const result = await action(); return result === undefined ? undefined : h.text(result).toString() }
    catch (error) {
      ctx.logger.warn('历史指令未完成：%s', safeErrorSummary(error))
      return h.text(error instanceof GameUserError ? error.message : '历史操作未完成，请管理员检查日志。').toString()
    }
  }
  ctx.command('历史对局 [page:posint]', '查询本群已完成对局；--aborted 查看进入第一阶段后中止的对局；私聊仅本人参与对局')
    .option('keyword', '-k <keyword:string> 题面、昵称或公开发言关键词')
    .option('mode', '-m <mode:string> classic/deer/turtle')
    .option('aborted', '--aborted 查看进入第一阶段后中止的对局（默认不列出）')
    .option('from', '--from <from:string> 起始日期（含）')
    .option('until', '--until <until:string> 结束日期（不含）')
    .action(({ session, options }, page = 1) => safe(async () => {
      const result = await queries.list(viewer(session), { page, keyword: options.keyword, mode: options.mode as any,
        disposition: options.aborted ? 'aborted' : 'completed',
        from: date(options.from), until: date(options.until) })
      return `历史对局${options.aborted ? '（中止局）' : ''} 第${result.page}/${result.pages}页，共${result.total}局\n`
        + result.entries.map(row => `#${row.id} ${new Date(row.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ${row.mode}｜${row.host}｜${row.result}`).join('\n')
        + '\n用“复盘 编号”查看；历史对局 [页码] -k 关键词 -m deer --from 2026-01-01 --until 2026-02-01；历史对局 --aborted 查看中止局。'
    }))
  const render = async (session: Session, id: number | undefined, options: { round?: number; phase?: number; page?: number }, forward: boolean) => {
    const result = await queries.replay(viewer(session), id, { round: options.round, sequence: options.phase })
    if (!result) return '没有可访问的历史对局；请在原群查询，私聊仅限主持人或参赛玩家。'
    const pages = historyTextPages([result.introduction, ...result.phases.map(p => p.text)].join('\n\n'))
    const page = options.page ?? 1
    const sendHistoryMessage = async (content: h.Fragment): Promise<void> => {
      const messageIds = await session.send(content)
      if (!messageIds?.length) throw new Error('history message was not delivered')
    }
    if (forward) {
      const nodes = [h.text(result.introduction), ...result.phases.map(p => p.content ?? h.text(p.text))]
        .flatMap(content => historyContentPages(content))
      // Bound each forward batch and provide continuation instead of flooding all history.
      const chunks = Math.max(1, Math.ceil(nodes.length / 10))
      if (page > chunks) return `合并转发共有${chunks}批。`
      try {
        await sendHistoryMessage(h('message', { forward: true }, nodes.slice((page - 1) * 10, page * 10).map(content =>
          h('message', { userId: session.selfId, nickname: '对局复盘' }, content))))
        return chunks > page ? `下一批：回放 ${result.id} --page ${page + 1}` : undefined
      } catch {
        const fallback = pages[page - 1] === undefined ? `当前只有${pages.length}页。`
          : pages[page - 1] + `\n合并转发不可用，已改为文本。第${page}/${pages.length}页。`
          + (page < pages.length ? `后续：复盘 ${result.id}`
            + (options.round ? ' --round ' + options.round : '')
            + (options.phase ? ' --phase ' + options.phase : '')
            + ` --page ${page + 1}。` : '')
        try { await sendHistoryMessage(h.text(fallback)); return undefined }
        catch { return fallback }
      }
    }
    const media = result.phases.some(p => p.content?.toString().includes('<face')
      || p.content?.toString().includes('<img')
      || p.content?.toString().includes('<audio') || p.content?.toString().includes('<video') || p.content?.toString().includes('<file'))
    if (media) {
      const structured = historyContentPages(h('template', {}, h.text(result.introduction + '\n\n'),
        ...result.phases.flatMap(p => [p.content ?? h.text(p.text), h.text('\n\n')])))
      if (page > structured.length) return `当前只有${structured.length}页。`
      try {
        await sendHistoryMessage(structured[page - 1])
        return structured.length > page ? `下一页：复盘 ${result.id}`
          + (options.round ? ' --round ' + options.round : '')
          + (options.phase ? ' --phase ' + options.phase : '')
          + ` --page ${page + 1}` : undefined
      }
      catch (error) {
        ctx.logger.warn('复盘媒体消息发送失败，已回退为文本：%s', safeErrorSummary(error))
        if (page > pages.length) return `当前只有${pages.length}页。`
        const fallback = pages[page - 1] + (page < pages.length ? `\n后续：复盘 ${result.id}`
          + (options.round ? ' --round ' + options.round : '')
          + (options.phase ? ' --phase ' + options.phase : '')
          + ` --page ${page + 1}。` : '')
        try { await sendHistoryMessage(h.text(fallback)); return undefined }
        catch (fallbackError) {
          ctx.logger.warn('复盘文本回退发送失败：%s', safeErrorSummary(fallbackError))
          return fallback
        }
      }
    }
    if (page > pages.length) return `当前只有${pages.length}页。`
    return pages[page - 1] + `\n第${page}/${pages.length}页` + (page < pages.length ? `；下一页：复盘 ${result.id}${options.round ? ' --round ' + options.round : ''}${options.phase ? ' --phase ' + options.phase : ''} --page ${page + 1}` : '')
  }
  for (const name of ['复盘', '回放']) {
    const command = ctx.command(`${name} [id:posint]`, '分轮复盘历史；省略编号取最近正常完成局，也可用编号复盘中止局')
      .option('round', '--round <round:posint> 指定轮次')
      .option('phase', '--phase <phase:posint> 指定历史阶段编号')
      .option('page', '--page <page:posint> 文本页码或转发批次')
      .action(({ session, options }, id) => safe(() => render(session, id, options, name === '回放')))
    if (name === '复盘') command.alias('总结').alias('上局总结').alias('总结上局')
  }
  ctx.command('选人记录 [page:posint]', '列出本群正常/中止鹿模式选人记录')
    .action(({ session }, page = 1) => safe(async () => {
      const result = await deer.list(viewer(session), page)
      return `选人记录 第${result.page}/${result.pages}页，共${result.total}局\n`
        + result.entries.map(r => `#${r.id} ${r.aborted ? '中止局' : '正常结束'} ${new Date(r.endedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`).join('\n')
        + '\n公布选人 [编号] / 隐藏选人 [编号]。'
    }))
  for (const [name, op] of [['公布选人', 'reveal'], ['隐藏选人', 'hide']] as const)
    ctx.command(`${name} [id:posint]`, '在原群维护已结束鹿局的选人公开状态')
      .action(({ session }, id) => safe(async () => {
        if (id === undefined) { const text = await ephemeralDeer?.(session, op); if (text !== undefined) return text }
        return deer.change(viewer(session), op, id)
      }))
  ctx.command('历史清理 [id:posint]', 'authority 5：预览删除当前群指定对局', { authority: 5 }).userFields(['authority'])
    .action(({ session }, id) => safe(async () => {
      if (!id) return '用法：历史清理 <对局编号>；先预览，再在原会话粘贴五分钟令牌。'
      if (!session.guildId || session.isDirect) return '请在对局原群执行清理。'
      const rows = await ctx.database.get('undercover_history_game', { id, platform: session.platform, selfId: session.selfId, guildId: session.guildId })
      if (!rows.length) return '本群没有对应历史。'
      const token = 'UCHIST-' + randomBytes(18).toString('hex')
      for (const [key, value] of confirmations) if (value.actor === scopeKey(session) || value.expires <= Date.now()) confirmations.delete(key)
      confirmations.set(token, { actor: scopeKey(session), expires: Date.now() + 300000, rows: await Promise.all(rows.map(async r => ({ gameId: r.gameId, digest: await store.deletionFingerprint(r.gameId) }))) })
      return `将永久删除对局#${id}及发言、选票、选人记录；旧待重试文件也不能恢复。此操作不撤销积分。\n确认令牌：${token}`
    }))
  ctx.middleware(async (session, next) => {
    if (!/^UCHIST-[a-f0-9]{36}$/.test(session.content.trim())) return next()
    return safe(async () => {
      const token = session.content.trim(), request = confirmations.get(token)
      if (!request || request.expires <= Date.now()) { confirmations.delete(token); return '清理令牌不存在或已过期，请重新预览。' }
      if (request.actor !== scopeKey(session)) return '请由原管理员在原会话确认。'
      const user = await ctx.database.getUser(session.platform, session.userId, ['authority'])
      if (!user || user.authority < 5) return '当前权限不足，不能执行历史清理。'
      confirmations.delete(token)
      for (const row of request.rows) {
        const current = (await ctx.database.get('undercover_history_game', { gameId: row.gameId }))[0]
        if (!current || await store.deletionFingerprint(row.gameId) !== row.digest) return '历史记录已变化，请重新预览。'
      }
      for (const row of request.rows) await store.erase(row.gameId, row.digest)
      await afterErase?.()
      return '历史清理完成；积分未修改。'
    })
  }, true)
  ctx.on('dispose', () => confirmations.clear())
}
