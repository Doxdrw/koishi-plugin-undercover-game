import { GameUserError } from './errors'
import { h, type Context } from 'koishi'
import type { HistorySnapshot, HistoryPhase, HistorySpeechSegment } from './history-snapshot'
import type { HistoryGameRow } from './history-store'
import { HERO_NAMES } from '../heroes'

export interface HistoryViewer {
  platform: string
  selfId: string
  userId: string
  isDirect: boolean
  guildId?: string
}
export interface HistoryFilter {
  page?: number
  keyword?: string
  mode?: HistorySnapshot['mode']
  disposition?: 'completed' | 'aborted'
  from?: number
  until?: number
}
type Header = Omit<HistorySnapshot, 'phases' | 'deerChoices'>
/** Only rendered, public fields leave this boundary. IDs and private choices do not. */
export interface HistorySummary {
  id: number
  mode: HistorySnapshot['mode']
  startedAt: number
  endedAt: number
  host: string
  result: string
  disposition: 'completed' | 'aborted'
}
export interface HistoryReplay extends HistorySummary {
  introduction: string
  phases: Array<{ sequence: number; round: number; kind: 'regular' | 'overtime'; text: string; content?: h.Fragment }>
}
const label = { good: '好人', undercover: '卧底', white: '白板', none: '无人' }
const modes = { classic: '经典', deer: '鹿', turtle: '龟' }
const departures = {
  vote: '投票出局',
  skill: '因武将技能出局',
  kick: '被主持人踢出',
  'self-exit': '主动退出游戏',
  timeout: '发言超时，被自动踢出',
}
const endingReasons: Record<HistorySnapshot['ending']['reason'], string> = {
  elimination: '规则结算',
  stalemate: '连续两轮平安夜僵局',
  'white-survival': '白板存活结算',
  'rule-no-winner': '好人自爆，无人胜利',
  'self-explosion': '自爆结算',
  recruitment: '白板猜词加入阵营',
  'host-stop': '主持人或管理员终止',
  'host-timeout': '主持人处理超时',
  'setup-timeout': '发题配置超时',
  'system-error': '系统异常终止',
  restart: '插件或实例重启',
}

export class HistoryQueries {
  constructor(private readonly database: Context['database'],
    /** Return current canonical person ID; unavailable service returns undefined. */
    private readonly currentPerson: (platform: string, userId: string) => Promise<number | undefined> = async () => undefined,
    private readonly canonical: (personId: number) => Promise<number | undefined> = async id => id) {}

  private validate(viewer: HistoryViewer) {
    if (!viewer.platform || !viewer.selfId || !viewer.userId || (!viewer.isDirect && !viewer.guildId)) throw new GameUserError('缺少历史查询会话范围。')
  }
  private async owns(viewer: HistoryViewer, header: Header) {
    const identities = [header.host, ...header.participants.map(p => p.identity)].filter(i => !i.erased)
    if (identities.some(i => i.platform === viewer.platform && i.userId === viewer.userId)) return true
    const current = await this.currentPerson(viewer.platform, viewer.userId)
    if (current === undefined) return false
    for (const identity of identities) if (identity.personId !== undefined && await this.canonical(identity.personId) === current) return true
    return false
  }
  private async allowed(viewer: HistoryViewer, row: HistoryGameRow, header: Header) {
    if (row.platform !== viewer.platform || row.selfId !== viewer.selfId
      || row.disposition !== 'completed' && row.disposition !== 'aborted' && row.disposition !== 'deer-aborted') return false
    if (viewer.guildId && row.guildId !== viewer.guildId) return false
    return viewer.isDirect ? this.owns(viewer, header) : true
  }
  private summary(row: HistoryGameRow, header: Header): HistorySummary {
    if (header.ending.kind === 'aborted') {
      return { id: row.id, mode: header.mode, startedAt: row.startedAt, endedAt: row.endedAt,
        host: header.host.nickname, result: '中止局', disposition: 'aborted' }
    }
    return { id: row.id, mode: header.mode, startedAt: row.startedAt, endedAt: row.endedAt,
      host: header.host.nickname, result: header.ending.winner === 'none' ? '无人胜利' : label[header.ending.winner] + '胜利', disposition: 'completed' }
  }
  private phaseLines(header: Header, phase: HistoryPhase) {
    const who = (id: string) => {
      const p = header.participants.find(p => p.tenureId === id)
      return p ? `${p.seat}号玩家${p.identity.nickname}` : '已移除玩家'
    }
    const ballotStatus = (ballot: HistoryPhase['ballots'][number]) => {
      if (ballot.status) return ballot.status
      if (ballot.targetSeat !== null) return 'vote'
      if (ballot.weight === 0) return 'skip'
      return 'abstain'
    }
    const ballotText = (ballot: HistoryPhase['ballots'][number]) => {
      const target = ballot.targetSeat === null
        ? ({ abstain: '弃权', timeout: '未来得及投票', skip: '跳过投票阶段', locked: '无需投票' } as Record<string, string>)[ballotStatus(ballot)] ?? '未投票'
        : `${ballot.targetSeat}号玩家${ballot.targetNickname ? ballot.targetNickname : ''}`
      const weight = ballot.weight !== undefined && ballot.weight > 1 ? `（${ballot.weight}票）` : ''
      if (ballot.targetSeat === null) return `${who(ballot.voterTenureId)}${target}${weight}。`
      return `${who(ballot.voterTenureId)}投给了${target}${weight}。`
    }
    const reveals = new Map<string, string>()
    const departureTenures = new Set<string>()
    const explosionDepartures = new Set(phase.events.filter(e => e.kind === 'self-explosion' && e.outcome === 'white-departure').map(e => e.tenureId))
    type SkillEvent = Extract<HistoryPhase['events'][number], { kind: 'skill' }>
    const departureCauses = new Map<string, SkillEvent>()
    const consumedSkillEvents = new Set<SkillEvent>()
    for (const event of phase.events) {
      if (event.kind === 'hero-reveal') reveals.set(event.tenureId, HERO_NAMES[event.heroId] ?? '未知武将')
      else if (event.kind === 'departure') {
        departureTenures.add(event.tenureId)
      }
    }
    for (const event of phase.events) {
      if (event.kind !== 'departure' || event.reason !== 'skill') continue
      const participant = header.participants.find(p => p.tenureId === event.tenureId)
      if (!participant) continue
      const cause = phase.events.find((candidate): candidate is SkillEvent => candidate.kind === 'skill'
        && ((candidate.effect === '出局带走' || candidate.effect === '权计指定出局' || candidate.effect.startsWith('发动“权计”，指定'))
          ? candidate.targetSeats.includes(participant.seat)
          : candidate.effect === '守卫连带出局' && candidate.tenureId === event.tenureId
            || candidate.effect === '处决：自裁' && candidate.tenureId === event.tenureId))
      if (cause) {
        departureCauses.set(event.tenureId, cause)
        consumedSkillEvents.add(cause)
      }
    }
    const sentence = (text: string) => /[。！？!?…]$/u.test(text) ? text : text + '。'
    const eventLines: string[] = []
    for (const event of phase.events) {
      if (event.kind === 'self-explosion') {
        eventLines.push(`${who(event.tenureId)}自爆，发言为：${event.text}`)
        if (event.adjudicated) eventLines.push(`主持人判定自爆${event.outcome === 'undercover-win' || event.outcome === 'white-win' ? '成功' : '失败'}。`)
        if (event.outcome === 'undercover-win') eventLines.push('卧底自爆成功，游戏结束，卧底胜利。')
        else if (event.outcome === 'white-win') eventLines.push('白板自爆成功，游戏结束，白板胜利。')
        else if (event.outcome === 'no-winner') eventLines.push('游戏结束，好人自爆，无人胜利。')
        else if (event.outcome === 'good-win') eventLines.push(header.participants.find(p => p.tenureId === event.tenureId)?.finalCamp === 'white'
          ? '白板自爆失败，场上已无卧底在场，游戏结束，好人胜利。'
          : '卧底自爆失败，游戏结束，好人胜利。')
        else if (event.outcome === 'white-departure') eventLines.push(sentence(`白板自爆失败，场上仍有卧底在场，白板${who(event.tenureId)}出局，游戏继续${reveals.has(event.tenureId) ? `，亮出武将牌：${reveals.get(event.tenureId)}` : ''}`))
        else eventLines.push('自爆判定尚未完成。')
        continue
      }
      if (event.kind === 'hero-reveal') {
        // A reveal is normally attached to the departure sentence below, but
        // some skills reveal a hero without eliminating anyone.  Keep those
        // standalone reveals visible instead of silently dropping them.
        if (!departureTenures.has(event.tenureId)) {
          eventLines.push(sentence(`${who(event.tenureId)}亮出武将牌：${HERO_NAMES[event.heroId] ?? '未知武将'}`))
        }
        continue
      }
      if (event.kind === 'replacement') {
        eventLines.push(`${who(event.tenureId)}补位加入游戏。`)
      }
      else if (event.kind === 'departure') {
        if (explosionDepartures.has(event.tenureId)) continue
        const reveal = reveals.get(event.tenureId)
        const cause = departureCauses.get(event.tenureId)
        if (cause) {
          const targets = cause.targetSeats.map(seat => {
            const target = header.participants.find(p => p.seat === seat)
            return `${seat}号玩家${target?.identity.nickname ?? ''}`
          }).join('、')
          const causeText = cause.effect === '出局带走'
            ? `${who(event.tenureId)}被张献忠带走`
            : cause.effect === '权计指定出局' || cause.effect.startsWith('发动“权计”，指定')
              ? `${who(event.tenureId)}被吴三桂指定出局`
              : cause.effect === '守卫连带出局'
                ? `${who(event.tenureId)}被其所守卫的${targets}带走`
                : `${who(event.tenureId)}自裁`
          eventLines.push(sentence(`${causeText}${reveal ? `，亮出武将牌：${reveal}` : ''}`))
        }
        else eventLines.push(sentence(`${who(event.tenureId)}${departures[event.reason]}${reveal ? `，亮出武将牌：${reveal}` : ''}`))
      }
      else {
        if (consumedSkillEvents.has(event)) continue
        // Some skill events are the cause of a departure and the departure
        // sentence already carries the complete public wording.  Rendering
        // both would repeat the same elimination twice.
        const targets = event.targetSeats.map(seat => {
          const target = header.participants.find(p => p.seat === seat)
          return `${seat}号玩家${target?.identity.nickname ?? ''}`
        }).join('、')
        const effect = event.effect.replace(/；本人投票未失效/g, '')
        const natural: Record<string, string> = {
          '出局带走': `带走${targets}`,
          '权计指定出局': `发动“权计”，指定${targets}出局`,
          '处决：命中异阵营': `选择处决${targets}，处决成功`,
          '处决：自裁': '选择自裁',
          '处决：同阵营反噬': `选择处决${targets}，处决失败`,
          '处决被保护抵消': `${targets}受到保护，处决失效`,
          '权计被保护抵消': `${targets}受到保护，“权计”失效`,
          '“权计”被保护抵消': `${targets}受到保护，“权计”失效`,
          '设置守卫目标': `选择守卫${targets}`,
          '更换守卫目标': `放弃原守卫，改为守卫${event.targetSeats.at(-1)}号玩家${header.participants.find(p => p.seat === event.targetSeats.at(-1))?.identity.nickname ?? ''}`,
          '设置定策': `将“定策”标记给予${targets}`,
          '转移定策': `将“定策”标记从${event.targetSeats[0]}号玩家${header.participants.find(p => p.seat === event.targetSeats[0])?.identity.nickname ?? ''}转移到${event.targetSeats[1]}号玩家${header.participants.find(p => p.seat === event.targetSeats[1])?.identity.nickname ?? ''}`,
          '摄政换票': `发动“摄政”，使${targets}的得票数互换`,
          '配置摄政': `发动“摄政”，用${event.targetSeats[1]}号玩家保${event.targetSeats[0]}号玩家`,
          '守卫连带出局': `被其所守卫的${targets}带走`,
          '抵诽：得票减少1': '发动“抵诽”，本次得票数减少1票',
          '获得1个权': '获得1个“权”标记',
          '放弃权计': '放弃发动“权计”',
          '放弃出局技能': '放弃发动技能',
          '入关觉醒': '入关，获得“摄政”',
        }
        const readableEffect = (value: string) =>
          /^(?:选择处决|选择守卫|选择自裁|发动“|获得|觉醒|入关|放弃|将“|把|使|输入超时)/u.test(value)
            && !/^(?:处决：|觉醒及援寡结算|觉醒西迁|出局带走|权计指定出局|守卫连带出局|设置守卫目标|设置定策|配置摄政|抵诽：|迟投增加|定策保护：|消耗\d+个权，减票|赠予\d+个伐|获得\d+个伐|获得1个权)$/u.test(value)
        const rendered = natural[effect]
          ?? (/^迟投增加([\d.]+)票$/.test(effect) ? `使${targets}得票数增加${effect.match(/^迟投增加([\d.]+)票$/)![1]}票` : undefined)
          ?? (/^定策保护：减票([\d.]+)$/.test(effect) ? `发动“定策”，使${targets}得票数减少${effect.split('减票')[1]}票` : undefined)
          ?? (/^消耗([\d.]+)个权，减票([\d.]+)$/.test(effect) ? `消耗${effect.match(/^消耗([\d.]+)个权/)![1]}个“权”，使${targets}得票数减少${effect.split('减票')[1]}票` : undefined)
          ?? (/^赠予([\d.]+)个伐$/.test(effect) ? `将${effect.match(/^赠予([\d.]+)/)![1]}个“伐”标记赠予${targets}` : undefined)
          ?? (/^获得([\d.]+)个伐$/.test(effect) ? `获得${effect.match(/^获得([\d.]+)/)![1]}个“伐”标记` : undefined)
          ?? (/^觉醒西迁$/.test(effect) ? '觉醒，获得“西迁”' : undefined)
          ?? (/^觉醒及援寡结算$/.test(effect) ? '完成“援寡”结算' : undefined)
          ?? (/^避实抵消([\d.]+)票(?:；免疫(.+?))?(?:；本人投票失效)?$/.test(effect) ? (() => {
            const match = effect.match(/^避实抵消([\d.]+)票(?:；免疫(.+?))?(?:；本人投票失效)?$/)!
            const immuneVotes = targets ? `${targets}的投票` : match[2]
            return `${immuneVotes ? `受武将技能保护，免疫${immuneVotes}` : `“避实”抵消${match[1]}票`}${effect.endsWith('；本人投票失效') ? '，本人的投票失效' : ''}`
          })() : undefined)
          // Old snapshots can contain no-op late-vote records.  They are
          // implementation details and should not become public jargon.
          ?? (/^迟投(?:超时|放弃)$/.test(effect) ? '' : undefined)
          ?? (/^权计选择超时，进入加时$/.test(effect) ? '输入超时，进入加时' : undefined)
          ?? (readableEffect(effect) ? effect : undefined)
          ?? '发动武将技能'
        if (rendered) eventLines.push(sentence(`${who(event.tenureId)}${rendered}`))
      }
    }
    const nonZeroVotes = phase.effectiveVotes.filter(v => v.count > 0)
    const speechLines = this.orderedSpeeches(header, phase).flatMap(s => header.mode === 'turtle'
      ? [`${who(s.tenureId)}：问：${s.question}`, `答：${s.answer}`]
      : [`${who(s.tenureId)}：${s.text}`])
    const tailLines = [
      ...(phase.ballots.length ? ['投票结果：', ...phase.ballots.map(ballotText)] : []),
      ...(nonZeroVotes.length ? ['最终票数：', ...nonZeroVotes.map(v => `${v.seat}号玩家${header.participants.find(p => p.seat === v.seat)?.identity.nickname ?? ''}获得${v.count}票。`)] : []),
      ...(phase.outcomes ?? []),
      ...eventLines]
    return { headerLine: `第${phase.round}轮${phase.kind === 'overtime' ? '加时' : ''}`, speechLines, tailLines }
  }
  private phaseText(header: Header, phase: HistoryPhase) {
    const lines = this.phaseLines(header, phase)
    return [lines.headerLine, ...lines.speechLines, ...lines.tailLines].join('\n')
  }
  private orderedSpeeches(header: Header, phase: HistoryPhase) {
    const order = new Map(header.participants.map((p, index) => [p.tenureId, { seat: p.seat, joinedAt: p.joinedAt, index }]))
    return [...phase.speeches].sort((a, b) => {
      const left = order.get(a.tenureId)!, right = order.get(b.tenureId)!
      return left.seat - right.seat || left.joinedAt - right.joinedAt || left.index - right.index
    })
  }
  private speechSegments(segments: HistorySpeechSegment[] | undefined): h.Fragment | undefined {
    if (!segments?.length) return undefined
    return segments.map(segment => {
      if (segment.kind === 'text') return h.text(segment.text)
      if (segment.kind === 'face') return h('face', { id: segment.id, name: segment.name, platform: segment.platform })
      if (!segment.src) return h.text(`[${segment.label ?? (segment.type === 'img' ? '图片' : '媒体')}]`)
      return h(segment.type, { src: segment.src })
    })
  }
  private phaseContent(header: Header, phase: HistoryPhase): h.Fragment {
    const lines = this.phaseLines(header, phase)
    const nodes: any[] = [h.text(lines.headerLine + '\n')]
    for (const speech of this.orderedSpeeches(header, phase)) {
      const who = header.participants.find(p => p.tenureId === speech.tenureId)
      const prefix = `${who?.seat ?? ''}号玩家${who?.identity.nickname ?? '已移除玩家'}：`
      if (speech.segments?.some(s => s.kind === 'media')) nodes.push(h.text(prefix), h('template', {}, this.speechSegments(speech.segments)!), h.text('\n'))
      else if (header.mode === 'turtle') nodes.push(h.text(prefix + `问：${speech.question}\n答：${speech.answer}\n`))
      else if (speech.segments?.length) nodes.push(h.text(prefix), h('template', {}, this.speechSegments(speech.segments)!), h.text('\n'))
      else nodes.push(h.text(prefix + speech.text + '\n'))
    }
    if (lines.tailLines.length) nodes.push(h.text(lines.tailLines.join('\n')))
    return h('template', {}, ...nodes)
  }
  private searchable(header: Header, phases: HistoryPhase[]) {
    // Explicit allowlist. Never serialize rows/payload indiscriminately, nor read
    // undercover_history_choice here, even for unhidden choices.
    return [header.host.nickname, ...header.participants.map(p => p.identity.nickname),
      header.topics?.publicText, header.topics?.good, header.topics?.undercover,
      ...phases.flatMap(p => p.speeches.flatMap(s => [s.text, s.question, s.answer])),
      ...phases.flatMap(p => p.events.flatMap(e => e.kind === 'self-explosion' ? [e.text] : []))].filter(Boolean).join('\n')
  }
  async list(viewer: HistoryViewer, filter: HistoryFilter = {}) {
    this.validate(viewer)
    const page = filter.page ?? 1
    if (!Number.isSafeInteger(page) || page < 1) throw new GameUserError('页码须为正整数。')
    if (filter.mode && !['classic', 'deer', 'turtle'].includes(filter.mode)) throw new GameUserError('未知游戏模式。')
    if (filter.disposition && !['completed', 'aborted'].includes(filter.disposition)) throw new GameUserError('未知历史类型。')
    if (filter.from !== undefined && !Number.isFinite(filter.from) || filter.until !== undefined && !Number.isFinite(filter.until)
      || filter.from !== undefined && filter.until !== undefined && filter.from >= filter.until) throw new GameUserError('日期范围无效，结束时间须晚于开始时间。')
    const keyword = filter.keyword?.trim()
    if (keyword && keyword.length > 200) throw new GameUserError('搜索关键词最多200字。')
    const disposition = filter.disposition ?? 'completed'
    const query = { platform: viewer.platform, selfId: viewer.selfId,
      disposition: disposition === 'aborted' ? { $in: ['aborted', 'deer-aborted'] } : disposition,
      ...(viewer.guildId ? { guildId: viewer.guildId } : {}), ...(filter.mode ? { mode: filter.mode } : {}) }
    let offset = 0, total = 0
    const result: HistorySummary[] = []
    // Read in bounded batches; permission and keyword filtering precede paging.
    while (true) {
      const rows = await this.database.get('undercover_history_game', query, { sort: { endedAt: 'desc', id: 'desc' }, limit: 100, offset })
      for (const row of rows) {
        if (filter.from !== undefined && row.startedAt < filter.from || filter.until !== undefined && row.startedAt >= filter.until) continue
        const header = JSON.parse(row.payload) as Header
        if (!await this.allowed(viewer, row, header)) continue
        if (keyword) {
          const phases = (await this.database.get('undercover_history_phase', { gameId: row.gameId })).map(p => JSON.parse(p.payload) as HistoryPhase)
          if (!this.searchable(header, phases).toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) continue
        }
        if (total >= (page - 1) * 10 && result.length < 10) result.push(this.summary(row, header))
        total++
      }
      if (rows.length < 100) break
      offset += rows.length
    }
    const pages = Math.max(1, Math.ceil(total / 10))
    if (page > pages) throw new GameUserError(`当前只有${pages}页。`)
    return { page, pages, total, entries: result }
  }
  async replay(viewer: HistoryViewer, id?: number, filter: { round?: number; sequence?: number; overtime?: boolean } = {}): Promise<HistoryReplay | undefined> {
    this.validate(viewer)
    if (id === undefined) id = (await this.list(viewer)).entries[0]?.id
    if (id === undefined) return
    if (!Number.isSafeInteger(id) || id < 1) throw new GameUserError('对局编号须为正整数。')
    for (const v of [filter.round, filter.sequence]) if (v !== undefined && (!Number.isSafeInteger(v) || v < 1)) throw new GameUserError('轮次和阶段须为正整数。')
    const row = (await this.database.get('undercover_history_game', { id, platform: viewer.platform, selfId: viewer.selfId,
      ...(viewer.guildId ? { guildId: viewer.guildId } : {}) }))[0]
    if (!row) return
    const header = JSON.parse(row.payload) as Header
    if (!await this.allowed(viewer, row, header)) return
    const phases = (await this.database.get('undercover_history_phase', { gameId: row.gameId }, { sort: { sequence: 'asc' } }))
      .map(p => JSON.parse(p.payload) as HistoryPhase).filter(p => (filter.round === undefined || p.round === filter.round)
        && (filter.sequence === undefined || p.sequence === filter.sequence) && (filter.overtime === undefined || (p.kind === 'overtime') === filter.overtime))
    const summary = this.summary(row, header)
    const topicLines = header.topics ? [
      ...(header.mode === 'deer' ? [`易混：${header.topics.publicText}`] : header.mode === 'turtle' ? [`汤面：${header.topics.publicText}`] : []),
      `${header.mode === 'deer' ? '好人规则' : header.mode === 'turtle' ? '好人实际词条' : '好人词条'}：${header.topics.good}`,
      `${header.mode === 'deer' ? '卧底规则' : header.mode === 'turtle' ? '卧底实际词条' : '卧底词条'}：${header.topics.undercover}`,
      ...(header.topics.goodHint ? [header.mode === 'classic' ? '好人雷点：' + header.topics.goodHint : '好人提示：' + header.topics.goodHint] : []),
      ...(header.topics.undercoverHint ? [header.mode === 'classic' ? '卧底雷点：' + header.topics.undercoverHint : '卧底提示：' + header.topics.undercoverHint] : []),
      ...(header.topics.whiteHint ? ['白板提示：' + header.topics.whiteHint] : []),
    ] : []
    const playerLines = header.participants.map(p => `${p.seat}号 ${p.identity.nickname}（${label[p.initialCamp]}${p.finalCamp !== p.initialCamp ? '→' + label[p.finalCamp] : ''}${p.heroId !== null ? '，' + (HERO_NAMES[p.heroId] ?? '未知武将') : ''}${p.replacedTenureId ? '，补位' : ''}）`)
    const awardLines = header.awards.map(a => {
      const nickname = header.participants.find(p => p.tenureId === a.tenureId)?.identity.nickname ?? '已移除玩家'
      if (a.status === 'failed') return `${nickname}应得${a.amount}分，但积分未写入，请管理员核对。`
      if (a.status === 'disabled') return `${nickname}应得${a.amount}分，本局未启用积分。`
      if (a.status === 'zero') return `${nickname}本局未获得积分。`
      return /undercover-boom-bonus$/.test(a.reason) ? `${nickname}自爆获胜，额外加${a.amount}分。` : `${nickname}获得${a.amount}分。`
    })
    const introduction = [`对局 #${row.id}｜${modes[header.mode]}模式｜${summary.result}`,
      `主持人：${header.host.nickname}`,
      ...(header.ending.reason === 'elimination' ? [] : [`结束原因：${endingReasons[header.ending.reason]}`]),
      ...topicLines,
      '玩家：', ...playerLines,
      ...(awardLines.length ? ['积分：', ...awardLines] : [])]
    return { ...summary, introduction: introduction.filter(Boolean).join('\n'),
      phases: phases.map(p => ({ sequence: p.sequence, round: p.round, kind: p.kind, text: this.phaseText(header, p), content: this.phaseContent(header, p) })) }
  }
}

/** Bound plain-text fallback; caller escapes each page as text before sending. */
export function historyTextPages(text: string, maximum = 2500): string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 100) throw new GameUserError('分页上限无效。')
  const pages: string[] = []; let current = ''
  for (const character of text) {
    if (current.length + character.length > maximum) { pages.push(current); current = '' }
    current += character
  }
  if (current || !pages.length) pages.push(current)
  return pages
}

/** Bounded structured pages preserve media without escaping it into XML text. */
export function historyContentPages(content: h.Fragment, maximum = 2500): h.Fragment[] {
  if (!Number.isSafeInteger(maximum) || maximum < 100) throw new GameUserError('分页上限无效。')
  const pages: h.Fragment[] = []
  let nodes: h[] = []
  let length = 0
  const flush = () => { if (nodes.length) pages.push(h('template', {}, ...nodes)); nodes = []; length = 0 }
  const append = (element: h) => {
    if (element.type === 'template') { for (const child of element.children) append(child); return }
    if (element.type !== 'text') {
      if (length + 100 > maximum) flush()
      nodes.push(element); length += 100
      return
    }
    let text = ''
    for (const character of String(element.attrs.content ?? '')) {
      if (length + text.length + character.length > maximum) {
        if (text) nodes.push(h.text(text))
        flush(); text = ''
      }
      text += character
    }
    if (text) { nodes.push(h.text(text)); length += text.length }
  }
  for (const element of h.normalize(content)) append(element)
  flush()
  return pages.length ? pages : [h.text('')]
}
