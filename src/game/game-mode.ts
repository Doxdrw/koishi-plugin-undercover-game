export type GameMode = "classic" | "deer" | "turtle"

export interface GameModeCapabilities {
  readonly allowsWhite: boolean
  readonly allowsWhiteRecruitment: boolean
  readonly allowsSelfExplosion: boolean
}

export interface GameModeModule extends GameModeCapabilities {
  readonly id: GameMode
  readonly label: string
}

export type DeerSelectionStatus = "waiting-player" | "pending-host" | "approved"

export interface DeerSelectionState {
  readonly seat: number
  userId: string
  nickname: string
  status: DeerSelectionStatus
  candidate?: string
  requestMessageIds?: string[]
  requestMessageContent?: string
  selectionDeadlineAt?: number
  submittedAt?: number
}

export interface DeerProgress {
  readonly waitingPlayer: number[]
  readonly pendingHost: number[]
  readonly approved: number[]
}

export interface ModeRosterMember {
  readonly seat: number
  readonly userId: string
  readonly nickname: string
}

export interface ModeMessageReference {
  readonly messageId?: string
  readonly content?: string
}

export interface ModeQuoteLike {
  readonly id?: unknown
  readonly messageId?: unknown
  readonly content?: unknown
}

export interface ModeMessageReferenceSources {
  readonly quote?: ModeQuoteLike
  readonly eventQuote?: ModeQuoteLike
  readonly rawMessage?: unknown
  readonly onebotMessage?: unknown
}

export type DeerSubmissionResult =
  | { readonly kind: "accepted", readonly selection: DeerSelectionState }
  | { readonly kind: "empty" | "common-term" | "not-player" | "pending" | "approved" }

export type DeerReviewResult =
  | { readonly kind: "approved" | "rejected", readonly selection: DeerSelectionState, readonly reason?: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "not-pending" }

export interface ClassicModeState {
  readonly kind: "classic"
}

export interface DeerModeState {
  readonly kind: "deer"
  goodRule: string
  undercoverRule: string
  commonTerm: string
  selections: Map<number, DeerSelectionState>
  firstRoundStarted: boolean
}

export type TurtleAnswer = "是" | "否" | "是也不是" | "无关" | "不确定"
export type TurtleTurnStatus = "waiting-question" | "pending-host" | "complete"

export interface TurtleTurnState {
  readonly seat: number
  userId: string
  nickname: string
  status: TurtleTurnStatus
  question?: string
  questionMessageIds?: string[]
  questionMessageContent?: string
  answer?: TurtleAnswer
  remainingMs: number
  clockStartedAt?: number
  pendingSince?: number
}

export interface TurtleModeState {
  readonly kind: "turtle"
  surface: string
  goodTerm: string
  undercoverTerm: string
  activeRoundKey?: string
  rounds: Map<string, Map<number, TurtleTurnState>>
}

export type TurtleQuestionResult =
  | { readonly kind: "accepted", readonly turn: TurtleTurnState }
  | { readonly kind: "empty" }
  | { readonly kind: "not-player" }
  | { readonly kind: "wrong-seat" }
  | { readonly kind: "pending" }
  | { readonly kind: "complete" }
  | { readonly kind: "expired" }

export type TurtleHostInput =
  | { readonly kind: "answer", readonly seat: number, readonly answer: TurtleAnswer }
  | { readonly kind: "correction", readonly seat: number, readonly answer: TurtleAnswer }
  | { readonly kind: "reject", readonly seat: number, readonly reason?: string }
  | { readonly kind: "seat-mismatch", readonly seat: number, readonly quotedSeat: number }
  | { readonly kind: "invalid" }

export type TurtleAnswerResult =
  | { readonly kind: "answered", readonly turn: TurtleTurnState }
  | { readonly kind: "rejected", readonly turn: TurtleTurnState, readonly reason?: string }
  | { readonly kind: "corrected", readonly turn: TurtleTurnState }
  | { readonly kind: "not-found" }
  | { readonly kind: "not-pending" }
  | { readonly kind: "not-complete" }

export interface TurtleProgress {
  readonly waitingQuestion: number[]
  readonly pendingHost: number[]
  readonly complete: number[]
}

export type GameModeState = ClassicModeState | DeerModeState | TurtleModeState

const modules: Record<GameMode, GameModeModule> = {
  classic: {
    id: "classic",
    label: "经典模式",
    allowsWhite: true,
    allowsWhiteRecruitment: true,
    allowsSelfExplosion: true,
  },
  deer: {
    id: "deer",
    label: "鹿模式",
    allowsWhite: true,
    allowsWhiteRecruitment: false,
    allowsSelfExplosion: false,
  },
  turtle: {
    id: "turtle",
    label: "龟模式",
    allowsWhite: false,
    allowsWhiteRecruitment: false,
    allowsSelfExplosion: false,
  },
}

export function getGameModeModule(mode: GameMode): GameModeModule {
  return modules[mode]
}

export function formatModeRoundCapabilities(
  mode: GameMode,
  prefix: "本轮" | "从现在起",
): string {
  return prefix + (getGameModeModule(mode).allowsSelfExplosion ? "可以自爆、" : "")
    + "可以盘发言、可以带票。"
}

export function createGameModeState(mode: GameMode): GameModeState {
  if (mode === "deer") {
    return {
      kind: "deer",
      goodRule: "",
      undercoverRule: "",
      commonTerm: "",
      selections: new Map(),
      firstRoundStarted: false,
    }
  }
  if (mode === "turtle") {
    return {
      kind: "turtle",
      surface: "",
      goodTerm: "",
      undercoverTerm: "",
      activeRoundKey: undefined,
      rounds: new Map(),
    }
  }
  return { kind: "classic" }
}

const selectionCommands = new Map<string, GameMode>([
  ["经典模式", "classic"],
  ["鹿模式", "deer"],
  ["龟模式", "turtle"],
])

const startCommands = new Map<string, GameMode>([
  ["开始经典模式", "classic"],
  ["开始鹿模式", "deer"],
  ["开始龟模式", "turtle"],
])

export function parseGameModeSelection(content: string): GameMode | null {
  return selectionCommands.get(content.replace(/\s/g, "")) ?? null
}

export function parseModeStart(content: string): GameMode | null {
  return startCommands.get(content.replace(/\s/g, "")) ?? null
}

export function normalizeModeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{White_Space}\p{P}\p{S}]/gu, "")
}

export function normalizeModeMessageReference(quote?: ModeQuoteLike): ModeMessageReference | undefined {
  if (!quote) return undefined
  const rawMessageId = quote.id ?? quote.messageId
  const messageId = rawMessageId === undefined || rawMessageId === null
    ? undefined
    : String(rawMessageId).trim() || undefined
  const content = typeof quote.content === "string" ? quote.content.trim() : undefined
  if (!messageId && !content) return undefined
  return {
    ...(messageId ? { messageId } : {}),
    ...(content ? { content } : {}),
  }
}

function rawReplyMessageId(rawMessage: unknown): string | undefined {
  if (typeof rawMessage === "string") {
    const match = rawMessage.match(/\[CQ:reply,[^\]]*?\bid=([^,\]]+)/i)
    return match?.[1] ? String(match[1]).trim() : undefined
  }
  if (Array.isArray(rawMessage)) {
    const reply = rawMessage.find((segment: any) => segment?.type === "reply")
    const id = reply?.data?.id ?? reply?.data?.message_id ?? reply?.attrs?.id ?? reply?.id
    return id === undefined || id === null ? undefined : String(id).trim() || undefined
  }
  if (!rawMessage || typeof rawMessage !== "object") return undefined
  const record = rawMessage as Record<string, unknown>
  if (record.type === "reply") {
    const data = record.data as Record<string, unknown> | undefined
    const attrs = record.attrs as Record<string, unknown> | undefined
    const id = data?.id ?? data?.message_id ?? attrs?.id ?? record.id
    if (id !== undefined && id !== null) return String(id).trim() || undefined
  }
  return rawReplyMessageId(record.message)
    ?? rawReplyMessageId(record.raw_message)
    ?? rawReplyMessageId(record.original_message)
}

export function resolveModeMessageReference(
  sources: ModeMessageReferenceSources,
): ModeMessageReference | undefined {
  return normalizeModeMessageReference(sources.quote)
    ?? normalizeModeMessageReference(sources.eventQuote)
    ?? (() => {
      const messageId = rawReplyMessageId(sources.rawMessage)
      return messageId ? { messageId } : undefined
    })()
    ?? (() => {
      const messageId = rawReplyMessageId(sources.onebotMessage)
      return messageId ? { messageId } : undefined
    })()
}

export function parseTurtleQuestion(content: string): { seat: number, question: string } | null {
  const match = content.trim().match(/^(\d+)\s*(.*)$/s)
  if (!match) return null
  return { seat: Number(match[1]), question: match[2].trim() }
}

const turtleAnswers: readonly TurtleAnswer[] = ["是也不是", "不确定", "无关", "是", "否"]

export function parseTurtleHostInput(content: string, quotedSeat?: number): TurtleHostInput {
  const trimmed = content.trim()
  const correction = trimmed.startsWith("改")
  const source = correction ? trimmed.slice(1).trim() : trimmed
  const seatMatch = source.match(/^(\d+)\s*(.*)$/s)
  if (!seatMatch && quotedSeat === undefined) return { kind: "invalid" }
  const seat = seatMatch ? Number(seatMatch[1]) : quotedSeat!
  if (seatMatch && quotedSeat !== undefined && seat !== quotedSeat) {
    return { kind: "seat-mismatch", seat, quotedSeat }
  }
  const decision = (seatMatch ? seatMatch[2] : source).trim()
  if (!correction && decision.startsWith("驳回")) {
    const reason = decision.slice(2).replace(/^[\s：:，,]+/, "").trim()
    return { kind: "reject", seat, reason: reason || undefined }
  }
  const answer = turtleAnswers.find(value => decision === value)
  if (!answer) return { kind: "invalid" }
  return { kind: correction ? "correction" : "answer", seat, answer }
}

export class ModeInteractionCoordinator {
  private currentState: GameModeState = createGameModeState("classic")

  get state(): GameModeState {
    return this.currentState
  }

  get mode(): GameMode {
    return this.currentState.kind
  }

  get module(): GameModeModule {
    return getGameModeModule(this.mode)
  }

  reset(mode: GameMode): GameModeState {
    this.currentState = createGameModeState(mode)
    return this.currentState
  }

  configureDeer(goodRule: string, undercoverRule: string, commonTerm: string): void {
    const state = this.requireDeer()
    state.goodRule = goodRule.trim()
    state.undercoverRule = undercoverRule.trim()
    state.commonTerm = commonTerm.trim()
  }

  syncDeerRoster(roster: readonly ModeRosterMember[], whiteSeat: number): void {
    const state = this.requireDeer()
    const expected = new Map(roster
      .filter(member => member.seat !== whiteSeat)
      .map(member => [member.seat, member]))

    for (const seat of state.selections.keys()) {
      if (!expected.has(seat)) state.selections.delete(seat)
    }

    for (const member of expected.values()) {
      const current = state.selections.get(member.seat)
      if (!current || current.userId !== member.userId) {
        state.selections.set(member.seat, {
          seat: member.seat,
          userId: member.userId,
          nickname: member.nickname,
          status: "waiting-player",
        })
      }
      else {
        current.nickname = member.nickname
      }
    }
  }

  removeDeerSeat(seat: number): boolean {
    return this.requireDeer().selections.delete(seat)
  }

  beginDeerSelectionClock(seat: number, deadlineAt: number): DeerSelectionState | null {
    const selection = this.requireDeer().selections.get(seat)
    if (!selection || selection.status !== "waiting-player") return null
    selection.selectionDeadlineAt = deadlineAt
    return selection
  }

  submitDeerSelection(userId: string, input: string, now = Date.now()): DeerSubmissionResult {
    const state = this.requireDeer()
    const selection = [...state.selections.values()].find(value => value.userId === userId)
    if (!selection) return { kind: "not-player" }
    if (selection.status === "pending-host") return { kind: "pending" }
    if (selection.status === "approved") return { kind: "approved" }

    // “选词” is the neutral public wording; keep “选人” as a compatibility
    // alias for historical games and commands.  Store only the candidate so
    // review, history and rule checks do not leak the command prefix.
    const candidate = input.trim().replace(/^(?:选人|选词)[\s：:]*/, "").trim()
    if (!candidate) return { kind: "empty" }
    if (normalizeModeTerm(candidate) === normalizeModeTerm(state.commonTerm)) {
      return { kind: "common-term" }
    }

    selection.status = "pending-host"
    selection.candidate = candidate
    selection.submittedAt = now
    delete selection.selectionDeadlineAt
    delete selection.requestMessageIds
    delete selection.requestMessageContent
    return { kind: "accepted", selection }
  }

  recordDeerRequestMessage(seat: number, messageIds?: readonly string[], messageContent?: string): boolean {
    const selection = this.requireDeer().selections.get(seat)
    if (!selection || selection.status !== "pending-host") return false
    selection.requestMessageIds = messageIds?.map(String).filter(Boolean)
    selection.requestMessageContent = messageContent?.trim() || undefined
    return true
  }

  reviewDeerSelection(input: {
    readonly seat?: number
    readonly requestMessageId?: string
    readonly requestMessageContent?: string
    readonly approved: boolean
    readonly reason?: string
  }): DeerReviewResult {
    const state = this.requireDeer()
    const seatSelection = input.seat === undefined ? undefined : state.selections.get(input.seat)
    let referencedSelection: DeerSelectionState | undefined
    if (input.requestMessageId) {
      referencedSelection = [...state.selections.values()]
        .find(value => value.requestMessageIds?.includes(input.requestMessageId!))
    }
    if (!referencedSelection && !input.requestMessageId && input.requestMessageContent) {
      const content = input.requestMessageContent.trim()
      const matches = [...state.selections.values()]
        .filter(value => value.requestMessageContent === content)
      if (matches.length === 1) referencedSelection = matches[0]
    }
    const hasReference = Boolean(input.requestMessageId || input.requestMessageContent)
    if (hasReference && !referencedSelection) return { kind: "not-found" }
    if (seatSelection && referencedSelection && seatSelection.seat !== referencedSelection.seat) {
      return { kind: "not-found" }
    }
    const selection = referencedSelection ?? seatSelection
    if (!selection) return { kind: "not-found" }
    if (selection.status !== "pending-host") return { kind: "not-pending" }

    if (input.approved) {
      selection.status = "approved"
      delete selection.submittedAt
      delete selection.requestMessageIds
      delete selection.requestMessageContent
      return { kind: "approved", selection }
    }

    selection.status = "waiting-player"
    delete selection.candidate
    delete selection.selectionDeadlineAt
    delete selection.submittedAt
    delete selection.requestMessageIds
    delete selection.requestMessageContent
    return {
      kind: "rejected",
      selection,
      reason: input.reason?.trim() || undefined,
    }
  }

  resetDeerSelection(seat: number): DeerSelectionState | null {
    const selection = this.requireDeer().selections.get(seat)
    if (!selection) return null
    selection.status = "waiting-player"
    delete selection.candidate
    delete selection.selectionDeadlineAt
    delete selection.submittedAt
    delete selection.requestMessageIds
    delete selection.requestMessageContent
    return selection
  }

  deerSelectionForSeat(seat: number): DeerSelectionState | undefined {
    return this.requireDeer().selections.get(seat)
  }

  deerAllApproved(): boolean {
    const selections = [...this.requireDeer().selections.values()]
    return selections.length > 0 && selections.every(value => value.status === "approved")
  }

  deerPendingSeats(): number[] {
    return [...this.requireDeer().selections.values()]
      .filter(value => value.status !== "approved")
      .map(value => value.seat)
      .sort((left, right) => left - right)
  }

  deerProgress(): DeerProgress {
    const progress: DeerProgress = { waitingPlayer: [], pendingHost: [], approved: [] }
    for (const selection of this.requireDeer().selections.values()) {
      if (selection.status === "waiting-player") progress.waitingPlayer.push(selection.seat)
      else if (selection.status === "pending-host") progress.pendingHost.push(selection.seat)
      else progress.approved.push(selection.seat)
    }
    progress.waitingPlayer.sort((left, right) => left - right)
    progress.pendingHost.sort((left, right) => left - right)
    progress.approved.sort((left, right) => left - right)
    return progress
  }

  deerExpiredWaitingSeats(now: number): number[] {
    return [...this.requireDeer().selections.values()]
      .filter(selection => selection.status === "waiting-player"
        && selection.selectionDeadlineAt !== undefined
        && selection.selectionDeadlineAt <= now)
      .map(selection => selection.seat)
      .sort((left, right) => left - right)
  }

  get deerFirstRoundStarted(): boolean {
    return this.requireDeer().firstRoundStarted
  }

  markDeerFirstRoundStarted(): boolean {
    const state = this.requireDeer()
    if (state.firstRoundStarted) return false
    state.firstRoundStarted = true
    return true
  }

  configureTurtle(surface: string, goodTerm: string, undercoverTerm: string): void {
    const state = this.requireTurtle()
    state.surface = surface.trim()
    state.goodTerm = goodTerm.trim()
    state.undercoverTerm = undercoverTerm.trim()
  }

  beginTurtleRound(
    roundKey: string,
    roster: readonly ModeRosterMember[],
    eligibleSeats: readonly number[],
    perPlayerMs: number,
    now: number,
  ): Map<number, TurtleTurnState> {
    const state = this.requireTurtle()
    const eligible = new Set(eligibleSeats)
    const turns = new Map<number, TurtleTurnState>()
    for (const member of roster) {
      if (!eligible.has(member.seat)) continue
      turns.set(member.seat, {
        seat: member.seat,
        userId: member.userId,
        nickname: member.nickname,
        status: "waiting-question",
        remainingMs: perPlayerMs,
        clockStartedAt: Number.isFinite(perPlayerMs) ? now : undefined,
      })
    }
    state.activeRoundKey = roundKey
    state.rounds.set(roundKey, turns)
    return turns
  }

  syncTurtleRoundRoster(
    roster: readonly ModeRosterMember[],
    eligibleSeats: readonly number[],
    perPlayerMs: number,
    now: number,
  ): void {
    const turns = this.requireActiveTurtleRound()
    const eligible = new Set(eligibleSeats)
    const expected = new Map(roster.filter(member => eligible.has(member.seat)).map(member => [member.seat, member]))
    for (const seat of turns.keys()) {
      if (!expected.has(seat)) turns.delete(seat)
    }
    for (const member of expected.values()) {
      const current = turns.get(member.seat)
      if (!current || current.userId !== member.userId) {
        turns.set(member.seat, {
          seat: member.seat,
          userId: member.userId,
          nickname: member.nickname,
          status: "waiting-question",
          remainingMs: perPlayerMs,
          clockStartedAt: Number.isFinite(perPlayerMs) ? now : undefined,
        })
      }
      else current.nickname = member.nickname
    }
  }

  submitTurtleQuestion(userId: string, seat: number, question: string, now: number): TurtleQuestionResult {
    const turns = this.requireActiveTurtleRound()
    const turn = [...turns.values()].find(value => value.userId === userId)
    if (!turn) return { kind: "not-player" }
    if (turn.seat !== seat) return { kind: "wrong-seat" }
    if (turn.status === "pending-host") return { kind: "pending" }
    if (turn.status === "complete") return { kind: "complete" }
    const normalized = question.trim()
    if (!normalized) return { kind: "empty" }
    if (turn.clockStartedAt !== undefined) {
      turn.remainingMs = Math.max(0, turn.remainingMs - Math.max(0, now - turn.clockStartedAt))
      delete turn.clockStartedAt
    }
    if (turn.remainingMs <= 0) return { kind: "expired" }
    turn.status = "pending-host"
    turn.question = normalized
    turn.pendingSince = now
    delete turn.answer
    delete turn.questionMessageIds
    delete turn.questionMessageContent
    return { kind: "accepted", turn }
  }

  recordTurtleQuestionMessage(seat: number, messageIds?: readonly string[], messageContent?: string): boolean {
    const turn = this.requireActiveTurtleRound().get(seat)
    if (!turn || turn.status !== "pending-host") return false
    turn.questionMessageIds = messageIds?.map(String).filter(Boolean)
    turn.questionMessageContent = messageContent?.trim() || undefined
    return true
  }

  turtleSeatForQuestionReference(reference: ModeMessageReference): number | undefined {
    const turns = [...this.requireActiveTurtleRound().values()]
    if (reference.messageId) {
      return turns.find(turn => turn.questionMessageIds?.includes(reference.messageId!))?.seat
    }
    if (!reference.content) return undefined
    const matches = turns.filter(turn => turn.questionMessageContent === reference.content)
    return matches.length === 1 ? matches[0].seat : undefined
  }

  answerTurtleQuestion(
    input: Extract<TurtleHostInput, { kind: "answer" | "reject" }>,
    now: number,
  ): Exclude<TurtleAnswerResult, { kind: "corrected" } | { kind: "not-complete" }> {
    const turn = this.requireActiveTurtleRound().get(input.seat)
    if (!turn) return { kind: "not-found" }
    if (turn.status !== "pending-host") return { kind: "not-pending" }
    if (input.kind === "reject") {
      turn.status = "waiting-question"
      turn.clockStartedAt = Number.isFinite(turn.remainingMs) ? now : undefined
      delete turn.question
      delete turn.questionMessageIds
      delete turn.questionMessageContent
      delete turn.answer
      delete turn.pendingSince
      return { kind: "rejected", turn, reason: input.reason }
    }
    turn.status = "complete"
    turn.answer = input.answer
    delete turn.pendingSince
    return { kind: "answered", turn }
  }

  correctTurtleAnswer(
    seat: number,
    answer: TurtleAnswer,
  ): Extract<TurtleAnswerResult, { kind: "corrected" } | { kind: "not-found" } | { kind: "not-complete" }> {
    const turn = this.requireActiveTurtleRound().get(seat)
    if (!turn) return { kind: "not-found" }
    if (turn.status !== "complete") return { kind: "not-complete" }
    turn.answer = answer
    return { kind: "corrected", turn }
  }

  removeTurtleSeat(seat: number): boolean {
    const state = this.requireTurtle()
    if (!state.activeRoundKey) return false
    return state.rounds.get(state.activeRoundKey)?.delete(seat) ?? false
  }

  turtleHasPendingHost(): boolean {
    const state = this.requireTurtle()
    if (!state.activeRoundKey) return false
    return [...(state.rounds.get(state.activeRoundKey)?.values() ?? [])]
      .some(turn => turn.status === "pending-host")
  }

  turtleProgress(): TurtleProgress {
    const progress: TurtleProgress = { waitingQuestion: [], pendingHost: [], complete: [] }
    for (const turn of this.requireActiveTurtleRound().values()) {
      if (turn.status === "waiting-question") progress.waitingQuestion.push(turn.seat)
      else if (turn.status === "pending-host") progress.pendingHost.push(turn.seat)
      else progress.complete.push(turn.seat)
    }
    progress.waitingQuestion.sort((a, b) => a - b)
    progress.pendingHost.sort((a, b) => a - b)
    progress.complete.sort((a, b) => a - b)
    return progress
  }

  turtleAllComplete(): boolean {
    const turns = [...this.requireActiveTurtleRound().values()]
    return turns.length > 0 && turns.every(turn => turn.status === "complete")
  }

  turtleTurnForSeat(seat: number): TurtleTurnState | undefined {
    return this.requireActiveTurtleRound().get(seat)
  }

  get turtleActiveRoundKey(): string | undefined {
    return this.requireTurtle().activeRoundKey
  }

  private requireActiveTurtleRound(): Map<number, TurtleTurnState> {
    const state = this.requireTurtle()
    if (!state.activeRoundKey) throw new Error("Turtle round interaction requested before a round was initialized.")
    const turns = state.rounds.get(state.activeRoundKey)
    if (!turns) throw new Error("Active Turtle round state is missing.")
    return turns
  }

  private requireTurtle(): TurtleModeState {
    if (this.currentState.kind !== "turtle") {
      throw new Error("Turtle mode interaction requested outside turtle mode.")
    }
    return this.currentState
  }

  private requireDeer(): DeerModeState {
    if (this.currentState.kind !== "deer") {
      throw new Error("Deer mode interaction requested outside deer mode.")
    }
    return this.currentState
  }
}
