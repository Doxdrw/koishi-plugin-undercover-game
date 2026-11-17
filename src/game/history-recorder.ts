import { captureHistory, type HistorySnapshot, type HistoryParticipant, type HistoryIdentity, type HistoryCamp, type HistoryPhase, type HistoryEnding, type HistorySpeechSegment, type HistoryExplosionOutcome } from './history-snapshot'
import type { ScoreReceipt } from './score-service'
import type { VoteFact } from './vote-facts'

export type HistoryStart = Pick<HistorySnapshot, 'gameId' | 'platform' | 'selfId' | 'guildId' | 'sandbox' | 'mode' | 'startedAt' | 'host' | 'ruleVersion' | 'rules'>

/** Structured event collector; no game transitions, messages, DB or score writes. */
export class HistoryRecorder {
  private data: HistorySnapshot
  private active = new Map<number, HistoryParticipant>()
  private current?: HistoryPhase
  private phaseToken?: string
  private finished?: Readonly<HistorySnapshot>

  constructor(start: HistoryStart) {
    this.data = { ...structuredClone(start), version: 1, endedAt: start.startedAt, topics: null,
      ending: { kind: 'aborted', reason: 'system-error' }, participants: [], phases: [], awards: [], deerChoices: [] }
  }
  hasPhase(): boolean { return this.data.phases.length > 0 }
  currentSequence(): number | undefined { return this.current?.sequence }
  private live() { if (this.finished) throw new Error('历史记录器已经结束。') }
  private participant(seat: number) {
    const row = this.active.get(seat)
    if (!row) throw new Error('历史座位未在场：' + seat)
    return row
  }
  topics(topics: NonNullable<HistorySnapshot['topics']>) { this.live(); this.data.topics = structuredClone(topics) }
  join(seat: number, identity: HistoryIdentity, camp: HistoryCamp, heroId: number | null, at: number): string {
    this.live()
    if (this.active.has(seat)) throw new Error('历史座位尚未离场。')
    const previous = this.data.participants.filter(p => p.seat === seat).at(-1)
    const tenureId = `seat-${seat}-entry-${this.data.participants.length + 1}`
    const row: HistoryParticipant = { tenureId, seat, identity: structuredClone(identity), joinedAt: at,
      ...(previous ? { replacedTenureId: previous.tenureId } : {}), initialCamp: camp, finalCamp: camp, heroId }
    this.data.participants.push(row); this.active.set(seat, row)
    if (previous && this.current) this.current.events.push({ kind: 'replacement', tenureId })
    return tenureId
  }
  leave(seat: number, reason: Extract<HistoryPhase['events'][number], { kind: 'departure' }>['reason'], at: number) {
    this.live(); const row = this.participant(seat)
    row.leftAt = at
    this.current?.events.push({ kind: 'departure', tenureId: row.tenureId, reason })
    this.active.delete(seat)
  }
  camp(seat: number, camp: HistoryCamp) { this.live(); this.participant(seat).finalCamp = camp }
  /** token identifies an actual speech window; roster/timer refresh reuses it. */
  beginPhase(token: string, round: number, kind: HistoryPhase['kind'], seats: readonly number[]) {
    this.live()
    if (!token) throw new Error('缺少历史阶段标识。')
    if (token === this.phaseToken) {
      if (this.current!.round !== round || this.current!.kind !== kind) throw new Error('历史阶段标识冲突。')
      this.allowSpeakers(seats); return this.current!.sequence
    }
    this.current = { sequence: this.data.phases.length + 1, round, kind, eligibleTenures: [], speeches: [], ballots: [], effectiveVotes: [], outcomes: [], events: [] }
    this.data.phases.push(this.current); this.phaseToken = token; this.allowSpeakers(seats)
    return this.current.sequence
  }
  allowSpeakers(seats: readonly number[]) {
    this.live(); if (!this.current) throw new Error('尚未开始历史发言阶段。')
    for (const seat of seats) {
      const id = this.participant(seat).tenureId
      if (!this.current.eligibleTenures.includes(id)) this.current.eligibleTenures.push(id)
    }
  }
  speech(seat: number, text: string, question?: string, answer?: string, segments?: HistorySpeechSegment[]) {
    this.live(); const row = this.participant(seat)
    if (!this.current?.eligibleTenures.includes(row.tenureId)) throw new Error('不是本次历史发言参与者。')
    this.writeSpeech(this.current, row.tenureId, text, question, answer, segments)
  }
  speechAt(seat: number, round: number, text: string, segments?: HistorySpeechSegment[]) {
    this.live(); const row = this.participant(seat)
    const phase = this.data.phases.find(p => p.round === round && p.kind === 'regular')
    if (!phase) throw new Error('未找到补发言对应的普通阶段。')
    if (!phase.eligibleTenures.includes(row.tenureId)) phase.eligibleTenures.push(row.tenureId)
    this.writeSpeech(phase, row.tenureId, text, undefined, undefined, segments)
  }
  invalidateSpeech(seat: number, round: number, overtime: boolean, text: string, reason: string) {
    this.live(); const row = this.participant(seat)
    for (const phase of this.data.phases.filter(p => p.round === round && p.kind === (overtime ? 'overtime' : 'regular'))) {
      const speech = phase.speeches.find(s => s.tenureId === row.tenureId && s.text === text)
      if (speech) speech.invalidReason = reason
    }
  }
  private writeSpeech(phase: HistoryPhase, tenureId: string, text: string, question?: string, answer?: string, segments?: HistorySpeechSegment[]) {
    const old = phase.speeches.findIndex(s => s.tenureId === tenureId)
    const previous = phase.speeches[old]
    const previousInvalid = previous?.previousInvalid ? structuredClone(previous.previousInvalid) : []
    if (previous?.invalidReason) previousInvalid.push({ text: previous.text, reason: previous.invalidReason, segments: previous.segments })
    const speech = { tenureId, text,
      ...(question === undefined ? {} : { question }), ...(answer === undefined ? {} : { answer }),
      ...(segments === undefined ? {} : { segments: structuredClone(segments) }),
      ...(previousInvalid.length ? { previousInvalid } : {}) }
    if (old < 0) phase.speeches.push(speech)
    else phase.speeches[old] = speech
  }
  outcome(text: string) {
    this.live(); if (!this.current) throw new Error('尚未开始历史发言阶段。')
    if (!text.trim()) throw new Error('阶段结果不能为空。')
    this.current.outcomes ??= []
    this.current.outcomes.push(text)
  }
  explosion(seat: number, text: string) {
    this.live()
    const row = this.participant(seat)
    if (!this.current) throw new Error('尚未开始历史阶段。')
    this.current.events.push({ kind: 'self-explosion', tenureId: row.tenureId, text })
  }
  resolveExplosion(seat: number, outcome: HistoryExplosionOutcome, adjudicated: boolean) {
    this.live()
    const row = this.participant(seat)
    const event = this.current && [...this.current.events].reverse().find(e => e.kind === 'self-explosion' && e.tenureId === row.tenureId && !e.outcome)
    if (!event || event.kind !== 'self-explosion') throw new Error('缺少待判定的自爆记录。')
    event.outcome = outcome; event.adjudicated = adjudicated
  }
  /** Replace this phase's facts; an aborted vote is not a completed result. */
  vote(ballots: Array<Omit<VoteFact, 'weight' | 'status'> & Partial<Pick<VoteFact, 'weight' | 'status'>>>,
    effectiveVotes: HistoryPhase['effectiveVotes'], settled = true, anonymousVotes: NonNullable<HistoryPhase['anonymousVotes']> = []) {
    this.live(); if (!this.current) throw new Error('尚未开始历史阶段。')
    this.current.ballots = ballots.map(b => ({ voterTenureId: this.participant(b.voterSeat).tenureId,
      ...(b.deciderSeat === undefined ? {} : { deciderTenureId: this.participant(b.deciderSeat).tenureId }), targetSeat: b.targetSeat,
      ...(b.targetNickname === undefined ? {} : { targetNickname: b.targetNickname }),
      ...(b.weight === undefined ? {} : { weight: b.weight }),
      ...(b.status === undefined ? {} : { status: b.status }),
      ...(b.countedWeight === undefined ? {} : { countedWeight: b.countedWeight }),
      ...(b.invalidReasons === undefined ? {} : { invalidReasons: [...b.invalidReasons] }) }))
    this.current.effectiveVotes = structuredClone(effectiveVotes)
    this.current.voteSettled = settled
    this.current.anonymousVotes = anonymousVotes.length ? structuredClone(anonymousVotes) : undefined
  }
  event(seat: number, event: Omit<Extract<HistoryPhase['events'][number], { kind: 'hero-reveal' }>, 'tenureId'>
    | Omit<Extract<HistoryPhase['events'][number], { kind: 'skill' }>, 'tenureId'>,
    position?: { sequence?: number; timing?: HistoryPhase['events'][number]['timing'] }) {
    this.live()
    // Post-elimination skills remain authored by the departed tenure.
    const row = this.active.get(seat) ?? this.data.participants.filter(p => p.seat === seat).at(-1)
    const phase = position?.sequence === undefined ? this.current : this.data.phases.find(p => p.sequence === position.sequence)
    if (!row || !phase) throw new Error('历史技能阶段或参与者缺失。')
    phase.events.push({ ...structuredClone(event), ...(position?.timing ? { timing: position.timing } : {}), tenureId: row.tenureId })
  }
  choice(seat: number, choice: string | null) {
    this.live(); if (this.data.mode !== 'deer') throw new Error('仅鹿模式拥有选人记录。')
    const row = this.participant(seat)
    const old = this.data.deerChoices.find(c => c.tenureId === row.tenureId)
    if (old) old.choice = choice
    else {
      const prior = this.data.participants.filter(p => p.seat === seat && p.tenureId !== row.tenureId && p.identity.platform === row.identity.platform
        && (p.identity.userId === row.identity.userId || row.identity.personId !== undefined && p.identity.personId === row.identity.personId))
      const hidden = prior.some(p => this.data.deerChoices.some(c => c.tenureId === p.tenureId && c.hidden))
      this.data.deerChoices.push({ tenureId: row.tenureId, choice, hidden })
    }
  }
  hideChoices(platform: string, userId: string, personId?: number): number {
    this.live()
    let count = 0
    for (const p of this.data.participants) {
      if (p.identity.platform !== platform || p.identity.erased || !(p.identity.userId === userId || personId !== undefined && p.identity.personId === personId)) continue
      const choice = this.data.deerChoices.find(c => c.tenureId === p.tenureId)
      if (choice) choice.hidden = true
      else this.data.deerChoices.push({ tenureId: p.tenureId, choice: null, hidden: true })
      count++
    }
    return count
  }
  finish(ending: HistoryEnding, at: number, receipts: readonly ScoreReceipt[] = [], systemKey?: string): Readonly<HistorySnapshot> {
    if (this.finished) return this.finished
    this.data.ending = structuredClone(ending); this.data.endedAt = at
    this.data.awards = receipts.map(receipt => {
      // The last matching actual account tenure, never a different login with the
      // same person nickname. Legacy fallback only when no account ID was known.
      const participant = this.data.participants.filter(p => receipt.input.accountId
        ? p.identity.accountId === receipt.input.accountId : p.identity.nickname === receipt.input.nickname).at(-1)
      if (!participant) throw new Error('积分结果没有对应的历史参赛账号。')
      return { tenureId: participant.tenureId, systemKey, amount: receipt.input.amount, reason: receipt.input.reason,
        idempotencyKey: receipt.input.idempotencyKey, status: receipt.status, journalId: receipt.journalId }
    })
    return this.finished = captureHistory(this.data)
  }
}
