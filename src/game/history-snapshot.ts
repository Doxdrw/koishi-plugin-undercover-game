/** Staged archive contract. Not yet connected to live game settlement. */
export type HistoryMode = 'classic' | 'deer' | 'turtle'
export type HistoryCamp = 'good' | 'undercover' | 'white'
export type HistoryExplosionOutcome = 'undercover-win' | 'white-win' | 'good-win' | 'no-winner' | 'white-departure'
export type HistoryEnding =
  | { kind: 'completed'; reason: 'elimination' | 'stalemate' | 'white-survival' | 'rule-no-winner' | 'self-explosion' | 'recruitment'; winner: HistoryCamp | 'none' }
  | { kind: 'aborted'; reason: 'host-stop' | 'host-timeout' | 'setup-timeout' | 'system-error' | 'restart' }

export interface HistoryIdentity {
  erased?: boolean
  platform: string
  userId: string
  personId?: number
  accountId?: string
  nickname: string
}

/** Never use seat alone as authorship: a replacement gets a new tenureId. */
export interface HistoryParticipant {
  tenureId: string
  seat: number
  identity: HistoryIdentity
  joinedAt: number
  leftAt?: number
  replacedTenureId?: string
  initialCamp: HistoryCamp
  finalCamp: HistoryCamp
  heroId: number | null
}

/**
 * A deliberately small, JSON-safe representation of a message fragment.
 * Text remains the authoritative searchable/fallback value.  Media sources
 * are optional because a platform may only expose an expiring or inline
 * (base64) source; those are represented by a safe placeholder instead of
 * being persisted verbatim.
 */
export type HistorySpeechSegment =
  | { kind: 'text'; text: string }
  | { kind: 'face'; id: string; name?: string; platform?: string }
  | { kind: 'media'; type: 'img' | 'audio' | 'video' | 'file'; src?: string; label?: string }

/** A fresh sequence even for a second overtime in the same round. */
export interface HistoryPhase {
  sequence: number
  round: number
  kind: 'regular' | 'overtime'
  eligibleTenures: string[]
  speeches: Array<{ tenureId: string; text: string; question?: string; answer?: string; segments?: HistorySpeechSegment[] }>
  ballots: Array<{
    voterTenureId: string
    targetSeat: number | null
    /** Nickname at the time of the vote; optional for older snapshots. */
    targetNickname?: string
    weight?: number
    /** Public replay wording; absent on older snapshots, inferred by the renderer. */
    status?: 'vote' | 'abstain' | 'timeout' | 'skip' | 'locked'
  }>
  effectiveVotes: Array<{ seat: number; count: number }>
  /** Public result notices belonging to this phase; optional for older snapshots. */
  outcomes?: string[]
  events: Array<
    | { kind: 'hero-reveal'; tenureId: string; heroId: number }
    | { kind: 'skill'; tenureId: string; heroId: number; effect: string; targetSeats: number[] }
    | { kind: 'self-explosion'; tenureId: string; text: string; outcome?: HistoryExplosionOutcome; adjudicated?: boolean }
    | { kind: 'replacement'; tenureId: string }
    | { kind: 'departure'; tenureId: string; reason: 'vote' | 'skill' | 'kick' | 'self-exit' | 'timeout' }
  >
}

export interface HistoryAward {
  tenureId: string
  systemKey?: string
  amount: number
  reason: string
  idempotencyKey: string
  status: 'written' | 'failed' | 'disabled' | 'zero'
  journalId?: number
}

export interface HistorySnapshot {
  version: 1
  gameId: string
  platform: string
  selfId: string
  guildId: string
  sandbox: boolean
  mode: HistoryMode
  startedAt: number
  endedAt: number
  host: HistoryIdentity
  ruleVersion: string
  /** Only explicitly selected rule values; never copy the full plugin config. */
  rules: Record<string, string | number | boolean | null>
  topics: { publicText: string; good: string; undercover: string; goodHint?: string; undercoverHint?: string; whiteHint?: string } | null
  ending: HistoryEnding
  participants: HistoryParticipant[]
  phases: HistoryPhase[]
  awards: HistoryAward[]
  /** Kept outside public game/phase payload and search text in persistent storage. */
  deerChoices: Array<{ tenureId: string; choice: string | null; hidden: boolean }>
}

function invariant(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error('无效历史快照：' + message)
}
const camps = ['good', 'undercover', 'white']
const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0

/** Validate JSON-compatible input and detach it from the mutable game closure. */
export function captureHistory(input: HistorySnapshot): Readonly<HistorySnapshot> {
  invariant(input.version === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.gameId), '版本或对局 UUID')
  invariant(['classic', 'deer', 'turtle'].includes(input.mode), '游戏模式')
  invariant(input.platform && input.guildId && input.selfId && typeof input.sandbox === 'boolean', '群与机器人范围')
  invariant(Number.isFinite(input.startedAt) && input.startedAt >= 0 && Number.isFinite(input.endedAt) && input.endedAt >= input.startedAt, '对局时间')
  invariant(input.ruleVersion && input.host.platform && (input.host.userId || input.host.erased) && typeof input.host.nickname === 'string', '主持人/规则版本')
  invariant(Object.values(input.rules).every(v => v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v)), '配置必须为显式原始规则值')
  if (input.ending.kind === 'completed') {
    invariant(['elimination', 'stalemate', 'white-survival', 'rule-no-winner', 'self-explosion', 'recruitment'].includes(input.ending.reason), '完成原因')
    invariant([...camps, 'none'].includes(input.ending.winner), '胜方')
    invariant(input.ending.reason !== 'stalemate' || input.ending.winner === 'undercover', '僵局胜方')
    invariant(input.ending.reason !== 'white-survival' || input.ending.winner === 'white', '白板胜方')
    invariant((input.ending.reason === 'rule-no-winner') === (input.ending.winner === 'none'), '无人胜利原因')
    invariant(input.topics !== null && input.participants.length > 0, '正常完成局缺少题面或玩家')
  } else {
    invariant(input.ending.kind === 'aborted' && ['host-stop', 'host-timeout', 'setup-timeout', 'system-error', 'restart'].includes(input.ending.reason), '中止原因')
  }
  if (input.topics) invariant(['publicText', 'good', 'undercover'].every(k => typeof input.topics[k] === 'string'), '题面')
  const tenures = new Map<string, HistoryParticipant>()
  for (const p of input.participants) {
    invariant(p.tenureId && !tenures.has(p.tenureId) && positiveInt(p.seat), '玩家任职 ID/座位')
    invariant(p.identity.platform === input.platform && (p.identity.userId || p.identity.erased) && typeof p.identity.nickname === 'string', '玩家身份')
    invariant(p.identity.personId === undefined || positiveInt(p.identity.personId), '真人 ID')
    invariant(camps.includes(p.initialCamp) && camps.includes(p.finalCamp), '阵营')
    invariant(p.heroId === null || Number.isSafeInteger(p.heroId) && p.heroId >= 0, '武将 ID')
    invariant(Number.isFinite(p.joinedAt) && p.joinedAt >= input.startedAt && p.joinedAt <= input.endedAt, '加入时间')
    invariant(p.leftAt === undefined || Number.isFinite(p.leftAt) && p.leftAt >= p.joinedAt && p.leftAt <= input.endedAt, '离开时间')
    const prior = [...tenures.values()].filter(row => row.seat === p.seat).at(-1)
    invariant(prior ? p.replacedTenureId === prior.tenureId && prior.leftAt !== undefined && prior.leftAt <= p.joinedAt : p.replacedTenureId === undefined, '补位继承链')
    tenures.set(p.tenureId, p)
  }
  let sequence = 0, lastRound = 0
  const seats = new Set(input.participants.map(p => p.seat))
  for (const phase of input.phases) {
    invariant(positiveInt(phase.sequence) && phase.sequence > sequence && positiveInt(phase.round) && phase.round >= lastRound, '轮次顺序')
    sequence = phase.sequence; lastRound = phase.round
    invariant(['regular', 'overtime'].includes(phase.kind), '发言阶段')
    invariant(new Set(phase.eligibleTenures).size === phase.eligibleTenures.length && phase.eligibleTenures.every(id => tenures.has(id)), '阶段资格')
    // A replacement may speak in the same phase as its departed predecessor.
    // Participant tenure intervals above, rather than seat uniqueness here,
    // guarantee that they did not occupy the seat simultaneously.
    invariant(new Set(phase.speeches.map(s => s.tenureId)).size === phase.speeches.length, '重复最终发言')
    for (const s of phase.speeches) invariant(phase.eligibleTenures.includes(s.tenureId) && typeof s.text === 'string'
      && (s.segments === undefined || Array.isArray(s.segments) && s.segments.every(segment =>
        segment.kind === 'text' && typeof segment.text === 'string'
        || segment.kind === 'face' && typeof segment.id === 'string' && /^[\w.:-]{1,128}$/.test(segment.id)
          && (segment.name === undefined || typeof segment.name === 'string' && segment.name.length <= 100)
          && (segment.platform === undefined || typeof segment.platform === 'string' && segment.platform.length <= 100)
        || segment.kind === 'media' && ['img', 'audio', 'video', 'file'].includes(segment.type)
          && (segment.src === undefined || typeof segment.src === 'string')
          && (segment.label === undefined || typeof segment.label === 'string')))
      && (input.mode !== 'turtle' || typeof s.question === 'string' && typeof s.answer === 'string'), '发言/问答作者')
    invariant(new Set(phase.ballots.map(b => b.voterTenureId)).size === phase.ballots.length, '重复最终选票')
    for (const b of phase.ballots) invariant(tenures.has(b.voterTenureId) && (b.targetSeat === null || seats.has(b.targetSeat))
      && (b.targetNickname === undefined || typeof b.targetNickname === 'string')
      && (b.weight === undefined || Number.isFinite(b.weight) && b.weight >= 0)
      && (b.status === undefined || ['vote', 'abstain', 'timeout', 'skip', 'locked'].includes(b.status)), '投票记录')
    invariant(new Set(phase.effectiveVotes.map(v => v.seat)).size === phase.effectiveVotes.length, '重复有效票型')
    for (const v of phase.effectiveVotes) invariant(seats.has(v.seat) && Number.isFinite(v.count) && v.count >= 0, '有效票数')
    if (phase.outcomes !== undefined) invariant(Array.isArray(phase.outcomes) && phase.outcomes.every(text => typeof text === 'string'), '阶段结果')
    for (const e of phase.events) {
      invariant(tenures.has(e.tenureId), '事件作者')
      if (e.kind === 'departure') invariant(['vote', 'skill', 'kick', 'self-exit', 'timeout'].includes(e.reason), '出局原因')
      else if (e.kind === 'replacement') invariant(input.participants.some(p => p.tenureId === e.tenureId && p.replacedTenureId), '补位记录')
      else if (e.kind === 'self-explosion') invariant(typeof e.text === 'string'
        && (e.outcome === undefined || ['undercover-win', 'white-win', 'good-win', 'no-winner', 'white-departure'].includes(e.outcome))
        && (e.adjudicated === undefined || typeof e.adjudicated === 'boolean'), '自爆记录')
      else {
        invariant(['skill', 'hero-reveal'].includes(e.kind) && Number.isSafeInteger(e.heroId) && e.heroId >= 0, '技能/亮将')
        if (e.kind === 'skill') invariant(typeof e.effect === 'string' && e.targetSeats.every(s => seats.has(s)), '技能结果')
      }
    }
  }
  const keys = new Set<string>()
  for (const a of input.awards) {
    invariant(tenures.has(a.tenureId) && Number.isFinite(a.amount) && a.reason && a.idempotencyKey && !keys.has(a.idempotencyKey), '积分结果')
    keys.add(a.idempotencyKey)
    invariant(['written', 'failed', 'disabled', 'zero'].includes(a.status), '写分状态')
    invariant(a.journalId === undefined || a.status === 'written' && positiveInt(a.journalId), '积分流水关联')
  }
  invariant(input.mode === 'deer' || input.deerChoices.length === 0, '非鹿局选人')
  invariant(new Set(input.deerChoices.map(c => c.tenureId)).size === input.deerChoices.length, '重复选人')
  for (const c of input.deerChoices) invariant(tenures.has(c.tenureId) && (c.choice === null || typeof c.choice === 'string') && typeof c.hidden === 'boolean', '选人所有权')
  const json = JSON.stringify(input)
  invariant(Buffer.byteLength(json) <= 8 * 1024 * 1024, '超过单局 8 MiB 上限')
  const copy = JSON.parse(json) as HistorySnapshot
  function freeze(value: unknown) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  }
  freeze(copy)
  return copy
}

export function archiveDisposition(snapshot: Readonly<HistorySnapshot>, options = { enabled: true, sandbox: false }): 'completed' | 'aborted' | 'deer-aborted' | 'skip' {
  if (!options.enabled || snapshot.sandbox && !options.sandbox) return 'skip'
  if (snapshot.ending.kind === 'completed') return 'completed'
  // A stopped game becomes replayable only after a real speech/question phase
  // exists.  Keep Deer's dedicated disposition so its historical selection
  // controls remain compatible; the generic aborted list treats both values
  // as the same public category. Setup/dealing interruptions remain skipped.
  if (snapshot.ending.reason === 'host-stop' && snapshot.phases.length > 0) {
    if (snapshot.mode === 'deer' && snapshot.topics !== null && !!snapshot.topics.publicText.trim()
      && !!snapshot.topics.good.trim() && !!snapshot.topics.undercover.trim()) return 'deer-aborted'
    if (snapshot.mode === 'deer') return 'skip'
    return 'aborted'
  }
  return snapshot.mode === 'deer' && snapshot.topics !== null && !!snapshot.topics.publicText.trim()
    && !!snapshot.topics.good.trim() && !!snapshot.topics.undercover.trim() ? 'deer-aborted' : 'skip'
}
