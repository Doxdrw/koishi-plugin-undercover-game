import { randomUUID } from "node:crypto"
import { App, Bot, Context, h, Universal, type Session } from "koishi"
import SQLiteDriver from "@koishijs/plugin-database-sqlite"
import * as undercoverGame from "../src/index"
import type { RuntimeResolutionTraceEvent } from "../src/game/resolution-pipeline"

export interface TranscriptEntry {
  readonly direction: "in" | "out"
  readonly scope: "group" | "private"
  readonly userId: string
  readonly channelId: string
  readonly messageId: string
  readonly content: string
}

export interface HarnessQuote {
  readonly id?: string
  readonly messageId?: string
  readonly content?: string
  readonly eventQuote?: { readonly id?: string, readonly messageId?: string, readonly content?: string }
  readonly rawMessage?: unknown
  readonly onebotMessage?: unknown
  readonly omitSessionQuote?: boolean
}

interface TestBotConfig {
  platform: string
  selfId: string
}

class TranscriptBot extends Bot<Context, TestBotConfig> {
  hidden = true
  readonly transcript: TranscriptEntry[] = []
  readonly guildMembers = new Map<string, Set<string>>()
  guildMemberListError: Error | null = null
  readonly groupMessageFailures = new Map<string, Error[]>()
  readonly privateMessageFailures = new Map<string, Error[]>()

  constructor(ctx: Context, config: TestBotConfig) {
    super(ctx, config, "sandbox")
    this.platform = config.platform
    this.selfId = config.selfId
    this.user.name = "Koishi"
  }

  async sendMessage(channelId: string, content: h.Fragment, _referrer?: any, options?: { session?: Session }): Promise<string[]> {
    let outgoing: ReturnType<TranscriptBot['session']> | undefined
    if (options?.session) {
      outgoing = this.session({ type: 'send', channel: options.session.event.channel, guild: options.session.event.guild })
      outgoing.content = h.normalize(content).join('')
      if (await this.ctx.serial(outgoing, 'before-send', outgoing, options)) return []
    }
    if (!channelId.startsWith("@")) {
      const failures = this.groupMessageFailures.get(channelId)
      if (failures?.length) {
        const failure = failures.shift()!
        if (failures.length === 0) this.groupMessageFailures.delete(channelId)
        throw failure
      }
    }
    const messageId = randomUUID()
    const rendered = h.normalize(content).map(element => element.toString()).join("")
    this.transcript.push({
      direction: "out",
      scope: channelId.startsWith("@") ? "private" : "group",
      userId: "Koishi",
      channelId,
      messageId,
      content: rendered,
    })
    if (outgoing) { outgoing.messageId = messageId; this.ctx.emit(outgoing, 'send', outgoing) }
    return [messageId]
  }

  async sendPrivateMessage(userId: string, content: h.Fragment): Promise<string[]> {
    const failures = this.privateMessageFailures.get(userId)
    if (failures?.length) {
      const failure = failures.shift()!
      if (failures.length === 0) this.privateMessageFailures.delete(userId)
      throw failure
    }
    return this.sendMessage("@" + userId, content)
  }

  async getGuildMemberList(guildId: string) {
    if (this.guildMemberListError) throw this.guildMemberListError
    return {
      data: [...(this.guildMembers.get(guildId) ?? [])].map(userId => ({
        user: { id: userId, name: this.displayName(userId) },
      })),
    }
  }

  private displayName(userId: string): string {
    return userId
  }

  dispose(): Promise<void> {
    if (!this.ctx.bots) return this.stop()
    return super.dispose()
  }
}

export interface HarnessXpPointsService {
  resolveNickname?(platform: string, userId: string, fallback?: string): string | undefined
  ensureManagedIdentity?(
    platform: string, userId: string, suggestedNickname?: string,
  ): Promise<{ profileId: number, accountId?: string, nickname: string, automatic: boolean }>
  getManagedIdentity?(platform: string, userId: string): Promise<{ profileId: number, accountId: string, nickname: string } | null>
  resolveCanonicalProfileId?(profileId: number): Promise<number>
  registerAccountConsumer?(name: string): {
    acquire(targets: readonly { platform: string, userId: string }[]): Promise<{
      accounts: Array<{ accountId: string, profileId: number, nickname: string }>, release(): void
    }>
    dispose(): void
  }
  addScoreByNickname?(
    nickname: string, platform: string, guildId: string, amount: number,
  ): Promise<number>
  registerScoreConsumer?(registration: {
    consumer: string
    systemKey: string
    defaultSystem?: { key: string, name: string, unit?: string, scope: 'global' | 'platform' | 'guild' }
  }): {
    systemKey: string
    addAccount(target: { accountId: string }, amount: number, context: {
      platform?: string
      guildId?: string
      reason: string
      idempotencyKey?: string
    }): Promise<{ after: number }>
    dispose(): void
  }
}

export interface UndercoverGameHarnessOptions {
  readonly platform?: string
  readonly xpPoints?: HarnessXpPointsService
  readonly baseDir?: string
  /** Private workspace gates may load real consumer services without a fake. */
  readonly configureApp?: (app: App) => void
}

const TEST_CONFIG: undercoverGame.Config = {
  scoreSystemKey: 'undercover',
  enablePersistentScoring: true,
  minPlayers: 6,
  undercoverDivisor: 3,
  whiteMinPlayers: 7,
  enabledHeroes: [],
  enabledSpecialModes: ['deer', 'turtle'],
  allowLateJoinByDefault: true,
  realtimeVoteNoticeDefault: false,
  notifications: {
    voteStartPrivate: true,
    voteFirstSuccessReceipt: false,
    voteHurryPrivate: true,
    voteHurryGroup: true,
    turtleAnswerPrivate: false,
    turtleHostHalfReminder: true,
  },
  gatherTimeout: 3600,
  setupTimeout: 900,
  dealMessageInterval: 0,
  dealMessageTimeout: 30,
  speakTimeoutMode1: 900,
  speakTimeoutMode2: 1800,
  speakTimeoutMode3PerPlayer: 180,
  voteTimeout: 300,
  hurryTimeout: 120,
  skillTimeout: 120,
  replacementTimeout: 180,
  boomAdjudicationTimeout: 300,
  deerSelectionTimeout: 900,
  deerHostReviewTimeout: 300,
  deerProgressDelay: 300,
  turtleAnswerTimeout: 300,
  heroCardMaxBytes: 20 * 1024 * 1024,
  heroCardMaxPixels: 40_000_000,
  heroCardInteractionTimeout: 300,
  heroCardDownloadTimeout: 30,
  scoreGoodWin: 1,
  scoreGoodWinSpeedrun: 0.5,
  scoreUndercoverWin: 2,
  scoreUndercoverBoomBonus: 0.5,
  scoreWhiteWin: 2,
  scoreWhiteBoomWin: 3,
  scoreGoodBoomNoWin: 1,
}

export class UndercoverGameHarness {
  readonly app: App
  readonly bot: TranscriptBot
  readonly guildId = "undercover-test-guild"
  readonly resolutionTrace: RuntimeResolutionTraceEvent[]

  private messageCounter = 0
  private readonly displayNames = new Map<string, string>()
  private readonly groupCards = new Map<string, string>()
  private constructor(
    app: App,
    bot: TranscriptBot,
    resolutionTrace: RuntimeResolutionTraceEvent[],
  ) {
    this.app = app
    this.bot = bot
    this.resolutionTrace = resolutionTrace
  }

  static async create(
    config: Partial<undercoverGame.Config> = {},
    options: UndercoverGameHarnessOptions = {},
  ): Promise<UndercoverGameHarness> {
    const app = new App({
      autoAssign: true,
      autoAuthorize: 1,
      delay: { character: 0, message: 0, cancel: 0, broadcast: 0, prompt: 0 },
    })
    if (options.baseDir) app.baseDir = options.baseDir
    const resolutionTrace: RuntimeResolutionTraceEvent[] = []
    if (options.xpPoints) app.provide("xpPoints", options.xpPoints, true)
    app.provide("undercoverGameResolutionTrace", event => resolutionTrace.push(event), true)
    app.plugin(SQLiteDriver, { path: ":memory:" })
    options.configureApp?.(app)
    app.plugin(undercoverGame, { ...TEST_CONFIG, ...config })

    const bot = new TranscriptBot(app, {
      platform: options.platform ?? "sandbox:undercover-test",
      selfId: "koishi",
    })
    await app.start()
    bot.online()
    return new UndercoverGameHarness(app, bot, resolutionTrace)
  }

  get transcript(): readonly TranscriptEntry[] {
    return this.bot.transcript
  }

  async addUser(userId: string, nickname: string, authority = 1): Promise<void> {
    this.displayNames.set(userId, nickname)
    const members = this.bot.guildMembers.get(this.guildId) ?? new Set<string>()
    members.add(userId)
    this.bot.guildMembers.set(this.guildId, members)
    await this.app.database.createUser(this.bot.platform, userId, {
      authority,
    })
  }

  setGuildMembers(userIds: readonly string[]): void {
    this.bot.guildMembers.set(this.guildId, new Set(userIds))
  }

  setGroupCard(userId: string, groupCard: string): void {
    this.groupCards.set(userId, groupCard)
  }

  failGuildMemberList(error: Error | null): void {
    this.bot.guildMemberListError = error
  }

  failNextPrivateMessages(userId: string, count = 1, error = new Error("private message failed")): void {
    this.bot.privateMessageFailures.set(userId, Array.from({ length: count }, () => error))
  }

  failNextGroupMessages(count = 1, error = new Error("group message failed"), channelId = this.guildId): void {
    this.bot.groupMessageFailures.set(channelId, Array.from({ length: count }, () => error))
  }

  async emitGuildMemberAdded(userId: string): Promise<void> {
    const members = this.bot.guildMembers.get(this.guildId) ?? new Set<string>()
    members.add(userId)
    this.bot.guildMembers.set(this.guildId, members)
    await this.emitGuildMemberEvent('guild-member-added', userId)
  }

  async emitGuildMemberRemoved(userId: string): Promise<void> {
    this.bot.guildMembers.get(this.guildId)?.delete(userId)
    await this.emitGuildMemberEvent('guild-member-removed', userId)
  }

  async sendGroup(userId: string, content: string): Promise<void> {
    return this.dispatch(userId, this.guildId, content)
  }

  async sendGroupEvent(userId: string, content: string, messageId: string): Promise<void> {
    return this.dispatch(userId, this.guildId, content, undefined, messageId)
  }

  async sendGroupReply(userId: string, content: string, quote: string | HarnessQuote): Promise<void> {
    return this.dispatch(userId, this.guildId, content, quote)
  }

  async sendGroupTo(guildId: string, userId: string, content: string): Promise<void> {
    return this.dispatch(userId, guildId, content)
  }

  async sendPrivate(userId: string, content: string): Promise<void> {
    return this.dispatch(userId, "@" + userId, content)
  }

  async sendPrivateReply(userId: string, content: string, quote: string | HarnessQuote): Promise<void> {
    return this.dispatch(userId, "@" + userId, content, quote)
  }

  async stop(): Promise<void> {
    await this.app.stop()
  }

  private async emitGuildMemberEvent(type: 'guild-member-added' | 'guild-member-removed', userId: string): Promise<void> {
    const session = this.bot.session({
      user: { id: userId, name: this.displayNames.get(userId) ?? userId },
      channel: { id: this.guildId, type: Universal.Channel.Type.TEXT },
      guild: { id: this.guildId },
      timestamp: Date.now(),
    })
    ;(session.event as any).member = {
      nick: this.groupCards.get(userId),
      user: session.event.user,
    }
    session.type = type
    this.app.emit(type, session)
    await new Promise<void>(resolve => setImmediate(resolve))
  }

  private async dispatch(
    userId: string,
    channelId: string,
    content: string,
    quote?: string | HarnessQuote,
    forcedMessageId?: string,
  ): Promise<void> {
    const isDirect = channelId === "@" + userId
    const messageId = forcedMessageId ?? "test-message-" + ++this.messageCounter
    this.bot.transcript.push({
      direction: "in",
      scope: isDirect ? "private" : "group",
      userId,
      channelId,
      messageId,
      content,
    })

    const session = this.bot.session({
      user: { id: userId, name: this.displayNames.get(userId) ?? userId },
      channel: {
        id: channelId,
        type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
      },
      guild: isDirect ? undefined : { id: channelId },
      timestamp: Date.now(),
    })
    ;(session.event as any).member = {
      nick: this.groupCards.get(userId),
      user: session.event.user,
    }
    session.type = "message"
    session.messageId = messageId
    session.content = content
    if (quote) {
      const value = typeof quote === "string" ? { id: quote } : quote
      if (!value.omitSessionQuote) (session as any).quote = value
      if (value.eventQuote) session.event.message!.quote = value.eventQuote as any
      if (value.rawMessage !== undefined) session.event._data = { message: value.rawMessage }
      if (value.onebotMessage !== undefined) (session as any).onebot = { message: value.onebotMessage }
    }

    this.bot.dispatch(session)
    const deadline = performance.now() + 30000
    const sessions = (this.app.$processor as unknown as { _sessions: Record<string, unknown> })._sessions
    do {
      await new Promise<void>(resolve => setImmediate(resolve))
      if (!sessions[session.id]) return
    } while (performance.now() < deadline)

    const transcript = this.bot.transcript
      .map(entry => `${entry.direction} ${entry.scope} ${entry.userId}: ${entry.content}`)
      .join("\n")
    throw new Error(`Timed out while dispatching ${userId}: ${content}\n${transcript}`)
  }
}
