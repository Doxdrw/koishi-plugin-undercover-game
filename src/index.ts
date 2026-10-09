import { App, Command, Context, Schema, h, $, Session } from "koishi"
import { randomUUID } from 'node:crypto'
import { HEROES, HERO_NUM, HERO_NAMES, HERO_ABILITIES, HERO, HeroState } from './heroes'
import { createHeroStateStore, HeroStateStore } from './game/hero-state'
import { PendingActionCoordinator } from './game/pending-action'
import { GameTimerManager } from './game/game-timer-manager'
import { ReplacementRequestCoordinator } from './game/replacement-request'
import { GameRouteCoordinator } from './game/game-route'
import { AsyncSerialQueue } from './game/async-serial-queue'
import { VoteSettlementCoordinator } from './game/vote-settlement'
import { GameMessageDelivery } from './game/message-delivery'
import {
  ModeInteractionCoordinator,
  formatModeRoundCapabilities,
  parseGameModeSelection,
  parseModeStart,
  parseTurtleHostInput,
  parseTurtleQuestion,
  resolveModeMessageReference,
} from './game/game-mode'
import { ScoreService } from './game/score-service'
import { HistoryRecorder } from './game/history-recorder'
import { HistoryStore, registerHistoryModels, type HistoryMediaRetention } from './game/history-store'
import { HistoryPersistence, FileHistoryRetryQueue } from './game/history-retry'
import { HistoryQueries, historyTextPages } from './game/history-query'
import { DeerHistoryControls } from './game/history-deer'
import { registerHistoryCommands } from './game/history-commands'
import { createHistoryDeletionConsumer } from './game/history-deletion-consumer'
import type { HistoryEnding, HistoryCamp, HistorySpeechSegment } from './game/history-snapshot'
import { DiagnosticLog, GameDiagnostics, type DiagnosticConfig } from './game/diagnostics'
import { removeRosterSeat } from './game/roster-service'
import { isEligibleSpeechSeat } from './game/speech-eligibility'
import { removeArrayIndicesInPlace } from './game/sparse-array'
import { SpeechPhaseCoordinator } from './game/speech-phase'
import { SpeechHistory } from './game/speech-history'
import { PublicHeroRevealState } from './game/hero-reveal'
import { postEliminationHero } from './game/post-elimination'
import { classifyEliminationVictory } from './game/elimination-outcome'
import { isStalemateEligible, StalemateTracker } from './game/stalemate'
import { snapshotEliminationContext, snapshotVoteContext, VoteContext } from './game/resolution-context'
import type { EliminationContext } from './game/resolution-context'
import { rebuildVoteState } from './game/vote-ballots'
import { retainBallotsAfterRosterChange } from './game/vote-roster'
import type { VoteRosterSnapshot } from './game/vote-roster'
import { calculateVoteLeaders } from './game/vote-leaders'
import type { VoteLeaderResult } from './game/vote-leaders'
import { classifyVoteOutcome } from './game/vote-outcome'
import { getVoteResolutionStatus } from './game/vote-resolution'
import {
  ResolutionCursor,
  VOTE_ELIMINATION_PIPELINE,
  VOTE_RESOLUTION_TAIL,
  continueResolution,
  endResolution,
  pauseResolution,
  runResolutionPipeline,
} from './game/resolution-pipeline'
import type {
  ResolutionControl,
  ResolutionTraceSegment,
  RuntimeResolutionTraceSink,
} from './game/resolution-pipeline'
import { heroRegistry } from './heroes/registry'
import { duoErGunModule } from './heroes/duo-er-gun'
import { huangTaiJiModule } from './heroes/huang-tai-ji'
import type { HuangTaiJiQuanMode } from './heroes/huang-tai-ji'
import { linDanHanModule } from './heroes/lin-dan-han'
import { liZiChengModule } from './heroes/li-zi-cheng'
import { maoWenLongModule } from './heroes/mao-wen-long'
import { shiKeFaModule } from './heroes/shi-ke-fa'
import { wuSanGuiModule } from './heroes/wu-san-gui'
import { zhangXianZhongModule } from './heroes/zhang-xian-zhong'
import { yuanChongHuanModule } from './heroes/yuan-chong-huan'
import { zhuYouJianModule } from './heroes/zhu-you-jian'
import { HeroCardService, HeroCardValidationError, registerHeroCardModel } from './game/hero-card-service'
import { safeErrorSummary } from './game/errors'
import {
  HeroCardInteractionCoordinator,
  findHeroId,
  renderHero,
  renderHeroCardStatus,
} from './game/hero-card-interaction'
import {
  ProfileDeletionScopeLike,
  registerSubscriptionModel,
  SubscriptionMemberListError,
  UndercoverSubscriptionService,
} from './game/subscription-service'

declare module "koishi" {
  interface Context {
    // 由 xp-points 插件提供的积分服务（可选依赖）。
    xpPoints?: {
      resolveNickname?(platform: string, userId: string, fallback?: string): string | undefined
      getManagedIdentity?(platform: string, userId: string): Promise<{ profileId: number, accountId: string, nickname: string } | null>
      resolveCanonicalProfileId?(profileId: number): Promise<number>
      registerAccountConsumer?(name: string): {
        acquire(targets: readonly { platform: string, userId: string }[]): Promise<{
          accounts: Array<{ accountId: string, profileId: number, nickname: string }>, release(): void
        }>
        dispose(): void
      }
      ensureManagedIdentity?(
        platform: string, userId: string, suggestedNickname?: string,
      ): Promise<{ profileId: number, accountId?: string, nickname: string, automatic: boolean }>
      ensureManagedGuildIdentity?(
        platform: string, userId: string, guildId: string, suggestedNickname?: string,
      ): Promise<{ profileId: number, accountId?: string, nickname: string, automatic: boolean }>
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
          businessId?: string
        }): Promise<{ after: number; journalId?: number }>
        dispose(): void
      }
      registerProfileDataConsumer?(consumer: {
        name: string
        preview(database: Context['database'], scope: ProfileDeletionScopeLike): Promise<{
          affectedRows: number, summary: string[], snapshot: unknown
        }>
        delete(database: Context['database'], scope: ProfileDeletionScopeLike): Promise<void>
        afterDelete?(scope: ProfileDeletionScopeLike): Promise<void>
      }): () => void
    }
    // 测试驱动器可注入的只读结算轨迹接收器；生产环境不提供该服务。
    undercoverGameResolutionTrace?: RuntimeResolutionTraceSink
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomIntInclusive(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min; //含最大值，含最小值
}

function isEmpty(a) {
  if (a === "") return true; //检验空字符串
  if (a === "null") return true; //检验字符串类型的null
  if (a === "undefined") return true; //检验字符串类型的 undefined
  if (!a && a !== 0 && a !== "") return true; //检验 undefined 和 null
  if (Array.prototype.isPrototypeOf(a) && a.length === 0) return true; //检验空数组
  if (Object.prototype.isPrototypeOf(a) && Object.keys(a).length === 0) return true;  //检验空对象
  return false;
}

export const name = "undercover-game"

export const inject = { required: ["database"], optional: ["xpPoints"] }

export interface Config {
  debug?: DiagnosticConfig
  history?: {
    enabled: boolean
    sandbox: boolean
    retentionDays: number
    mediaRetention?: 'next-game' | 'permanent' | 'days'
    mediaRetentionDays?: number
  }
  scoreSystemKey: string
  enablePersistentScoring: boolean
  minPlayers: number
  undercoverDivisor: number
  whiteMinPlayers: number
  enabledHeroes: string[]
  heroesByDefault?: boolean
  enabledSpecialModes: Array<'deer' | 'turtle'>
  allowLateJoinByDefault: boolean
  realtimeVoteNoticeDefault: boolean
  notifications: {
    voteStartPrivate: boolean
    voteFirstSuccessReceipt: boolean
    voteHurryPrivate: boolean
    voteHurryGroup: boolean
    turtleAnswerPrivate: boolean
    turtleHostHalfReminder: boolean
  }
  gatherTimeout: number
  setupTimeout: number
  dealMessageInterval: number
  dealMessageTimeout: number
  speakTimeoutMode1: number
  speakTimeoutMode2: number
  speakTimeoutMode3PerPlayer: number
  voteTimeout: number
  hurryTimeout: number
  skillTimeout: number
  replacementTimeout: number
  boomAdjudicationTimeout: number
  deerSelectionTimeout: number
  deerHostReviewTimeout: number
  deerProgressDelay: number
  turtleAnswerTimeout: number
  heroCardMaxBytes: number
  heroCardMaxPixels: number
  heroCardInteractionTimeout: number
  heroCardDownloadTimeout: number
  scoreGoodWin: number
  scoreGoodWinSpeedrun: number
  scoreUndercoverWin: number
  scoreUndercoverBoomBonus: number
  scoreWhiteWin: number
  scoreWhiteBoomWin: number
  scoreGoodBoomNoWin: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    minPlayers: Schema.natural().default(6).description("开始游戏所需的最低玩家数。"),
    undercoverDivisor: Schema.number().min(2).default(3).description("卧底数 = 向下取整(玩家数 ÷ 此值)。"),
    whiteMinPlayers: Schema.natural().default(7).description("达到此人数时询问主持人是否加入白板。"),
    heroesByDefault: Schema.boolean().default(true).description("新局默认加入武将；主持人可在凑人至发题前用“普通局／武将局”切换。"),
    enabledHeroes: Schema.array(Schema.union(HERO_NAMES.map((name) => Schema.const(name))))
      .role("checkbox").default([...HERO_NAMES])
      .description("随机分配的武将池；自定义局由主持人指定武将。"),
    enabledSpecialModes: Schema.array(Schema.union([
      Schema.const("deer").description("鹿模式"),
      Schema.const("turtle").description("龟模式"),
    ])).role("checkbox").default(["deer", "turtle"])
      .description("允许主持人选择的特殊模式；经典模式始终可用。"),
    allowLateJoinByDefault: Schema.boolean().default(true).description("开局配置期间默认允许加人；主持人可用“开启加人／停止加人”切换。"),
  }).description("游戏设置"),
  Schema.object({
    gatherTimeout: Schema.natural().default(3600).description("凑人时限（秒）；超时终止本局。"),
    setupTimeout: Schema.natural().min(30).default(900).description("主持人确认开始后的总配置时限（秒），涵盖白板、词条与武将。"),
    dealMessageInterval: Schema.number().min(0).default(1).description("逐条私聊发题及发武将牌的间隔（秒）。"),
    dealMessageTimeout: Schema.natural().min(1).default(30).description("单条发题或发牌的等待上限（秒）；失败后继续发送其余玩家。"),
  }).description("开局与发题"),
  Schema.object({
    speakTimeoutMode1: Schema.natural().default(900).description("限时模式1：每轮发言时限（秒）。"),
    speakTimeoutMode2: Schema.natural().default(1800).description("限时模式2：首轮外每轮发言时限（秒）。"),
    speakTimeoutMode3PerPlayer: Schema.natural().default(180).description("限时模式3：每位在场玩家分摊的发言时间（秒）。"),
    voteTimeout: Schema.natural().default(300).description("投票时限（秒）。"),
    hurryTimeout: Schema.natural().default(120).description("投票开始后自动催票的等待时间（秒）。"),
    skillTimeout: Schema.natural().default(120).description("等待武将发动技能的时限（秒）。"),
    replacementTimeout: Schema.natural().min(10).default(180).description("补位申请每个步骤的时限（秒）；等待武将技能时暂停。"),
    boomAdjudicationTimeout: Schema.natural().min(10).default(300).description("主持人判定疑似自爆的时限（秒）；超时终止且不计分。"),
    deerSelectionTimeout: Schema.natural().min(30).default(900).description("鹿模式每名玩家的独立选词时限（秒）；超时踢出该座位。"),
    deerHostReviewTimeout: Schema.natural().min(30).default(300).description("鹿模式有待审核选词时的主持人空闲时限（秒）；有效审核后重新计时。"),
    deerProgressDelay: Schema.natural().default(300).description("鹿模式首轮开放后，公开查询或自动催促选词进度的等待时间（秒）。"),
    turtleAnswerTimeout: Schema.natural().min(10).default(300).description("龟模式每个问题的主持人回答时限（秒）；过半提醒，超时终止且不计分。"),
  }).description("发言、投票与技能时限"),
  Schema.object({
    realtimeVoteNoticeDefault: Schema.boolean().default(false).description("默认向主持人私聊实时票况；主持人可在局内切换。"),
    notifications: Schema.object({
      voteStartPrivate: Schema.boolean().default(true).description("投票开始时私聊应投票玩家，合并可投对象和技能提示。"),
      voteFirstSuccessReceipt: Schema.boolean().default(false).description("首次投票成功后私聊确认；改票和非法输入提示保持现状。"),
      voteHurryPrivate: Schema.boolean().default(true).description("自动催票时私聊尚未投票的玩家。"),
      voteHurryGroup: Schema.boolean().default(true).description("自动催票时在群内显示尚未投票的玩家。"),
      turtleAnswerPrivate: Schema.boolean().default(false).description("龟模式群内回答后，额外私聊玩家确认。"),
      turtleHostHalfReminder: Schema.boolean().default(true).description("龟模式等待回答过半时私聊提醒主持人。"),
    }),
  }).description("消息提醒"),
  Schema.object({
    enablePersistentScoring: Schema.boolean().default(true).description("接入 xp-points 并保存结算积分；关闭后不读写积分或发送积分服务告警。"),
    scoreSystemKey: Schema.string().default("undercover").description("结算使用的 xp-points 系统 key；同 key 接入同一积分系统。"),
    scoreGoodWin: Schema.number().default(1).description("好人常规胜利得分。"),
    scoreGoodWinSpeedrun: Schema.number().default(0.5).description("好人速通得分（总轮次≤非好人阵营人数）。"),
    scoreUndercoverWin: Schema.number().default(2).description("卧底胜利得分。"),
    scoreUndercoverBoomBonus: Schema.number().default(0.5).description("卧底自爆获胜时，自爆者的额外得分。"),
    scoreWhiteWin: Schema.number().default(2).description("白板苟赢得分；招安后按所加入阵营结算。"),
    scoreWhiteBoomWin: Schema.number().default(3).description("白板自爆成功得分。"),
    scoreGoodBoomNoWin: Schema.number().default(1).description("好人误爆、无人胜利时，非好人阵营每人得分。"),
  }).description("积分结算"),
  Schema.object({
    history: Schema.object({
      enabled: Schema.boolean().default(true).description("保存完成局及进入第一阶段后被主持人或管理员终止的对局；鹿模式另保留中止局有效选词。"),
      sandbox: Schema.boolean().default(false).description("持久保存沙盒对局。"),
      retentionDays: Schema.natural().default(0).description("对局历史保留天数；0为不限，到期清理本插件历史。"),
      mediaRetention: Schema.union([
        Schema.const("next-game").description("保留至同一机器人下一局"),
        Schema.const("permanent").description("永久保留引用"),
        Schema.const("days").description("按结束时间保留指定天数"),
      ]).default("next-game").description("历史发言的媒体引用保留方式；文字历史使用上方保留期。"),
      mediaRetentionDays: Schema.natural().default(30).description("选择按天保留时的媒体保留天数，从对局结束时间计算。"),
    }),
  }).description("对局历史"),
  Schema.object({
    heroCardMaxBytes: Schema.natural().min(1024).default(20 * 1024 * 1024).description("单张上传卡面大小上限（字节，默认20 MiB）。"),
    heroCardMaxPixels: Schema.natural().min(1).default(40_000_000).description("单张上传卡面像素总量上限（宽×高）。"),
    heroCardInteractionTimeout: Schema.natural().min(30).default(300).description("武将查询及卡面管理分步交互的时限（秒）。"),
    heroCardDownloadTimeout: Schema.natural().min(1).default(30).description("远程卡面下载全过程的时限（秒）。"),
  }).description("武将卡面"),
  Schema.object({
    debug: Schema.object({
      enabled: Schema.boolean().default(false).description("记录本插件处理的消息与发送状态，写入实例本地诊断日志。"),
      privateBodies: Schema.boolean().default(false).description("诊断启用时额外记录私聊正文，含题面、投票、审核和技能等游戏秘密，请谨慎开启。"),
      guilds: Schema.array(Schema.string()).default([]).description("诊断日志群白名单；空为全部，私聊按当前游戏群过滤。"),
      retentionDays: Schema.natural().min(1).default(7).description("日志保留天数；启动及每小时清理到期日志，关闭采集后仍生效。"),
      fileBytes: Schema.natural().min(16384).default(10 * 1024 * 1024).description("单文件上限（字节，默认10 MiB）；应不小于单条记录上限。"),
      totalBytes: Schema.natural().min(16384).default(200 * 1024 * 1024).description("总容量上限（字节，默认200 MiB）；应不小于单文件上限，超限先清理旧文件。"),
      queueLimit: Schema.natural().min(1).default(1000).description("待写入记录数上限；超限丢弃新记录并统计数量。"),
      entryBytes: Schema.natural().min(512).default(16384).description("单条记录上限（字节）；过长正文截断。"),
    }).description("本地诊断日志，默认关闭").collapse(),
  }).description("高级诊断"),
])

export function apply(ctx: Context, config: Config) {
  const diagnosticLog = new DiagnosticLog(ctx.baseDir, config.debug, text => ctx.logger.warn(text))
  const diagnostics = new GameDiagnostics(diagnosticLog, session => ({
    gameId: gameInstanceId, guildId: gameRoute.guildId,
    phase: game_off ? 'idle' : !wait_off ? 'gathering' : flag_start ? 'setup' : !ann_off ? 'speech' : !vote_off ? 'voting' : 'resolving',
    revision: speechPhases.current()?.revision,
    seat: session && player ? order?.[player.indexOf(session.userId)] : undefined,
  }))
  ctx = diagnostics.context(ctx)
  ctx.on('dispose', async () => { await diagnosticLog.close() })
  const gameInputQueue = new AsyncSerialQueue()
  // A queued game action must never await the rest of Koishi's middleware
  // chain.  ChatLuna/Character may legitimately spend a long time handling an
  // unrelated message; forwarding is therefore performed after the queue task
  // has released the serial game-state lock.
  const forwardGameInput = Symbol('forward-game-input')
  const voteSettlement = new VoteSettlementCoordinator()
  const notifications = {
    voteStartPrivate: true,
    voteFirstSuccessReceipt: false,
    voteHurryPrivate: true,
    voteHurryGroup: true,
    turtleAnswerPrivate: false,
    turtleHostHalfReminder: true,
    ...config.notifications,
  }
  const enabledSpecialModes = new Set(config.enabledSpecialModes ?? ['deer', 'turtle'])
  const messages = new GameMessageDelivery((label, error) => {
    ctx.logger.warn("%s发送失败：%s", label, safeErrorSummary(error))
  })
  registerSubscriptionModel(ctx)
  registerHistoryModels(ctx)
  const mediaRetention: HistoryMediaRetention = config.history?.mediaRetention === 'permanent'
    ? { mode: 'permanent' }
    : config.history?.mediaRetention === 'days'
      ? { mode: 'days', days: Math.max(1, config.history?.mediaRetentionDays ?? 30) }
      : { mode: 'next-game' }
  const historyStore = new HistoryStore(ctx.database, config.history?.retentionDays ?? 0, mediaRetention)
  const historyOptions = { enabled: config.history?.enabled ?? true, sandbox: config.history?.sandbox ?? false }
  const historyQueue = new FileHistoryRetryQueue(ctx.baseDir)
  const historyPersistence = new HistoryPersistence(historyStore, historyQueue,
    (event, id) => ctx.logger.warn('对局历史保存状态：%s（%s）', event, id ?? 'unknown'))
  const historyPerson = async (platform: string, userId: string) => (await ctx.xpPoints?.getManagedIdentity?.(platform, userId))?.profileId
  const historyCanonical = async (id: number) => ctx.xpPoints?.resolveCanonicalProfileId ? ctx.xpPoints.resolveCanonicalProfileId(id) : id
  const historyQueries = new HistoryQueries(ctx.database, historyPerson, historyCanonical)
  const deerHistory = new DeerHistoryControls(ctx.database, historyPerson, historyCanonical)
  const pendingHistoryWrites = new Set<Promise<unknown>>()
  registerHistoryCommands(ctx, historyQueries, deerHistory, historyStore, async () => { await Promise.allSettled([...pendingHistoryWrites]) },
    async (session, op) => {
      if (historyOptions.enabled && (!session.platform.startsWith('sandbox') || historyOptions.sandbox)) return
      const snapshot = lastDeerReveal
      if (!snapshot) return '当前没有可操作的上局鹿模式选人记录。'
      if (session.isDirect || session.platform !== snapshot.platform || session.guildId !== snapshot.guildId) return '请在上一把鹿模式所在群使用该指令。'
      const own = await findLastDeerRow(session, snapshot)
      if (op === 'hide') {
        if (!own) return '只有上一把鹿模式的玩家可以隐藏自己的选人。'
        own.hidden = true
        return '已隐藏你的上局鹿模式选人；这只影响主持人之后的批量公布，无法撤回已经发送的消息。'
      }
      if (session.userId === snapshot.hostId) return formatDeerRevealRows(snapshot, snapshot.rows.filter(r => !r.hidden))
      if (!own) return '只有上一把鹿模式的主持人或玩家可以公布选人。'
      own.hidden = false
      return formatDeerRevealRows(snapshot, [own])
    }, async () => {
      const result = await historyPersistence.retry()
      if (result.failed) throw new Error('历史数据库清理已完成，但部分本地待重试文件未清理，请检查日志。')
    })
  const maintainHistory = async () => {
    await historyStore.prune()
    await historyStore.pruneExpiredMedia()
    await historyPersistence.retry()
  }
  ctx.on('ready', maintainHistory)
  if ((config.history?.retentionDays ?? 0) > 0 || mediaRetention.mode === 'days') ctx.setInterval(() => {
    void maintainHistory().catch(error => ctx.logger.warn('历史保留期清理未完成：%s', safeErrorSummary(error)))
  }, 3600000)
  const subscriptions = new UndercoverSubscriptionService(ctx)
  let scoreLedger: ReturnType<NonNullable<Context['xpPoints']>['registerScoreConsumer']> | undefined
  let accountConsumer: ReturnType<NonNullable<Context['xpPoints']>['registerAccountConsumer']> | undefined
  const accountLeases = new Map<string, () => void>()
  const releaseAccountLeases = () => {
    for (const release of accountLeases.values()) release()
    accountLeases.clear()
  }
  const releasePlayerLease = (userId: string) => {
    accountLeases.get(userId)?.()
    accountLeases.delete(userId)
  }
  ;(ctx as any).inject(['xpPoints'], (child: Context) => {
    const dispose = child.xpPoints?.registerProfileDataConsumer?.(createHistoryDeletionConsumer(historyQueue, historyPersistence, () => pendingHistoryWrites.size > 0))
    if (dispose) child.on('dispose', dispose)
    const consumer = child.xpPoints?.registerAccountConsumer?.('undercover-game')
    accountConsumer = consumer
    if (consumer) child.on('dispose', () => {
      consumer.dispose()
      if (accountConsumer === consumer) { accountConsumer = undefined; releaseAccountLeases() }
    })
    if (config.enablePersistentScoring === false) return
    const ledger = child.xpPoints?.registerScoreConsumer?.({
      consumer: 'undercover-game',
      systemKey: config.scoreSystemKey,
      ...(config.scoreSystemKey === 'undercover' ? { defaultSystem: {
        key: config.scoreSystemKey,
        name: '卧底积分',
        unit: '分',
        scope: 'guild',
      } as const } : {}),
    })
    scoreLedger = ledger
    if (ledger) child.on('dispose', () => {
      ledger.dispose()
      if (scoreLedger === ledger) scoreLedger = undefined
    })
  })
  registerHeroCardModel(ctx)
  const heroCards = new HeroCardService(ctx, __dirname, {
    maxBytes: config.heroCardMaxBytes,
    maxPixels: config.heroCardMaxPixels,
    downloadTimeoutMs: Math.max(1, config.heroCardDownloadTimeout ?? 30) * 1000,
  })
  ctx.on("ready", () => heroCards.load().catch(error => {
    ctx.logger.error("读取自定义武将卡面记录失败：%s", safeErrorSummary(error))
  }))
  const heroCardInteractions = new HeroCardInteractionCoordinator(heroCards, {
    timeoutMs: config.heroCardInteractionTimeout * 1000,
    isGameActive: () => !game_off,
  })
  ctx.on("dispose", () => heroCardInteractions.dispose())
  const suggestedPlayerNickname = (session: Session): string => {
    return [
      session.author?.name,
      session.event?.user?.name,
      session.event?.member?.user?.name,
      session.username,
      session.author?.nick,
      session.event?.member?.nick,
      session.userId,
    ].find(value => typeof value === "string" && value.trim().length > 0)?.trim()
      ?? session.userId
  }
  const resolvePlayerNickname = (session: Session): string => {
    const fallback = suggestedPlayerNickname(session)
    return ctx.xpPoints?.resolveNickname?.(
      session.platform, session.userId, fallback,
    ) ?? fallback
  }
  const runPublicCommand = async <T>(label: string, callback: () => Promise<T>): Promise<T | string> => {
    try {
      return await callback()
    }
    catch (error) {
      ctx.logger.warn("%s失败：%s", label, safeErrorSummary(error))
      return `${label}失败，详细原因已记录。`
    }
  }
  const ensurePlayerNickname = async (session: Session): Promise<string> => {
    const identity = session.guildId && ctx.xpPoints?.ensureManagedGuildIdentity
      ? await ctx.xpPoints.ensureManagedGuildIdentity(
        session.platform,
        session.userId,
        session.guildId,
        suggestedPlayerNickname(session),
      )
      : await ctx.xpPoints?.ensureManagedIdentity?.(
        session.platform,
        session.userId,
        suggestedPlayerNickname(session),
      )
    if (identity) {
      profileIdByNickname.set(identity.nickname, identity.profileId)
      identityByUserId.set(session.userId, identity)
    }
    return identity?.nickname ?? resolvePlayerNickname(session)
  }
  var hostid: string
  var hostname: string
  var boomname: string
  var gameInstanceId = ''
  var gameStartedAt = 0
  let historyRecorder: HistoryRecorder | undefined
  let historyCaptureFailed = false
  let historyOvertime = 0
  const historyDepartureReasons = new Map<number, 'vote' | 'skill' | 'kick' | 'self-exit' | 'timeout'>()
  const capture = (operation: (recorder: HistoryRecorder) => void) => {
    if (!historyRecorder || historyCaptureFailed) return
    try { operation(historyRecorder) }
    catch (error) { historyCaptureFailed = true; ctx.logger.error('历史采集失败，游戏继续但不报告存档成功：%s', safeErrorSummary(error)) }
  }
  const recordSkill = (heroId: number, effect: string, targetSeats: number[] = []) => {
    const seat = heros?.[heroId]
    if (seat > 0) capture(r => r.event(seat, { kind: 'skill', heroId, effect, targetSeats }))
  }
  const historyCamp = (seat: number): HistoryCamp => flag_white && seat === white ? 'white' : uc.includes(seat) ? 'undercover' : 'good'
  const historyIdentity = (userId: string, nickname: string) => ({ platform: gameRoute.platform, userId, nickname,
    personId: profileIdByNickname.get(nickname), accountId: identityByUserId.get(userId)?.accountId ?? accountIdByNickname.get(nickname) })
  const startHistoryCapture = () => {
    historyRecorder = undefined; historyCaptureFailed = false; historyOvertime = 0
    if (!historyOptions.enabled || gameRoute.platform.startsWith('sandbox') && !historyOptions.sandbox) return
    const rules: Record<string, string | number | boolean | null> = { timeoutMode: timeout_mode }
    for (const key of ['minPlayers', 'undercoverDivisor', 'whiteMinPlayers', 'allowLateJoinByDefault', 'enablePersistentScoring',
      'gatherTimeout', 'setupTimeout', 'dealMessageInterval', 'dealMessageTimeout', 'speakTimeoutMode1', 'speakTimeoutMode2', 'speakTimeoutMode3PerPlayer',
      'voteTimeout', 'skillTimeout', 'replacementTimeout', 'boomAdjudicationTimeout', 'deerSelectionTimeout', 'deerHostReviewTimeout', 'deerProgressDelay', 'turtleAnswerTimeout',
      'scoreGoodWin', 'scoreGoodWinSpeedrun', 'scoreUndercoverWin', 'scoreUndercoverBoomBonus', 'scoreWhiteWin', 'scoreWhiteBoomWin', 'scoreGoodBoomNoWin']) {
      if (typeof config[key] === 'number' || typeof config[key] === 'boolean') rules[key] = config[key]
    }
    rules.enabledHeroes = JSON.stringify(config.enabledHeroes ?? [])
    rules.enabledSpecialModes = JSON.stringify(config.enabledSpecialModes ?? [])
    historyRecorder = new HistoryRecorder({ gameId: gameInstanceId, startedAt: gameStartedAt, mode: modeInteraction.mode,
      platform: gameRoute.platform, selfId: gameRoute.bot!.selfId, guildId: gameRoute.guildId,
      sandbox: gameRoute.platform.startsWith('sandbox'), host: historyIdentity(hostid, hostname), ruleVersion: '0.3.1', rules })
    capture(r => {
      r.topics(modeInteraction.mode === 'deer' ? { publicText: instr3, good: item1, undercover: item2 }
        : modeInteraction.mode === 'turtle' ? { publicText: item1, good: item2, undercover: instr1 }
          : { publicText: '', good: item1, undercover: item2, goodHint: instr1, undercoverHint: instr2, whiteHint: instr3 })
      order.forEach((seat, i) => {
        r.join(seat, historyIdentity(player[i], player_name[i]), historyCamp(seat), heros.includes(seat) ? heros.indexOf(seat) : null, Date.now())
        if (modeInteraction.mode === 'deer') r.choice(seat, null)
      })
    })
  }
  var profileIdByNickname = new Map<string, number>()
  var identityByUserId = new Map<string, { profileId: number, accountId?: string, nickname: string }>()
  var accountIdByNickname = new Map<string, string>()
  const personKey = (nickname: string): string => profileIdByNickname.has(nickname)
    ? 'person:' + profileIdByNickname.get(nickname) : 'name:' + nickname
  const personAlreadyRecorded = (nickname: string): boolean =>
    personKey(hostname) === personKey(nickname) || player_copy.some(name => !isEmpty(name) && personKey(name) === personKey(nickname))
  const occupyPlayer = async (userId: string, nickname: string, platform: string): Promise<boolean> => {
    const epoch = gameInstanceId
    let identity = identityByUserId.get(userId)
    if (accountConsumer && !accountLeases.has(userId)) {
      const lease = await accountConsumer.acquire([{ platform, userId }])
      if (game_off || gameInstanceId !== epoch) { lease.release(); return false }
      const current = lease.accounts[0]
      if (!current || (identity && (current.profileId !== identity.profileId || current.nickname !== nickname))) {
        lease.release()
        throw new Error('玩家账号关系已变化，请重新加入。')
      }
      identity = current
      if (accountLeases.has(userId)) lease.release()
      else accountLeases.set(userId, lease.release)
    }
    if (identity?.accountId) accountIdByNickname.set(nickname, identity.accountId)
    return true
  }
  var formerSeatByName = new Map<string, number>()
  var kickout: number[]
  var nv_out: number[]
  //var timeout = 120000
  var player: string[]
  var player_name: string[]
  var player_copy: string[]
  var player_id_copy: string[]
  var order: number[]
  var uc: number[]
  var uc_copy: number[]
  var white: number
  var white_copy: number
  var item1: string
  var item1_copy: string
  //var alias1 = []
  var instr1: string
  var item2: string
  var item2_copy: string
  //var alias2 = []
  var instr2: string
  var instr3: string
  var ann: string[]
  var add_ann: string[]
  var annstr = "本轮发言结果：\n"
  var vstr = "本轮投票结果：\n"
  var vstr2 = "本轮投票结果：\n"
  var ptsstr = "本局计分结算："
  var flag: boolean
  var flag_white: boolean
  var flag_white_perm: boolean
  var flag_ask_white: boolean
  var flag_just_vote: boolean
  const stalemate = new StalemateTracker()
  var flag_start: boolean
  var white_only: boolean
  // Permission belongs to this finalized vote, never merely to a roster fact.
  // Keep it through a post-vote skill pause; clear it before the next round.
  let whiteSurvivalSettlementPending = false
  let whiteConsolationHandled = false
  let preDealRevision = 0
  var boom_pending: boolean
  var boom_state: number
  var ask_nice: boolean
  var ask_nice_instr: boolean
  var ask_uc: boolean
  var ask_uc_instr: boolean
  var ask_white_instr: boolean
  var flag_fati: boolean
  var flag_ask_timeout: boolean
  var flag_notify: boolean
  var set_mode: boolean
  var set_flag: boolean[]
  var vote: Array<number>[]
  var poll: number[]
  var round: number
  var add_flag = false
  var add_indices: number[]
  var add_indices_0: number[]
  var add_vote: Array<number>[]
  var add_voter: string[]
  // A raw -1 ballot is used both for an automatic timeout and for an early
  // locked result.  Keep the distinction outside the legacy ballot arrays so
  // the replay renderer can retain the old player-facing wording.
  const lockedVoteSeats = new Set<string>()
  let votePhaseSerial = 0
  const votePhaseKey = (seat: number): string => `${votePhaseSerial}:${seat}`
  var unvote: number
  var score_enabled: boolean
  var fa_tot: number
  var quan_tot: number
  var skip: number
  var add_player = true
  var game_off = true
  var wait_off = true
  var ann_off = true
  var vote_off = true
  var disp_off = true
  const gameRoute = new GameRouteCoordinator<Session["bot"]>()
  const matchesActiveSession = (session: Session): boolean => session.guildId
    ? gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
    : gameRoute.matchesBot(session.platform, session.selfId)
  const sendGroupNotice = (
    session: Session,
    content: h.Fragment,
    label: string,
    guildId = gameRoute.guildId,
  ): Promise<boolean> => messages.state(label, () => session.bot.sendMessage(guildId, content))
  const sendPrivateNotice = (
    session: Session,
    userId: string,
    content: h.Fragment,
    label: string,
  ): Promise<boolean> => messages.state(label, () => session.bot.sendPrivateMessage(userId, content))
  const notifyGroup = (
    session: Session,
    content: h.Fragment,
    label: string,
    guildId = gameRoute.guildId,
  ): void => messages.bestEffort(label, () => session.bot.sendMessage(guildId, content))
  const notifyPrivate = (
    session: Session,
    userId: string,
    content: h.Fragment,
    label: string,
  ): void => messages.bestEffort(label, () => session.bot.sendPrivateMessage(userId, content))
  const notifySession = (
    session: Session,
    content: h.Fragment,
    label = "会话通知",
  ): void => messages.bestEffort(label, () => session.send(content))
  const notifyBotGroup = (
    bot: Session["bot"] | undefined,
    guildId: string,
    content: h.Fragment,
    label: string,
  ): void => {
    if (!bot || !guildId) return
    messages.bestEffort(label, () => bot.sendMessage(guildId, content))
  }
  const modeInteraction = new ModeInteractionCoordinator()
  var uc_num: number
  var sumup: string
  var waiver: number
  var increment: number
  var timeout_mode: number
  var hero_num = HERO_NUM
  var heroesEnabled = true
  var heros: number[]
  var hs: HeroState
  var heroState: HeroStateStore
  var flag_fa: number[]
  var huangTaiJiQuanMode: HuangTaiJiQuanMode | null
  var quan_diff: number
  var shield: boolean[]
  var fa: number[]
  var quan: number[]
  var hero_name = HERO_NAMES
  var hero_ability = HERO_ABILITIES
  var vote_num: number[]
  var add_str_simp: string
  var add_str_at: string
  const traceResolution = (segment: ResolutionTraceSegment) => (cursor: ResolutionCursor) => {
    ctx.undercoverGameResolutionTrace?.({
      segment,
      cursor,
      gameEpoch: gameTimers.epoch,
      round,
      overtime: add_flag,
    })
  }
  const createGameHeroState = () => {
    const state = createHeroStateStore(hero_num)
    heroRegistry.initializeState(state)
    return state
  }
  var regex = /[`:_.~!@#$%^&*()\+=<>?"{}|,\/;'\\[\]~！@#￥%……&*（）——\+={}|？：“”【】、；‘’，。、\n]/g
  var timer_zxz
  var timer_htj
  var timer_wsg
  var timer_mwl
  var timer_vote
  var timer_hurry
  var timer_ann
  var timer_uc
  var timer_setup
  var timer_ask_timeout
  let speechPhaseDeadlineAt = 0
  let zhangSpeechHold: {
    deadlineAt: number
    phase: ReturnType<SpeechPhaseCoordinator['current']>
    turtleDeadlines: Map<number, number>
  } | undefined
  var timer_boom
  var timer_replace
  var timer_deer_host_review
  var timer_deer_host_review_reminder
  const deerSelectionTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const deerSelectionReminderTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const deerSpeechTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const deerSpeechDeadlines = new Map<number, number>()
  const turtleSpeechTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const turtleAnswerTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const turtleAnswerReminderTimers = new Map<number, ReturnType<typeof setTimeout>>()
  // A vote-stage replacement may optionally complete the previous turtle
  // question round.  These seats are deliberately not prompted; they only
  // become eligible when the replacement sends the normal seat+question form.
  const turtleBackfillSeats = new Set<number>()
  const turtleBackfillUsers = new Map<number, string>()
  const speechBackfillSeats = new Set<number>()
  const speechBackfillUsers = new Map<number, string>()
  var deerHostReviewDeadlineAt = 0
  var deerLastSelectionReminderAt: number | undefined
  var deerProgressAvailableAt = 0
  var deerLastGroupProgressSignature = ""
  const deerHandledProgressMessageIds = new Set<string>()
  var deerSelectionExpiryRunning = false
  var deerSpeechExpiryRunning = false
  var kickActivePlayer: (session: Session, seat: number, cause: "host" | "selection-timeout" | "self") => Promise<"removed" | "blocked" | "missing">
  interface DeerRevealRow {
    seat: number
    userId: string
    profileId?: number
    nickname: string
    role: "好人" | "卧底" | "白板"
    rule: string
    choice: string
    hidden: boolean
  }
  interface DeerRevealSnapshot {
    platform: string
    guildId: string
    hostId: string
    commonTerm: string
    rows: DeerRevealRow[]
  }
  var lastDeerReveal: DeerRevealSnapshot | undefined
  const pendingAction = new PendingActionCoordinator()
  interface RecoverablePendingPrompt {
    kind: import('./game/pending-action').PendingActionKind
    userId: string
    content: string
    scope: 'private' | 'group'
    gameEpoch: number
  }
  const recoverablePendingPrompts = new Map<import('./game/pending-action').PendingActionKind, RecoverablePendingPrompt>()
  const rememberPendingPrompt = (prompt: RecoverablePendingPrompt) => {
    recoverablePendingPrompts.set(prompt.kind, prompt)
  }
  const sendRecoverablePrivatePrompt = (
    session: Session,
    prompt: Omit<RecoverablePendingPrompt, 'scope' | 'gameEpoch'>,
  ) => {
    const recorded: RecoverablePendingPrompt = {
      ...prompt,
      scope: 'private',
      gameEpoch: gameTimers.epoch,
    }
    rememberPendingPrompt(recorded)
    void messages.state(
      `${prompt.kind}私聊提示`,
      () => session.bot.sendPrivateMessage(prompt.userId, prompt.content),
    ).then(delivered => {
      if (delivered || game_off || recorded.gameEpoch !== gameTimers.epoch) return
      const stillActive = pendingAction.activeActions.some(action =>
        action.kind === prompt.kind && action.gameEpoch === recorded.gameEpoch,
      )
      if (!stillActive) return
      messages.bestEffort(
        `${prompt.kind}群内补救提示`,
        () => session.bot.sendMessage(
          gameRoute.guildId,
          `${actionSeatLabel(prompt.kind)}的私聊操作提示发送失败；流程仍在等待，请相关玩家发送“我的待处理”重新获取。`,
          ),
        )
    }).catch(error => ctx.logger.error("可恢复私聊提示后处理失败：%s", safeErrorSummary(error)))
  }
  const actionSeatLabel = (kind: import('./game/pending-action').PendingActionKind): string => {
    const action = pendingAction.activeActions.find(item => item.kind === kind)
    return action?.ownerSeat ? `${action.ownerSeat}号玩家` : '当前玩家'
  }
  const replacementRequest = new ReplacementRequestCoordinator()
  const gameTimers = new GameTimerManager({
    isActive: () => !game_off,
    onError: (error) => {
      diagnosticLog.record({ scope: 'group', guildId: gameRoute.guildId, gameId: gameInstanceId,
        direction: 'internal', event: 'timer-exception', result: 'failed', body: '游戏计时任务发生异常；原始错误由Koishi运行日志记录。' })
      ctx.logger.error("卧底游戏计时回调执行失败：%s", safeErrorSummary(error))
      if (game_off) return
      const bot = gameRoute.bot
      const guildId = gameRoute.guildId
      sumup += "系统异常：计时任务执行失败，本局已自动终止。\n"
      end_game({ kind: 'aborted', reason: 'system-error' })
      notifyBotGroup(bot, guildId, "卧底游戏计时任务执行异常，本局已自动终止；错误详情已写入日志。", "计时异常终止通知")
    },
  })
  const speechPhases = new SpeechPhaseCoordinator()
  const speechHistory = new SpeechHistory()
  const publicHeroReveals = new PublicHeroRevealState()
  const setGameTimeout = gameTimers.schedule.bind(gameTimers)
  const armSetupTimeout = (session: Session) => {
    gameTimers.cancel(timer_setup)
    const delay = Math.max(30, Number(config.setupTimeout ?? 900) || 900) * 1000
    timer_setup = setGameTimeout(async () => {
      if (flag_fati) return
      if (flag_ask_timeout) {
        timeout_mode = 1
        notifyGroup(session, "发题时限已到，已自动选择限时模式1。", "发题时限自动选择通知")
        await finishTopicSetup(session)
        return
      }
      sumup += "开局配置超时，本局自动终止。\n"
      const bot = session.bot
      const guildId = gameRoute.guildId
      end_game({ kind: 'aborted', reason: 'setup-timeout' })
      notifyBotGroup(bot, guildId, "主持人配置超时，本局卧底已自动终止，请重新开局。", "开局配置超时通知")
    }, delay)
  }
  let finishTopicSetup: (session: Session) => Promise<string | void>
  const armTimeoutSelection = (session: Session) => {
    flag_ask_timeout = true
    gameTimers.cancel(timer_ask_timeout)
    timer_ask_timeout = setGameTimeout(async () => {
      if (!flag_ask_timeout || game_off || flag_fati) return
      flag_ask_timeout = false
      timeout_mode = 1
      notifyGroup(session, "主持人超过60秒未选择发言限时，已自动选择限时模式1。", "限时模式自动选择通知")
      await finishTopicSetup(session)
    }, 60_000)
  }
  const beginBoomAdjudication = (session: Session, state: number) => {
    boom_pending = true
    boom_state = state
    gameTimers.cancel(timer_ann)
    gameTimers.cancel(timer_boom)
    const delay = Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) * 1000
    timer_boom = setGameTimeout(() => {
      if (!boom_pending) return
      sumup += "主持人未在限时内完成自爆判定，本局自动终止且不计分。\n"
      const bot = session.bot
      const guildId = gameRoute.guildId
      end_game({ kind: 'aborted', reason: 'host-timeout' })
      notifyBotGroup(bot, guildId, "主持人未在限时内完成自爆判定，本局已自动终止且不计分。", "自爆判定超时通知")
    }, delay)
  }
  const timeout = config.skillTimeout * 1000
  var timeout_for_vote = config.voteTimeout * 1000
  // 发言阶段限时（毫秒），按限时模式计算；模式3按在场人数动态计算。
  const annTimeoutMs = (mode: number): number => {
    switch (mode) {
      case 1: return config.speakTimeoutMode1 * 1000
      case 2: return config.speakTimeoutMode2 * 1000
      case 3: return config.speakTimeoutMode3PerPlayer * 1000 * (add_flag ? add_indices.length : player.length)
      default: return 0
    }
  }
  const beginSpeechPhase = (eligibleSeats: readonly number[]) => {
    speechBackfillSeats.clear()
    speechBackfillUsers.clear()
    zhangSpeechHold = undefined
    speechPhaseDeadlineAt = 0
    const phase = speechPhases.begin({ gameEpoch: gameTimers.epoch, round, kind: add_flag ? 'overtime' : 'regular', eligibleSeats })
    const token = add_flag ? 'overtime-' + ++historyOvertime : 'round-' + round
    capture(r => r.beginPhase(token, round, phase.kind, eligibleSeats))
    return phase
  }
  const startClassicSpeechPhase = (session: Session): void => {
    const eligibleSeats = add_flag ? add_indices.map(index => order[index]) : order.slice()
    const phase = beginSpeechPhase(eligibleSeats)
    gameTimers.cancel(timer_ann)
    const timed = timeout_mode === 1
      || timeout_mode === 3
      || (timeout_mode === 2 && (add_flag || round > 1))
    speechPhaseDeadlineAt = 0
    if (!timed) return
    const duration = annTimeoutMs(timeout_mode)
    speechPhaseDeadlineAt = Date.now() + duration
    timer_ann = setGameTimeout(() => {
      if (!speechPhases.matches(phase)) return
      return timeout_ann_auto(session)
    }, duration)
    notifyGroup(session, "本次发言阶段限时：" + duration / 60000 + "分钟", "经典模式发言限时通知")
  }
  var timeout_for_uc = config.gatherTimeout * 1000
  const timeout_for_hurry = config.hurryTimeout * 1000
  const scoreService = new ScoreService({
    add: async (input) => {
      if (!scoreLedger?.addAccount || !input.accountId || !input.platform || !input.guildId) {
        throw new Error("xp-points 不可用，无法写入持久积分")
      }
      return scoreLedger.addAccount({ accountId: input.accountId }, input.amount, {
        platform: input.platform,
        guildId: input.guildId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        businessId: input.businessId,
      })
    },
  }, (nickname, error) => {
    ctx.logger.error("玩家 %s 的积分写入失败：%s", nickname, safeErrorSummary(error))
  })
  const addScore = (nickname: string, amount: number, reason: string): Promise<boolean> => {
    return scoreService.add({
      enabled: score_enabled,
      nickname,
      amount,
      platform: gameRoute.platform,
      guildId: gameRoute.guildId,
      profileId: profileIdByNickname.get(nickname),
      accountId: accountIdByNickname.get(nickname),
      reason,
      idempotencyKey: `${gameInstanceId}:${reason}:${accountIdByNickname.get(nickname) ?? nickname}`,
      businessId: gameInstanceId,
    })
  }
  const sendScoreSummary = async (
    session: Session,
    winner: HistoryCamp | 'none',
    whiteSelfExplosionFailed = false,
    guildId = gameRoute.guildId,
  ): Promise<void> => {
    // Final active account, not an eliminated/recruited predecessor or the
    // old white seat. No-winner games already have their own award rule.
    if (!whiteConsolationHandled && (winner === 'good' || winner === 'undercover')
      && flag_white && order.includes(white) && !whiteSelfExplosionFailed) {
      whiteConsolationHandled = true
      const nickname = player_name[order.indexOf(white)]
      await addScore(nickname, 1, 'white-survival-consolation')
      ptsstr += nickname + "仍在场，获得1分安慰积分。"
    }
    notifyGroup(session, ptsstr + scoreService.failureNotice(), "积分结算通知", guildId)
  }
  const resetPreDealSetup = () => {
    preDealRevision += 1
    gameTimers.cancel(timer_setup)
    gameTimers.cancel(timer_ask_timeout)
    disp_off = true
    flag_ask_white = false
    flag_white = false
    flag_white_perm = false
    white_only = false
    whiteSurvivalSettlementPending = false
    boom_pending = false
    ask_nice = false
    ask_nice_instr = false
    ask_uc = false
    ask_uc_instr = false
    ask_white_instr = false
    flag_fati = false
    flag_ask_timeout = false
    flag_notify = config.realtimeVoteNoticeDefault ?? false
    set_mode = false
    flag_just_vote = false
    set_flag = Array(6).fill(false)
    uc = []
    uc_copy = []
    vote = []
    poll = []
    ann = []
    add_ann = []
    round = 0
    uc_num = 0
    white = 0
    white_copy = 0
    quan_diff = 0
    item1 = ""
    item1_copy = ""
    instr1 = ""
    item2 = ""
    item2_copy = ""
    instr2 = ""
    instr3 = ""
    sumup = ""
    heros = []
    heroState = createGameHeroState()
    hs = heroState.legacy
    add_flag = false
    add_indices = []
    add_indices_0 = []
    add_vote = []
    add_voter = []
    lockedVoteSeats.clear()
    votePhaseSerial = 0
  }
  const randomizeHeroesForRoster = () => {
    heros = []
    while (heroesEnabled && heros.length < hero_num) {
      const candidate = getRandomIntInclusive(1, Math.max(hero_num, player.length))
      if (!heros.includes(candidate)) heros.push(candidate)
    }
    for (let k = 0; k < heros.length; k++) if (heros[k] > player.length) heros[k] = 0
    for (let k = 0; k < hero_num; k++) if (config.enabledHeroes.indexOf(hero_name[k]) === -1) heros[k] = 0
    if (!heroesEnabled) heros = Array(hero_num).fill(0)
  }
  const currentModeRoster = () => order.map((seat, index) => ({
    seat,
    userId: player[index],
    nickname: player_name[index],
  }))
  const sendHeroAssignment = async (session: Session, userId: string, seat: number) => {
    const heroIndex = heros.indexOf(seat)
    if (heroIndex === -1) return false
    const heroName = hero_name[heroIndex]
    const heroCard = await heroCards.image(heroIndex)
    await messages.required(
      `${seat}号玩家武将牌私聊`,
      () => session.bot.sendPrivateMessage(
        userId,
        "你本局抽到的武将为：" + heroName + heroCard,
      ),
    )
    return true
  }
  type SetupPromptStep = "primary" | "good-detail" | "undercover" | "undercover-detail" | "white-detail" | "timeout" | "dealing" | "idle"
  type DealItem = "题面" | "武将牌"
  interface DealFailure {
    seat: number
    item: DealItem
    reason: unknown
  }
  const clearSetupPromptFlags = () => {
    ask_nice = false
    ask_nice_instr = false
    ask_uc = false
    ask_uc_instr = false
    ask_white_instr = false
    flag_ask_timeout = false
  }
  const currentSetupPromptStep = (): SetupPromptStep => {
    if (flag_fati) return "dealing"
    if (ask_nice) return "primary"
    if (ask_nice_instr) return "good-detail"
    if (ask_uc) return "undercover"
    if (ask_uc_instr) return "undercover-detail"
    if (ask_white_instr) return "white-detail"
    if (flag_ask_timeout) return "timeout"
    return "idle"
  }
  const setSetupPromptStep = (step: SetupPromptStep) => {
    clearSetupPromptFlags()
    if (step === "primary") ask_nice = true
    else if (step === "good-detail") ask_nice_instr = true
    else if (step === "undercover") ask_uc = true
    else if (step === "undercover-detail") ask_uc_instr = true
    else if (step === "white-detail") ask_white_instr = true
    else if (step === "timeout") flag_ask_timeout = true
  }
  const roundCapabilityText = (prefix: "本轮" | "从现在起") => {
    return formatModeRoundCapabilities(modeInteraction.mode, prefix)
  }
  const hostPrimaryContentPrompt = () => {
    if (modeInteraction.mode === "deer") return "请输入鹿模式好人阵营的选人/选词规则："
    if (modeInteraction.mode === "turtle") return "请输入龟模式汤面："
    return "请输入好人词条(不用写雷点，稍后会问；时代等注意事项可以在人物名后使用任意标点符号分隔标注，请不要在词条名中夹杂除·与书名号以外的任何标点符号)："
  }
  const setupPromptText = (step = currentSetupPromptStep()): string => {
    if (step === "dealing") return "正在逐人发送题面和武将牌。"
    if (step === "primary") return hostPrimaryContentPrompt()
    if (step === "timeout") return timeoutSettingsPrompt
    if (modeInteraction.mode === "turtle") {
      if (step === "good-detail") return "请输入龟模式好人阵营的实际词条；该内容只用于主持回答与赛后总结，不会发给玩家："
      if (step === "undercover") return "请输入龟模式卧底阵营的实际词条；该内容只用于主持回答与赛后总结，不会发给玩家："
    }
    if (modeInteraction.mode === "deer") {
      if (step === "good-detail") return "请输入鹿模式卧底阵营的选人/选词规则："
      if (step === "undercover") return "请输入鹿模式易混（不能作为玩家选词，将公开到群聊并私聊给所有玩家）："
    }
    if (step === "good-detail") return "请输入好人词条" + item1 + "雷点："
    if (step === "undercover") return "请输入卧底词条(不用写雷点，稍后会问；时代等注意事项可以在人物名后使用任意标点符号分隔标注，请不要在词条名中夹杂除·与书名号以外的任何标点符号)："
    if (step === "undercover-detail") return "请输入卧底词条" + item2 + "雷点："
    if (step === "white-detail") return "请输入白板提示："
    return "当前尚未进入题面输入步骤。"
  }
  const setupStatusText = (): string => {
    const modeLabel = modeInteraction.module.label
    const step = currentSetupPromptStep()
    const values = modeInteraction.mode === "turtle"
      ? ["汤面：" + (item1 || "（未填写）"), "好人实际词条：" + (item2 || "（未填写）"), "卧底实际词条：" + (instr1 || "（未填写）")]
      : modeInteraction.mode === "deer"
        ? ["好人规则：" + (item1 || "（未填写）"), "卧底规则：" + (item2 || "（未填写）"), "易混：" + (instr3 || "（未填写）")]
        : ["好人词条：" + (item1 || "（未填写）"), "好人雷点：" + (instr1 || "（未填写）"), "卧底词条：" + (item2 || "（未填写）"), "卧底雷点：" + (instr2 || "（未填写）"), ...(flag_white ? ["白板提示：" + (instr3 || "（未填写）")] : [])]
    return ["当前模式：" + modeLabel, "当前步骤：" + setupPromptText(step), ...values].join("\n")
  }
  const resetTopicSetup = () => {
    item1 = ""
    item1_copy = ""
    instr1 = ""
    item2 = ""
    item2_copy = ""
    instr2 = ""
    instr3 = ""
    setSetupPromptStep("primary")
    disp_off = false
  }
  const rewindTopicSetup = (): boolean => {
    const step = currentSetupPromptStep()
    if (step === "primary" || step === "idle" || step === "dealing") return false
    if (modeInteraction.mode === "turtle") {
      if (step === "good-detail") {
        item1 = ""
        setSetupPromptStep("primary")
      }
      else if (step === "undercover") {
        item2 = ""
        setSetupPromptStep("good-detail")
      }
      else {
        instr1 = ""
        setSetupPromptStep("undercover")
      }
      return true
    }
    if (modeInteraction.mode === "deer") {
      if (step === "good-detail") {
        item1 = ""
        setSetupPromptStep("primary")
      }
      else if (step === "undercover") {
        item2 = ""
        setSetupPromptStep("good-detail")
      }
      else {
        instr3 = ""
        setSetupPromptStep("undercover")
      }
      return true
    }
    if (step === "good-detail") {
      item1 = ""
      setSetupPromptStep("primary")
    }
    else if (step === "undercover") {
      instr1 = ""
      setSetupPromptStep("good-detail")
    }
    else if (step === "undercover-detail") {
      item2 = ""
      setSetupPromptStep("undercover")
    }
    else if (step === "white-detail") {
      instr2 = ""
      setSetupPromptStep("undercover-detail")
    }
    else {
      if (flag_white) {
        instr3 = ""
        setSetupPromptStep("white-detail")
      }
      else {
        instr2 = ""
        setSetupPromptStep("undercover-detail")
      }
    }
    return true
  }
  const dealIntervalMs = () => Math.max(0, Number(config.dealMessageInterval ?? 1) || 0) * 1000
  const dealTimeoutMs = () => Math.max(1, Number(config.dealMessageTimeout ?? 30) || 30) * 1000
  const waitDealInterval = async () => {
    const delay = dealIntervalMs()
    if (delay > 0) await sleep(delay)
  }
  const sendPrivateWithDealTimeout = async (session: Session, userId: string, content: h.Fragment): Promise<void> => {
    let handle: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        messages.required("发牌私聊", () => session.bot.sendPrivateMessage(userId, content)).then(() => undefined),
        new Promise<never>((_, reject) => {
          handle = setTimeout(() => reject(new Error("私聊发送超过" + dealTimeoutMs() / 1000 + "秒")), dealTimeoutMs())
        }),
      ])
    }
    finally {
      if (handle) clearTimeout(handle)
    }
  }
  const topicAssignmentText = (seat: number, replacement = false): string => {
    const goodTopic = item1_copy || item1
    const undercoverTopic = item2_copy || item2
    if (modeInteraction.mode === "deer") {
      if (seat === white_copy || seat === white) {
        return "你是" + seat + "号玩家。\n你是白板。\n鹿模式易混：" + instr3 + "\n你不会收到阵营规则，也不需要选人；发言必须完全符合易混。"
      }
      const rule = uc_copy.includes(seat) || uc.includes(seat) ? undercoverTopic : goodTopic
      return "你是" + seat + "号玩家。\n鹿模式易混：" + instr3 + "\n你的选人/选词规则：" + rule + "\n"
        + (replacement
          ? "你不能继承原玩家的选人，请私聊我重新提交并等待主持人审核。"
          : "请私聊我发送所选词条（可直接发送，或发送“选人 词条”）。不能选择易混本身；主持人审核通过后即可发言。")
    }
    if (modeInteraction.mode === "turtle") {
      return "你是" + seat + "号玩家。\n龟模式汤面：" + goodTopic + "\n请在每轮群聊问答阶段发送座位号加问题。你的阵营实际词条不会发送给你。"
    }
    if (uc_copy.includes(seat) || uc.includes(seat)) {
      return "你是" + seat + "号玩家。\n你拿到的词条为" + undercoverTopic + "\n雷点：" + instr2
    }
    if (seat === white_copy || seat === white) return "你是" + seat + "号玩家。\n你是白板。\n提示：" + instr3
    return "你是" + seat + "号玩家。\n你拿到的词条为" + goodTopic + "\n雷点：" + instr1
  }
  const sendTopicAssignment = async (session: Session, userId: string, seat: number, replacement = false): Promise<void> => {
    await sendPrivateWithDealTimeout(session, userId, topicAssignmentText(seat, replacement))
    if (modeInteraction.mode === "deer" && seat !== white && seat !== white_copy
      && deerSeatNeedsSelection(seat) && !deerSelectionTimers.has(seat)) {
      armDeerPlayerSelectionClock(session, seat)
    }
  }
  const speechPhaseLabel = (roundNumber: number, overtime: boolean) =>
    "第" + roundNumber + "轮" + (overtime ? "加时" : "")
  const mediaSourceForHistory = (source: unknown): string | undefined => {
    if (typeof source !== 'string' || !source || source.startsWith('data:') || source.startsWith('file:')) return undefined
    try {
      const url = new URL(source)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
      url.hash = ''
      return url.toString()
    }
    catch { return undefined }
  }
  const extractSpeechSegments = (content: h.Fragment): HistorySpeechSegment[] => {
    const elements = typeof content === 'string' ? h.parse(content) : h.normalize(content)
    return elements.flatMap<HistorySpeechSegment>(element => {
      if (element.type === 'text') return [{ kind: 'text' as const, text: String(element.attrs.content ?? '') }]
      if (element.type === 'face') {
        const id = String(element.attrs.id ?? '').trim()
        if (!/^[\w.:-]{1,128}$/.test(id)) return [{ kind: 'text', text: '[表情]' }]
        const name = typeof element.attrs.name === 'string' ? element.attrs.name.slice(0, 100) : undefined
        return [{ kind: 'face', id, ...(name ? { name } : {}), platform: gameRoute.platform }]
      }
      if (!['img', 'audio', 'video', 'file'].includes(element.type)) return []
      const attrs = element.attrs ?? {}
      const src = typeof attrs.src === 'string' ? attrs.src : undefined
      const label = typeof attrs.alt === 'string' ? attrs.alt : typeof attrs.title === 'string' ? attrs.title : undefined
      return [{ kind: 'media' as const, type: element.type as 'img' | 'audio' | 'video' | 'file', src, label }]
    })
  }
  const persistentSpeechSegments = (segments: HistorySpeechSegment[]) => segments.map(segment =>
    segment.kind !== 'media' ? segment : { ...segment, src: mediaSourceForHistory(segment.src) })
  const speechRecordText = (record: ReturnType<SpeechHistory['bySeat']>[number]) =>
    record.seat + "号玩家" + record.nickname + "：" + record.text
  const plainSpeechSegments = (segments: HistorySpeechSegment[]) => segments
    .map(segment => segment.kind === 'text' ? segment.text : segment.kind === 'face' ? '[表情]' : `[${segment.type === 'img' ? '图片' : '媒体'}]`).join('')
  const recordSpeech = (session: Session, seat: number, text: string, question?: string, answer?: string) => {
    // Turtle records the player's question and the host's final answer, not
    // the host reply session alone. Parse the combined public Q/A fragment.
    const segments = extractSpeechSegments(question === undefined ? ((session as any).elements ?? session.content) : text)
    // Media remains a structured fragment, never an XML string containing
    // authorization-bearing URLs in searchable text or text-only fallback.
    const plainText = segments.some(segment => segment.kind !== 'text') || /<face\b/i.test(text)
      ? plainSpeechSegments(segments)
      : text
    speechHistory.record({
      round,
      overtime: add_flag,
      seat,
      nickname: player_copy[seat - 1] || (order.indexOf(seat) === -1 ? "" : player_name[order.indexOf(seat)]),
      text: plainText,
      segments,
    })
    capture(r => r.speech(seat, plainText,
      question === undefined ? undefined : plainSpeechSegments(extractSpeechSegments(question)),
      answer === undefined ? undefined : plainSpeechSegments(extractSpeechSegments(answer)),
      persistentSpeechSegments(segments)))
  }
  const speechOverviewText = () => {
    const phases = speechHistory.phases()
    if (phases.length === 0) return "本局目前还没有已记录的发言。"
    return phases.map(phase =>
      speechPhaseLabel(phase.round, phase.overtime) + "：\n" + phase.records.map(speechRecordText).join("\n"),
    ).join("\n\n")
  }
  const speechRecordFragment = (record: ReturnType<SpeechHistory['bySeat']>[number]): any => {
    const prefix = record.seat + "号玩家" + record.nickname + "："
    if (!record.segments?.some(segment => segment.kind !== 'text')) return h.text(prefix + record.text)
    return h('template', {}, h.text(prefix), ...record.segments.map(segment => {
      if (segment.kind === 'text') return h.text(segment.text)
      if (segment.kind === 'face') return h('face', { id: segment.id, name: segment.name, platform: segment.platform })
      return segment.src ? h(segment.type, { src: segment.src }) : h.text(`[${segment.label ?? (segment.type === 'img' ? '图片' : '媒体')}]`)
    }))
  }
  const sendSpeechOverview = async (session: Session): Promise<string | void> => {
    const phases = speechHistory.phases()
    if (phases.length === 0) return "本局目前还没有已记录的发言。"
    const nodes = phases.map(phase => h(
      'message',
      {},
      h.text(speechPhaseLabel(phase.round, phase.overtime) + "：\n"),
      phase.records.flatMap(record => [speechRecordFragment(record), h.text("\n")]),
    ))
    try {
      await messages.required(
        "发言总览合并转发",
        () => session.bot.sendMessage(gameRoute.guildId, h('message', { forward: true }, nodes)),
      )
    }
    catch (error) {
      ctx.logger.warn("发送发言总览合并转发失败，已降级为文本：%s", safeErrorSummary(error))
      return speechOverviewText()
    }
  }
  const speechReviewUnlocked = () =>
    round > uc_num || player_copy.length - player.length - kickout.length >= uc_num
  const publicHeroIdentity = (seat: number, ordinal = false, afterNickname = ""): string => {
    const heroIndex = heros.indexOf(seat)
    const nickname = player_copy[seat - 1] || (order.indexOf(seat) === -1 ? "" : player_name[order.indexOf(seat)])
    const base = (ordinal ? "第" : "") + seat + "号玩家" + nickname + afterNickname
    if (heroIndex === -1) return base
    const hero = hero_name[heroIndex]
    const first = publicHeroReveals.reveal(seat)
    if (first) capture(r => r.event(seat, { kind: 'hero-reveal', heroId: heroIndex }))
    return first ? base + "亮出武将牌：" + hero : base + "（" + hero + "）"
  }
  const publicHeroEliminationText = (seat: number, base: string, action: string): string => {
    const heroIndex = heros.indexOf(seat)
    if (heroIndex === -1) return base + action
    const hero = hero_name[heroIndex]
    const first = publicHeroReveals.reveal(seat)
    if (first) capture(r => r.event(seat, { kind: 'hero-reveal', heroId: heroIndex }))
    if (!first) return base + "（" + hero + "）" + action
    // Keep the action's terminal punctuation at the end of the sentence.  In
    // particular, do not produce "出局。，亮将" when the caller already passed
    // a legacy action ending in a full stop.
    const punctuation = action.match(/[。！？!?…]+$/u)?.[0] ?? "。"
    const stem = action.replace(/[。！？!?…]+$/u, "")
    return base + stem + "，亮出武将牌：" + hero + punctuation
  }
  const publicHeroStatusText = (): string => {
    const rows = publicHeroReveals.seats()
      .filter(seat => heros.indexOf(seat) !== -1 && !isEmpty(player_copy[seat - 1]))
      .map(seat => seat + "号玩家" + player_copy[seat - 1] + "（" + hero_name[heros.indexOf(seat)] + "）")
    return rows.length > 0 ? "当前已亮将玩家：\n" + rows.join("\n") : "当前尚无玩家公开武将牌。"
  }
  const buildDeerReveal = (): DeerRevealSnapshot | undefined => {
    const state = modeInteraction.state
    if (state.kind !== "deer" || !state.commonTerm || !gameRoute.guildId || !hostid) return
    const rows: DeerRevealRow[] = []
    for (let seat = 1; seat <= player_copy.length; seat++) {
      if (isEmpty(player_copy[seat - 1])) continue
      const role = seat === white_copy ? "白板" : (uc_copy.indexOf(seat) !== -1 ? "卧底" : "好人")
      const rule = role === "白板" ? "仅易混" : (role === "卧底" ? state.undercoverRule : state.goodRule)
      const choice = role === "白板" ? "（无需选人）" : (state.selections.get(seat)?.candidate ?? "（未通过）")
      rows.push({
        seat,
        userId: player_id_copy[seat - 1],
        profileId: profileIdByNickname.get(player_copy[seat - 1]),
        nickname: player_copy[seat - 1],
        role,
        rule,
        choice,
        hidden: false,
      })
    }
    if (rows.length === 0) return
    return { platform: gameRoute.platform, guildId: gameRoute.guildId, hostId: hostid, commonTerm: state.commonTerm, rows }
  }
  const rememberDeerReveal = () => {
    const snapshot = buildDeerReveal()
    if (snapshot) lastDeerReveal = snapshot
  }
  const formatDeerRevealRows = (snapshot: DeerRevealSnapshot, rows: readonly DeerRevealRow[]): string => {
    if (rows.length === 0) return "上局鹿模式当前没有可公布的未隐藏选人。"
    let result = "鹿模式选人公布（易混：" + snapshot.commonTerm + "）：\n"
    for (const row of rows) {
      result += row.seat + "号 " + row.nickname + "｜" + row.role + "｜规则：" + row.rule + "｜选人：" + row.choice + "\n"
    }
    return result.trimEnd()
  }
  const findLastDeerRow = async (session: Session, snapshot: DeerRevealSnapshot): Promise<DeerRevealRow | undefined> => {
    if (ctx.xpPoints?.getManagedIdentity) {
      const identity = await ctx.xpPoints.getManagedIdentity(session.platform, session.userId)
      if (identity) {
        for (const row of snapshot.rows) {
          if (row.profileId === undefined) continue
          const canonical = ctx.xpPoints.resolveCanonicalProfileId
            ? await ctx.xpPoints.resolveCanonicalProfileId(row.profileId) : row.profileId
          if (canonical === identity.profileId) return row
        }
      }
      return snapshot.rows.find(row => row.profileId === undefined && row.userId === session.userId)
    }
    const managedNickname = ctx.xpPoints?.resolveNickname?.(session.platform, session.userId)
    if (managedNickname) return snapshot.rows.find(row => row.nickname === managedNickname)
    return snapshot.rows.find(row => row.userId === session.userId)
  }
  const cancelDeerTimers = () => {
    gameTimers.cancel(timer_deer_host_review)
    gameTimers.cancel(timer_deer_host_review_reminder)
    for (const timer of deerSelectionTimers.values()) gameTimers.cancel(timer)
    for (const timer of deerSelectionReminderTimers.values()) gameTimers.cancel(timer)
    for (const timer of deerSpeechTimers.values()) gameTimers.cancel(timer)
    deerSelectionTimers.clear()
    deerSelectionReminderTimers.clear()
    deerLastSelectionReminderAt = undefined
    deerProgressAvailableAt = 0
    deerLastGroupProgressSignature = ""
    deerHandledProgressMessageIds.clear()
    deerSpeechTimers.clear()
    deerSpeechDeadlines.clear()
    deerHostReviewDeadlineAt = 0
    deerSelectionExpiryRunning = false
    deerSpeechExpiryRunning = false
  }
  const cancelTurtleTimers = () => {
    for (const timer of turtleSpeechTimers.values()) gameTimers.cancel(timer)
    for (const timer of turtleAnswerTimers.values()) gameTimers.cancel(timer)
    for (const timer of turtleAnswerReminderTimers.values()) gameTimers.cancel(timer)
    turtleSpeechTimers.clear()
    turtleAnswerTimers.clear()
    turtleAnswerReminderTimers.clear()
    turtleBackfillSeats.clear()
    turtleBackfillUsers.clear()
  }
  const turtleEligibleSeats = (): number[] => add_flag
    ? add_indices.map(index => order[index]).filter(seat => seat > 0)
    : order.slice()
  const turtlePerPlayerMs = (eligibleCount: number): number => {
    if (eligibleCount <= 0) return Infinity
    if (timeout_mode === 1) return Math.max(1, config.speakTimeoutMode1 * 1000 / eligibleCount)
    if (timeout_mode === 2) {
      if (round === 1 && !add_flag) return Infinity
      return Math.max(1, config.speakTimeoutMode2 * 1000 / eligibleCount)
    }
    if (timeout_mode === 3) return Math.max(1, config.speakTimeoutMode3PerPlayer * 1000)
    return Infinity
  }
  const cancelTurtleSeatTimers = (seat: number) => {
    gameTimers.cancel(turtleSpeechTimers.get(seat))
    gameTimers.cancel(turtleAnswerTimers.get(seat))
    gameTimers.cancel(turtleAnswerReminderTimers.get(seat))
    turtleSpeechTimers.delete(seat)
    turtleAnswerTimers.delete(seat)
    turtleAnswerReminderTimers.delete(seat)
  }
  const armTurtleSpeechTimer = (session: Session, seat: number) => {
    gameTimers.cancel(turtleSpeechTimers.get(seat))
    turtleSpeechTimers.delete(seat)
    if (modeInteraction.mode !== "turtle" || ann_off) return
    const turn = modeInteraction.turtleTurnForSeat(seat)
    if (!turn || turn.status !== "waiting-question") return
    if (zhangXianZhongModule.isAwaitingTarget(heroState) && zhangSpeechHold) {
      if (Number.isFinite(turn.remainingMs)) {
        zhangSpeechHold.turtleDeadlines.set(seat, (turn.clockStartedAt ?? Date.now()) + turn.remainingMs)
        turn.remainingMs = Infinity
        delete turn.clockStartedAt
      }
      return
    }
    if (!Number.isFinite(turn.remainingMs)) return
    const phase = speechPhases.current()
    if (!phase || !phase.eligibleSeats.includes(seat)) return
    const timer = setGameTimeout(async () => {
      if (modeInteraction.mode !== "turtle" || ann_off || !speechPhases.matches(phase)) return
      const now = Date.now()
      const expiredSeats = turtleEligibleSeats().filter(currentSeat => {
        const current = modeInteraction.turtleTurnForSeat(currentSeat)
        return !!current
          && current.status === "waiting-question"
          && current.clockStartedAt !== undefined
          && current.clockStartedAt + current.remainingMs <= now
      })
      for (const expiredSeat of expiredSeats) {
        gameTimers.cancel(turtleSpeechTimers.get(expiredSeat))
        turtleSpeechTimers.delete(expiredSeat)
      }
      if (expiredSeats.length > 0) await players_timeout_outcast(session, expiredSeats)
    }, Math.max(1, turn.remainingMs))
    turtleSpeechTimers.set(seat, timer)
  }
  const armTurtleAnswerTimer = (session: Session, seat: number) => {
    gameTimers.cancel(turtleAnswerTimers.get(seat))
    gameTimers.cancel(turtleAnswerReminderTimers.get(seat))
    const turn = modeInteraction.turtleTurnForSeat(seat)
    if (!turn || turn.status !== "pending-host") return
    const phase = speechPhases.current()
    if (!phase || !phase.eligibleSeats.includes(seat)) return
    const pendingSince = turn.pendingSince
    const total = Math.max(10, Number(config.turtleAnswerTimeout ?? 300) || 300) * 1000
    if (notifications.turtleHostHalfReminder) {
      turtleAnswerReminderTimers.set(seat, setGameTimeout(() => {
        if (modeInteraction.mode !== "turtle" || (ann_off && !turtleBackfillSeats.has(seat)) || !speechPhases.matches(phase)) return
        const current = modeInteraction.turtleTurnForSeat(seat)
        if (!current || current.status !== "pending-host" || current.pendingSince !== pendingSince) return
        messages.bestEffort(
          `龟模式${seat}号回答过半提醒`,
          () => session.bot.sendPrivateMessage(hostid, "龟模式" + seat + "号玩家的问题等待回答时间已过半，请尽快在群内回答或驳回。"),
        )
      }, Math.max(1, Math.floor(total / 2))))
    }
    turtleAnswerTimers.set(seat, setGameTimeout(() => {
      if (modeInteraction.mode !== "turtle" || (ann_off && !turtleBackfillSeats.has(seat)) || !speechPhases.matches(phase)) return
      const current = modeInteraction.turtleTurnForSeat(seat)
      if (!current || current.status !== "pending-host" || current.pendingSince !== pendingSince) return
      const bot = session.bot
      const guildId = gameRoute.guildId
      sumup += "龟模式主持人回答" + seat + "号问题超时，本局自动终止且不计分。\n"
      end_game({ kind: 'aborted', reason: 'host-timeout' })
      notifyBotGroup(bot, guildId, "龟模式主持人未在限时内回答" + seat + "号玩家的问题，本局已自动终止且不计分。", "龟模式回答超时通知")
    }, total))
  }
  const startTurtleRound = (session: Session) => {
    if (modeInteraction.mode !== "turtle" || game_off) return false
    cancelTurtleTimers()
    gameTimers.cancel(timer_ann)
    const eligibleSeats = turtleEligibleSeats()
    beginSpeechPhase(eligibleSeats)
    const perPlayerMs = turtlePerPlayerMs(eligibleSeats.length)
    const roundKey = round + ":" + (add_flag ? "overtime" : "regular")
    modeInteraction.beginTurtleRound(roundKey, currentModeRoster(), eligibleSeats, perPlayerMs, Date.now())
    for (const seat of eligibleSeats) armTurtleSpeechTimer(session, seat)
    const timing = Number.isFinite(perPlayerMs)
      ? "每名玩家独立提问时间为" + perPlayerMs / 60000 + "分钟；提交后暂停该玩家计时。"
      : "本阶段玩家提问不限时。"
    const onboarding = round === 1 && !add_flag
      ? "应发言玩家请发送座位号加问题，例如3他是否……。主持人可引用问题直接回答或驳回，也可发送座位号加答案。"
      : ""
    messages.bestEffort(
      '龟模式问答开始通知',
      () => session.bot.sendMessage(
        gameRoute.guildId,
        (add_flag ? "龟模式加时问答开始。" : `龟模式问答开始（第${round}轮）。`) + onboarding + timing,
      ),
    )
    return true
  }
  const deerSeatDisplay = (seat: number, mention = false): string => {
    const index = order.indexOf(seat)
    const name = index === -1 ? (player_copy[seat - 1] ?? "") : player_name[index]
    const userId = index === -1 ? player_id_copy[seat - 1] : player[index]
    return seat + "号玩家" + name + (mention && userId ? String(h("at", { id: userId })) : "")
  }
  const deerProgressText = (): string => {
    const progress = modeInteraction.deerProgress()
    if (progress.waitingPlayer.length === 0 && progress.pendingHost.length === 0) {
      return "所有在场非白板玩家均已通过选人审核。"
    }
    const parts: string[] = []
    if (progress.waitingPlayer.length > 0) {
      parts.push("尚未提交：" + progress.waitingPlayer.map(seat => deerSeatDisplay(seat, true)).join("，"))
    }
    if (progress.pendingHost.length > 0) {
      parts.push("待主持审核：" + progress.pendingHost.map(seat => deerSeatDisplay(seat)).join("，")
        + (hostid ? "；请主持人" + String(h("at", { id: hostid })) + "尽快处理" : ""))
    }
    return "鹿模式选人进度：" + parts.join("；") + "。"
  }
  const deerProgressSignature = (): string => {
    const progress = modeInteraction.deerProgress()
    return progress.waitingPlayer.join(",") + "|" + progress.pendingHost.join(",")
  }
  const sendAutomaticDeerProgress = (session: Session): void => {
    const now = Date.now()
    if (!modeInteraction.deerFirstRoundStarted || now < deerProgressAvailableAt) return
    const signature = deerProgressSignature()
    if (deerLastSelectionReminderAt !== undefined
      && deerLastGroupProgressSignature === signature
      && now - deerLastSelectionReminderAt < 30_000) return
    deerLastSelectionReminderAt = now
    deerLastGroupProgressSignature = signature
    messages.bestEffort('鹿模式自动选人进度', () => session.bot.sendMessage(gameRoute.guildId, deerProgressText()))
  }
  const cancelDeerSelectionClock = (seat: number) => {
    gameTimers.cancel(deerSelectionTimers.get(seat))
    gameTimers.cancel(deerSelectionReminderTimers.get(seat))
    deerSelectionTimers.delete(seat)
    deerSelectionReminderTimers.delete(seat)
  }
  const scheduleExpiredDeerSelectionRetry = (session: Session, seat: number) => {
    gameTimers.cancel(deerSelectionTimers.get(seat))
    deerSelectionTimers.set(seat, setGameTimeout(() => processDeerSelectionExpiries(session), 1000))
  }
  const processDeerSelectionExpiries = async (session: Session) => {
    if (deerSelectionExpiryRunning || modeInteraction.mode !== "deer" || game_off) return
    deerSelectionExpiryRunning = true
    try {
      const expiredSeats = modeInteraction.deerExpiredWaitingSeats(Date.now())
      if (expiredSeats.length === 0) return
      if (isRosterChangeBlocked()) {
        for (const seat of expiredSeats) scheduleExpiredDeerSelectionRetry(session, seat)
        return
      }
      for (const seat of expiredSeats) {
        cancelDeerSelectionClock(seat)
        const result = await kickActivePlayer(session, seat, "selection-timeout")
        if (result === "blocked") scheduleExpiredDeerSelectionRetry(session, seat)
        if (game_off) return
      }
    }
    finally {
      deerSelectionExpiryRunning = false
    }
  }
  const armDeerPlayerSelectionClock = (session: Session, seat: number) => {
    cancelDeerSelectionClock(seat)
    const total = Math.max(30, Number(config.deerSelectionTimeout ?? 900) || 900) * 1000
    const deadlineAt = Date.now() + total
    if (!modeInteraction.beginDeerSelectionClock(seat, deadlineAt)) return
    const remind = () => {
      const selection = modeInteraction.deerSelectionForSeat(seat)
      if (!selection || selection.status !== "waiting-player" || selection.selectionDeadlineAt !== deadlineAt) return
      const now = Date.now()
      if (!modeInteraction.deerFirstRoundStarted || now < deerProgressAvailableAt) {
        const delay = modeInteraction.deerFirstRoundStarted
          ? Math.max(1, deerProgressAvailableAt - now)
          : 1000
        deerSelectionReminderTimers.set(seat, setGameTimeout(remind, delay))
        return
      }
      sendAutomaticDeerProgress(session)
    }
    deerSelectionReminderTimers.set(seat, setGameTimeout(remind, Math.max(1, Math.floor(total / 2))))
    deerSelectionTimers.set(seat, setGameTimeout(() => processDeerSelectionExpiries(session), total))
  }
  const syncDeerHostReviewClock = (session: Session, reset: boolean) => {
    const pending = modeInteraction.deerProgress().pendingHost
    if (pending.length === 0) {
      gameTimers.cancel(timer_deer_host_review)
      gameTimers.cancel(timer_deer_host_review_reminder)
      deerHostReviewDeadlineAt = 0
      return
    }
    if (!reset && deerHostReviewDeadlineAt > Date.now()) return
    gameTimers.cancel(timer_deer_host_review)
    gameTimers.cancel(timer_deer_host_review_reminder)
    const total = Math.max(30, Number(config.deerHostReviewTimeout ?? 300) || 300) * 1000
    deerHostReviewDeadlineAt = Date.now() + total
    const expectedDeadline = deerHostReviewDeadlineAt
    timer_deer_host_review_reminder = setGameTimeout(() => {
      if (modeInteraction.mode !== "deer" || deerHostReviewDeadlineAt !== expectedDeadline
        || modeInteraction.deerProgress().pendingHost.length === 0) return
      messages.bestEffort(
        '鹿模式主持审核过半提醒',
        () => session.bot.sendPrivateMessage(hostid, "鹿模式仍有待审核选人，请尽快处理。\n" + deerProgressText()),
      )
    }, Math.max(1, Math.floor(total / 2)))
    timer_deer_host_review = setGameTimeout(() => {
      if (modeInteraction.mode !== "deer" || deerHostReviewDeadlineAt !== expectedDeadline
        || modeInteraction.deerProgress().pendingHost.length === 0) return
      const bot = session.bot
      const guildId = gameRoute.guildId
      sumup += "鹿模式主持人审核持续超时，本局自动终止且不计分。\n"
      end_game({ kind: 'aborted', reason: 'host-timeout' })
      notifyBotGroup(bot, guildId, "鹿模式主持人长时间未处理待审核选人，本局已自动终止且不计分。", "鹿模式主持审核超时通知")
    }, total)
  }
  const deerSeatNeedsSelection = (seat: number): boolean => {
    if (modeInteraction.mode !== "deer") return false
    const selection = modeInteraction.deerSelectionForSeat(seat)
    return !!selection && selection.status !== "approved"
  }
  const deerSeatHasSpoken = (seat: number): boolean => {
    const activeIndex = order.indexOf(seat)
    if (activeIndex === -1) return true
    if (add_flag) {
      const overtimeIndex = add_indices.indexOf(activeIndex)
      return overtimeIndex === -1 || !isEmpty(add_ann[overtimeIndex])
    }
    return !isEmpty(ann[activeIndex])
  }
  const deerSpeechDurationMs = (): number => {
    if (timeout_mode === 2 && round === 1 && !add_flag) return Infinity
    if (timeout_mode >= 4) return Infinity
    return annTimeoutMs(timeout_mode)
  }
  const cancelDeerSpeechClock = (seat: number) => {
    gameTimers.cancel(deerSpeechTimers.get(seat))
    deerSpeechTimers.delete(seat)
    deerSpeechDeadlines.delete(seat)
  }
  const processDeerSpeechExpiries = async (session: Session) => {
    if (deerSpeechExpiryRunning || modeInteraction.mode !== "deer" || game_off || ann_off
      || zhangXianZhongModule.isAwaitingTarget(heroState)) return
    deerSpeechExpiryRunning = true
    try {
      const now = Date.now()
      const expiredSeats = [...deerSpeechDeadlines.entries()]
        .filter(([seat, deadline]) => deadline <= now && !deerSeatHasSpoken(seat) && !deerSeatNeedsSelection(seat))
        .map(([seat]) => seat)
      for (const seat of expiredSeats) cancelDeerSpeechClock(seat)
      if (expiredSeats.length > 0) await players_timeout_outcast(session, expiredSeats)
    }
    finally {
      deerSpeechExpiryRunning = false
    }
  }
  const armDeerSpeechClock = (session: Session, seat: number, deadlineAt?: number) => {
    cancelDeerSpeechClock(seat)
    if (modeInteraction.mode !== "deer" || ann_off || deerSeatNeedsSelection(seat) || deerSeatHasSpoken(seat)) return
    const duration = deadlineAt === undefined ? deerSpeechDurationMs() : Math.max(1, deadlineAt - Date.now())
    if (!Number.isFinite(duration) || duration <= 0) return
    const phase = speechPhases.current()
    if (!phase || !phase.eligibleSeats.includes(seat)) return
    const deadline = Date.now() + duration
    deerSpeechDeadlines.set(seat, deadline)
    if (zhangXianZhongModule.isAwaitingTarget(heroState)) return
    deerSpeechTimers.set(seat, setGameTimeout(() => {
      if (!speechPhases.matches(phase)) return
      return processDeerSpeechExpiries(session)
    }, duration))
  }
  const startDeerSpeechRound = (session: Session, firstRound = false): boolean => {
    if (modeInteraction.mode !== "deer" || game_off) return false
    gameTimers.cancel(timer_ann)
    for (const seat of [...deerSpeechTimers.keys()]) cancelDeerSpeechClock(seat)
    ann_off = false
    if (firstRound && modeInteraction.markDeerFirstRoundStarted()) {
      deerProgressAvailableAt = Date.now() + Math.max(0, Number(config.deerProgressDelay ?? 300) || 0) * 1000
      if (order.indexOf(heros[HERO.LIN_DAN_HAN]) !== -1) {
        linDanHanModule.initializeRealityRecords(heroState, order, heros[HERO.LIN_DAN_HAN])
      }
    }
    const eligibleSeats = add_flag ? add_indices.map(index => order[index]) : order.slice()
    beginSpeechPhase(eligibleSeats)
    for (const seat of eligibleSeats) armDeerSpeechClock(session, seat)
    const duration = deerSpeechDurationMs()
    const timing = Number.isFinite(duration) ? "每名获得发言资格的玩家独立限时" + duration / 60000 + "分钟。" : "本轮发言不限时。"
    const prefix = firstRound
      ? "鹿模式易混：" + instr3 + "\n鹿模式第1轮发言已开放：已获得发言资格的玩家可以发言，其他玩家请继续完成私聊选人流程。"
      : "鹿模式第" + round + "轮发言开始。"
    messages.bestEffort('鹿模式发言开始通知', () => session.bot.sendMessage(gameRoute.guildId, prefix + timing))
    return true
  }
  const timeoutSettingsPrompt = "请输入本局游戏发言限时模式（输入选项对应的序号）：\n"
    + "1.每轮发言限时" + config.speakTimeoutMode1 / 60 + "分钟（适合普通局）\n"
    + "2.第一轮发言无时间限制，随后每轮发言限制" + config.speakTimeoutMode2 / 60 + "分钟（适合较为复杂的局、或鹿模式）\n"
    + "3.每轮发言限时为在场人数×" + config.speakTimeoutMode3PerPlayer / 60 + "分钟（适合龟模式）\n"
    + "4.发言无时间限制（适合复杂局）\n"
    + "5.发言以及投票均无时间限制（适合有新手参与的局）"
  finishTopicSetup = async (session: Session) => {
    if (game_off || flag_fati || !matchesActiveSession(session)) return
    flag_ask_timeout = false
    gameTimers.cancel(timer_ask_timeout)
    const invalidModeContent = modeInteraction.mode === "deer"
      ? isEmpty(item1) || isEmpty(item2) || isEmpty(instr3)
      : modeInteraction.mode === "turtle"
        ? isEmpty(item1) || isEmpty(item2) || isEmpty(instr1)
        : isEmpty(item1) || isEmpty(item2) || isEmpty(instr1) || isEmpty(instr2) || (flag_white && isEmpty(instr3))
    if (invalidModeContent) {
      const guildId = gameRoute.guildId
      end_game({ kind: 'aborted', reason: 'setup-timeout' })
      notifyGroup(session, "出现错误，发题超时，请重新开始卧底。", "发题内容缺失通知", guildId)
      return
    }
    gameTimers.cancel(timer_setup)
    const deerMode = modeInteraction.mode === "deer"
    const turtleMode = modeInteraction.mode === "turtle"
    if (deerMode) {
      modeInteraction.configureDeer(item1, item2, instr3)
      modeInteraction.syncDeerRoster(currentModeRoster(), white)
    }
    else if (turtleMode) {
      modeInteraction.configureTurtle(item1, item2, instr1)
    }
    item1_copy = item1
    item2_copy = item2
    startHistoryCapture()
    const heroDescriptions: string[] = []
    const dealFailures: DealFailure[] = []
    const dealingEpoch = gameTimers.epoch
    flag_fati = true
    try {
      for (let i = 1; i <= player.length; i++) {
        await waitDealInterval()
        if (game_off || dealingEpoch !== gameTimers.epoch) return
        const seat = order[i - 1]
        try {
          await sendTopicAssignment(session, player[i - 1], seat)
        }
        catch (error) {
          dealFailures.push({ seat, item: "题面", reason: error })
          ctx.logger.warn("%d号玩家题面私聊发送失败：%s", seat, safeErrorSummary(error))
        }
        if (heros.indexOf(seat) !== -1) {
          await waitDealInterval()
          if (game_off || dealingEpoch !== gameTimers.epoch) return
          try {
            await sendPrivateWithDealTimeout(
              session,
              player[i - 1],
              "你本局抽到的武将为：" + hero_name[heros.indexOf(seat)] + await heroCards.image(heros.indexOf(seat)),
            )
          }
          catch (error) {
            dealFailures.push({ seat, item: "武将牌", reason: error })
            ctx.logger.warn("%d号玩家武将牌私聊发送失败：%s", seat, safeErrorSummary(error))
          }
          heroDescriptions.push(seat + "号玩家" + player_name[i - 1] + "为武将" + hero_name[heros.indexOf(seat)])
        }
      }
    }
    finally {
      if (dealingEpoch === gameTimers.epoch) flag_fati = false
    }
    if (game_off || dealingEpoch !== gameTimers.epoch) return
    const str_hero = heroDescriptions.length > 0 ? "本局武将设置：" + heroDescriptions.join("，") : "本局没有设置武将。"
    notifySession(session, str_hero)
    sumup += str_hero + "\n"
    flag_start = false
    disp_off = true
    if (dealFailures.length > 0) {
      await sendGroupNotice(
        session,
        "以下私聊发送失败：" + dealFailures.map(({ seat, item }) => seat + "号" + item).join("、")
          + "。游戏已继续；相关玩家可发送“重发我的信息”“我的题面”或“我的武将”补取。",
        "发牌失败汇总",
      )
    }
    if (deerMode) {
      sumup += "鹿模式好人规则：" + item1 + "\n鹿模式卧底规则：" + item2 + "\n鹿模式易混：" + instr3 + "\n"
      startDeerSpeechRound(session, true)
    }
    else if (turtleMode) {
      sumup += "龟模式汤面：" + item1 + "\n好人实际词条：" + item2 + "\n卧底实际词条：" + instr1 + "\n"
      notifyGroup(session, "龟模式汤面：" + item1 + "\n汤面已同时私聊给所有玩家；实际词条不会发给玩家。", "龟模式开局汤面通知")
      if (order.indexOf(heros[HERO.LIN_DAN_HAN]) !== -1) {
        linDanHanModule.initializeRealityRecords(heroState, order, heros[HERO.LIN_DAN_HAN])
      }
      ann_off = false
      startTurtleRound(session)
    }
    else {
      sumup += "好人词条为：" + item1 + "\n雷点：" + instr1 + "\n卧底词条为：" + item2 + "\n雷点：" + instr2 + "\n"
      if (flag_white) sumup += "白板提示为：" + instr3 + "\n"
      notifyGroup(session, "发题完毕，开始第" + round + "轮。", "经典模式开局通知")
      let k1 = item1.search(regex)
      if (k1 !== -1) item1 = item1.slice(0, k1)
      let k2 = item2.search(regex)
      if (k2 !== -1) item2 = item2.slice(0, k2)
      if (item1.search(/[《》·\s]/) !== -1) item1 = item1.replace(/[《》·\s]/g, "")
      if (item2.search(/[《》·\s]/) !== -1) item2 = item2.replace(/[《》·\s]/g, "")
      if (order.indexOf(heros[HERO.LIN_DAN_HAN]) !== -1) {
        linDanHanModule.initializeRealityRecords(heroState, order, heros[HERO.LIN_DAN_HAN])
      }
      ann_off = false
      startClassicSpeechPhase(session)
    }
    return ("发题配置已完成。实时投票通知默认关闭；主持人可随时发送“开启投票通知”或“关闭投票通知”。")
  }
  const restartPreDealSetupAfterRosterChange = async (session: Session): Promise<void> => {
    gameTimers.cancel(timer_uc)
    const guildId = gameRoute.guildId
    flag_start = true
    wait_off = true
    add_player = config.allowLateJoinByDefault ?? true
    sumup = "上局为" + player.length + "人局，主持人为" + hostname + "。\n"
    fa = Array(player.length).fill(0)
    flag_fa = Array(player.length).fill(0)
    huangTaiJiQuanMode = null
    quan = Array(player.length).fill(0)
    shield = Array(player.length).fill(false)
    order = Array.from({ length: player.length }, (_, index) => index + 1)
    ann = Array(player.length)
    vote = [Array(player.length)]
    poll = Array(player.length).fill(0)
    vote_num = Array(player.length).fill(1)
    round = 1
    const roster = "玩家顺序：\n" + order
      .map((seat, index) => seat + "号玩家：" + player_name[index])
      .join("\n")
    sumup += roster + "\n"
    randomizeHeroesForRoster()
    let groupSetupSummary: string | undefined
    let hostSetupSummary: string | undefined
    if (modeInteraction.module.allowsWhite && player.length >= config.whiteMinPlayers) {
      flag_ask_white = true
    }
    else {
      uc_num = Math.floor(player.length / config.undercoverDivisor)
      while (uc.length < uc_num) {
        const seat = getRandomIntInclusive(1, player.length)
        if (!uc.includes(seat)) uc.push(seat)
      }
      uc_copy = [...uc]
      disp_off = false
      const undercoverText = uc.map(seat => seat + "号玩家" + player_name[seat - 1]).join("，")
      groupSetupSummary = "本局有" + (player.length - uc_num) + "个好人，" + uc_num + "个卧底，无白板。"
      hostSetupSummary = "你为本局主持人，随机生成本局游戏" + undercoverText + "为卧底。"
      sumup += "上局游戏" + undercoverText + "为卧底。\n"
      ask_nice = true
    }
    armSetupTimeout(session)

    await sendGroupNotice(session, "开局配置阶段限时" + Math.max(30, Number(config.setupTimeout ?? 900) || 900) / 60 + "分钟。", "名单变化后配置限时通知", guildId)
    await sendGroupNotice(session, "本局为" + player.length + "人局（默认" + (heroesEnabled ? "加入武将" : "普通局无武将") + "；主持人可在发题前发送“普通局”或“武将局”调整，也可发送“自定义”自行配置。）", "名单变化后配置说明", guildId)
    if (modeInteraction.mode !== "classic") {
      await sendGroupNotice(session, "本局为" + modeInteraction.module.label + "，发题前仍可切换模式。", "名单变化后模式通知", guildId)
    }
    await sendGroupNotice(session, roster, "名单变化后玩家顺序", guildId)
    if (flag_ask_white) {
      await sendGroupNotice(session, "是否加入白板？请主持人发送“是”或“否”", "名单变化后白板提示", guildId)
      return
    }
    await sendGroupNotice(session, groupSetupSummary!, "名单变化后阵营摘要", guildId)
    await sendPrivateNotice(session, hostid, hostSetupSummary!, "名单变化后主持人身份提示")
    await sendPrivateNotice(session, hostid, hostPrimaryContentPrompt(), "名单变化后主持人发题提示")
  }
  const help = "使用卧底bot指令帮助：\n\
  使用bot参与游戏前请先加bot好友。\n\
  在非游戏状态下，在群里发送“卧底”进入卧底模式，发送者成为主持人。\n\
  群友扣1以参与，凑齐人后主持人在群里发送“开始”进行发题。\n\
  主持人发题时根据私聊提示依次输入内容；可用“发题状态”“发题上一步”“重新发题”检查或纠正。\n\
  发言与投票按照提示进行，投票时和bot进行私聊。\n\
  注意玩家发言时必须以自己的顺序号码开头，否则bot不识别。\n\
  自爆时须以玩家号码接“自爆”的格式打头，中间不允许有任何汉字字母或数字，例如“1自爆，好人赵恒”或“1.,自爆，好人赵恒”均能触发，但“1.我要自爆，好人赵恒”不行。\n\
  在bot发送结果前可以改发言改票，发送发言/投票结果后不得更改。\n\
  游戏结束后bot自动退出卧底模式，如果卧底中途需要停止，请主持人在群里发送“停止卧底”、“中止卧底”或“终止卧底”以退出卧底模式。\n\
  每局结束后，发送“总结”或“上局总结”、“总结上局”或“复盘”以获得总结。\n\
  支持7人及以上的局加入白板，白板可以通过卧底全部出局后苟一轮，自爆猜出好人与卧底人物（不必猜出哪一方是好人哪一方是卧底）胜利，或者私信bot猜出一方人物加入该阵营。\n\
  支持主持人中途踢人（防跳车），在群里发送“踢出”+玩家序号即可，如“踢出1”。"
  const conciseHelp = `谁是卧底 · 武将版

【快速开始】
1. 群内发送卧底，玩家发送1；主持人可选择经典模式、鹿模式或龟模式（不选则默认经典），再发送开始。
2. 也可直接发送开始经典模式、开始鹿模式、开始龟模式。逐人发题前仍可切换模式，切换会清空旧题面与自定义设置。
3. 主持人按私聊提示完成身份、武将、题目和限时配置。
4. 经典/鹿模式按座位号群内发言；龟模式按座位号群内提问；投票均私聊 bot。

【三种模式】
经典：设置双方词条；可选白板，允许招安和自爆。
鹿：设置双方选人规则与公开易混；非白板私聊选词，主持人审核通过后即可发言，不必等待全员。第一轮开放一段时间后可发送谁没选人催促进度。禁止招安、自爆，不能选择易混本身。
龟：所有人只收到公开汤面；玩家群内发送3他是否……，主持人回答3是/否/是也不是/无关/不确定，或3驳回 原因。禁止白板、招安和自爆。
龟模式可发送龟进度；主持人可引用玩家问题直接回答，也可发送3否等座位格式；在最后一人完成前重复回答同一座位即可覆盖。
鹿模式达到配置的催促等待时间后可发送谁没选人；玩家各自获得发言资格后立即获得完整发言机会。

【常用指令】
普通局：关闭武将　自定义：手动设置身份与武将
踢出3：踢出玩家　取消补位：主持人取消当前申请
发题状态 / 重发发题提示 / 发题上一步 / 重新发题：主持人私聊检查或纠正配置
我的题面 / 我的武将 / 重发我的信息：玩家随时私聊补取本局信息
谁没发言 / 谁没投票：经典与鹿进度　龟进度：龟模式问答进度
凑人进度 / 几个人了：查看当前人数　发言总览：合并查看本局各轮发言
盘3：解锁盘发言后，由在场玩家查看3号从开局至今的全部发言
亮将情况：查看本局当前已公开武将牌的固定座位
结束投票：主持人强制结算　总结 / 复盘：查看上局记录
开启投票通知 / 关闭投票通知：主持人随时切换私聊票况；投票通知状态可查询
隐藏选人：上把鹿模式玩家在原群隐藏自己的记录，避免被主持人批量公布
公布选人：原主持人公布全部未隐藏记录；上把玩家公布自己的记录并解除隐藏
查询武将 [武将名]：查看技能；省略名称可交互选择　停止卧底：终止本局

【重要规则】
使用前请先添加 bot 为好友；主持人不参与游戏。
结果公布前可以改发言、改票；鹿模式选人通过后不能自行更改。
禁止自爆只限制普通座位号加自爆流程，不影响武将技能。
同一机器人同时只进行一局游戏。`
  ctx.command("卧底帮助")
    .action(({ session }) => {
      return conciseHelp
    })
  ctx.command("订阅")
  .alias("叫我")
  .action(async ({session})=>{
    if (!session.guildId) {
      return("本功能仅支持qq群内使用哦~")
    }
    return runPublicCommand("订阅叫人通知", async () => {
      const result = await subscriptions.subscribe(session.platform, session.guildId!, session.userId)
      if (result === 'paused') return resolvePlayerNickname(session) + "，你的订阅仍然保留，但已被管理员暂停；只有管理员执行“订阅管理.恢复”后才能参与召唤。"
      if (result === 'existing') return(resolvePlayerNickname(session) + "，你是不是糊涂了？你已经订阅了，别来烦我")
      if (result === 'reactivated') return("好的，" + resolvePlayerNickname(session) + "，已恢复你的叫人订阅。")
      return("好的，" + resolvePlayerNickname(session) + "，当我叫人时会叫你的。")
    })
  })

  ctx.command("查询武将 [hero_str:string]")
  .action(async ({session}, hero_str)=>{
    const heroId = findHeroId(hero_str)
    if (hero_str && heroId === undefined) {
      return "暂时没有该武将。\n" + heroCardInteractions.startQuery(session)
    }
    if (heroId === undefined) return heroCardInteractions.startQuery(session)
    heroCardInteractions.cancel(session)
    return runPublicCommand("查询武将", () => renderHero(heroCards, heroId))
  })
  const cardManagementHelp = `武将卡面管理（authority 5）
卡面管理.替换 [武将] [图片]：替换卡面，也可分步选择并上传
卡面管理.恢复 [武将]：恢复包内默认卡面
卡面管理.查看 [武将]：查看当前卡面及来源
卡面管理.列表：查看全部武将卡面来源
兼容别名：替换卡面、恢复默认卡面、查看卡面
上传的覆盖卡面保存在本实例 data/undercover-game/hero-cards 中，不会修改插件包。`
  ctx.command("卡面管理", { authority: 5 })
    .action(() => cardManagementHelp)
  ctx.command("卡面管理.替换 [hero:string] [image:image]", { authority: 5 })
    .alias("替换卡面")
    .action(async ({ session }, hero, image) => {
      const heroId = findHeroId(hero)
      if (hero && heroId === undefined) return "暂时没有该武将。\n" + heroCardInteractions.startReplacement(session)
      if (heroId === undefined) return heroCardInteractions.startReplacement(session)
      if (!image?.src) return heroCardInteractions.startReplacement(session, heroId)
      heroCardInteractions.cancel(session)
      try {
        const status = await heroCards.replaceFromSource(heroId, image.src, {
          platform: session.platform,
          userId: session.userId,
        })
        return `已替换${status.heroName}的卡面。` + await heroCards.image(heroId)
      }
      catch (error) {
        if (!(error instanceof HeroCardValidationError)) ctx.logger.error("武将卡面替换失败：%s", safeErrorSummary(error))
        return error instanceof HeroCardValidationError ? `卡面替换失败：${error.message}` : "卡面替换失败，当前卡面没有改变。"
      }
    })
  ctx.command("卡面管理.恢复 [hero:string]", { authority: 5 })
    .alias("恢复默认卡面")
    .action(async ({ session }, hero) => {
      const heroId = findHeroId(hero)
      if (heroId === undefined) return hero ? "暂时没有该武将。" : "请指定要恢复的武将，例如：恢复默认卡面 朱由检"
      heroCardInteractions.cancel(session)
      return runPublicCommand("恢复默认卡面", async () => {
        const changed = await heroCards.restoreDefault(heroId)
        return (changed ? `已恢复${HEROES[heroId].name}的默认卡面。` : `${HEROES[heroId].name}当前已使用默认卡面。`)
          + await heroCards.image(heroId)
      })
    })
  ctx.command("卡面管理.查看 [hero:string]", { authority: 5 })
    .alias("查看卡面")
    .action(async ({ session }, hero) => {
      const heroId = findHeroId(hero)
      if (heroId === undefined) return hero ? "暂时没有该武将。" : heroCardInteractions.startStatus(session)
      heroCardInteractions.cancel(session)
      return runPublicCommand("查看卡面", () => renderHeroCardStatus(heroCards, heroId))
    })
  ctx.command("卡面管理.列表", { authority: 5 })
    .action(async () => {
      return runPublicCommand("查看卡面列表", async () => {
        const statuses = await heroCards.list()
        return statuses.map(status => `${status.heroName}：${status.source === "custom" ? "自定义" : "默认"}`).join("\n")
      })
    })
  ctx.middleware(async (session, next) => {
    const result = await heroCardInteractions.handle(session)
    if (!result.handled) return next()
    return result.response
  }, true)
  ctx.command("取订")
  .alias("别叫我")
  .action(async ({session})=>{
    if (!session.guildId) {
      return("本功能仅支持qq群内使用哦~")
    }
    return runPublicCommand("取消叫人订阅", async () => {
      if (!await subscriptions.unsubscribe(session.platform, session.guildId!, session.userId)) {
        return(resolvePlayerNickname(session) + "，你根本没订阅啊！取消什么呢？")
      }
      return("好的，" + resolvePlayerNickname(session) + "，我叫人的时候不会再烦你了。")
    })
  })
  ctx.command("叫人")
  .userFields(["authority"])
  .alias("召唤术")
  .action(async ({session})=>{
    if (!session.guildId) {
      return("本功能仅支持qq群内使用哦~")
    }
    if(session.user.authority < 2 && (session.userId !== hostid || (wait_off && !flag_start && isEmpty(kickout)))) return(resolvePlayerNickname(session) + "，你又不是bot管理员，也没在凑人，我才不理你呢！")
    return runPublicCommand("叫人", async () => {
      let at_str = ""
      let callableUserIds: string[]
      try {
        callableUserIds = await subscriptions.getCallableUserIds(
          session.bot,
          session.platform,
          session.guildId!,
        )
      }
      catch (error) {
        if (!(error instanceof SubscriptionMemberListError)) throw error
        ctx.logger.warn("叫人实时成员读取失败：%s", safeErrorSummary(error))
        return "当前无法完整读取本群成员名单，本次没有召唤任何订阅者，也没有修改订阅记录；请稍后重试。"
      }
      for (const userId of callableUserIds) {
        if (userId !== session.userId && (player ?? []).indexOf(userId) === -1) {
          at_str += h('at', { id: userId })
        }
      }
      at_str += "，"+ resolvePlayerNickname(session) + "在召唤大家"
      return(at_str)
    })
  })
  const parseSubscriptionTarget = (session: Session, target: string | undefined) => {
    if (!target) return null
    const separator = target.lastIndexOf(':')
    const platform = separator > 0 ? target.slice(0, separator) : session.platform
    const userId = separator > 0 ? target.slice(separator + 1) : target
    if (!userId || platform !== session.platform) return null
    return { platform, userId }
  }
  const requireSubscriptionGuild = (session: Session): string | null => session.guildId ?? null
  ctx.command("订阅管理", { authority: 5 })
    .action(() => "订阅管理（authority 5）：\n订阅管理.状态 [用户]\n订阅管理.停用 <用户>\n订阅管理.恢复 <用户>\n订阅管理.删除 <用户> [确认]\n订阅管理.扫描成员 [执行]\n订阅会长期保留；叫人时实时核对群成员。旧“执行”参数仅兼容用法，不再改写订阅。")
  ctx.command("订阅管理.状态 [target:user]", { authority: 5 })
    .action(async ({ session }, target) => {
      const guildId = requireSubscriptionGuild(session)
      if (!guildId) return "本功能仅支持群聊。"
      const parsed = parseSubscriptionTarget(session, target)
      if (target && !parsed) return "无法解析目标用户，或目标不属于当前平台。"
      return runPublicCommand("查询订阅状态", async () => {
        if (parsed) {
          const row = await subscriptions.get(parsed.platform, guildId, parsed.userId)
          if (!row) return "该用户在本群没有卧底叫人订阅。"
          try {
            const scan = await subscriptions.scanGuildMembers(session.bot, parsed.platform, guildId)
            const status = scan.statuses.find(item => item.userId === parsed.userId)!
            const reasons = [
              ...(status.manuallyPaused ? ['管理员暂停'] : []),
              ...(!status.inGuild ? ['当前不在群'] : []),
              ...(status.authorityZero ? ['authority 0'] : []),
            ]
            return `订阅 ${parsed.userId}：已保留；${status.callable ? '当前可召唤' : reasons.join('、') || '当前不可召唤'}。`
          }
          catch (error) {
            if (!(error instanceof SubscriptionMemberListError)) throw error
            return `订阅 ${parsed.userId}：已保留${row.reason === 'manual-inactive' ? '，管理员暂停' : ''}；实时成员名单读取失败，当前资格未知。`
          }
        }
        try {
          const scan = await subscriptions.scanGuildMembers(session.bot, session.platform, guildId)
          return `本群共有 ${scan.candidates} 条保留订阅：当前可叫 ${scan.callable}，不在群 ${scan.absent}，管理员暂停 ${scan.manuallyPaused}，authority 0 ${scan.authorityZero}。`
        }
        catch (error) {
          if (!(error instanceof SubscriptionMemberListError)) throw error
          const rows = await subscriptions.list(session.platform, guildId)
          const paused = rows.filter(row => row.reason === 'manual-inactive').length
          return `本群共有 ${rows.length} 条保留订阅，其中管理员暂停 ${paused}；实时成员名单读取失败，当前可召唤人数未知。`
        }
      })
    })
  const setSubscriptionState = (state: 'active' | 'inactive', reason: string) =>
    async (session: Session, target: string | undefined) => {
      const guildId = requireSubscriptionGuild(session)
      if (!guildId) return "本功能仅支持群聊。"
      const parsed = parseSubscriptionTarget(session, target)
      if (!parsed) return "请指定当前平台的目标用户。"
      return runPublicCommand(state === 'active' ? "恢复订阅" : "停用订阅", async () => {
        const changed = await subscriptions.markExisting(
          parsed.platform,
          guildId,
          parsed.userId,
          state,
          reason,
        )
        if (!changed) return "该用户在本群没有卧底叫人订阅。"
        return `已${state === 'active' ? '恢复' : '停用'} ${parsed.userId} 的本群订阅。`
      })
    }
  ctx.command("订阅管理.停用 <target:user>", { authority: 5 })
    .action(({ session }, target) => setSubscriptionState('inactive', 'manual-inactive')(session, target))
  ctx.command("订阅管理.恢复 <target:user>", { authority: 5 })
    .action(({ session }, target) => setSubscriptionState('active', 'manual-active')(session, target))
  ctx.command("订阅管理.删除 <target:user> [confirmation:string]", { authority: 5 })
    .action(async ({ session }, target, confirmation) => {
      const guildId = requireSubscriptionGuild(session)
      if (!guildId) return "本功能仅支持群聊。"
      const parsed = parseSubscriptionTarget(session, target)
      if (!parsed) return "请指定当前平台的目标用户。"
      return runPublicCommand("删除订阅", async () => {
        const row = await subscriptions.get(parsed.platform, guildId, parsed.userId)
        if (!row) return "该用户在本群没有卧底叫人订阅。"
        if (confirmation !== '确认') {
          return `将永久删除 ${parsed.userId} 在本群的卧底叫人订阅；档案和积分不受影响。确认后发送：订阅管理.删除 ${target} 确认`
        }
        await subscriptions.remove(parsed.platform, guildId, parsed.userId)
        return `已永久删除 ${parsed.userId} 在本群的卧底叫人订阅。`
      })
    })
  ctx.command("订阅管理.扫描成员 [mode:string]", { authority: 5 })
    .action(async ({ session }, mode) => {
      const guildId = requireSubscriptionGuild(session)
      if (!guildId) return "本功能仅支持群聊。"
      if (mode && mode !== '执行') return "用法：订阅管理.扫描成员 [执行]\n该操作始终只读；“执行”仅作为旧用法兼容。"
      return runPublicCommand("扫描订阅成员", async () => {
        try {
          const result = await subscriptions.scanGuildMembers(
            session.bot,
            session.platform,
            guildId,
            mode === '执行',
          )
          return [
            `订阅成员实时检查（只读）：群成员 ${result.memberCount}，保留订阅 ${result.candidates}，当前可叫 ${result.callable}。`,
            `不在群 ${result.absent}，管理员暂停 ${result.manuallyPaused}，authority 0 ${result.authorityZero}。`,
            ...(result.executeRequested ? ['“执行”参数已兼容接受；成员存在性没有写入订阅记录。'] : []),
          ].join('\n')
        }
        catch (error) {
          if (!(error instanceof SubscriptionMemberListError)) throw error
          ctx.logger.warn("订阅成员实时检查失败：%s", safeErrorSummary(error))
          return "无法完整读取本群成员名单；本次检查未修改任何订阅，请稍后重试。"
        }
      })
    })
  ctx.middleware((session, next) => {//主持人实时投票通知开关
    if (game_off || session.userId !== hostid) return next()
    if (!matchesActiveSession(session)) return next()
    const input = session.content.replace(/\s/g, "")
    if (["开启投票通知", "打开投票通知", "开启实时投票通知"].includes(input)) {
      if (flag_notify) return ("实时投票通知已经开启。")
      flag_notify = true
      return ("已开启实时投票通知。")
    }
    if (["关闭投票通知", "关闭实时投票通知"].includes(input)) {
      if (!flag_notify) return ("实时投票通知已经关闭。")
      flag_notify = false
      return ("已关闭实时投票通知。")
    }
    if (input === "投票通知状态") {
      return ("实时投票通知当前已" + (flag_notify ? "开启。" : "关闭。"))
    }
    return next()
  })
  const deerHostReviewPrompt = (seat: number): string | undefined => {
    const state = modeInteraction.state
    if (state.kind !== 'deer') return
    const selection = state.selections.get(seat)
    if (!selection || selection.status !== 'pending-host' || !selection.candidate) return
    const isUndercover = uc_copy.includes(seat)
    const role = isUndercover ? '卧底' : '好人'
    const rule = isUndercover ? state.undercoverRule : state.goodRule
    return "鹿模式" + seat + "号玩家" + selection.nickname + "提交选人：“" + selection.candidate + "”。"
      + "\n该座位身份：" + role + "；对应规则：" + rule + "；本局易混：" + state.commonTerm + "。"
      + "\n请引用本消息回复“是”或“否”，也可以发送“" + seat + "是”或“" + seat + "否 原因”。"
  }
  const turtleHostAnswerPrompt = (seat: number): string | undefined => {
    const state = modeInteraction.state
    if (state.kind !== 'turtle') return
    const turn = modeInteraction.turtleTurnForSeat(seat)
    if (!turn || turn.status !== 'pending-host' || !turn.question) return
    const isUndercover = uc.includes(seat)
    const actualTerm = isUndercover ? state.undercoverTerm : state.goodTerm
    return "龟模式" + seat + "号玩家" + turn.nickname + "提问：" + turn.question
      + "\n该座位阵营：" + (isUndercover ? "卧底" : "好人") + "；对应实际词条：" + actualTerm
      + "\n请引用该玩家的群消息直接回复是、否、是也不是、无关、不确定或驳回 原因；也可发送" + seat + "是、" + seat + "否等座位号格式。"
      + "\n在本轮全部问答完成前，再次发送同座位答案即可覆盖。"
  }
  ctx.middleware(async (session, next) => {//阻塞动作状态与私聊提示补取
    if (game_off) return next()
    if (!matchesActiveSession(session)) return next()
    const input = session.content.replace(/\s/g, "")
    if (input === "待处理操作") {
      if (session.userId !== hostid) return next()
      const actions = pendingAction.activeActions.filter(action => action.gameEpoch === gameTimers.epoch)
      const actionLines = actions.map(action => {
        const owner = action.ownerSeat ? `${action.ownerSeat}号玩家` : "主持人"
        const remaining = pendingAction.remainingMs(Date.now(), action.kind)
        const time = Number.isFinite(remaining) ? `，剩余约${Math.ceil(remaining / 1000)}秒` : ""
        return `正在等待${owner}处理${action.kind}${time}。`
      })
      const modeStatus: string[] = []
      const modeDetails: string[] = []
      if (modeInteraction.mode === 'deer') {
        const seats = modeInteraction.deerProgress().pendingHost
        if (seats.length) {
          modeStatus.push(`鹿模式待主持审核座位：${seats.join('、')}。`)
          if (!session.guildId) modeDetails.push(...seats.map(deerHostReviewPrompt).filter((value): value is string => !!value))
        }
      }
      if (modeInteraction.mode === 'turtle') {
        const seats = modeInteraction.turtleProgress().pendingHost
        if (seats.length) {
          modeStatus.push(`龟模式待主持回答座位：${seats.join('、')}。`)
          if (!session.guildId) modeDetails.push(...seats.map(turtleHostAnswerPrompt).filter((value): value is string => !!value))
        }
      }
      if (!actionLines.length && !modeStatus.length) return "当前没有等待处理的武将技能或主持操作。"
      if (session.guildId && modeStatus.length) modeStatus.push('详细内容请主持人私聊发送“待处理操作”补取。')
      return [...actionLines, ...modeStatus, ...modeDetails].join("\n\n")
    }
    if (input !== "我的待处理") return next()
    const action = pendingAction.activeActions.find(item =>
      item.gameEpoch === gameTimers.epoch && item.ownerUserId === session.userId,
    )
    if (!action) return "你当前没有等待处理的武将技能或游戏操作。"
    const prompt = recoverablePendingPrompts.get(action.kind)
    if (!prompt || prompt.gameEpoch !== gameTimers.epoch) {
      return "当前操作仍在等待，但没有可重发的提示；请联系主持人查看“待处理操作”。"
    }
    if (prompt.scope === 'group' || !session.guildId) return prompt.content
    const delivered = await messages.state(
      `${prompt.kind}补取提示`,
      () => session.bot.sendPrivateMessage(session.userId, prompt.content),
    )
    return delivered ? "已私聊重发当前操作提示。" : "私聊提示仍发送失败，请检查是否已添加机器人好友。"
  })
  ctx.middleware(async (session, next) => {//玩家主动退出
    if (game_off || !["退出游戏", "退出卧底"].includes(session.content.replace(/\s/g, ""))) return next()
    const isPrivate = !session.guildId
    const sameRoute = isPrivate
      ? session.selfId === gameRoute.bot?.selfId && session.platform === gameRoute.platform
      : gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
    if (!sameRoute) return next()
    const inputEpoch = gameTimers.epoch
    const result = await gameInputQueue.run(async () => {
    // The route may have been cleared while this input waited in the queue.
    // Forward only after leaving the queue so an unrelated downstream plugin
    // cannot hold up later game inputs.
    const stillSameRoute = isPrivate
      ? session.selfId === gameRoute.bot?.selfId && session.platform === gameRoute.platform
      : gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
    if (game_off || !stillSameRoute || inputEpoch !== gameTimers.epoch) return forwardGameInput
    const playerIndex = player.indexOf(session.userId)
    if (playerIndex === -1) return "你当前不是本局在场或已记录的玩家。"
    if (flag_fati) return "正在逐人发牌，暂时不能退出；发牌完成后可再次发送“退出游戏”。"
    if (isRosterChangeBlocked()) return "正在等待武将技能或主持人判定，暂时不能退出游戏。"

    const nickname = player_name[playerIndex]
    const seat = order[playerIndex] ?? playerIndex + 1
    if (!wait_off) {
      releasePlayerLease(session.userId)
      player.splice(playerIndex, 1)
      player_name.splice(playerIndex, 1)
      player_copy.splice(playerIndex, 1)
      player_id_copy.splice(playerIndex, 1)
      await sendGroupNotice(
        session,
        nickname + "已退出游戏。当前已加入" + player.length + "人，还差"
          + Math.max(0, config.minPlayers - player.length) + "人可以开始。",
        "凑人阶段主动退出通知",
      )
    }
    else if (flag_start) {
      releasePlayerLease(session.userId)
      player.splice(playerIndex, 1)
      player_name.splice(playerIndex, 1)
      player_copy = [...player_name]
      player_id_copy = [...player]
      resetPreDealSetup()
      await sendGroupNotice(session, seat + "号玩家" + nickname + "主动退出，开局配置已重置。", "配置阶段主动退出通知")
      if (player.length >= config.minPlayers) {
        await restartPreDealSetupAfterRosterChange(session)
      }
      else {
        flag_start = false
        wait_off = false
        timer_uc = setGameTimeout(() => {
          const guildId = gameRoute.guildId
          end_game({ kind: 'aborted', reason: 'setup-timeout' })
          sumup += "凑人超时，卧底自动终止。"
          notifyGroup(session, "凑人超时，卧底自动终止。", "退出后凑人超时通知", guildId)
        }, timeout_for_uc)
        await sendGroupNotice(
          session,
          "当前剩余" + player.length + "人，还差" + (config.minPlayers - player.length) + "人；已返回凑人阶段。",
          "退出后返回凑人通知",
        )
      }
    }
    else {
      const result = await kickActivePlayer(session, seat, "self")
      if (result === "blocked") return "正在等待武将技能或主持人判定，暂时不能退出游戏。"
      if (result === "missing") return "你的座位已经不在当前名单中。"
    }
    if (isPrivate) {
      await sendPrivateNotice(session, hostid, nickname + "通过私聊主动退出了本局游戏。", "私聊主动退出主持人通知")
      return "你已退出本局游戏。"
    }
    })
    return result === forwardGameInput ? next() : result
  })
  ctx.middleware(async (session, next) => {//玩家补取题面与武将牌
    if (game_off) return next()
    const command = session.content.replace(/\s/g, "")
    if (!["重发我的信息", "我的题面", "我的武将"].includes(command)) return next()
    const isPrivate = !session.guildId
    if (isPrivate) {
      if (session.selfId !== gameRoute.bot?.selfId || session.platform !== gameRoute.platform) return next()
    }
    else if (!gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let seatIndex = player.indexOf(session.userId)
    let seat = seatIndex === -1 ? player_id_copy.indexOf(session.userId) + 1 : order[seatIndex]
    if (seat <= 0) return "你当前不是本局在场或已记录的玩家。"
    if (flag_fati) return "正在逐人发牌，请等待本轮发送完成后再补取。"
    if (!wait_off || flag_start || isEmpty(item1_copy)) return "本局尚未完成发题，暂时没有可重发的信息。"
    try {
      if (command !== "我的武将") {
        await sendTopicAssignment(session, session.userId, seat, false)
      }
      if (command !== "我的题面") {
        if (heros.indexOf(seat) === -1) {
          await sendPrivateWithDealTimeout(session, session.userId, "你的座位本局没有武将牌。")
        }
        else {
          await sendPrivateWithDealTimeout(
            session,
            session.userId,
            "你本局抽到的武将为：" + hero_name[heros.indexOf(seat)] + await heroCards.image(heros.indexOf(seat)),
          )
        }
      }
    }
    catch (error) {
      ctx.logger.warn("%d号玩家主动补取信息失败：%s", seat, safeErrorSummary(error))
      return "私聊重发失败，请确认已添加机器人好友或稍后重试。"
    }
    if (!isPrivate) return "已将所需信息重新私聊发送给你。"
  })
  ctx.guild().middleware(async (session, next) => {//凑人进度与发言回顾
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const input = session.content.replace(/\s/g, "")
    const gatheringQuery = ["凑人进度", "凑人状态", "凑人进程"].includes(input)
      || input.indexOf("几人") !== -1
      || input.indexOf("几个人") !== -1
    // A progress query during gathering is serialized with joins so it cannot
    // observe the short identity/lease interval before a `1` reaches the
    // roster.  Once setup has started it is not a game query anymore; forward
    // it immediately so an unrelated downstream plugin is never put behind
    // the game-state queue.
    if (gatheringQuery) {
      if (wait_off) return next()
      const inputEpoch = gameTimers.epoch
      const result = await gameInputQueue.run(() => {
        if (game_off || wait_off || inputEpoch !== gameTimers.epoch
          || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return forwardGameInput
        const missing = Math.max(0, config.minPlayers - player.length)
        return missing > 0
          ? "当前已加入" + player.length + "人，还差" + missing + "人可以开始。"
          : "当前已加入" + player.length + "人，已经达到开局人数，等待主持人发送“开始”。"
      })
      return result === forwardGameInput ? next() : result
    }
    if (input === "亮将情况") {
      if (!wait_off || flag_start || flag_fati) return "本局尚未进入可以亮将的游戏阶段。"
      return publicHeroStatusText()
    }
    if (input === "发言总览") {
      if (!wait_off || flag_start || flag_fati) return "本局尚未进入发言阶段。"
      return sendSpeechOverview(session)
    }
    const review = input.match(/^盘(\d+)$/)
    if (!review) return next()
    if (player.indexOf(session.userId) === -1) return "只有本局当前在场玩家可以盘发言。"
    if (!speechReviewUnlocked()) return "当前尚未解锁盘发言，请等待游戏进入可以盘发言的阶段。"
    const seat = Number(review[1])
    const records = speechHistory.bySeat(seat)
    if (records.length === 0) return "本局尚未记录" + seat + "号玩家的发言。"
    return seat + "号玩家从开局至今的发言：\n" + records.map(record =>
      speechPhaseLabel(record.round, record.overtime) + "｜" + record.text,
    ).join("\n")
  })
  ctx.guild().middleware(async (session: Session, next) => {
    let str_start = session.content.replace(/\s/g, "")
    const startRequested = str_start === "卧底" || str_start === "卧底，启动！"
    if (!game_off) {
      if (!startRequested) return next()
      // A plugin instance may receive events from several bot connections.
      // Once a game is bound, a start command from another platform/selfId is
      // not this game's command and must be left for that connection's route.
      const sameBot = gameRoute.matchesBot(session.platform, session.selfId)
      const sameRoute = gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
      if (!sameBot) return next()
      if (sameRoute) {
        return session.userId === hostid
          ? "当前已有一局卧底正在进行中。如需重开，请先发送“停止卧底”。"
          : "当前已有一局卧底正在进行中，请继续当前游戏。"
      }
      else {
        return "当前机器人已在其他群进行一局卧底，暂时无法再次开局。"
      }
    }
    if (startRequested) {
      //if(str_start===h("at", { id: session.selfId }) + "卧底"){
      // A new game is the default media-retention boundary for this bot.  Wait
      // for the previous archive attempt first so a queued snapshot cannot
      // reintroduce media after the cleanup pass.  Cleanup is best-effort and
      // never prevents a new game from starting.
      if (mediaRetention.mode !== 'permanent') {
        await Promise.allSettled([...pendingHistoryWrites])
        await historyPersistence.retry().catch(error => ctx.logger.warn('历史媒体清理前的待重试存档未完成：%s', safeErrorSummary(error)))
        await historyStore.pruneMediaForBot(session.platform, session.selfId, Date.now())
          .catch(error => ctx.logger.warn('历史多媒体清理未完成：%s', safeErrorSummary(error)))
      }
      const isSandbox = session.platform.startsWith("sandbox:")
      score_enabled = (config.enablePersistentScoring ?? true) && !isSandbox
      gameRoute.bind(session.platform, session.guildId, session.bot)
      gameTimers.advanceEpoch()
      preDealRevision += 1
      modeInteraction.reset("classic")
      heroesEnabled = config.heroesByDefault ?? true
      speechHistory.clear()
      publicHeroReveals.clear()
      cancelDeerTimers()
      cancelTurtleTimers()
      game_off = false
      wait_off = false
      add_player = config.allowLateJoinByDefault ?? true
      flag_white = false
      flag_white_perm = false
      flag_start = false
      flag_ask_white = false
      white_only = false
      whiteSurvivalSettlementPending = false
      boom_pending = false
      ask_nice = false
      ask_nice_instr = false
      ask_uc = false
      ask_uc_instr = false
      ask_white_instr = false
      flag_fati = false
      flag_ask_timeout = false
      flag_notify = config.realtimeVoteNoticeDefault ?? false
      stalemate.reset()
      set_mode = false
      flag_just_vote = false
      set_flag = Array(6).fill(false)
      boom_state = 0
      increment = 0
      timeout_mode = 0
      player = []
      kickout = []
      nv_out = []
      player_name = []
      player_copy = []
      player_id_copy = []
      profileIdByNickname.clear()
      identityByUserId.clear()
      accountIdByNickname.clear()
      releaseAccountLeases()
      gameInstanceId = randomUUID()
      gameStartedAt = Date.now()
      historyRecorder = undefined
      order = []
      uc = []
      uc_copy = []
      uc_num = 0
      white = 0
      white_copy = 0
      quan_diff = 0
      replacementRequest.reset()
      formerSeatByName.clear()
      gameTimers.cancel(timer_replace)
      item1 = ""
      item1_copy = ""
      //alias1 = []
      instr1 = ""
      item2 = ""
      item2_copy = ""
      //alias2 = []
      instr2 = ""
      instr3 = ""
      sumup = ""
      boomname = ""
      ann = []
      add_ann = []
      vote = []
      poll = []
      round = 0
      add_flag = false
      add_indices = []
      add_indices_0 = []
      add_vote = []
      add_voter = []
      unvote = 0
      fa_tot = 0
      quan_tot = 0
      skip = 0
      lockedVoteSeats.clear()
      votePhaseSerial = 0
      waiver = 0
      hostid = session.userId
      try {
        hostname = await ensurePlayerNickname(session)
        if (!await occupyPlayer(session.userId, hostname, session.platform)) return
      } catch (error) {
        end_game({ kind: 'aborted', reason: 'system-error' })
        ctx.logger.warn('主持人账号初始化失败：%s', safeErrorSummary(error))
        return '账号服务暂不可用，本局未开始，请稍后重试。'
      }
      annstr = "本轮发言结果：\n"
      vstr = "本轮投票结果：\n"
      scoreService.reset()
      whiteConsolationHandled = false
      ptsstr = score_enabled ? "本局计分结算：" : "沙盒测试局不写入积分，模拟结算："
      heros = []
      heroState = createGameHeroState()
      hs = heroState.legacy
      flag_fa = []
      huangTaiJiQuanMode = null
      fa = []
      quan = []
      shield = []
      vote_num = []
      timer_uc = setGameTimeout(()=>{
        const guildId = gameRoute.guildId
        end_game({ kind: 'aborted', reason: 'setup-timeout' })
        sumup += "凑人超时，卧底自动终止。"
        notifyGroup(session, "凑人超时，卧底自动终止。", "凑人超时通知", guildId)
      }, timeout_for_uc)
      const gatherNotice = score_enabled
        ? "开始凑人，请扣1"
        : "开始凑人，请扣1（沙盒测试模式：本局不会写入积分）"
      const specialModeHints = [
        enabledSpecialModes.has('deer') ? '鹿模式' : null,
        enabledSpecialModes.has('turtle') ? '龟模式' : null,
      ].filter(Boolean)
      if (specialModeHints.length === 0) return gatherNotice + "\n本实例仅启用经典模式，人数足够后由主持人发送“开始”。"
      return gatherNotice + "\n主持人可在发题前选择模式：发送“"
        + specialModeHints.join('”或“')
        + "”；不选择则为经典模式。人数足够后也可直接发送“开始" + specialModeHints.join('”或“开始') + "”。"
    }
    else {
      return next()
    }
  })
  const prepareGatheringPlayer = async (session: Session, inputEpoch: number): Promise<
    { nickname: string } | { error: string } | null
  > => {
    try {
      const nickname = await ensurePlayerNickname(session)
      if (game_off || inputEpoch !== gameTimers.epoch) return null
      if (personAlreadyRecorded(nickname)) return { error: "你或同一真人的其他账号已在本局，不能重复加入。" }
      if (!await occupyPlayer(session.userId, nickname, session.platform)) return null
      if (game_off || inputEpoch !== gameTimers.epoch) {
        releasePlayerLease(session.userId)
        return null
      }
      return { nickname }
    }
    catch (error) {
      if (game_off || inputEpoch !== gameTimers.epoch) return null
      ctx.logger.warn('玩家加入初始化失败：%s', safeErrorSummary(error))
      return { error: "本次加入未成功，账号服务暂不可用或账号关系发生变化；请稍后重新发送半角数字 1。" }
    }
  }
  const shouldQueueGatheringInput = (session: Session): boolean => {
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return false
    if (wait_off && !flag_start) return false
    const content = session.content.replace(/\s/g, "")
    const selectedMode = parseGameModeSelection(session.content)
    const shortcutMode = parseModeStart(session.content)
    if (session.userId === hostid && !flag_fati && selectedMode) return true
    if (session.userId === hostid && (content === "普通局" || content === "武将局" || (flag_start && content === "自定义"))) return true
    if (!wait_off && !flag_start && content === "１") return true
    if (session.userId === hostid && flag_start && (
      content === "停止加人" || content === "关闭加人" || content === "结束加人"
      || content === "终止加人" || content === "不加人了" || content === "不加了"
      || content === "开启加人" || content === "开始加人" || content === "继续加人"
    )) return true
    if (content === "1" && !flag_start) return true
    if (content === "1" && flag_start && session.userId !== hostid && player.indexOf(session.userId) === -1) return true
    // Route host start requests through the roster queue even when the
    // minimum count is not true yet.  The queued task evaluates the latest
    // player list after earlier concurrent `1` messages have been processed;
    // deciding here would let a start sent in the same burst fall through to
    // ChatLuna/Character before those joins become visible.
    if (session.userId === hostid && !flag_start
      && (content === "开始" || shortcutMode !== null)) return true
    return session.userId === hostid && flag_start && content.indexOf("踢出") === 0
  }

  ctx.guild().middleware(async (session: Session, next) => {//凑人阶段
    // Do not put ordinary group traffic into the game queue.  In particular,
    // a ChatLuna/Character response must not hold the roster lock.
    if (!shouldQueueGatheringInput(session)) return next()
    const inputEpoch = gameTimers.epoch
    const result = await gameInputQueue.run(async () => {
      if (inputEpoch !== gameTimers.epoch || !shouldQueueGatheringInput(session)) return forwardGameInput
      if (wait_off && !flag_start) return forwardGameInput
    const selectedMode = parseGameModeSelection(session.content)
    if (session.userId === hostid && !flag_fati && selectedMode) {
      if (selectedMode !== 'classic' && !enabledSpecialModes.has(selectedMode)) {
        return "本实例未启用" + (selectedMode === 'deer' ? '鹿模式' : '龟模式') + "。"
      }
      if (flag_start) {
        if (modeInteraction.mode === selectedMode) return "本局已是" + modeInteraction.module.label + "。"
        resetPreDealSetup()
        modeInteraction.reset(selectedMode)
        cancelDeerTimers()
        cancelTurtleTimers()
        pendingAction.clear()
        recoverablePendingPrompts.clear()
        await restartPreDealSetupAfterRosterChange(session)
        return "已切换为" + modeInteraction.module.label + "，旧题面及自定义设置已清空，请重新配置。"
      }
      modeInteraction.reset(selectedMode)
      return "已选择" + modeInteraction.module.label + "，发题前仍可切换。"
    }
    const shortcutMode = parseModeStart(session.content)
    if (session.userId === hostid && !flag_start && shortcutMode && shortcutMode !== 'classic' && !enabledSpecialModes.has(shortcutMode)) {
      return "本实例未启用" + (shortcutMode === 'deer' ? '鹿模式' : '龟模式') + "。"
    }
    if (session.userId === hostid && !flag_start && shortcutMode) modeInteraction.reset(shortcutMode)
    const startRequestedDuringGather = session.content.replace(/\s/g, "") === "开始" || shortcutMode !== null
    let str_nos = session.content.replace(/\s/g, "")
    if (!wait_off && !flag_start && str_nos === "１") {
      return "全角“１”不会加入游戏；如要参与请发送半角数字 1。"
    }
    if (session.userId === hostid && !flag_start && (str_nos === "普通局" || str_nos === "武将局")) {
      heroesEnabled = str_nos === "武将局"
      return heroesEnabled ? "已设定本局为武将局。" : "已设定本局为无武将普通局。"
    }
    if (session.userId === hostid && flag_start && add_player && (str_nos === "停止加人" || str_nos === "关闭加人" || str_nos === "结束加人" || str_nos === "终止加人" || str_nos === "不加人了" || str_nos === "不加了")) {
      add_player = false
      return ("已关闭加人模式，发送“开启加人”以继续加人。")
    }
    else if (session.userId === hostid && flag_start && (!add_player) && (str_nos === "开启加人" || str_nos === "开始加人" || str_nos === "继续加人")) {
      add_player = true
      return ("已开启加人模式，群友可继续扣1。")
    }
    if (str_nos === "1" && !flag_start) {
      if (player.indexOf(session.userId) == -1 && session.userId !== hostid) {
        const prepared = await prepareGatheringPlayer(session, inputEpoch)
        if (!prepared) return
        if ('error' in prepared) return prepared.error
        const joiningName = prepared.nickname
        player.push(session.userId)
        player_id_copy.push(session.userId)
        player_name.push(joiningName)
        player_copy.push(joiningName)
      }
    }
    else {
      if ((startRequestedDuringGather && player.length >= config.minPlayers && session.userId === hostid && !flag_start) || (str_nos === "1" && player.indexOf(session.userId) === -1 && session.userId !== hostid) || (session.userId === hostid && str_nos.indexOf("踢出") === 0 && flag_start)) {
        if (str_nos === "1") {
          if (!add_player) return ("主持人已经关闭了加人，你无法再加入。")
          if (flag_fati) return ("你来晚了，我已经在发题了")
          const prepared = await prepareGatheringPlayer(session, inputEpoch)
          if (!prepared) return
          if ('error' in prepared) return prepared.error
          const joiningName = prepared.nickname
          player.push(session.userId)
          player_id_copy.push(session.userId)
          player_name.push(joiningName)
          player_copy.push(joiningName)
          notifySession(session, joiningName + "加入游戏，游戏自动重置。")
          notifyPrivate(session, hostid, joiningName + "加入游戏，游戏自动重置。请主持人重新在群聊中确定是否加入白板，并重新输入词条。", "配置阶段加人重置提示")
          resetPreDealSetup()
          armSetupTimeout(session)
        }
        else if (str_nos.indexOf("踢出") === 0) {
          if (flag_fati) return ("不是哥们，我已经在发题了，你这时候踢人？")
          let outcast = Number(str_nos.replace("踢出", ""))
          let out_index = order.indexOf(outcast)
          if (out_index !== -1) {
            notifySession(session, outcast + "号玩家" + player_name[out_index] + "被主持人踢出，主持人还未发题，游戏自动重置。")
            releasePlayerLease(player[out_index])
            player.splice(out_index, 1)
            player_id_copy.splice(outcast - 1, 1)
            player_copy.splice(outcast - 1, 1)
            player_name.splice(out_index, 1)
            resetPreDealSetup()
          armSetupTimeout(session)
          }
          else return
        }
        gameTimers.cancel(timer_uc)
        armSetupTimeout(session)
        notifySession(session, "开局配置阶段限时" + Math.max(30, Number(config.setupTimeout ?? 900) || 900) / 60 + "分钟。")
        notifySession(session, "本局为" + player.length + "人局（默认" + (heroesEnabled ? "加入武将" : "普通局无武将") + "；主持人可在发题前发送“普通局”或“武将局”调整，也可发送“自定义”自行配置。）")
        if (modeInteraction.mode !== "classic") notifySession(session, "本局为" + modeInteraction.module.label + "，发题前仍可切换模式。")
        flag_start = true
        sumup += "上局为" + player.length + "人局，主持人为" + hostname + "。\n"
        wait_off = true
        fa = Array(player.length).fill(0)
        flag_fa = Array(player.length).fill(0)
        huangTaiJiQuanMode = null
        quan = Array(player.length).fill(0)
        shield = Array(player.length).fill(false)
        order = Array(player.length)
        ann = Array(player.length)
        vote.push(Array(player.length))
        poll = Array(player.length).fill(0)
        vote_num = Array(player.length).fill(1)
        round += 1
        let str2 = "玩家顺序：\n"
        for (let i = 1; i <= player.length; i++) {
          str2 += i + "号玩家：" + player_name[i - 1] + "\n"
          order[i - 1] = i
        }
        notifySession(session, str2)
        sumup += str2
        randomizeHeroesForRoster()
        if (modeInteraction.module.allowsWhite && player.length >= config.whiteMinPlayers) {
          notifySession(session, "是否加入白板？请主持人发送“是”或“否”")
          flag_ask_white = true
        }
        else {
          uc = []
          uc_num = Math.floor(player.length / config.undercoverDivisor)
          notifySession(session, "本局有" + (player.length - uc_num) + "个好人，" + uc_num + "个卧底，无白板。")
          let str1 = ""
          while (uc.length < uc_num) {
            var tempid = getRandomIntInclusive(1, player.length)
            if (uc.indexOf(tempid) == -1) {
              uc.push(tempid)
              str1 += tempid + "号玩家" + player_name[tempid - 1] + "，"
            }
          }
          uc_copy = uc.map((x) => x)
          str1 = str1.slice(0, -1)
          disp_off = false
          sumup += "上局游戏" + str1 + "为卧底。\n"
          notifyPrivate(session, hostid, "你为本局主持人，随机生成本局游戏" + str1 + "为卧底。", "主持人随机身份提示")
          notifyPrivate(session, hostid, hostPrimaryContentPrompt(), "主持人发题提示")
          ask_nice = true
        }
      }
      else if (session.userId === hostid && (str_nos === "普通局" || str_nos === "武将局")) {
        heroesEnabled = str_nos === "武将局"
        if (heroesEnabled && heros.every(value => value === 0)) randomizeHeroesForRoster()
        else if (!heroesEnabled) heros = Array(hero_num).fill(0)
        return heroesEnabled ? "已设定本轮为武将局。" : "已设定本轮为无武将普通局。"
      }
      else return forwardGameInput
    }
    })
    return result === forwardGameInput ? next() : result
  })
  ctx.guild().middleware((session, next) => {
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_askwh = session.content.replace(/\s/g, "")
    if (!flag_ask_white || session.userId !== hostid || str_askwh === "停止卧底" || str_askwh === "中止卧底" || str_askwh === "终止卧底" || str_askwh === "结束卧底" || str_askwh === "关闭卧底") return next()
    uc_num = Math.floor(player.length / config.undercoverDivisor)
    if (str_askwh === "否") {
      flag_white = false
      flag_white_perm = false
      notifySession(session, "本局有" + (player.length - uc_num) + "个好人，" + uc_num + "个卧底，无白板。")
    }
    else if (str_askwh === "是") {
      flag_white = true
      flag_white_perm = true
      notifySession(session, "本局有" + (player.length - uc_num - 1) + "个好人，" + uc_num + "个卧底，1个白板。")
    }
    else return ("不识别的语句，请主持人发送“是”或“否”。")
    flag_ask_white = false
    uc = []
    let str1 = ""
    let str2 = ""
    while (uc.length < uc_num) {
      var tempid = getRandomIntInclusive(1, player.length)
      if (uc.indexOf(tempid) == -1) {
        uc.push(tempid)
        str1 += tempid + "号玩家" + player_name[tempid - 1] + "，"
      }
    }
    uc_copy = uc.map((x) => x)
    str1 = str1.slice(0, -1)
    disp_off = false
    if (flag_white) {
      while (white === 0) {
        var tempid = getRandomIntInclusive(1, player.length)
        if (uc.indexOf(tempid) == -1 && tempid !== heros[HERO.ZHANG_XIAN_ZHONG] && tempid !== heros[HERO.SHI_KE_FA]) {
          white = tempid
          str2 += tempid + "号玩家" + player_name[tempid - 1]
        }
      }
      white_copy = white
      sumup += "上局游戏" + str1 + "为卧底，" + str2 + "为白板。\n"
      notifyPrivate(session, hostid, "你为本局主持人，随机生成本局游戏" + str1 + "为卧底，" + str2 + "为白板。", "主持人含白板身份提示")
    }
    else {
      sumup += "上局游戏" + str1 + "为卧底。\n"
      notifyPrivate(session, hostid, "你为本局主持人，随机生成本局游戏" + str1 + "为卧底。", "主持人随机身份提示")
    }
    ask_nice = true
    notifyPrivate(session, hostid, hostPrimaryContentPrompt(), "主持人发题提示")
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//鹿模式选人与主持审核
    if (game_off || modeInteraction.mode !== "deer" || !matchesActiveSession(session)) return next()
    const state = modeInteraction.state
    if (state.kind !== "deer" || isEmpty(state.commonTerm)) return next()
    if (session.userId === hostid) {
      const trimmed = session.content.trim()
      const seatMatch = trimmed.match(/^(\d+)\s*(是|否)(.*)$/s)
      const quoteReference = resolveModeMessageReference({
        quote: session.quote,
        eventQuote: session.event.message?.quote,
        rawMessage: session.event._data?.message,
        onebotMessage: (session as any).onebot?.message,
      })
      const quoteDecision = quoteReference
        ? trimmed.match(/^(是|否)(?:[\s：:，,]+(.*))?$/s)
        : null
      if (!seatMatch && !quoteDecision) {
        if (/^(?:是|否)(?:[\s，,:：]+.*)?$/s.test(trimmed)) {
          return "未识别到有效的引用消息，请重新引用待审核提示，或发送“座位号是/否”。"
        }
        return next()
      }
      const approved = (seatMatch?.[2] ?? quoteDecision?.[1]) === "是"
      const reason = (seatMatch?.[3] ?? quoteDecision?.[2])?.replace(/^[\s：:，,]+/, "").trim()
      const review = modeInteraction.reviewDeerSelection({
        seat: seatMatch ? Number(seatMatch[1]) : undefined,
        requestMessageId: quoteReference?.messageId,
        requestMessageContent: quoteReference?.content,
        approved,
        reason,
      })
      if (review.kind === "not-found") return ("没有找到对应的待审核选人，请检查座位号或引用消息。")
      if (review.kind === "not-pending") return ("该座位当前没有待审核的选人。")
      if (review.kind === "approved") {
        capture(r => r.choice(review.selection.seat, review.selection.candidate ?? null))
        syncDeerHostReviewClock(session, true)
        if (!ann_off) armDeerSpeechClock(session, review.selection.seat)
        messages.bestEffort(
          `鹿模式${review.selection.seat}号审核通过通知`,
          () => session.bot.sendPrivateMessage(review.selection.userId, "主持人已通过你的选人“" + review.selection.candidate + "”。"),
        )
        return "已通过" + review.selection.seat + "号玩家的选人；该玩家现在可以发言。"
      }
      syncDeerHostReviewClock(session, true)
      armDeerPlayerSelectionClock(session, review.selection.seat)
      messages.bestEffort(
        `鹿模式${review.selection.seat}号审核驳回通知`,
        () => session.bot.sendPrivateMessage(review.selection.userId, "主持人驳回了你的选人，请重新提交。" + (review.reason ? "原因：" + review.reason : "")),
      )
      return ("已驳回" + review.selection.seat + "号玩家的选人。")
    }
    const selection = [...state.selections.values()].find(value => value.userId === session.userId)
    if (!selection) return next()
    if (selection.status === "approved") return next()
    const hadPendingReview = modeInteraction.deerProgress().pendingHost.length > 0
    const submitted = modeInteraction.submitDeerSelection(session.userId, session.content, Date.now())
    if (submitted.kind === "empty") return ("选人不能为空，请重新发送。")
    if (submitted.kind === "common-term") return ("不能选择易混本身，请重新选择符合阵营规则的词条。")
    if (submitted.kind === "pending") return ("你的选人正在等待主持人审核，不能覆盖；如需重选，请先等待主持人驳回。")
    if (submitted.kind !== "accepted") return next()
    cancelDeerSelectionClock(submitted.selection.seat)
    modeInteraction.recordDeerRequestMessage(
      submitted.selection.seat,
      undefined,
      deerHostReviewPrompt(submitted.selection.seat),
    )
    syncDeerHostReviewClock(session, !hadPendingReview)
    const request = deerHostReviewPrompt(submitted.selection.seat)!
    let requestIds: string[] = []
    const delivered = await messages.state(
      `鹿模式${submitted.selection.seat}号主持审核提示`,
      async () => {
        const messageIds = await session.bot.sendPrivateMessage(hostid, request)
        requestIds = (Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean).map(String)
      },
    )
    if (delivered) {
      modeInteraction.recordDeerRequestMessage(submitted.selection.seat, requestIds, request)
    }
    else {
      await messages.state(
        `鹿模式${submitted.selection.seat}号审核群内补救提示`,
        () => session.bot.sendMessage(
          gameRoute.guildId,
          `鹿模式${submitted.selection.seat}号玩家的主持审核私聊发送失败；流程仍在等待，主持人请私聊发送“待处理操作”补取。`,
        ),
      )
    }
    return ("已提交“" + submitted.selection.candidate + "”，请等待主持人审核。")
  })
  ctx.guild().middleware(async (session, next) => {//鹿模式重置选人
    if (game_off || modeInteraction.mode !== "deer" || session.userId !== hostid || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const match = session.content.replace(/\s/g, "").match(/^重置选人(\d+)$/)
    if (!match) return next()
    const seat = Number(match[1])
    if (round !== 1) return ("只有第一轮尚未发言的玩家可以重置选人。")
    if (deerSeatHasSpoken(seat)) return ("该玩家已经完成第一轮发言，不能再重置选人。")
    const selection = modeInteraction.resetDeerSelection(seat)
    if (!selection) return ("该座位是白板、已离场或不存在，无需选人。")
    capture(r => r.choice(seat, null))
    syncDeerHostReviewClock(session, false)
    cancelDeerSpeechClock(selection.seat)
    armDeerPlayerSelectionClock(session, selection.seat)
    await sendPrivateNotice(session, selection.userId, "主持人要求你重新选人，请按原阵营规则重新提交。", `鹿模式${selection.seat}号重选通知`)
    return ("已重置" + selection.seat + "号玩家的选人。")
  })
  ctx.guild().middleware((session, next) => {//谁没选人
    if (game_off || modeInteraction.mode !== "deer" || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const content = session.content.replace(/[《》·\s]/g, "").replace(regex, "")
    if (content.indexOf("谁") === -1 || (content.indexOf("没选人") === -1 && content.indexOf("没有选人") === -1)) return next()
    const messageId = session.messageId ? String(session.messageId) : ""
    if (messageId && deerHandledProgressMessageIds.has(messageId)) return
    if (messageId) deerHandledProgressMessageIds.add(messageId)
    if (!modeInteraction.deerFirstRoundStarted || Date.now() < deerProgressAvailableAt) {
      const remaining = Math.max(1, Math.ceil((deerProgressAvailableAt - Date.now()) / 1000))
      return "鹿模式选人阶段尚未达到催促时间，请约" + remaining + "秒后再查询。"
    }
    deerLastSelectionReminderAt = Date.now()
    deerLastGroupProgressSignature = deerProgressSignature()
    return deerProgressText()
  })
  ctx.exclude(ctx.guild()).middleware((session, next) => {//主持人发题状态与回退
    if (game_off || session.userId !== hostid || !matchesActiveSession(session)) return next()
    const input = session.content.replace(/\s/g, "")
    if (!["发题状态", "重发发题提示", "发题上一步", "重新发题"].includes(input)) return next()
    if (input === "发题状态") return setupStatusText()
    if (flag_fati) return "正在逐人发送题面和武将牌，不能回退或重置发题步骤；发送完成后可让玩家使用“重发我的信息”。"
    if (currentSetupPromptStep() === "idle") return "当前尚未进入题面输入步骤，请先完成白板、身份和武将配置。"
    if (input === "重发发题提示") return setupPromptText()
    if (input === "重新发题") {
      resetTopicSetup()
      armSetupTimeout(session)
      return "已清空本次题面输入并重新开始。\n" + setupPromptText()
    }
    if (!rewindTopicSetup()) return "当前已经是第一步，无法再返回上一步。\n" + setupPromptText()
    armSetupTimeout(session)
    return "已返回上一步；该步及之后输入已清除。\n" + setupPromptText()
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//发题阶段
    if (game_off || session.userId !== hostid || !matchesActiveSession(session)) return next()
    if (disp_off) return next()
    const inputEpoch = gameTimers.epoch, inputRevision = preDealRevision
    const result = await gameInputQueue.run(async () => {
      if (game_off || inputEpoch !== gameTimers.epoch || !matchesActiveSession(session)) return forwardGameInput
      if (inputRevision !== preDealRevision) return "配置已重置，请按最新发题提示重新输入。"
      if (disp_off) return forwardGameInput
    if (modeInteraction.mode === "turtle") {
      if (ask_nice) {
        item1 = session.content.trim()
        if (isEmpty(item1)) return ("汤面不能为空，请重新输入。")
        ask_nice = false
        ask_nice_instr = true
        return ("请输入龟模式好人阵营的实际词条；该内容只用于主持回答与赛后总结，不会发给玩家：")
      }
      if (ask_nice_instr) {
        item2 = session.content.trim()
        if (isEmpty(item2)) return ("好人实际词条不能为空，请重新输入。")
        ask_nice_instr = false
        ask_uc = true
        return ("请输入龟模式卧底阵营的实际词条；该内容只用于主持回答与赛后总结，不会发给玩家：")
      }
      if (ask_uc) {
        instr1 = session.content.trim()
        if (isEmpty(instr1)) return ("卧底实际词条不能为空，请重新输入。")
        ask_uc = false
        armTimeoutSelection(session)
        return timeoutSettingsPrompt
      }
    }
    if (modeInteraction.mode === "deer") {
      if (ask_nice) {
        item1 = session.content.trim()
        if (isEmpty(item1)) return ("好人规则不能为空，请重新输入。")
        ask_nice = false
        ask_nice_instr = true
        return ("请输入鹿模式卧底阵营的选人/选词规则：")
      }
      if (ask_nice_instr) {
        item2 = session.content.trim()
        if (isEmpty(item2)) return ("卧底规则不能为空，请重新输入。")
        ask_nice_instr = false
        ask_uc = true
        return ("请输入鹿模式易混（不能作为玩家选词，将公开到群聊并私聊给所有玩家）：")
      }
      if (ask_uc) {
        instr3 = session.content.trim()
        if (isEmpty(instr3)) return ("易混不能为空，请重新输入。")
        ask_uc = false
        instr1 = item1
        instr2 = item2
        armTimeoutSelection(session)
        return timeoutSettingsPrompt
      }
    }
    if (ask_nice) {
      item1 = session.content
      ask_nice = false
      ask_nice_instr = true
      return ("请输入好人词条" + item1 + "雷点：")
    }
    else if (ask_nice_instr) {
      instr1 = session.content
      ask_nice_instr = false
      ask_uc = true
      return ("请输入卧底词条(不用写雷点，稍后会问；时代等注意事项可以在人物名后使用任意标点符号分隔标注，请不要在词条名中夹杂除·与书名号以外的任何标点符号)：")
    }
    else if (ask_uc) {
      item2 = session.content
      ask_uc = false
      ask_uc_instr = true
      return ("请输入卧底词条" + item2 + "雷点：")
    }
    else if (ask_uc_instr) {
      instr2 = session.content
      ask_uc_instr = false
      if (flag_white) {
        ask_white_instr = true
        return ("请输入白板提示：")
      }
      else {
        armTimeoutSelection(session)
        return timeoutSettingsPrompt
      }
    }
    else if (ask_white_instr) {
      instr3 = session.content
      ask_white_instr = false
      armTimeoutSelection(session)
      return timeoutSettingsPrompt
    }
    else if (flag_ask_timeout) {
      if (session.content.replace(/\s/g, "") === "1") {
        flag_ask_timeout = false
        timeout_mode = 1
        notifyGroup(session, "本局游戏发言阶段限时" + config.speakTimeoutMode1 / 60 + "分钟；投票阶段限时" + config.voteTimeout / 60 + "分钟。", "限时模式通知")
      }
      else if (session.content.replace(/\s/g, "") === "2") {
        flag_ask_timeout = false
        timeout_mode = 2
        notifyGroup(session, "本局游戏第一轮发言（加时除外）不限时，其余发言阶段限时" + config.speakTimeoutMode2 / 60 + "分钟；投票阶段限时" + config.voteTimeout / 60 + "分钟。", "限时模式通知")
      }
      else if (session.content.replace(/\s/g, "") === "3") {
        flag_ask_timeout = false
        timeout_mode = 3
        notifyGroup(session, "本局游戏发言阶段限时为在场人数×" + config.speakTimeoutMode3PerPlayer / 60 + "分钟；投票阶段限时" + config.voteTimeout / 60 + "分钟。", "限时模式通知")
      }
      else if (session.content.replace(/\s/g, "") === "4") {
        flag_ask_timeout = false
        timeout_mode = 4
        notifyGroup(session, "本局游戏发言阶段不限时；投票阶段限时" + formatConfiguredDuration(config.voteTimeout) + "。", "限时模式通知")
      }
      else if (session.content.replace(/\s/g, "") === "5") {
        flag_ask_timeout = false
        timeout_mode = 5
        notifyGroup(session, "本局游戏发言阶段与投票阶段均无时间限制。", "限时模式通知")
      }
      else return ("不识别的语句，请主持人选择1-5的序号。")
      gameTimers.cancel(timer_ask_timeout)
      return finishTopicSetup(session)
    }
    else if (flag_fati) {
      return("正在发题，无法进行操作。")
    }
    else {
      const guildId = gameRoute.guildId
      end_game({ kind: 'aborted', reason: 'system-error' })
      notifyGroup(session, "出现未知错误，卧底已结束。", "开局配置异常通知", guildId)
      return
    }
    })
    return result === forwardGameInput ? next() : result
  })
  ctx.guild().middleware((session, next) => {//自定义模式
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId) || session.userId !== hostid || !flag_start) return next()
    let str_nos = session.content.replace(/\s/g, "")
    if (str_nos === "自定义") {
      disp_off = true
      flag_ask_white = false
      ask_nice = false
      ask_nice_instr = false
      ask_uc = false
      ask_uc_instr = false
      ask_white_instr = false
      uc = []
      round = 1
      uc_num = 0
      white = 0
      white_copy = 0
      item1 = ""
      item1_copy = ""
      instr1 = ""
      item2 = ""
      item2_copy = ""
      instr2 = ""
      instr3 = ""
      sumup = ""
      heros = []
      heroState = createGameHeroState()
      hs = heroState.legacy
      set_mode = true
      notifyPrivate(session, hostid, "本局为" + player.length + "人局，请主持人输入本局游戏的卧底数量：", "自定义模式卧底数量提示")
      sumup = "上局为" + player.length + "人局，主持人为" + hostname + "。\n"
      let str2 = "玩家顺序：\n"
      for (let i = 1; i <= player.length; i++) {
        str2 += i + "号玩家：" + player_name[i - 1] + "\n"
        order[i - 1] = i
      }
      notifySession(session, str2)
      sumup += str2
      set_flag[0] = true
      return ("进入自定义模式，请主持人在私聊中确定本局阵营设置以及武将设置情况")
    }
    else return next()
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {
    if (!set_mode || session.userId !== hostid || !matchesActiveSession(session)) return next()
    const inputEpoch = gameTimers.epoch, inputRevision = preDealRevision
    const result = await gameInputQueue.run(async () => {
      if (game_off || inputEpoch !== gameTimers.epoch || !matchesActiveSession(session)) return forwardGameInput
      if (inputRevision !== preDealRevision) return "配置已重置，请按最新发题提示重新输入。"
      if (!set_mode) return forwardGameInput
    let str_nos = session.content.replace(/\s/g, "")
    let host_num = Number(str_nos)
    if (set_flag[0]) {
      if (isEmpty(host_num) || host_num <= 0 || host_num > player.length) return ("不识别的语句，请重新输入")
      if (host_num > player.length / 2) return ("呃呃，卧底疑似有点太多了")
      uc_num = host_num
      set_flag[0] = false
      if (modeInteraction.mode === "turtle") {
        flag_white = false
        flag_white_perm = false
        set_flag[2] = true
        return ("龟模式不能加入白板。请主持人依次输入卧底玩家的玩家序号（一次只发一个数字）")
      }
      set_flag[1] = true
      return ("请主持人选择本局游戏是否加入白板（发送是或否）")
    }
    else if (set_flag[1]) {
      if (str_nos === "是") {
        flag_white = true
        flag_white_perm = true
      }
      else if (str_nos === "否") {
        flag_white = false
        flag_white_perm = false
      }
      else return ("不识别的语句，请重新输入")
      set_flag[1] = false
      set_flag[2] = true
      return ("请主持人依次输入卧底玩家的玩家序号（一次只发一个数字）")
    }
    else if (set_flag[2]) {
      if (isEmpty(host_num) || host_num <= 0 || host_num > player.length || uc.indexOf(host_num) !== -1) return ("不识别的语句，请重新输入")
      uc.push(host_num)
      uc_copy.push(host_num)
      notifySession(session, "已记录" + host_num + "号玩家" + player_name[host_num - 1] + "为卧底。")
      if (uc.length === uc_num) {
        set_flag[2] = false
        if (flag_white) {
          set_flag[3] = true
          return ("请输入白板玩家的序号：")
        }
        else {
          set_flag[4] = true
          return ("请确定是否要加入武将牌？（发送是或否）")
        }
      }
      else return
    }
    else if (set_flag[3]) {
      if (isEmpty(host_num) || host_num <= 0 || host_num > player.length || uc.indexOf(host_num) !== -1) return ("不识别的语句，请重新输入")
      white = host_num
      white_copy = host_num
      notifySession(session, "已记录" + host_num + "号玩家" + player_name[host_num - 1] + "为白板。")
      set_flag[3] = false
      set_flag[4] = true
      return ("请确定是否要加入武将牌？（发送是或否）")
    }
    else if (set_flag[4]) {
      heros = Array(hero_num).fill(0)
      if (str_nos === "是") {
        set_flag[5] = true
        set_flag[4] = false
        return ("请主持人输入武将" + hero_name[HERO.ZHANG_XIAN_ZHONG] + "的玩家序号：（发送“否”或“0”以设置不加入该武将）")
      }
      else if (str_nos === "否") {
        set_flag[4] = false
        notifySession(session, "已设定本轮为无武将普通局。")
      }
      else return ("不识别的语句，请重新输入")
    }
    else if (set_flag[5]) {
      if (str_nos !== "否" && (isEmpty(host_num) || host_num < 0 || host_num > player.length || (heros.indexOf(host_num) !== -1 && host_num !== 0))) return ("不识别的语句，请重新输入")
      let i = heros.indexOf(0)
      if (str_nos === "否" || host_num === 0) {
        heros[i] = -1
        notifySession(session, "已设置不加入武将" + hero_name[i] + "。")
      }
      else {
        heros[i] = host_num
        notifySession(session, "已设置" + host_num + "号玩家" + player_name[host_num - 1] + "为武将" + hero_name[i] + "。")
      }
      if (i < hero_num - 1) return ("请主持人输入武将" + hero_name[i + 1] + "的玩家序号：（发送“否”或“0”以设置不加入该武将）")
      else {
        for (let k = 0; k < hero_num; k++) {
          if (heros[k] < 0) heros[k] = 0
        }
      }
    }
    set_mode = false
    let str1 = ""
    let str2 = ""
    for (let j = 0; j < uc.length; j++) {
      str1 += uc[j] + "号玩家" + player_name[uc[j] - 1] + "，"
    }
    uc_copy = uc.map((x) => x)
    str1 = str1.slice(0, -1)
    if (flag_white) {
      str2 += white + "号玩家" + player_name[white - 1]
      sumup += "上局游戏" + str1 + "为卧底，" + str2 + "为白板。\n"
      notifySession(session, "自定义设置完毕，本局游戏" + str1 + "为卧底，" + str2 + "为白板。\n")
    }
    else {
      sumup += "上局游戏" + str1 + "为卧底。\n"
      notifySession(session, "自定义设置完毕，本局游戏" + str1 + "为卧底。\n")
    }
    disp_off = false
    ask_nice = true
    return (hostPrimaryContentPrompt())
    })
    return result === forwardGameInput ? next() : result
  })
  const end_game = (
    ending: HistoryEnding = { kind: 'aborted', reason: 'system-error' },
    historyOutcome?: string,
  )=>{
    if (historyRecorder) {
      const recorder = historyRecorder
      historyRecorder = undefined
      const bot = gameRoute.bot, guild = gameRoute.guildId
      try {
        if (historyCaptureFailed) throw new Error('本局采集不完整')
        if (ending.kind === 'aborted' && historyOutcome && recorder.hasPhase()) recorder.outcome(historyOutcome)
        const snapshot = recorder.finish(ending, Date.now(), scoreService.results, config.scoreSystemKey)
        const write = historyPersistence.save(snapshot, historyOptions).then(result => {
          if (result.kind === 'failed' || result.kind === 'queued') notifyBotGroup(
            bot,
            guild,
            result.kind === 'queued' ? '对局历史暂未写入数据库，已保存本地待重试；游戏结束不受影响。' : '对局历史保存失败，请管理员检查日志；游戏结束不受影响。',
            '对局历史保存状态通知',
          )
        }).finally(() => pendingHistoryWrites.delete(write))
        pendingHistoryWrites.add(write)
      } catch (error) {
        ctx.logger.error('对局历史快照失败：%s', safeErrorSummary(error))
        notifyBotGroup(bot, guild, '本局历史采集不完整，未报告保存成功；请管理员检查日志。', '对局历史采集失败通知')
      }
    }
    stalemate.reset()
    rememberDeerReveal()
    historyDepartureReasons.clear()
    cancelDeerTimers()
    cancelTurtleTimers()
    speechPhases.invalidate()
    speechBackfillSeats.clear()
    speechBackfillUsers.clear()
    pendingAction.clear()
    recoverablePendingPrompts.clear()
    voteSettlement.clear()
    gameTimers.advanceEpoch()
    game_off = true
    wait_off = true
    ann_off = true
    vote_off = true
    disp_off = true
    flag_fati = false
    flag_ask_white = false
    flag_ask_timeout = false
    ask_nice = false
    ask_nice_instr = false
    ask_uc = false
    ask_uc_instr = false
    ask_white_instr = false
    set_mode = false
    gameTimers.cancel(timer_replace)
    replacementRequest.reset()
    formerSeatByName.clear()
    boom_pending = false
    flag_just_vote = false
    scoreService.reset()
    whiteSurvivalSettlementPending = false
    profileIdByNickname.clear()
    identityByUserId.clear()
    accountIdByNickname.clear()
    releaseAccountLeases()
    gameInstanceId = ''
    gameRoute.clear()
  }
  ctx.on("dispose", async () => { end_game({ kind: 'aborted', reason: 'restart' }); await Promise.allSettled([...pendingHistoryWrites]) })
  const canSettleWhiteSurvival = (settled: boolean): boolean => settled
    && !(white === heros[HERO.YUAN_CHONG_HUAN]
      && yuanChongHuanModule.retaliationTarget(heroState) !== null)
  const resolveEliminationVictory = async (
    session: Session,
    whiteSurvivalSettled = false,
  ): Promise<ResolutionControl> => {
    const victory = classifyEliminationVictory({
      activePlayerCount: player.length,
      activeUndercoverCount: uc.length,
      whiteActive: flag_white,
      whiteOnly: white_only,
      whiteSurvivalSettled: canSettleWhiteSurvival(whiteSurvivalSettled),
    })
    if (victory === "good") {
      await sendGroupNotice(session, "游戏结束，好人胜利。", "好人胜利通知")
      sumup += "游戏结束，好人胜利。"
      if (round > uc_copy.length + (white_copy === 0 ? 0 : 1) || player_copy.length - player.length - kickout.length > uc_copy.length + (white_copy === 0 ? 0 : 1)) { increment = config.scoreGoodWin }
      else { increment = config.scoreGoodWinSpeedrun }
      for (let i = 0; i < player_copy.length; i++) {
        if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
          await addScore(player_copy[i], increment, 'elimination-good-win')
          ptsstr += player_copy[i] + "，"
        }
      }
      ptsstr = ptsstr.slice(0, -1)
      ptsstr += "加" + increment + "分。"
      await sendScoreSummary(session, 'good')
      end_game({ kind: 'completed', reason: 'elimination', winner: 'good' })
      return endResolution()
    }
    else if (victory === "white") {
      const winningWhiteSeat = white
      await sendGroupNotice(session, "游戏结束，白板胜利。", "白板胜利通知")
      sumup += "游戏结束，白板胜利。"
      increment = config.scoreWhiteWin
      await addScore(player_copy[winningWhiteSeat - 1], increment, 'elimination-white-win')
      ptsstr += player_copy[winningWhiteSeat - 1] + "加" + increment + "分。"
      await sendScoreSummary(session, 'white')
      end_game({ kind: 'completed', reason: 'white-survival', winner: 'white' })
      return endResolution()
    }
    else if (victory === "undercover") {
      await sendGroupNotice(session, "游戏结束，卧底胜利。", "卧底胜利通知")
      sumup += "游戏结束，卧底胜利。"
      increment = config.scoreUndercoverWin
      for (let i = 0; i < player_copy.length; i++) {
        if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
          await addScore(player_copy[i], increment, 'elimination-undercover-win')
          ptsstr += player_copy[i] + "，"
        }
      }
      ptsstr = ptsstr.slice(0, -1)
      ptsstr += "加" + increment + "分。"
      await sendScoreSummary(session, 'undercover')
      end_game({ kind: 'completed', reason: 'elimination', winner: 'undercover' })
      return endResolution()
    }
    return continueResolution()
  }
  const check_game_end = async (session, outplayer, extra, whiteSurvivalSettled = false) => {
    const control = await resolveEliminationVictory(session, whiteSurvivalSettled)
    if (control.kind === "game-end") return
    await extra(session, outplayer)
  }
  const splice_player = (outplayer, is_kickout, is_check_white) => {
    capture(r => r.leave(outplayer, historyDepartureReasons.get(outplayer) ?? (is_kickout ? 'kick' : 'skill'), Date.now()))
    historyDepartureReasons.delete(outplayer)
    const result = removeRosterSeat({
      activeUserIds: player,
      activeNames: player_name,
      fixedNames: player_copy,
      fixedUserIds: player_id_copy,
      activeSeats: order,
      activeUndercoverSeats: uc,
      whiteSeat: white,
      whiteActive: flag_white,
      whiteOnly: white_only,
    }, {
      seat: outplayer,
      kicked: is_kickout,
      checkWhiteOnly: is_check_white && (!add_flag || add_indices.some(index => order[index] === white)),
    })
    stalemate.reset()
    if (modeInteraction.mode === "turtle" && !ann_off) {
      modeInteraction.removeTurtleSeat(outplayer)
      cancelTurtleSeatTimers(outplayer)
    }
    if (is_kickout) {
      if (!isEmpty(result.departingName)) formerSeatByName.set(personKey(result.departingName), outplayer)
      if (modeInteraction.mode === "deer") modeInteraction.removeDeerSeat(outplayer)
      cancelDeerSelectionClock(outplayer)
      cancelDeerSpeechClock(outplayer)
    }
    white = result.whiteSeat
    flag_white = result.whiteActive
    white_only = result.whiteOnly
    if (!is_kickout){
      if (order.indexOf(heros[HERO.WU_SAN_GUI]) !== -1) {
        wuSanGuiModule.removeAttacker(heroState, outplayer)
      }
    }
  }
  const settleYuanRetaliation = async (session: Session): Promise<boolean> => {
    const retaliationTarget = yuanChongHuanModule.consumeRetaliationTarget(heroState)
    const yuanSeat = heros[HERO.YUAN_CHONG_HUAN]
    const yuanIndex = order.indexOf(yuanSeat)
    if (yuanIndex === -1 || retaliationTarget === null) return false
    const yuanEliminationText = publicHeroEliminationText(
      yuanSeat,
      yuanSeat + "号玩家" + player_name[yuanIndex],
      "被其所守卫的" + retaliationTarget + "号玩家" + player_copy[retaliationTarget - 1] + "带走。",
    )
    // Complete the fixed-seat/history transition before delivery.  The
    // awaited notice only establishes observable order; a delivery failure is
    // absorbed by GameMessageDelivery and cannot undo the elimination.
    sumup += yuanEliminationText + "\n"
    recordSkill(HERO.YUAN_CHONG_HUAN, '守卫连带出局', [retaliationTarget])
    nv_out.push(yuanSeat)
    splice_player(yuanSeat, false, false)
    boom_pending = false
    await sendGroupNotice(session, yuanEliminationText, "袁崇焕反噬通知")
    return true
  }
  const player_out_long = async (session, outplayer, extra, is_kickout, is_check_white) => {
    splice_player(outplayer, is_kickout, is_check_white)
    boom_pending = false
    await check_game_end(session, outplayer, extra, whiteSurvivalSettlementPending)
  }
  const player_out = async (session, outplayer, is_kickout, is_check_white) => {
    await player_out_long(session, outplayer, (session, outplayer) => {}, is_kickout, is_check_white)
  }
  const players_out = async (session, outplayers, extra, is_kickout, is_check_white) => {
    for (let i=0; i<outplayers.length; i++) {
      splice_player(outplayers[i], is_kickout, is_check_white)
    }
    boom_pending = false
    await check_game_end(session, outplayers, extra)
  }
  const new_round = async (session): Promise<boolean> => {
    if (game_off) return false
    // A completed post-vote choice can establish victory without retaliation.
    // The white-Yuan survival guard remains part of the existing classifier.
    if ((await resolveEliminationVictory(session, whiteSurvivalSettlementPending)).kind === 'game-end') return false
    // new_round 永远表示进入普通轮。先使旧加时阶段和其计时器失效，
    // 再结算上一轮结束时袁崇焕的反噬；只有反噬完成且没有触发胜负
    // 终局后，才建立新轮历史阶段并处理其他轮首效果。
    speechPhases.invalidate()
    cancelTurtleTimers()
    for (const seat of [...deerSpeechTimers.keys()]) cancelDeerSpeechClock(seat)
    gameTimers.cancel(timer_ann)
    add_flag = false
    add_indices = []
    add_voter = []
    add_ann = []
    const wuSanGuiSeat = heros[HERO.WU_SAN_GUI]
    const wuSanGuiActive = order.indexOf(wuSanGuiSeat) !== -1
    zhangXianZhongModule.finishTargetSelection(heroState)
    waiver = 0
    const yuanRetaliated = await settleYuanRetaliation(session)
    if (yuanRetaliated || whiteSurvivalSettlementPending) {
      await check_game_end(session, heros[HERO.YUAN_CHONG_HUAN], (session, outplayer) => {}, whiteSurvivalSettlementPending)
      if (game_off) return false
    }
    whiteSurvivalSettlementPending = false
    // Round-start authority is settled only after Yuan Chonghuan's retaliation
    // has completed.  This keeps all public/new-round effects in the same
    // post-retaliation window and avoids awarding Huang Taiji or Wu Sangui
    // state from a round that has not actually begun yet.
    if (wuSanGuiModule.advanceAuthorityRound(heroState, wuSanGuiActive)) {
      vote_num[wuSanGuiSeat - 1] += 1
    }
    capture(r => r.beginPhase('round-' + round, round, 'regular', order))
    const huangTaiJiRewardTarget = huangTaiJiModule.consumePredictionReward(heroState, {
      activeSeats: order,
      heroActive: order.indexOf(heros[HERO.HUANG_TAI_JI]) !== -1,
    })
    if (huangTaiJiRewardTarget !== null) {
      quan[heros[HERO.HUANG_TAI_JI] - 1] += 1
      await sendPrivateNotice(session, player[order.indexOf(heros[HERO.HUANG_TAI_JI])], "陛下料敌机先，果然大破" + huangTaiJiRewardTarget + "号玩家" + player_copy[huangTaiJiRewardTarget - 1] + "此贼，获得一个“权”标记。", "皇太极权标记通知")
      sumup += heros[HERO.HUANG_TAI_JI] + "号玩家" + player_name[order.indexOf(heros[HERO.HUANG_TAI_JI])] + "（皇太极）获得1个“权”标记。\n"
      recordSkill(HERO.HUANG_TAI_JI, '获得1个“权”标记')
    }
    shiKeFaModule.clearTeammateAttackers(heroState)
    if (order.indexOf(heros[HERO.LIN_DAN_HAN]) !== -1) {
      let str_ldh = ""
      let str_ldh_2 = ""
      const report = linDanHanModule.roundReport(heroState, order, heros[HERO.LIN_DAN_HAN])
      for (const seat of report.attackedSeats) str_ldh_2 += seat + "号玩家" + player_copy[seat - 1] + "，"
      for (const seat of report.unattackedSeats) str_ldh += seat + "号玩家" + player_copy[seat - 1] + "，"
      if (isEmpty(str_ldh)) {
        notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，防线已全面崩溃，属下无力再防。", "林丹汗防线通知")
      }
      else {
        str_ldh = str_ldh.slice(0, -1)
        if (isEmpty(str_ldh_2)) {
          notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，在场的玩家中，并无一人攻击过您。", "林丹汗攻击记录通知")
        }
        else {
          str_ldh_2 = str_ldh_2.slice(0, -1)
          notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，在场的玩家中，" + str_ldh_2 + "已经攻击过您；还有" + str_ldh + "尚未攻击过您。", "林丹汗攻击记录通知")
        }
      }
    }
    const wuSanGuiRound = wuSanGuiModule.resolveRoundProgress(heroState, {
      heroActive: wuSanGuiActive,
    })
    if (wuSanGuiRound.awakenedNow) {
      fa[wuSanGuiSeat - 1] += wuSanGuiRound.faReward
      let str_wsg = ""
      for (const attackerSeat of wuSanGuiRound.attackerSeats) {
        if (order.indexOf(attackerSeat) !== -1) {
          str_wsg += attackerSeat + "号玩家" + player_copy[attackerSeat - 1] + "，"
        }
      }
      str_wsg = str_wsg.slice(0, -1)
      notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "将军，您已遭到" + str_wsg + "之中伤，是可忍孰不可忍，今宜自立。\n您获得" + wuSanGuiRound.faReward + "个伐标记，当传檄天下，扫荡贼夷。", "吴三桂自立私聊通知")
      notifyGroup(session, wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）自立，获知了投过他的玩家，并获得一定数量的“伐”标记。", "吴三桂自立群通知")
      sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）觉醒，获得" + wuSanGuiRound.faReward + "个“伐”标记。\n"
      recordSkill(HERO.WU_SAN_GUI, '觉醒，获得' + wuSanGuiRound.faReward + '个“伐”标记')
    }
    else if (wuSanGuiRound.restrictionAdded === 0) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后不能再于加时阶段自救了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡1效果：参与加时时不能发动“权计”。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：参与加时时不能发动“权计”')
      }
    else if(wuSanGuiRound.restrictionAdded === 1) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后发动权计的下一轮不能投票了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡2效果：发动“权计”的下一轮不能投票。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：发动“权计”的下一轮不能投票')
      }
    else if (wuSanGuiRound.restrictionAdded === 2) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后不能连续两轮发动权计了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡3效果：若前一轮发动了“权计”，则本轮无法发动。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：若前一轮发动了“权计”，则本轮无法发动')
      }
    const dorgonIndex = order.indexOf(heros[HERO.DUO_ER_GUN])
    const dorgonRoundStart = duoErGunModule.beginRound(heroState, {
      heroActive: dorgonIndex !== -1,
      hasNonVoteElimination: !isEmpty(nv_out),
    })
    if (dorgonRoundStart.regencyReopened && dorgonRoundStart.strategySeat !== null) {
      const d = dorgonRoundStart.strategySeat
      notifyPrivate(session, player[dorgonIndex], "从现在起您可以重新发动“摄政”。您可向我发送“保A弃B”或“弃B保A”以发动技能（效果：下次A要被投出去时，AB得票数互换）\n注意A、B其一必须要在轮次开始时有“定策”标记；目前" + d + "号玩家" + player_name[order.indexOf(d)] + "拥有“定策”标记。", "多尔衮摄政恢复通知")
    }
    if (dorgonRoundStart.awakened) {
      const dorgonIdentity = publicHeroIdentity(heros[HERO.DUO_ER_GUN])
      sumup += dorgonIdentity + "，入关，获得“摄政”。\n"
      recordSkill(HERO.DUO_ER_GUN, '入关，获得“摄政”')
      notifyGroup(session, dorgonIdentity + "，入关，获得技能“摄政”。", "多尔衮入关通知")
      const d = dorgonRoundStart.strategySeat ?? 0
      notifyPrivate(session, player[dorgonIndex], "恭喜王爷得获得摄政大权，您可向我发送“保A弃B”或“弃B保A”以发动技能（效果：下次A要被投出去时，AB得票数互换）\n注意A、B其一必须要在轮次开始时有“定策”标记；目前" + (order.indexOf(d)!==-1 ? (d + "号玩家" + player_name[order.indexOf(d)] + "拥有“定策”标记。") : "场上没有“定策”标记，您需要先拥立一人。"), "多尔衮摄政私聊通知")
    }
    if (isEmpty(uc) && flag_white) white_only = true
    if (round > uc_num || player_copy.length - player.length - kickout.length >= uc_num) {
      notifyGroup(session, roundCapabilityText("本轮"), "轮次能力通知")
    }
    if (modeInteraction.mode === "deer") {
      startDeerSpeechRound(session)
    }
    else if (modeInteraction.mode === "turtle") {
      startTurtleRound(session)
    }
    else startClassicSpeechPhase(session)
    return true
  }
  // 林丹汗「转进」觉醒判定：若其因「避实」防下一次致命伤害（避实防下的票数 + 实际得票
  // 超过最高票，且自身实际得票不高于最高票，且未被守卫），则觉醒获得「西迁」。
  // 该判定原先在投票结算链的多个分支（毛文龙超时回调、皇太极超时回调、正常流程）中逐字重复，
  // 现统一抽取为此函数。
  const tryAwakenLinDanHan = (session, max: number) => {
    const linIndex = order.indexOf(heros[HERO.LIN_DAN_HAN])
    if (linDanHanModule.shouldAwakenFromVote(heroState, {
      heroActive: linIndex !== -1,
      heroPoll: linIndex === -1 ? 0 : poll[linIndex],
      preventedVotePower: heroState.linDanHan.preventedVotePower,
      maximumPoll: max,
      unvote,
      shielded: shield[heros[HERO.LIN_DAN_HAN] - 1],
    })) {
      notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，由于您防下了一次致命伤害，您从现在获得“西迁”。", "林丹汗觉醒通知")
      sumup += heros[HERO.LIN_DAN_HAN] + "号玩家" + player_copy[heros[HERO.LIN_DAN_HAN] - 1] + "（林丹汗）觉醒，获得“西迁”。\n"
      recordSkill(HERO.LIN_DAN_HAN, '觉醒，获得“西迁”')
      linDanHanModule.awaken(heroState)
    }
  }
  // 林丹汗因「避实」挡下致命技能后，由模块先完成状态迁移，此处仅保留原有通知语义。
  const announceLinDanHanAwakening = (session) => {
    notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，由于您防下了一次致命伤害，您从现在获得“西迁”。", "林丹汗觉醒通知")
    sumup += heros[HERO.LIN_DAN_HAN] + "号玩家" + player_copy[heros[HERO.LIN_DAN_HAN] - 1] + "（林丹汗）觉醒，获得“西迁”。\n"
    recordSkill(HERO.LIN_DAN_HAN, '觉醒，获得“西迁”')
  }
  // 依据当前 poll / waiver / skip / unvote 重建本轮投票结果文本 vstr。
  // 该构建在投票结算链中（多尔衮换票后、毛文龙投票后等）多次出现，统一抽取。
  const buildVstr = () => {
    vstr = "本轮投票结果：\n"
    for (let j = 1; j <= player.length; j++) {
      if (poll[j - 1] > 0) vstr += order[j - 1] + "号玩家" + player_name[j - 1] + "：" + poll[j - 1] + "票\n"
    }
    if (waiver !== 0) vstr += "共有" + waiver + "位玩家弃票。\n"
    if (skip !== 0) vstr += "共有" + skip + "位玩家因武将技能发动跳过投票阶段。\n"
    if (unvote !== 0) vstr += "共有" + unvote + "票未来得及投出。"
    else vstr += "所有玩家均已投票。"
  }
  // 多尔衮「摄政」换票判定：若条件满足（已发动摄政、保护对象为唯一最高票等），
  // 则将 A、B 两名玩家的得票数互换、重建 vstr 与并列最高票列表 add_indices_0，并返回新的 quan_str。
  // 未触发时原样返回传入的 quanStr。该判定原先在结算链多处逐字重复。
  const tryDuoergunSwap = (session, idx: number, max: number, quanStr: string): string => {
    const result = duoErGunModule.resolveRegencySwap(heroState, {
      activeSeats: order,
      poll,
      heroSeat: heros[HERO.DUO_ER_GUN],
      leaderSeat: idx === -1 ? 0 : order[idx],
      uniqueLeader: idx !== -1 && poll.indexOf(max, idx + 1) === -1,
      overtime: add_flag,
      overtimeCandidateSeats: add_indices.map(index => order[index]),
    })
    if (result.kind === "swap") {
      let idx1 = order.indexOf(result.discardSeat);
      let idx2 = order.indexOf(result.keepSeat);
      [poll[idx1], poll[idx2]] = [poll[idx2], poll[idx1]];
      let temp1 = Math.min(result.discardSeat, result.keepSeat)
      let temp2 = Math.max(result.discardSeat, result.keepSeat)
      notifyGroup(session, heros[HERO.DUO_ER_GUN] + "号玩家" + player_copy[heros[HERO.DUO_ER_GUN] - 1] + "（多尔衮）发动技能，使" + temp1 + "号玩家" + player_copy[temp1 - 1] + "和" + temp2 + "号玩家" + player_copy[temp2 - 1] + "的得票数互换。", "多尔衮摄政结算通知")
      sumup += heros[HERO.DUO_ER_GUN] + "号玩家" + player_copy[heros[HERO.DUO_ER_GUN] - 1] + "（多尔衮）发动技能，使" + temp1 + "号玩家" + player_copy[temp1 - 1] + "和" + temp2 + "号玩家" + player_copy[temp2 - 1] + "的得票数互换。\n"
      recordSkill(HERO.DUO_ER_GUN, '摄政换票', [temp1, temp2])
      buildVstr()
      let idx_0 = poll.indexOf(max)
      quanStr = "";
      add_indices_0 = [];
      while (idx_0 !== -1) {
        add_indices_0.push(idx_0)
        quanStr += order[idx_0] + "号玩家" + player_name[idx_0] + "，"
        idx_0 = poll.indexOf(max, idx_0 + 1)
      }
      quanStr = quanStr.slice(0, -1)
    }
    return quanStr
  }
  // 皇太极「权」结算：投票计票完成后，若皇太极的「权」足够改变结果，则向其发送投票情况与减票选项，
  // 进入具名等待模式并挂起 timer_htj 超时，返回 true 表示「正在等待皇太极」。
  // 否则不触发，返回 false，由调用方继续最终投票结算。
  // 该 prompt-or-resolve 尾段原先在结算链 4 处逐字重复（含各自的 timer_htj 超时回调）。
  const resolveHuangTaiJi = (session, max: number, max_2: number, quanStr: string): boolean => {
    const huangSeat = heros[HERO.HUANG_TAI_JI]
    const mode = huangTaiJiModule.chooseQuanMode({
      heroActive: order.indexOf(huangSeat) !== -1,
      quan: quan[huangSeat - 1],
      requiredInfluence: quan_diff,
      leaderCount: add_indices_0.length,
      runnerUp: max_2,
      overtime: add_flag,
      playerCount: player.length,
    })
    if (mode !== null) {
      huangTaiJiQuanMode = mode
      gameTimers.cancel(timer_hurry)
      gameTimers.cancel(timer_vote)
      flag_just_vote = false
      let choicePrompt: string
      if (mode === "choose-tied-leader") {
        choicePrompt = "陛下，您现在拥有" + quan[huangSeat - 1] + "个权，可以改变本次投票结果。请陛下降旨，从" + quanStr + "中选择减票的对象（私聊臣发送玩家序号，消耗1个“权”），或发送“弃”放弃发动技能。"
      }
      else if (mode === "reduce-to-runner-up") {
        choicePrompt = "陛下，您现在拥有" + quan[huangSeat - 1] + "个权，可以改变本次投票结果。奴才向陛下请旨（给臣发送选项对应的数字）：\n1.消耗" + quan_diff + "个权，使" + quanStr + "的得票数减少为" + max_2 + "\n2.放弃发动技能。"
      }
      else {
        choicePrompt = "陛下，您现在拥有" + quan[huangSeat - 1] + "个权，可以改变本次投票结果。奴才向陛下请旨（给臣发送选项对应的数字）：\n1.消耗" + quan_diff + "个权，使" + quanStr + "的得票数减少为" + max_2 + "\n2.消耗" + (quan_diff + 1) + "个权，使" + quanStr + "的得票数减少为" + (max_2 - 1) + "\n3.放弃发动技能。"
      }
      vote_off = true
      const huangUserId = player[order.indexOf(huangSeat)]
      pendingAction.open({
        kind: "huang-tai-ji-quan",
        ownerSeat: huangSeat,
        ownerUserId: huangUserId,
        channel: { scope: "private" },
        blocksRosterChanges: true,
        gameEpoch: gameTimers.epoch,
        timeoutMs: timeout,
        resumeAt: ResolutionCursor.LinDanHanAwaken,
      })
      notifyGroup(session, "投票结束，等待皇太极发动技能...", "皇太极技能等待通知")
      sendRecoverablePrivatePrompt(session, {
        kind: "huang-tai-ji-quan",
        userId: huangUserId,
        content: vstr + "\n" + choicePrompt,
      })
      const huangGuildId = gameRoute.guildId
      timer_htj = setGameTimeout(async () => {
        await resumeHuangTaiJiQuan(session, "timeout")
        notifyPrivate(session, huangUserId, "你输入超时，已取消发动技能。", "皇太极技能超时私聊通知")
        notifyGroup(session, "皇太极技能发动超时，自动取消。", "皇太极技能超时群通知", huangGuildId)
      }, timeout);
      return true
    }
    return false
  }
  // Mutable values needed to resume the legacy post-Mao resolution tail.
  interface VoteResolutionTailContext {
    session: Session
    max: number
    max2: number
    idx: number
    vote: VoteContext
    quanStr: string
    skipDuoErGunSwap?: boolean
    skipHuangTaiJiPrompt?: boolean
  }
  interface FinalVoteResolutionInput {
    session: Session
    maximum: number
  }
  const liveVoteContext = (context: Pick<VoteResolutionTailContext, "max" | "max2">): VoteContext => {
    const voterIds = add_flag ? add_voter : player
    const ballots = add_flag ? add_vote[round - 1] : vote[round - 1]
    return snapshotVoteContext({
      gameEpoch: gameTimers.epoch,
      round,
      overtime: add_flag,
      activeSeats: order,
      voterSeats: voterIds.map(voterId => order[player.indexOf(voterId)]),
      ballots,
      poll,
      max: context.max,
      runnerUp: context.max2,
      leaderSeats: add_indices_0.map(index => order[index]),
      requiredInfluence: quan_diff,
    })
  }
  const runVoteResolutionTail = async (input: Omit<VoteResolutionTailContext, "vote">) => {
    const context: VoteResolutionTailContext = { ...input, vote: liveVoteContext(input) }
    return runResolutionPipeline({
      context,
      order: VOTE_RESOLUTION_TAIL,
      trace: traceResolution("vote-tail"),
      handlers: {
        [ResolutionCursor.DuoErGunSwap]: (current) => {
          if (!current.skipDuoErGunSwap) {
            current.quanStr = tryDuoergunSwap(
              current.session,
              current.idx,
              current.max,
              current.quanStr,
            )
          }
          return continueResolution()
        },
        [ResolutionCursor.LinDanHanAwaken]: (current) => {
          tryAwakenLinDanHan(current.session, current.max)
          return continueResolution()
        },
        [ResolutionCursor.HuangTaiJiQuan]: (current) => {
          if (!current.skipHuangTaiJiPrompt
            && resolveHuangTaiJi(current.session, current.max, current.max2, current.quanStr)) {
            return pauseResolution(ResolutionCursor.LinDanHanAwaken)
          }
          return continueResolution()
        },
        [ResolutionCursor.FinalizeVote]: async (current) => {
          return resolveFinalVote({
            session: current.session,
            maximum: current.max,
          })
        },
      },
    })
  }
  const resumeHuangTaiJiQuan = async (
    session: Session,
    completion: "input" | "timeout",
  ) => {
    const huangSeat = heros[HERO.HUANG_TAI_JI]
    huangTaiJiQuanMode = null
    gameTimers.cancel(timer_htj)
    if (completion === "timeout") pendingAction.clear("huang-tai-ji-quan")
    else pendingAction.complete("huang-tai-ji-quan")

    const leaders = calculateVoteLeaders({ poll, activeSeats: order, playerNames: player_name })
    add_indices_0 = leaders.leaderIndices.slice()
    quan_diff = leaders.requiredInfluence
    buildVstr()
    await runVoteResolutionTail({
      session,
      max: leaders.maximum,
      max2: leaders.runnerUp,
      idx: leaders.firstLeaderIndex,
      quanStr: leaders.leaderDescription,
      skipDuoErGunSwap: true,
      skipHuangTaiJiPrompt: true,
    })
  }
  interface MaoWenLongLateVoteContext {
    session: Session
    max: number
    max2: number
    idx: number
    quanStr: string
  }
  const resumeMaoWenLongLateVote = async (
    session: Session,
    targetSeat: number | null,
    completion: "input" | "timeout",
  ) => {
    const maoSeat = heros[HERO.MAO_WEN_LONG]
    gameTimers.cancel(timer_mwl)
    recordSkill(HERO.MAO_WEN_LONG, targetSeat === null ? '迟投' + (completion === 'timeout' ? '超时' : '放弃') : '迟投增加' + vote_num[maoSeat - 1] + '票', targetSeat === null ? [] : [targetSeat])
    if (targetSeat !== null) {
      const targetIndex = order.indexOf(targetSeat)
      poll[targetIndex] += vote_num[maoSeat - 1]
      sumup += maoSeat + "号玩家" + player_copy[maoSeat - 1] + "（毛文龙）使"
        + targetSeat + "号玩家" + player_name[targetIndex] + "得票数加" + vote_num[maoSeat - 1] + "。\n"
    }
    maoWenLongModule.finishLateVote(heroState)
    if (completion === "timeout") pendingAction.clear("mao-wen-long-late-vote")
    else pendingAction.complete("mao-wen-long-late-vote")

    const leaders = calculateVoteLeaders({ poll, activeSeats: order, playerNames: player_name })
    add_indices_0 = leaders.leaderIndices.slice()
    quan_diff = leaders.requiredInfluence
    buildVstr()
    await runVoteResolutionTail({
      session,
      max: leaders.maximum,
      max2: leaders.runnerUp,
      idx: leaders.firstLeaderIndex,
      quanStr: leaders.leaderDescription,
    })
  }
  const beginMaoWenLongLateVote = (context: MaoWenLongLateVoteContext) => {
    const maoSeat = heros[HERO.MAO_WEN_LONG]
    const maoIndex = order.indexOf(maoSeat)
    const maoUserId = player[maoIndex]
    gameTimers.cancel(timer_hurry)
    gameTimers.cancel(timer_vote)
    flag_just_vote = false
    vote_off = true
    maoWenLongModule.beginLateVote(heroState)
    pendingAction.open({
      kind: "mao-wen-long-late-vote",
      ownerSeat: maoSeat,
      ownerUserId: maoUserId,
      channel: { scope: "private" },
      blocksRosterChanges: true,
      gameEpoch: gameTimers.epoch,
      timeoutMs: timeout,
      resumeAt: ResolutionCursor.DuoErGunSwap,
    })
    notifyGroup(context.session, "其他人投票结束，等待毛文龙投票...", "毛文龙迟投等待通知")
    const prompt = [
      vstr,
      fa[maoSeat - 1] !== 0
        ? "毛帅，您目前有" + fa[maoSeat - 1] + "个伐，您可以在发送玩家序号之前发送“伐+数字”使用伐。"
        : "",
      "毛帅，请在参阅本次投票结果后投票。请注意，一旦发送确认玩家序号无法更改，请慎重。",
    ].filter(Boolean).join("\n")
    sendRecoverablePrivatePrompt(context.session, {
      kind: "mao-wen-long-late-vote",
      userId: maoUserId,
      content: prompt,
    })
    const maoGuildId = gameRoute.guildId
    timer_mwl = setGameTimeout(async () => {
      await resumeMaoWenLongLateVote(context.session, null, "timeout")
      notifyPrivate(context.session, maoUserId, "你输入超时，已取消发动技能。", "毛文龙技能超时私聊通知")
      notifyGroup(context.session, "毛文龙技能发动超时，自动取消。", "毛文龙技能超时群通知", maoGuildId)
    }, timeout)
  }
  const promptZhangXianZhongTarget = (session: Session, outplayer: number) => {
    const content = "技能触发，请" + player_copy[outplayer - 1] + h('at', { id: player_id_copy[outplayer - 1] }) + "选择带出局的玩家。（在群里发送玩家序号，或发送“弃”放弃发动技能）"
    rememberPendingPrompt({
      kind: "zhang-xian-zhong-target",
      userId: player_id_copy[outplayer - 1],
      content,
      scope: 'group',
      gameEpoch: gameTimers.epoch,
    })
  }
  const beginZhangXianZhongTarget = (session: Session) => {
    const zhangSeat = heros[HERO.ZHANG_XIAN_ZHONG]
    zhangXianZhongModule.beginTargetSelection(heroState)
    pendingAction.open({
      kind: "zhang-xian-zhong-target",
      ownerSeat: zhangSeat,
      ownerUserId: player_id_copy[zhangSeat - 1],
      ownerNickname: player_copy[zhangSeat - 1],
      channel: { scope: "group", guildId: gameRoute.guildId },
      blocksRosterChanges: true,
      gameEpoch: gameTimers.epoch,
      timeoutMs: timeout,
      resumeAt: ann_off ? ResolutionCursor.NextRound : ResolutionCursor.PostElimination,
    })
    const zhangGuildId = gameRoute.guildId
    const speechPhase = !ann_off ? speechPhases.current() : undefined
    if (speechPhase) {
      zhangSpeechHold = { deadlineAt: speechPhaseDeadlineAt, phase: speechPhase, turtleDeadlines: new Map() }
      gameTimers.cancel(timer_ann)
      timer_ann = undefined
      for (const [seat, timer] of deerSpeechTimers) {
        gameTimers.cancel(timer)
        deerSpeechTimers.delete(seat)
      }
      if (modeInteraction.mode === 'turtle') {
        for (const seat of speechPhase.eligibleSeats) armTurtleSpeechTimer(session, seat)
      }
    }
    timer_zxz = setGameTimeout(async () => {
      zhangXianZhongModule.finishTargetSelection(heroState)
      const action = pendingAction.clear("zhang-xian-zhong-target")
      sumup += player_copy[zhangSeat - 1] + "（张献忠）放弃发动技能。\n"
      if (action?.resumeAt === ResolutionCursor.NextRound) {
        await resumeZhangXianZhongAtNextRound(session)
      }
      resumeSpeechAfterZhang(session)
      notifyGroup(session, "张献忠输入超时，已取消发动技能。", "张献忠技能超时通知", zhangGuildId)
    }, timeout)
    const prompt = recoverablePendingPrompts.get("zhang-xian-zhong-target")
    if (prompt?.gameEpoch === gameTimers.epoch) {
      notifyGroup(session, prompt.content, "张献忠技能提示")
    }
  }
  const resumeSpeechAfterZhang = (session: Session) => {
    const hold = zhangSpeechHold
    zhangSpeechHold = undefined
    if (game_off || ann_off) return
    if (add_flag) endOvertimeAnn(session)
    else end_ann(session)
    if (!hold || ann_off || !speechPhases.matches(hold.phase)) return
    const now = Date.now()
    if (modeInteraction.mode === 'deer') {
      for (const [seat, deadline] of [...deerSpeechDeadlines]) {
        armDeerSpeechClock(session, seat, Math.max(deadline, now + 60_000))
      }
      return
    }
    if (modeInteraction.mode === 'turtle') {
      for (const [seat, deadline] of hold.turtleDeadlines) {
        const turn = modeInteraction.turtleTurnForSeat(seat)
        if (!turn || turn.status === 'complete') continue
        turn.remainingMs = Math.max(deadline - now, 60_000)
        if (turn.status === 'waiting-question') {
          turn.clockStartedAt = now
          armTurtleSpeechTimer(session, seat)
        }
      }
      return
    }
    if (hold.deadlineAt <= 0) return
    const deadlineAt = Math.max(hold.deadlineAt, now + 60_000)
    speechPhaseDeadlineAt = deadlineAt
    gameTimers.cancel(timer_ann)
    timer_ann = setGameTimeout(() => {
      if (!speechPhases.matches(hold.phase)) return
      return timeout_ann_auto(session)
    }, Math.max(1, deadlineAt - now))
  }
  // 是否正处于会被名单变化破坏的人工判定或武将技能等待态。
  // 此时踢人/加人会使回调基于错乱的索引或票数运行，故应拒绝操作。
  const beginShiKeFaGift = () => {
    const shiSeat = heros[HERO.SHI_KE_FA]
    shiKeFaModule.beginGift(heroState)
    pendingAction.open({
      kind: "shi-ke-fa-gift",
      ownerSeat: shiSeat,
      ownerUserId: player_id_copy[shiSeat - 1],
      channel: { scope: "private" },
      blocksRosterChanges: false,
      gameEpoch: gameTimers.epoch,
      timeoutMs: null,
      resumeAt: ResolutionCursor.PostElimination,
    })
  }
  const promptShiKeFaGift = (session: Session, outplayer: number) => {
    const amount = shiKeFaModule.prepareGift(
      heroState,
      uc_num + (flag_white_perm ? 1 : 0),
    )
    if (amount <= 0) return
    beginShiKeFaGift()
    notifyGroup(session, "技能触发，请" + player_copy[outplayer - 1] + "在私聊中选择一名玩家获得一定数量的“伐”标记。", "史可法技能群提示")
    sendRecoverablePrivatePrompt(session, {
      kind: "shi-ke-fa-gift",
      userId: player_id_copy[heros[HERO.SHI_KE_FA] - 1],
      content: "阁部，您可以将" + amount + "个“伐”标记赠予在场的任一名玩家。请私聊我发送玩家序号，或发送“弃”放弃发动技能。",
    })
  }
  const isRosterChangeBlocked = () => {
    if (boom_pending || pendingAction.isRosterChangeBlocked()) return true
    if (modeInteraction.mode === "turtle" && modeInteraction.turtleHasPendingHost()) return true
    return false
  }
  const hasPendingReplacement = () => replacementRequest.hasPending
  const isReplacementSeatAvailable = (seat: number) => kickout.indexOf(seat) !== -1
    && isEmpty(player_copy[seat - 1])
    && isEmpty(player_id_copy[seat - 1])
  const replacementCancelCommands = new Set(["取消补位", "取消加人", "取消候补"])
  const resetReplacementRequest = () => {
    gameTimers.cancel(timer_replace)
    const applicant = replacementRequest.applicant
    if (applicant && !player.includes(applicant.userId)) releasePlayerLease(applicant.userId)
    replacementRequest.reset()
  }
  const replacementTimeoutMs = () => Math.max(10, Number(config.replacementTimeout ?? 180) || 180) * 1000
  const scheduleReplacementTimeout = (session: Session) => {
    gameTimers.cancel(timer_replace)

    const tick = async () => {
      const result = replacementRequest.tick(Date.now(), isRosterChangeBlocked())
      if (result.kind === "idle") return
      if (result.kind === "expired") {
        if (!player.includes(result.applicant.userId)) releasePlayerLease(result.applicant.userId)
        await sendGroupNotice(session, result.applicant.nickname + "的补位申请已超时，申请自动取消。", "补位申请超时通知")
        return
      }
      timer_replace = setGameTimeout(tick, result.nextDelayMs)
    }

    timer_replace = setGameTimeout(
      tick,
      Math.min(1000, Math.max(100, replacementRequest.remainingMs)),
    )
  }
  // 返回某名玩家当前真正允许投票的对象。林丹汗觉醒后还要受到「西迁」限制。
  const getVotableTargets = (voterOrder: number) => {
    let targets = add_flag ? add_indices.map(i => order[i]) : order.slice()
    targets = targets.filter(targetOrder => targetOrder !== voterOrder)
    if (voterOrder === heros[HERO.LIN_DAN_HAN]) {
      targets = linDanHanModule.votableTargets(heroState, targets)
    }
    return targets
  }
  const captureVoteRoster = (): VoteRosterSnapshot => ({
    voterIds: (add_flag ? add_voter : player).slice(),
    ballots: (add_flag ? add_vote[round - 1] : vote[round - 1]).slice(),
  })
  const currentVoteData = () => add_flag
    ? { voterIds: add_voter, ballots: add_vote[round - 1] }
    : { voterIds: player, ballots: vote[round - 1] }
  // 名单变化后不再依靠局部加减 poll，而是以保留下来的原始选票重新演算票池及武将派生状态。
  // 这样既能只作废真正失效的票，也不会遗留林丹汗互投/避实、史可法队友票或皇太极目标。
  const rebuildPollFromBallots = () => {
    const { voterIds, ballots } = currentVoteData()
    const rebuilt = rebuildVoteState({
      overtime: add_flag,
      voterIds,
      ballots,
      playerIds: player,
      playerOrder: order,
      votePower: vote_num,
      undercoverSeats: uc,
      whiteSeat: white,
      heroes: {
        linDanHanSeat: heros[HERO.LIN_DAN_HAN],
        shiKeFaSeat: heros[HERO.SHI_KE_FA],
        huangTaiJiSeat: heros[HERO.HUANG_TAI_JI],
      },
      linDanHan: {
        awakened: linDanHanModule.isAwakened(heroState),
        realityRecords: linDanHanModule.realityRecords(heroState),
      },
      huangTaiJiRegularTarget: huangTaiJiModule.trackedVoteTarget(heroState) ?? 0,
    })
    poll = rebuilt.poll
    waiver = rebuilt.waiver
    unvote = rebuilt.unvote
    skip = rebuilt.skip
    vstr = "本轮投票结果：\n"
    linDanHanModule.replaceBallotState(heroState, {
      realityRecords: rebuilt.linDanHanRealityRecords,
      ownVoteInvalidated: rebuilt.linDanHanOwnVoteInvalidated,
      preventedVotePower: rebuilt.linDanHanPreventedVotePower,
    })
    shiKeFaModule.replaceTeammateAttackers(heroState, rebuilt.shiKeFaTeammateAttackers)
    huangTaiJiModule.replaceTrackedVoteTarget(heroState, rebuilt.huangTaiJiRegularTarget)
  }
  const applyShiKeFaResistance = (session: Session) => {
    const { voterIds, ballots } = currentVoteData()
    const shiSeat = heros[HERO.SHI_KE_FA]
    const shiIndex = order.indexOf(shiSeat)
    const result = shiKeFaModule.resolveVoteResistance(heroState, {
      overtime: add_flag,
      overtimeCandidateSeats: add_indices.map(index => order[index]),
      voterIds,
      ballots,
      playerIds: player,
      activeSeats: order,
      undercoverSeats: uc,
      whiteSeat: white,
      shiKeFaSeat: shiSeat,
    })
    if (shiIndex === -1) return
    if (result.pollAdjustment !== 0) poll[shiIndex] += result.pollAdjustment
    if (result.notice === "no-teammate") {
      notifyPrivate(session, player[shiIndex], "阁部，本次投票没有队友投您。", "史可法抵诽通知")
    }
    else if (result.notice === "reduced") {
      notifyPrivate(session, player[shiIndex], "阁部，本次投票您受到了队友的攻讦，已为您减去一票。", "史可法抵诽通知")
      sumup += shiSeat + "号玩家" + player_copy[shiSeat - 1] + "（史可法）发动技能，本次得票数减1。\n"
      recordSkill(HERO.SHI_KE_FA, '发动“抵诽”，本次得票数减少1票')
    }
    else if (result.notice === "unavailable") {
      notifyPrivate(session, player[shiIndex], "阁部，本次投票您受到了队友的攻讦，但您已失去抵诽技能，无法得到减票。", "史可法抵诽失效通知")
    }
  }
  const applyDuoErGunProtection = (session: Session) => {
    const dorgonSeat = heros[HERO.DUO_ER_GUN]
    const result = duoErGunModule.resolveProtection(heroState, {
      activeSeats: order,
      poll,
      heroSeat: dorgonSeat,
    })
    if (result.protectedSeat === null) return
    const protectedIndex = order.indexOf(result.protectedSeat)
    poll[protectedIndex] += result.pollAdjustment
    recordSkill(HERO.DUO_ER_GUN, '定策保护：减票' + -result.pollAdjustment, [result.protectedSeat])
    notifyPrivate(session, player[protectedIndex], "由于多尔衮保护，已为您减去一票。", "多尔衮定策保护通知")
    sumup += dorgonSeat + "号玩家" + player_copy[dorgonSeat - 1] + "（多尔衮）发动技能，"
      + result.protectedSeat + "号玩家" + player_copy[result.protectedSeat - 1] + "本次得票数减1。\n"
  }
  const deriveVoteEffects = (session: Session) => {
    if (add_flag) {
      unvote = 0
      skip = 0
      for (let i = 1; i <= add_voter.length; i++) {
        if (add_vote[round - 1][i - 1] === -1 && vote_num[order[player.indexOf(add_voter[i - 1])] - 1] !== 0) {
          if(order[player.indexOf(add_voter[i - 1])] !== heros[HERO.MAO_WEN_LONG]) unvote += vote_num[order[player.indexOf(add_voter[i - 1])] - 1]
        }
        else if (vote_num[order[player.indexOf(add_voter[i - 1])] - 1] === 0) {
          skip += 1
        }
      }
    }
    else {
      unvote = 0
      skip = 0
      for (let i = 1; i <= player.length; i++) {
        if (vote[round - 1][i - 1] === -1 && vote_num[order[i - 1] - 1] !== 0) {
          if(order[i - 1] !== heros[HERO.MAO_WEN_LONG]) unvote += vote_num[order[i - 1] - 1]
        }
        else if (vote_num[order[i - 1] - 1] === 0) {
          skip += 1
        }
      }
    }
    if (add_flag) sumup += "第" + round + "轮加时投票结果：\n"
    else sumup += "第" + round + "轮投票结果：\n"
    linDanHanModule.calculatePreventedVotePower(
      heroState,
      order.indexOf(heros[HERO.LIN_DAN_HAN]) !== -1 ? vote_num : [],
    )
    for (let j = 1; j <= player.length; j++) {
      if (add_flag) {
        if (add_indices.indexOf(j - 1) === -1) {
          let d = add_voter.indexOf(player[j - 1])
          if (add_vote[round - 1][d] > 0) {
            if (vote_num[order[j - 1] - 1] === 1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "投给了" + add_vote[round - 1][d] + "号玩家" + player_name[order.indexOf(add_vote[round - 1][d])] + "。\n"
            else if (vote_num[order[j - 1] - 1] > 1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "投给了" + add_vote[round - 1][d] + "号玩家" + player_name[order.indexOf(add_vote[round - 1][d])] + vote_num[order[j - 1] - 1] + "票。\n"
            if (linDanHanModule.hasPendingVoteAttack(heroState, order[j - 1]) && add_vote[round - 1][d] === heros[HERO.LIN_DAN_HAN]) {
              sumup += add_vote[round - 1][d] + "号玩家" + player_name[order.indexOf(add_vote[round - 1][d])] + "（林丹汗）受武将技能保护，免疫" + order[j - 1] + "号玩家" + player_name[j - 1] + "的投票。\n"
              if(order[j - 1]===heros[HERO.LI_ZI_CHENG]) {
                liZiChengModule.recordBallotOutcome(heroState, {
                  ballot: add_vote[round - 1][d],
                  invalidatedByLinDanHan: true,
                })
              }
              linDanHanModule.consumeVoteAttack(heroState, order[j - 1])
            }
            else if (linDanHanModule.isOwnVoteInvalidated(heroState) && order[j - 1] === heros[HERO.LIN_DAN_HAN]) {
              sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "（林丹汗）投给" + add_vote[round - 1][d] + "号玩家" + player_name[order.indexOf(add_vote[round - 1][d])] + "的投票失效。\n"
              notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，由于受到了" + add_vote[round - 1][d] + "号玩家" + player_name[order.indexOf(add_vote[round - 1][d])] + "的攻击，虽然我们成功转进，但是可汗本次投票失效。", "林丹汗投票失效通知")
              linDanHanModule.restoreOwnVote(heroState)
            }
            else if (yuanChongHuanModule.recordGuardedAttack(heroState, order[j - 1], add_vote[round - 1][d], heros[HERO.YUAN_CHONG_HUAN])) {
              shield[order[j - 1] - 1] = false
            }
            if (add_vote[round - 1][d] === heros[HERO.WU_SAN_GUI]) {
              wuSanGuiModule.recordAttacker(heroState, order[j - 1])
            }
          }
          else{
            if (order[j - 1]===heros[HERO.LI_ZI_CHENG]) {
              liZiChengModule.recordBallotOutcome(heroState, {
                ballot: add_vote[round - 1][d],
                invalidatedByLinDanHan: false,
              })
            }
            if (add_vote[round - 1][d] === 0) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "弃权。\n"
            else if (add_vote[round - 1][d] === -1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "未来得及投票。\n"
            else sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "跳过投票阶段。\n"
          }
        }
      }
      else {
        if (vote[round - 1][j - 1] > 0) {
          if (vote_num[order[j - 1] - 1] === 1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "投给了" + vote[round - 1][j - 1] + "号玩家" + player_name[order.indexOf(vote[round - 1][j - 1])] + "。\n"
          else if (vote_num[order[j - 1] - 1] > 1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "投给了" + vote[round - 1][j - 1] + "号玩家" + player_name[order.indexOf(vote[round - 1][j - 1])] + vote_num[order[j - 1] - 1] + "票。\n"
          if (linDanHanModule.hasPendingVoteAttack(heroState, order[j - 1]) && vote[round - 1][j - 1] === heros[HERO.LIN_DAN_HAN]) {
            sumup += vote[round - 1][j - 1] + "号玩家" + player_name[order.indexOf(vote[round - 1][j - 1])] + "（林丹汗）受武将技能保护，免疫" + order[j - 1] + "号玩家" + player_name[j - 1] + "的投票。\n"
            if(order[j - 1]===heros[HERO.LI_ZI_CHENG]) {
              liZiChengModule.recordBallotOutcome(heroState, {
                ballot: vote[round - 1][j - 1],
                invalidatedByLinDanHan: true,
              })
            }
            linDanHanModule.consumeVoteAttack(heroState, order[j - 1])
          }
          else if (linDanHanModule.isOwnVoteInvalidated(heroState) && order[j - 1] === heros[HERO.LIN_DAN_HAN]) {
            sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "（林丹汗）投给" + vote[round - 1][j - 1] + "号玩家" + player_name[order.indexOf(vote[round - 1][j - 1])] + "的投票失效。\n"
            notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，由于受到了" + vote[round - 1][j - 1] + "号玩家" + player_name[order.indexOf(vote[round - 1][j - 1])] + "的攻击，虽然我们成功转进，但是可汗本次投票失效。", "林丹汗投票失效通知")
            linDanHanModule.restoreOwnVote(heroState)
          }
          else if (yuanChongHuanModule.recordGuardedAttack(heroState, order[j - 1], vote[round - 1][j - 1], heros[HERO.YUAN_CHONG_HUAN])) {
            shield[order[j - 1] - 1] = false
          }
          if (vote[round - 1][j - 1] === heros[HERO.WU_SAN_GUI]) {
            wuSanGuiModule.recordAttacker(heroState, order[j - 1])
          }
        }
        else{
          if (order[j - 1]===heros[HERO.LI_ZI_CHENG]) {
            liZiChengModule.recordBallotOutcome(heroState, {
              ballot: vote[round - 1][j - 1],
              invalidatedByLinDanHan: false,
            })
          }
          if (vote[round - 1][j - 1] === 0) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "弃权。\n"
          else if (vote[round - 1][j - 1] === -1) sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "未来得及投票。\n"
          else sumup += order[j - 1] + "号玩家" + player_name[j - 1] + "跳过投票阶段。\n"
        }
      }
    }
    liZiChengModule.recordBallotOutcome(heroState, {
      ballot: vote[round - 1][order.indexOf(heros[HERO.LI_ZI_CHENG])],
      invalidatedByLinDanHan: false,
    })
    buildVstr()
  }
  interface PreMaoResolutionResult {
    leaders: VoteLeaderResult
    paused: boolean
  }
  const runVotePreMaoWindows = async (session: Session): Promise<PreMaoResolutionResult> => {
    let leaders: VoteLeaderResult | null = null
    const resolution = await runResolutionPipeline({
      context: { session },
      order: [
        ResolutionCursor.RebuildBallots,
        ResolutionCursor.ApplyShiKeFaResistance,
        ResolutionCursor.ApplyDuoErGunProtection,
        ResolutionCursor.DeriveVoteEffects,
        ResolutionCursor.CalculateLeaders,
        ResolutionCursor.MaoWenLongLateVote,
      ],
      trace: traceResolution("vote-pre-mao"),
      handlers: {
        [ResolutionCursor.RebuildBallots]: () => {
          rebuildPollFromBallots()
          return continueResolution()
        },
        [ResolutionCursor.ApplyShiKeFaResistance]: ({ session: currentSession }) => {
          applyShiKeFaResistance(currentSession)
          return continueResolution()
        },
        [ResolutionCursor.ApplyDuoErGunProtection]: ({ session: currentSession }) => {
          applyDuoErGunProtection(currentSession)
          return continueResolution()
        },
        [ResolutionCursor.DeriveVoteEffects]: ({ session: currentSession }) => {
          deriveVoteEffects(currentSession)
          return continueResolution()
        },
        [ResolutionCursor.CalculateLeaders]: () => {
          leaders = calculateVoteLeaders({ poll, activeSeats: order, playerNames: player_name })
          add_indices_0 = leaders.leaderIndices.slice()
          quan_diff = leaders.requiredInfluence
          return continueResolution()
        },
        [ResolutionCursor.MaoWenLongLateVote]: ({ session: currentSession }) => {
          if (leaders === null) throw new Error("Mao Wenlong window ran before leader calculation.")
          const maoSeat = heros[HERO.MAO_WEN_LONG]
          const overtimeCandidateSeats = add_indices.map(index => order[index])
          if (!order.includes(maoSeat) || (add_flag && overtimeCandidateSeats.includes(maoSeat))) {
            return continueResolution()
          }
          quan_tot = 0
          for (let j = 1; j <= player.length; j++) quan_tot += quan[order[j - 1] - 1]
          const decision = maoWenLongModule.decideLateVote({
            activeSeats: order,
            overtime: add_flag,
            overtimeCandidateSeats,
            maoWenLongSeat: maoSeat,
            requiredInfluence: leaders.requiredInfluence,
            votePower: vote_num[maoSeat - 1],
            fa: fa[maoSeat - 1],
            totalQuan: quan_tot,
          })
          if (decision === "prompt") {
            beginMaoWenLongLateVote({
              session: currentSession,
              max: leaders.maximum,
              max2: leaders.runnerUp,
              idx: leaders.firstLeaderIndex,
              quanStr: leaders.leaderDescription,
            })
            return pauseResolution(ResolutionCursor.DuoErGunSwap)
          }
          if (decision === "cannot-affect") {
            notifyPrivate(currentSession, player[order.indexOf(maoSeat)], "毛帅，您无力左右本次投票结果。", "毛文龙无力改变结果通知")
          }
          return continueResolution()
        },
      },
    })
    if (leaders === null) throw new Error("Vote leader calculation did not run.")
    return { leaders, paused: resolution.control.kind === "pause" }
  }
  const voteResolutionStatus = () => {
    const { voterIds, ballots } = currentVoteData()
    return getVoteResolutionStatus({
      voterIds,
      ballots,
      playerIds: player,
      playerOrder: order,
      votePower: vote_num,
      poll,
      fa,
      quan,
      maoWenLongSeat: heros[HERO.MAO_WEN_LONG],
      shiKeFa: {
        seat: heros[HERO.SHI_KE_FA],
        mode: heroState.shiKeFa.mode,
        teammateAttackers: heroState.shiKeFa.teammateAttackerSeats,
        undercoverSeats: uc,
        whiteSeat: white,
      },
      duoErGunStrategyMark: duoErGunModule.strategyMark(heroState),
    })
  }
  const reconcileVoteAfterRosterChange = async (session, notice: string, snapshot: VoteRosterSnapshot) => {
    const voterIds = add_flag
      ? player.filter((_, index) => add_indices.indexOf(index) === -1)
      : player.slice()
    const retained = retainBallotsAfterRosterChange({
      previous: snapshot,
      voterIds,
      playerIds: player,
      playerOrder: order,
      validTargetsBySeat: getVotableTargets,
    })
    const ballots = retained.ballots
    for (const voterId of retained.autoWaivedVoterIds) {
      notifyPrivate(session, voterId, "玩家变动后你已没有可投票的对象，已为你自动弃票。", "名单变化自动弃票通知")
    }
    if (add_flag) {
      add_voter = voterIds
      add_vote[round - 1] = ballots
    }
    else {
      vote[round - 1] = ballots
    }
    rebuildPollFromBallots()

    const status = voteResolutionStatus()
    flag = status !== "pending"
    if (status === "locked") {
      for (let i = 0; i < voterIds.length; i++) {
        const playerIndex = player.indexOf(voterIds[i])
        const voterOrder = order[playerIndex]
        if (isEmpty(ballots[i]) && vote_num[voterOrder - 1] !== 0) {
          ballots[i] = -1
          lockedVoteSeats.add(votePhaseKey(voterOrder))
          notifyPrivate(session, voterIds[i], "名单调整后票数已足以确定结果，无需你再进行投票。", "名单变化无需投票通知")
        }
      }
    }
    if (status !== "pending") {
      const reason = status === "complete" ? "所有必要投票均已完成" : "调整后的票数已经锁定结果"
      notifyGroup(session, notice + "，其余有效投票已保留；" + reason + "，立即结算。", "名单变化立即结算通知")
      await timeout_vote(session)
      return
    }

    notifyGroup(session, notice + "，其余有效投票继续保留。尚未投票或原投票失效的玩家请继续投票。", "名单变化继续投票通知")
    for (let i = 0; i < voterIds.length; i++) {
      const playerIndex = player.indexOf(voterIds[i])
      const voterOrder = order[playerIndex]
      if (!isEmpty(ballots[i]) || vote_num[voterOrder - 1] === 0 || voterOrder === heros[HERO.MAO_WEN_LONG]) continue
      const targets = getVotableTargets(voterOrder)
      const canVote = targets.map(targetOrder => targetOrder + "号" + player_copy[targetOrder - 1]).join("，")
      const prefix = retained.invalidatedVoterIds.has(voterIds[i]) ? "你原先投票的对象已不在有效候选中。" : "玩家名单刚刚发生变化。"
      notifyPrivate(session, voterIds[i], prefix + "当前可投票的玩家为：" + canVote + "。请继续投票。", "名单变化投票对象通知")
    }
  }
  const currentVoteSettlementKey = () => `${gameTimers.epoch}:${round}:${add_flag ? "overtime" : "regular"}`
  const timeout_vote = async (session) => {
    const key = currentVoteSettlementKey()
    return voteSettlement.run(key, async () => {
      gameTimers.cancel(timer_hurry)
      gameTimers.cancel(timer_vote)
      flag_just_vote = false
      const preMao = await runVotePreMaoWindows(session)
      if (preMao.paused) return
      const leaders = preMao.leaders
      const max = leaders.maximum
      const max_2 = leaders.runnerUp
      const quan_str = leaders.leaderDescription
      const idx = leaders.firstLeaderIndex
      await runVoteResolutionTail({ session, max, max2: max_2, idx, quanStr: quan_str })
    })
  }
  const timeout_vote_auto = async (session) => {
    if (game_off || vote_off) return
    if (voteSettlement.isRunning(currentVoteSettlementKey())) return
    const guildId = gameRoute.guildId
    let drag = 0
    let novote = "目前，还有"
    if (add_flag) {
      for (let i = 0; i < add_voter.length; i++) {
        let d = player.indexOf(add_voter[i])
        if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[d] + "号玩家" + player_name[d] + "，"
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[i] + "号玩家" + player_name[i] + "，"
        }
      }
    }
    novote = novote.slice(0, -1)
    novote += "共" + drag + "位玩家未投票，"
    if (add_flag) {
      for (let i = 0; i < add_voter.length; i++) {
        let d = player.indexOf(add_voter[i])
        if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
          add_vote[round - 1][i] = -1
          notifyPrivate(session, add_voter[i], "你投票太慢啦，投票阶段已经结束啦~", "加时投票超时通知")
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
          vote[round - 1][i] = -1
          notifyPrivate(session, player[i], "你投票太慢啦，投票阶段已经结束啦~", "投票超时通知")
        }
      }
    }
    novote += "不等他" + (drag === 1 ? "" : "们") + "投票了，本次投票阶段结束。"
    await timeout_vote(session)
    notifyGroup(session, novote, "投票超时群通知", guildId)
  }
  const hurry_vote = (session) => {
    if (game_off || vote_off) return
    let drag = 0
    let novote = "目前，还有"
    if (add_flag) {
      for (let i = 0; i < add_voter.length; i++) {
        let d = player.indexOf(add_voter[i])
        if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[d] + "号玩家" + player_name[d] + "，"
          if (notifications.voteHurryPrivate) notifyPrivate(session, player[d], "投票开始已经过去" + formatConfiguredDuration(config.hurryTimeout) + "了，赶快投票哦~\n（tip：如果你有技能可以发动，最好先发动技能再投票）", "加时催票私聊")
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[i] + "号玩家" + player_name[i] + "，"
          if (notifications.voteHurryPrivate) notifyPrivate(session, player[i], "投票开始已经过去" + formatConfiguredDuration(config.hurryTimeout) + "了，赶快投票哦~\n（tip：如果你有技能可以发动，最好先发动技能再投票）", "催票私聊")
        }
      }
    }
    novote = novote.slice(0, -1)
    novote += "共" + drag + "位玩家未投票，已经催了~"
    if (drag > 0 && notifications.voteHurryGroup) notifyGroup(session, novote, "催票群通知")
  }
  const turtleAnnouncementText = (seat: number): string => {
    const turn = modeInteraction.turtleTurnForSeat(seat)
    if (!turn?.question || !turn.answer) return ""
    return "问题：" + seat + turn.question + "；主持回答：" + seat + turn.answer
  }
  const rebuildTurtleAnnouncementProjection = () => {
    if (modeInteraction.mode !== "turtle") return
    if (add_flag) {
      add_ann = add_indices.map(index => turtleAnnouncementText(order[index]))
    }
    else {
      ann = order.map(seat => turtleAnnouncementText(seat))
    }
  }
  const formatConfiguredDuration = (seconds: number): string => {
    const minutes = seconds / 60
    return Number.isInteger(minutes) ? `${minutes}分钟` : `${seconds}秒`
  }
  const prepareVoteWindowAndNotifyPlayers = (session: Session, overtime: boolean) => {
    // Use a monotonic phase identity rather than round/overtime labels.  This
    // preserves replay status if a future skill deliberately creates another
    // overtime window in the same round.
    votePhaseSerial += 1
    if (flag_white && isEmpty(uc) && (!overtime || add_indices.some(index => order[index] === white))) white_only = true
    const voterIds = overtime ? add_voter : player
    const previousGuardTarget = !overtime && order.includes(heros[HERO.YUAN_CHONG_HUAN])
      ? yuanChongHuanModule.beginVoteWindow(heroState)
      : null
    const dorgonRegency = heroState.duoErGun.regencyState
    const dorgonStrategySeat = duoErGunModule.strategySeat(heroState)
    const canConfigureDorgon = !overtime
      && order.includes(heros[HERO.DUO_ER_GUN])
      && (dorgonRegency.kind === "locked"
        || ((dorgonRegency.kind === "available" || dorgonRegency.kind === "armed")
          && (dorgonStrategySeat === null || !order.includes(dorgonStrategySeat))))

    for (const voterId of voterIds) {
      const activeIndex = player.indexOf(voterId)
      if (activeIndex === -1) continue
      const seat = order[activeIndex]
      if (seat === heros[HERO.MAO_WEN_LONG] || vote_num[seat - 1] === 0) continue
      const targets = getVotableTargets(seat)
      if (seat === heros[HERO.LIN_DAN_HAN] && linDanHanModule.isAwakened(heroState) && targets.length === 0) {
        const ballotIndex = overtime ? add_voter.indexOf(voterId) : activeIndex
        if (overtime) add_vote[round - 1][ballotIndex] = 0
        else vote[round - 1][ballotIndex] = 0
        waiver += 1
        notifyPrivate(session, voterId, "可汗，您已经无法再向在场玩家进行投票，已为您自动弃票。", "林丹汗自动弃票通知")
        continue
      }
      if (!notifications.voteStartPrivate) continue

      const lines = [
        `第${round}轮${overtime ? "加时" : ""}投票已开始，该投票了。`,
        "可投票对象：" + targets.map(target => `${target}号${player_copy[target - 1]}`).join("，") + "。",
        "请私聊发送目标座位号；发送“弃”或“弃权”可弃票，结算前可以改票。",
      ]
      if (fa[seat - 1] > 0) {
        lines.push(`你有${fa[seat - 1]}个“伐”，可先发送“伐+数字”（只发“伐”默认使用1个）增加本次票数。`)
      }
      if (!overtime && seat === heros[HERO.YUAN_CHONG_HUAN]) {
        lines.push("你可以发送“守+座位号”指定守卫目标"
          + (previousGuardTarget === null || !order.includes(previousGuardTarget)
            ? "。"
            : `；本轮不能继续守卫${previousGuardTarget}号玩家${player_copy[previousGuardTarget - 1]}。`))
      }
      if (seat === heros[HERO.LIN_DAN_HAN] && linDanHanModule.isAwakened(heroState)) {
        lines.push("以上可投票对象已按“西迁”限制过滤。")
      }
      if (canConfigureDorgon && seat === heros[HERO.DUO_ER_GUN]) {
        lines.push(dorgonStrategySeat === null || !order.includes(dorgonStrategySeat)
          ? "你可以发送“立+座位号”，指定一名其他玩家获得“定策”标记保护。"
          : `你可以发送“立+座位号”，将“定策”从${dorgonStrategySeat}号${player_copy[dorgonStrategySeat - 1]}转移给另一名其他玩家。`)
      }
      notifyPrivate(session, voterId, lines.join("\n"), `投票开始${seat}号私聊提醒`)
    }
    linDanHanModule.beginVoteWindow(heroState)
  }
  const end_ann = (session) => {
    if (game_off || ann_off || boom_pending) return
    if (zhangXianZhongModule.isAwaitingTarget(heroState)) return
    if (modeInteraction.mode === "turtle") {
      rebuildTurtleAnnouncementProjection()
      flag = modeInteraction.turtleAllComplete()
    }
    else {
      flag = true
      for (let i = 1; i <= player.length; i++) {
        if (isEmpty(ann[i - 1])) flag = false
      }
    }
    if (flag && !boom_pending) {
      gameTimers.cancel(timer_ann)
      if (modeInteraction.mode === "deer") {
        for (const seat of [...deerSpeechTimers.keys()]) cancelDeerSpeechClock(seat)
      }
      for (let j = 1; j <= player.length; j++) {
        annstr += order[j - 1] + "号玩家" + player_name[j - 1] + "发言为：" + ann[j - 1] + "\n"
      }
      ann_off = true
      vote_off = false
      sumup += "第" + round + annstr.slice(1)
      notifyGroup(session, annstr + "现在开始投票。", "普通轮投票开始通知")
      prepareVoteWindowAndNotifyPlayers(session, false)
      flag_just_vote = true
      timer_hurry = setGameTimeout(()=>{
        hurry_vote(session)
        flag_just_vote = false
      }, timeout_for_hurry)
      if (timeout_mode <= 4) {
        timer_vote = setGameTimeout(() => {
          return timeout_vote_auto(session)
        }, timeout_for_vote);
        notifyGroup(session, "本次投票阶段限时：" + formatConfiguredDuration(config.voteTimeout), "投票限时通知")
      }
    }
    return
  }
  const endOvertimeAnn = (session: Session) => {
    if (zhangXianZhongModule.isAwaitingTarget(heroState)) return
    if (modeInteraction.mode === "turtle") {
      rebuildTurtleAnnouncementProjection()
      flag = modeInteraction.turtleAllComplete()
    }
    else {
      flag = true
      for (let i = 1; i <= add_indices.length; i++) {
        if (isEmpty(add_ann[i - 1])) flag = false
      }
    }
    if (flag && !boom_pending) {
      gameTimers.cancel(timer_ann)
      if (modeInteraction.mode === "deer") {
        for (const seat of [...deerSpeechTimers.keys()]) cancelDeerSpeechClock(seat)
      }
      for (let j = 1; j <= add_indices.length; j++) {
        annstr += order[add_indices[j - 1]] + "号玩家" + player_name[add_indices[j - 1]] + "发言为：" + add_ann[j - 1] + "\n"
      }
      ann_off = true
      vote_off = false
      sumup += "第" + round + "轮加时" + annstr.slice(2)
      notifySession(session, annstr + "现在开始投票。")
      prepareVoteWindowAndNotifyPlayers(session, true)
      flag_just_vote = true
      timer_hurry = setGameTimeout(()=>{
        hurry_vote(session)
        flag_just_vote = false
      }, timeout_for_hurry)
      if (timeout_mode <= 4) {
        timer_vote = setGameTimeout(() => {
          return timeout_vote_auto(session)
        }, timeout_for_vote);
        notifyGroup(session, "本次投票阶段限时：" + formatConfiguredDuration(config.voteTimeout), "加时投票限时通知")
      }
    }
  }
  const players_timeout_outcast = async (session, outcast) => {
    if (game_off || ann_off) return
    const guildId = gameRoute.guildId
    const validOutcasts = outcast.filter((outplayer) => {
      const playerIndex = order.indexOf(outplayer)
      return playerIndex !== -1 && (!add_flag || add_indices.indexOf(playerIndex) !== -1)
    })
    if (validOutcasts.length === 0) {
      if (add_flag) endOvertimeAnn(session)
      else end_ann(session)
      return
    }

    const outIndices = validOutcasts.map(outplayer => order.indexOf(outplayer))
    validOutcasts.forEach(seat => historyDepartureReasons.set(seat, 'timeout'))
    let out_str = ""
    for (let i = 0; i < validOutcasts.length; i++) {
      kickout.push(validOutcasts[i])
      out_str += validOutcasts[i] + "号玩家" + player_name[outIndices[i]] + "，"
    }
    out_str = out_str.slice(0, -1)
    sumup += out_str + "发言超时，被自动踢出。\n"
    await players_out(session, validOutcasts, (session, outplayer) => {}, true, true)
    await sendGroupNotice(session, out_str + "发言超时，被自动踢出。", "发言超时离场通知", guildId)
    if (game_off) return
    if (add_flag) {
      gameTimers.cancel(timer_htj)
      gameTimers.cancel(timer_zxz)
      gameTimers.cancel(timer_mwl)
      gameTimers.cancel(timer_wsg)
      gameTimers.cancel(timer_hurry)
      gameTimers.cancel(timer_vote)
      flag_just_vote = false
      gameTimers.cancel(timer_ann)
      round += 1
      add_flag = false
      if (!await new_round(session)) return
      ann = Array(player.length)
      vote.push(Array(player.length))
      poll = Array(player.length).fill(0)
      shield = Array(player_copy.length).fill(false)
      annstr = "本轮发言结果：\n"
      vstr = "本轮投票结果：\n"
      notifyGroup(session, "踢出正在进行加时的玩家，结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "超时结束加时通知", guildId)
      return
    }
    if (modeInteraction.mode === "turtle") rebuildTurtleAnnouncementProjection()
    else removeArrayIndicesInPlace(ann, outIndices)
    removeArrayIndicesInPlace(vote[round - 1], outIndices)
    end_ann(session)
  }
  const timeout_ann_auto = async (session) => {
    if (game_off || ann_off || boom_pending) return
    let drag_player = []
    if (add_flag) {
      for (let i = 0; i < add_indices.length; i++) {
        if (isEmpty(add_ann[i]) && !deerSeatNeedsSelection(order[add_indices[i]])){
          drag_player.push(order[add_indices[i]])
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(ann[i]) && !deerSeatNeedsSelection(order[i])) {
          drag_player.push(order[i])
        }
      }
    }
    await players_timeout_outcast(session, drag_player)
  }
  const writeTurtleAnnouncement = (session: Session, seat: number) => {
    const text = turtleAnnouncementText(seat)
    if (!text) return
    const turtleState = modeInteraction.state
    const turn = turtleState.kind === 'turtle' ? turtleState.rounds.get(turtleState.activeRoundKey!)?.get(seat) : undefined
    recordSpeech(session, seat, text, turn?.question, turn?.answer)
    const activeIndex = order.indexOf(seat)
    if (add_flag) {
      const overtimeIndex = add_indices.indexOf(activeIndex)
      if (overtimeIndex !== -1) add_ann[overtimeIndex] = text
    }
    else if (activeIndex !== -1) ann[activeIndex] = text
  }
  const turtleProgressText = () => {
    const progress = modeInteraction.turtleProgress()
    const seats = (values: number[]) => values.length > 0 ? values.join("、") : "无"
    return "龟模式进度：未提问 " + seats(progress.waitingQuestion)
      + "；待主持回答 " + seats(progress.pendingHost)
      + "；已完成 " + seats(progress.complete) + "。"
  }
  const finishTurtleSpeechRound = (session: Session) => {
    cancelTurtleTimers()
    if (add_flag) endOvertimeAnn(session)
    else end_ann(session)
  }
  ctx.guild().middleware(async (session: Session, next) => {//龟模式主持回答与进度
    if (game_off || modeInteraction.mode !== "turtle" || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (ann_off && !modeInteraction.turtleHasPendingHost()) return next()
    if (session.content.replace(/\s/g, "") === "龟进度") return turtleProgressText()
    if (session.userId !== hostid) return next()
    if (replacementRequest.hasPending && /^(?:是|否)$/.test(session.content.trim())) return next()
    const quoteReference = resolveModeMessageReference({
      quote: session.quote,
      eventQuote: session.event.message?.quote,
      rawMessage: session.event._data?.message,
      onebotMessage: (session as any).onebot?.message,
    })
    const quotedSeat = quoteReference
      ? modeInteraction.turtleSeatForQuestionReference(quoteReference)
      : undefined
    if (quoteReference) {
      diagnosticLog.record({ scope: 'group', platform: session.platform, selfId: session.selfId,
        guildId: gameRoute.guildId, gameId: gameInstanceId, direction: 'internal', handler: 'turtle-reference',
        referenceId: quoteReference.messageId, roundKey: modeInteraction.turtleActiveRoundKey,
        revision: speechPhases.current()?.revision, seat: quotedSeat, result: quotedSeat === undefined ? 'unmatched' : 'matched' })
    }
    if (quoteReference && quotedSeat === undefined) {
      const unquotedInput = parseTurtleHostInput(session.content)
      if (unquotedInput.kind !== "invalid") {
        return ("引用的消息不属于本轮仍有效的问题，请重新引用当前问题或发送座位号加答案。")
      }
    }
    const input = parseTurtleHostInput(session.content, quotedSeat)
    if (input.kind === "seat-mismatch") {
      return ("回答中的座位号与引用问题不一致：引用的是" + input.quotedSeat + "号，正文写的是" + input.seat + "号。")
    }
    if (input.kind === "invalid") {
      if (quoteReference && /^(?:改\s*)?(?:是也不是|不确定|无关|是|否|驳回)/.test(session.content.trim())) {
        return ("引用的消息不属于本轮仍有效的问题，请重新引用当前问题或发送座位号加答案。")
      }
      if (/^(?:改\s*)?(?:是也不是|不确定|无关|是|否|驳回)(?:[\s，,:：]+.*)?$/s.test(session.content.trim())) {
        return ("未识别到有效的引用消息，请重新引用当前问题，或发送座位号加答案。")
      }
      return next()
    }
    const currentTurn = modeInteraction.turtleTurnForSeat(input.seat)
    if (input.kind === "correction" || (input.kind === "answer" && currentTurn?.status === "complete")) {
      const corrected = modeInteraction.correctTurtleAnswer(input.seat, input.answer)
      if (corrected.kind === "not-found") return ("该座位不在本轮龟模式问答名单中。")
      if (corrected.kind === "not-complete") return ("该座位尚未完成问答，不能更正答案。")
      writeTurtleAnnouncement(session, input.seat)
      return
    }
    const result = modeInteraction.answerTurtleQuestion(input, Date.now())
    if (result.kind === "not-found") return ("该座位不在本轮龟模式问答名单中。")
    if (result.kind === "not-pending") return ("该座位当前没有等待主持人回答的问题。")
    cancelTurtleSeatTimers(input.seat)
    if (result.kind === "rejected") {
      armTurtleSpeechTimer(session, input.seat)
      messages.bestEffort(
        `龟模式${input.seat}号驳回通知`,
        () => session.bot.sendPrivateMessage(result.turn.userId, "主持人驳回了你的问题，请在剩余时间内重新提问。" + (result.reason ? "原因：" + result.reason : "")),
      )
      return ("已驳回" + input.seat + "号玩家的问题，该玩家可以重新提问。")
    }
    writeTurtleAnnouncement(session, input.seat)
    const allComplete = modeInteraction.turtleAllComplete()
    if (allComplete && !ann_off) finishTurtleSpeechRound(session)
    if (notifications.turtleAnswerPrivate) {
      messages.bestEffort(
        `龟模式${input.seat}号回答通知`,
        () => session.bot.sendPrivateMessage(result.turn.userId, "主持人已回答你的问题：" + result.turn.answer + "。本轮问答已完成。"),
      )
    }
    return
  })
  ctx.guild().middleware(async (session: Session, next) => {//龟模式玩家提问
    if (game_off || modeInteraction.mode !== "turtle" || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (session.userId === hostid) return next()
    if (replacementRequest.hasPending && replacementRequest.applicant?.userId === session.userId) return next()
    const parsed = parseTurtleQuestion(session.content)
    if (!parsed) return next()
    const activeIndex = player.indexOf(session.userId)
    if (activeIndex === -1 || order[activeIndex] !== parsed.seat) return next()
    const backfill = ann_off && !vote_off && turtleBackfillSeats.has(parsed.seat)
      && turtleBackfillUsers.get(parsed.seat) === session.userId
    if (ann_off && !backfill) return next()
    const stripped = parsed.question.replace(regex, "").replace(/[《》·\s]/g, "")
    if (stripped.startsWith("自爆")) return ("本模式不能自爆。")
    const submitted = modeInteraction.submitTurtleQuestion(session.userId, parsed.seat, parsed.question, Date.now())
    if (submitted.kind === "not-player" || submitted.kind === "wrong-seat") return next()
    if (submitted.kind === "empty") return ("问题不能为空，请在座位号后输入问题。")
    if (submitted.kind === "pending") return ("你的问题正在等待主持人回答，不能替换；被驳回后才可重问。")
    if (submitted.kind === "complete") return ("你本轮已经完成问答。")
    if (submitted.kind === "expired") {
      await players_timeout_outcast(session, [parsed.seat])
      return ("你的独立提问时间已经用尽。")
    }
    gameTimers.cancel(turtleSpeechTimers.get(parsed.seat))
    turtleSpeechTimers.delete(parsed.seat)
    modeInteraction.recordTurtleQuestionMessage(
      parsed.seat,
      [session.messageId].filter(Boolean).map(String),
      session.content,
    )
    if (backfill) {
      turtleBackfillSeats.delete(parsed.seat)
      turtleBackfillUsers.delete(parsed.seat)
    }
    if (!backfill) armTurtleAnswerTimer(session, parsed.seat)
    const prompt = turtleHostAnswerPrompt(parsed.seat)!
    let promptIds: string[] = []
    const delivered = await messages.state(
      `龟模式${parsed.seat}号主持回答提示`,
      async () => {
        const ids = await session.bot.sendPrivateMessage(hostid, prompt)
        promptIds = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String)
      },
    )
    if (delivered) {
      modeInteraction.recordTurtleQuestionMessage(
        parsed.seat,
        [session.messageId, ...promptIds].filter(Boolean).map(String),
        session.content,
      )
      return
    }
    return `龟模式${parsed.seat}号玩家的问题已记录，但主持人私聊提示发送失败；主持人可直接按群内问题发送座位号加答案，或私聊发送“待处理操作”补取。`
  })
  ctx.guild().middleware(async (session: Session, next) => {//发言阶段
    if (game_off || ann_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (modeInteraction.mode === "turtle") return next()
    const deerSpeakerIndex = player.indexOf(session.userId)
    if (deerSpeakerIndex !== -1 && deerSeatNeedsSelection(order[deerSpeakerIndex])) {
      const ownSeat = String(order[deerSpeakerIndex])
      if (session.content.trimStart().startsWith(ownSeat)) {
        return ("你需要先私聊提交选人并通过主持人审核，才能发言。")
      }
      return next()
    }
    let str_ann = session.content
    while (str_ann.search(/\s/) === 0) {
      str_ann = str_ann.replace(/\s/, "")
    }
    if (add_flag) {
      let p = player.indexOf(session.userId)
      let n = order[p]
      let q = add_indices.indexOf(p)
      //notifySession(session, "p="+p+",q="+q)
      if (n > 0 && q !== -1 && str_ann.indexOf(String(n)) === 0) {
        let str_bald = str_ann.replace(String(n), "").replace(regex, "").replace(/[《》·\s]/g, "")
        if (str_bald.indexOf("自爆") === 0) {
        if (!modeInteraction.module.allowsSelfExplosion) return ("本模式不能自爆。")
          if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) return ("未到轮次，无法自爆。")
          if (boom_pending) return ("已有玩家自爆了哦，无法再次自爆。")
          boomname = resolvePlayerNickname(session)
          recordSpeech(session, n, str_ann)
          sumup += n + "号玩家" + boomname + "自爆，发言为：" + str_ann + "\n"
          if (uc.indexOf(n) === -1) {
            if (n === white) {
              if (str_bald.indexOf(item1) === -1 || str_bald.indexOf(item2) === -1) {
                if (isEmpty(uc)) {
                  beginBoomAdjudication(session, 3)
                }
                else {
                  beginBoomAdjudication(session, 2)
                }
              }
              else {
                sumup += "白板自爆成功，游戏结束，白板胜利"
                notifySession(session, "白板自爆成功，游戏结束，白板胜利")
                increment = config.scoreWhiteBoomWin
                await addScore(boomname, increment, 'adjudicated-white-boom-win')
                ptsstr += boomname + "加" + increment + "分。"
                await sendScoreSummary(session, 'white')
              }
            }
            else {
              increment = config.scoreGoodBoomNoWin
              sumup += "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
              notifySession(session, "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。")
              for (let i = 0; i < player_copy.length; i++) {
                if ((uc_copy.indexOf(i + 1) !== -1 || i + 1 === white_copy) && !isEmpty(player_copy[i])) {
                  await addScore(player_copy[i], increment, 'adjudicated-good-boom-no-winner')
                  ptsstr += player_copy[i] + "，"
                }
              }
              ptsstr = ptsstr.slice(0, -1)
              ptsstr += "加" + increment + "分。"
              await sendScoreSummary(session, 'none')
            }
          }
          else {
            if (str_bald.indexOf(item1) === -1) {
              beginBoomAdjudication(session, 1)
            }
            else {
              notifySession(session, "卧底自爆成功，卧底胜利")
              sumup += "卧底自爆成功，卧底胜利"
              increment = config.scoreUndercoverWin
              for (let i = 0; i < player_copy.length; i++) {
                if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
                  await addScore(player_copy[i], increment, 'adjudicated-undercover-boom-win')
                  ptsstr += player_copy[i] + "，"
                }
              }
              ptsstr = ptsstr.slice(0, -1)
              ptsstr += "加" + increment + "分。"
              await addScore(boomname, config.scoreUndercoverBoomBonus, 'adjudicated-undercover-boom-bonus')
              ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
              await sendScoreSummary(session, 'undercover')
            }
          }
          if (boom_pending) {
            // add_flag = false
            notifySession(session, "有玩家自爆，但bot未能匹配到对应词条，请主持人在" + Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) / 60 + "分钟内判断自爆是否成功。（在群里发送“是”或“否”）")
          }
          else {
            end_game({ kind: 'completed', reason: n === white || uc.includes(n) ? 'self-explosion' : 'rule-no-winner', winner: n === white ? 'white' : uc.includes(n) ? 'undercover' : 'none' })
          }
          return
        }
        add_ann[q] = str_ann
        recordSpeech(session, n, str_ann)
        cancelDeerSpeechClock(n)
        endOvertimeAnn(session)
        return
      }
      else if (!(boom_pending && session.userId === hostid)) {
        return next()
      }
    }
    let p = player.indexOf(session.userId)
    let n = order[p]
    if (n > 0 && p !== -1 && str_ann.indexOf(String(n)) === 0) {
      let str_bald = str_ann.replace(String(n), "").replace(regex, "").replace(/[《》·\s]/g, "")
      if (str_bald.indexOf("自爆") === 0) {
        if (!modeInteraction.module.allowsSelfExplosion) return ("本模式不能自爆。")
        if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) return ("未到轮次，无法自爆。")
        if (boom_pending) return ("已有玩家自爆了哦，无法再次自爆。")
        boomname = resolvePlayerNickname(session)
        recordSpeech(session, n, str_ann)
        sumup += "第" + round + "轮" + n + "号玩家" + boomname + "自爆，发言为：" + str_ann + "\n"
        if (uc.indexOf(n) === -1) {
          if (n === white) {
            if (str_bald.indexOf(item1) === -1 || str_bald.indexOf(item2) === -1) {
              if (isEmpty(uc)) {
                beginBoomAdjudication(session, 3)
              }
              else {
                beginBoomAdjudication(session, 2)
              }
            }
            else {
              sumup += "白板自爆成功，游戏结束，白板胜利"
              notifySession(session, "白板自爆成功，游戏结束，白板胜利")
              increment = config.scoreWhiteBoomWin
              await addScore(boomname, increment, 'direct-white-boom-win')
              ptsstr += boomname + "加" + increment + "分。"
              await sendScoreSummary(session, 'white')
            }
          }
          else {
            increment = config.scoreGoodBoomNoWin
            sumup += "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
            notifySession(session, "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。")
            for (let i = 0; i < player_copy.length; i++) {
              if ((uc_copy.indexOf(i + 1) !== -1 || i + 1 === white_copy) && !isEmpty(player_copy[i])) {
                await addScore(player_copy[i], increment, 'direct-good-boom-no-winner')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            await sendScoreSummary(session, 'none')
          }
        }
        else {
          if (str_bald.indexOf(item1) === -1) {
            beginBoomAdjudication(session, 1)
          }
          else {
            sumup += "卧底自爆成功，游戏结束，卧底胜利"
            notifySession(session, "卧底自爆成功，游戏结束，卧底胜利")
            increment = config.scoreUndercoverWin
            for (let i = 0; i < player_copy.length; i++) {
              if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
                await addScore(player_copy[i], increment, 'direct-undercover-boom-win')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            await addScore(boomname, config.scoreUndercoverBoomBonus, 'direct-undercover-boom-bonus')
            ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
            await sendScoreSummary(session, 'undercover')
          }
        }
        if (boom_pending) {
          notifySession(session, "有玩家自爆，但bot未能匹配到对应词条，请主持人在" + Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) / 60 + "分钟内判断自爆是否成功。（在群里发送“是”或“否”）")
        }
        else {
          end_game({ kind: 'completed', reason: n === white || uc.includes(n) ? 'self-explosion' : 'rule-no-winner', winner: n === white ? 'white' : uc.includes(n) ? 'undercover' : 'none' })
        }
        return
      }
      ann[p] = str_ann
      recordSpeech(session, n, str_ann)
      cancelDeerSpeechClock(n)
      end_ann(session)
    }
    else if (boom_pending && session.userId === hostid) {
      if (str_ann === "是") {
        gameTimers.cancel(timer_boom)
        switch (boom_state) {
          case 1:
            sumup += "卧底自爆成功，游戏结束，卧底胜利"
            notifySession(session, "卧底自爆成功，游戏结束，卧底胜利")
            increment = config.scoreUndercoverWin
            for (let i = 0; i < player_copy.length; i++) {
              if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
                await addScore(player_copy[i], increment, 'confirmed-undercover-boom-win')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            await addScore(boomname, config.scoreUndercoverBoomBonus, 'confirmed-undercover-boom-bonus')
            ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
            await sendScoreSummary(session, 'undercover')
            break
          case 2:
            sumup += "白板自爆成功，游戏结束，白板胜利"
            notifySession(session, "白板自爆成功，游戏结束，白板胜利")
            increment = config.scoreWhiteBoomWin
            await addScore(boomname, increment, 'confirmed-white-boom-win-two')
            ptsstr += boomname + "加" + increment + "分。"
            await sendScoreSummary(session, 'white')
            break
          case 3:
            sumup += "白板自爆成功，游戏结束，白板胜利"
            notifySession(session, "白板自爆成功，游戏结束，白板胜利")
            increment = config.scoreWhiteBoomWin
            await addScore(boomname, increment, 'confirmed-white-boom-win-three')
            ptsstr += boomname + "加" + increment + "分。"
            await sendScoreSummary(session, 'white')
            break
          default:
            notifySession(session, "出现未知bug，游戏已结束。")
        }
      }
      else if (str_ann === "否") {
        gameTimers.cancel(timer_boom)
        switch (boom_state) {
          case 1:
            sumup += "卧底自爆失败，游戏结束，好人胜利。"
            notifySession(session, "卧底自爆失败，游戏结束，好人胜利。")
            increment = config.scoreGoodWin
            for (let i = 0; i < player_copy.length; i++) {
              if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
                await addScore(player_copy[i], increment, 'boom-resolution-good-win')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            await sendScoreSummary(session, 'good')
            break
          case 2:
            let w = order.indexOf(white)
            const whiteEliminationText = publicHeroEliminationText(
              white,
              "白板自爆失败，场上仍有卧底在场，白板" + white + "号玩家" + player_name[w],
              "出局，游戏继续。",
            )
            sumup += whiteEliminationText
            notifySession(session, whiteEliminationText)
            flag_white = false
            boom_pending = false
            capture(r => r.leave(white, 'skill', Date.now()))
            player.splice(w, 1)
            player_name.splice(w, 1)
            order.splice(w, 1)
            stalemate.reset()
            if (order.indexOf(heros[HERO.WU_SAN_GUI]) !== -1) {
              wuSanGuiModule.removeAttacker(heroState, white)
            }
            white = 0
            if (add_flag) {
              gameTimers.cancel(timer_htj)
              gameTimers.cancel(timer_zxz)
              gameTimers.cancel(timer_mwl)
              gameTimers.cancel(timer_wsg)
              gameTimers.cancel(timer_hurry)
              gameTimers.cancel(timer_vote)
              flag_just_vote = false
              gameTimers.cancel(timer_ann)
              round += 1
              add_flag = false
              if (!await new_round(session)) return
              ann = Array(player.length)
              vote.push(Array(player.length))
              poll = Array(player.length).fill(0)
              shield = Array(player_copy.length).fill(false)
              annstr = "本轮发言结果：\n"
              vstr = "本轮投票结果：\n"
              notifyGroup(session, "结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "自爆判定结束加时通知")
              return
              // if (add_indices.indexOf(w) !== -1) {

              // }
              // else {
              //   add_voter.splice(add_voter.indexOf(player[w]), 1)
              //   for (let i = 0; i < add_indices.length; i++) {
              //     if (w < add_indices[i]) add_indices[i] -= 1
              //   }
              //   add_vote[round - 1] = Array(add_voter.length)
              // }
            }
            else {
              ann.splice(w, 1)
              end_ann(session)
              if (!ann_off && (timeout_mode === 1 || timeout_mode === 3 || (timeout_mode === 2 && round > 1))) {
                const t = annTimeoutMs(timeout_mode)
                const phase = speechPhases.current()
                timer_ann = setGameTimeout(() => {
                  if (!speechPhases.matches(phase)) return
                  return timeout_ann_auto(session)
                }, t)
                notifyGroup(session, "自爆判定结束，发言阶段恢复；本阶段重新限时" + t / 60000 + "分钟。", "自爆判定后发言恢复通知")
              }
            }
            return
          case 3:
            sumup += "白板自爆失败，场上已无卧底在场，游戏结束，好人胜利。"
            notifySession(session, "白板自爆失败，场上已无卧底在场，游戏结束，好人胜利。")
            increment = config.scoreGoodWin
            for (let i = 0; i < player_copy.length; i++) {
              if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
                await addScore(player_copy[i], increment, 'boom-resolution-good-win-alternate')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            await sendScoreSummary(session, 'good', true)
            break
          default:
            notifySession(session, "出现未知bug，游戏已结束。")
        }
      }
      else {
        return ("不识别的语句，请主持人发送“是”或“否”。")
      }
      end_game(boom_state >= 1 && boom_state <= 3 ? { kind: 'completed', reason: 'self-explosion', winner: str_ann === '否' ? 'good' : boom_state === 1 ? 'undercover' : 'white' } : { kind: 'aborted', reason: 'system-error' })
      return
    }
    else return next()
  })
  ctx.guild().middleware((session: Session, next) => {
    if (game_off || !ann_off || vote_off || modeInteraction.mode === 'turtle'
      || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const index = player.indexOf(session.userId)
    const seat = order[index]
    if (index < 0 || !speechBackfillSeats.has(seat) || speechBackfillUsers.get(seat) !== session.userId) return next()
    const content = session.content.trimStart()
    if (!content.startsWith(String(seat)) || !content.slice(String(seat).length).trim()) return next()
    if (deerSeatNeedsSelection(seat)) return "你需要先私聊提交选词并通过主持人审核，才能补发言。"
    recordSpeech(session, seat, content)
    speechBackfillSeats.delete(seat)
    speechBackfillUsers.delete(seat)
    // Optional backfill belongs to the preceding speech phase. It does not
    // reopen speech, execute speech-window skills, or alter current ballots.
    return "已记录第" + seat + "号补位发言。"
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//白板猜人
    if (game_off || !matchesActiveSession(session)) return next()
    if (!flag_white) return next()
    if (!modeInteraction.module.allowsWhiteRecruitment) return next()
    if (session.userId !== player[order.indexOf(white)]) return next()
    let str_guess = session.content.replace(/[《》·\s]/g, "").replace(regex, "")
    if (str_guess === "是" || str_guess === "否") return next()
    if (str_guess === item1) {
      capture(r => r.camp(white, 'good'))
      flag_white = false
      sumup += "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出好人词条" + item1 + "，加入好人阵营。\n"
      notifySession(session, "恭喜猜中，成功加入好人或卧底阵营。\n雷点：" + instr1)
      notifyPrivate(session, hostid, "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出好人词条" + item1 + "，加入好人阵营。", "白板加入好人主持人通知")
      white = 0
      white_copy = 0
      if (isEmpty(uc) && !flag_white) {
        sumup += "游戏结束，好人胜利。"
        if (round > uc_copy.length + (white_copy === 0 ? 0 : 1) || player_copy.length - player.length - kickout.length > uc_copy.length + (white_copy === 0 ? 0 : 1)) { increment = config.scoreGoodWin }
        else { increment = config.scoreGoodWinSpeedrun }
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
            await addScore(player_copy[i], increment, 'vote-good-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        await sendScoreSummary(session, 'good')
        notifyGroup(session, "游戏结束，好人胜利。", "白板招安后好人胜利通知")
        end_game({ kind: 'completed', reason: 'recruitment', winner: 'good' })
      }
      return
    }
    else if (str_guess === item2) {
      capture(r => r.camp(white, 'undercover'))
      uc.push(white)
      uc_copy.push(white)
      flag_white = false
      sumup += "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出卧底词条" + item2 + "，加入卧底阵营。\n"
      notifySession(session, "恭喜猜中，成功加入好人或卧底阵营。\n雷点：" + instr2)
      notifyPrivate(session, hostid, "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出卧底词条" + item2 + "，加入卧底阵营。", "白板加入卧底主持人通知")
      white = 0
      white_copy = 0
      if (player.length < 2 * uc.length || (player.length === 2 && uc.length === 1)) {
        sumup += "游戏结束，卧底胜利。"
        increment = config.scoreUndercoverWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
            await addScore(player_copy[i], increment, 'vote-undercover-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        await sendScoreSummary(session, 'undercover')
        notifyGroup(session, "游戏结束，卧底胜利。", "白板招安后卧底胜利通知")
        end_game({ kind: 'completed', reason: 'recruitment', winner: 'undercover' })
      }
      return
    }
    else if (str_guess.indexOf("伐") !== -1 || str_guess.indexOf("守") === 0 || str_guess.indexOf("权") !== -1 || str_guess.indexOf("立") === 0 || (str_guess.indexOf("保") !== -1 && str_guess.indexOf("弃") !== -1)) return next()
    else if (isEmpty(Number(str_guess)) && str_guess !== "弃" && str_guess !== "弃权") return ("未能猜中好人或卧底人物，继续加油~")
    else return next()
  })
  const grantLiZiChengReward = (session: Session) => {
    const liSeat = heros[HERO.LI_ZI_CHENG]
    const reward = vote_num[liSeat - 1]
    const liIndex = order.indexOf(liSeat)
    fa[liSeat - 1] += reward
    liZiChengModule.consumeRewardPending(heroState)
    notifyPrivate(session, player[liIndex], "闯王，本次投票您获得" + reward + "个伐标记。您现在共有" + fa[liSeat - 1] + "个伐标记。", "李自成伐标记通知")
    sumup += liSeat + "号玩家" + player_name[liIndex] + "获得" + reward + "个伐标记。"
    recordSkill(HERO.LI_ZI_CHENG, '获得' + reward + '个“伐”标记')
  }

  const resolveSafeNight = async (session: Session, str_shield: string) => {
    if (isEmpty(add_indices)) {
      notifyGroup(session, str_shield + "因武将技能，免于出局。", "平安夜保护通知")
      sumup += str_shield + "因武将技能，免于出局。\n"
      capture(r => r.outcome(str_shield + "因武将技能，免于出局。"))
    }
    notifyGroup(session, "本轮无人出局，平安夜。", "平安夜通知")
    sumup += "第" + round + "轮无人出局，平安夜。\n"
    capture(r => r.outcome("本轮无人出局，平安夜。"))
    const eligible = isStalemateEligible(order, uc, heros[HERO.LIN_DAN_HAN], heroState)
    const stalemateWin = stalemate.recordSafeNight(round, eligible)
    if (eligible) {
      if (stalemateWin) {
        sumup += "游戏结束，卧底胜利。"
        capture(r => r.outcome("连续两轮平安夜且满足僵局条件，游戏结束，卧底胜利。"))
        increment = config.scoreUndercoverWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
            await addScore(player_copy[i], increment, 'overtime-undercover-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        await sendScoreSummary(session, 'undercover')
        stalemate.reset()
        notifyGroup(session, "连续两轮平安夜且满足僵局条件，游戏结束，卧底胜利。", "僵局卧底胜利通知")
        end_game({ kind: 'completed', reason: 'stalemate', winner: 'undercover' })
        return
      }
      else {
        round += 1
        if (!await new_round(session)) return
        vote_off = true
        ann_off = false
        shield = Array(player_copy.length).fill(false)
        vote.push(Array(player.length))
        if (!add_flag) add_vote.push([])
        ann = Array(player.length)
        poll = Array(player.length).fill(0)
        notifyGroup(session, "游戏继续，开始第" + round + "轮发言。", "平安夜下一轮通知")
      }
    }
    else if (isEmpty(uc) && flag_white && canSettleWhiteSurvival(whiteSurvivalSettlementPending)) {
      sumup += "游戏结束，白板胜利。"
      capture(r => r.outcome("游戏结束，白板胜利。"))
      increment = config.scoreWhiteWin
      await addScore(player_copy[white - 1], increment, 'vote-white-win')
      ptsstr += player_copy[white - 1] + "加" + increment + "分。"
      await sendScoreSummary(session, 'white')
      notifyGroup(session, "游戏结束，白板胜利。", "白板苟赢通知")
      end_game({ kind: 'completed', reason: 'white-survival', winner: 'white' })
      return
    }
    else {
      round += 1
      if (!await new_round(session)) return
      vote_off = true
      ann_off = false
      shield = Array(player_copy.length).fill(false)
      vote.push(Array(player.length))
      if (!add_flag) add_vote.push([])
      ann = Array(player.length)
      poll = Array(player.length).fill(0)
      notifyGroup(session, "游戏继续，开始第" + round + "轮发言。", "普通平安夜下一轮通知")
    }
    if(order.indexOf(heros[HERO.LI_ZI_CHENG]) !== -1 && liZiChengModule.hasRewardPending(heroState)){
      grantLiZiChengReward(session)
    }
    for (let k = 0; k < player.length; k++) {
      if (flag_fa[order[k] - 1] > 0) {
        vote_num[order[k] - 1] -= flag_fa[order[k] - 1]
        flag_fa[order[k] - 1] = 0
      }
    }
    add_flag = false
    annstr = "本轮发言结果：\n"
    vstr = "本轮投票结果：\n"
    return
  }

  const tryPauseForWuSanguiOvertime = (session: Session, add_str_simp: string, add_str_at: string): boolean => {
    const wuSanGuiIndex = order.indexOf(heros[HERO.WU_SAN_GUI])
    if (!wuSanGuiModule.canChooseOvertimeTarget(heroState, {
      heroActive: wuSanGuiIndex !== -1,
      heroIsCandidate: add_indices.includes(wuSanGuiIndex),
    })) return false
    wuSanGuiModule.beginChoice(heroState)
    vote_off = true
    const wuIdentity = publicHeroIdentity(
      heros[HERO.WU_SAN_GUI],
      true,
      String(h('at', { id: player_id_copy[heros[HERO.WU_SAN_GUI] - 1] })),
    )
    const choicePrompt = wuIdentity + "，请" + player_copy[heros[HERO.WU_SAN_GUI] - 1] + "选择：从" + add_str_simp + "中选择带出局的玩家（在群里发送玩家序号），或发送“弃”放弃发动技能。"
    rememberPendingPrompt({
      kind: "wu-san-gui-overtime-choice",
      userId: player_id_copy[heros[HERO.WU_SAN_GUI] - 1],
      content: choicePrompt,
      scope: 'group',
      gameEpoch: gameTimers.epoch,
    })
    if(order.indexOf(heros[HERO.LI_ZI_CHENG]) !== -1 && liZiChengModule.hasRewardPending(heroState)){
      grantLiZiChengReward(session)
    }
    for (let k = 0; k < player.length; k++) {
      if (flag_fa[order[k] - 1] > 0) {
        vote_num[order[k] - 1] -= flag_fa[order[k] - 1]
        flag_fa[order[k] - 1] = 0
      }
    }
    pendingAction.open({
      kind: "wu-san-gui-overtime-choice",
      ownerSeat: heros[HERO.WU_SAN_GUI],
      ownerUserId: player[order.indexOf(heros[HERO.WU_SAN_GUI])],
      channel: { scope: "group", guildId: gameRoute.guildId },
      blocksRosterChanges: true,
      gameEpoch: gameTimers.epoch,
      timeoutMs: timeout,
      resumeAt: ResolutionCursor.WuSanGuiOvertimeChoice,
    })
    notifyGroup(session, choicePrompt, "吴三桂权计选择提示")
    timer_wsg = setGameTimeout(() => {
      recordSkill(HERO.WU_SAN_GUI, '权计选择超时，进入加时')
      sumup += player_name[order.indexOf(heros[HERO.WU_SAN_GUI])] + "（吴三桂）输入超时，放弃发动技能。\n"
      add_flag = true
      wuSanGuiModule.abandonChoice(heroState)
      pendingAction.clear("wu-san-gui-overtime-choice")
      shiKeFaModule.clearTeammateAttackers(heroState)
      let add_str = "吴三桂输入超时，进入第" + round + "轮加时，请" + add_str_at + "发言。"
      add_voter = player.filter((a) => add_indices.indexOf(player.indexOf(a)) === -1)
      sumup += add_str_simp + "平票，进入第" + round + "轮加时。\n"
      capture(r => r.outcome(add_str_simp + "平票，进入第" + round + "轮加时。"))
      waiver = 0
      vote_off = true
      ann_off = false
      ann = Array(player.length)
      add_ann = Array(add_indices.length)
      add_vote.push(Array(add_voter.length))
      poll = Array(player.length).fill(0)
      annstr = "本轮发言结果：\n"
      vstr = "本轮投票结果：\n"
      if (modeInteraction.mode === "deer") {
        startDeerSpeechRound(session)
      }
      else if (modeInteraction.mode === "turtle") {
        startTurtleRound(session)
      }
      else startClassicSpeechPhase(session)
      notifyGroup(session, add_str, "吴三桂超时进入加时通知")
    }, timeout);
    return true
  }

  const beginOrdinaryOvertime = async (session: Session, add_str_at: string, add_str_simp: string) => {
    add_flag = true
    shiKeFaModule.clearTeammateAttackers(heroState)
    let add_str = "进入第" + round + "轮加时，请" + add_str_at + "发言。"
    add_voter = player.filter((a) => add_indices.indexOf(player.indexOf(a)) === -1)
    sumup += add_str_simp + "平票，进入第" + round + "轮加时。\n"
    capture(r => r.outcome(add_str_simp + "平票，进入第" + round + "轮加时。"))
    waiver = 0
    if (modeInteraction.mode === "deer") {
      startDeerSpeechRound(session)
    }
    else if (modeInteraction.mode === "turtle") {
      startTurtleRound(session)
    }
    else startClassicSpeechPhase(session)
    notifyGroup(session, add_str, "进入普通加时通知")
  }

  const announceVoteElimination = (
    session: Session,
    elimination: EliminationContext,
    str_shield: string,
  ) => {
    const eliminatedIndex = elimination.activeSeats.indexOf(elimination.targetSeat)
    if (!isEmpty(str_shield)) {
      notifyGroup(session, str_shield + "因武将技能，免于参与加时。", "投票保护通知")
      sumup += str_shield + "因武将技能，免于参与加时。\n"
    }
    if (!add_flag) add_vote.push([])
    else add_flag = false
    stalemate.reset()
    const eliminationText = publicHeroEliminationText(
      elimination.targetSeat,
      "本轮" + elimination.targetSeat + "号玩家" + player_name[eliminatedIndex],
      "出局。",
    )
    notifyGroup(session, eliminationText, "投票出局通知")
    sumup += "第" + round + "轮" + eliminationText.slice(2) + "\n"
  }

  interface VoteEliminationPipelineContext {
    session: Session
    elimination: EliminationContext
    str_shield: string
    postEliminationControl: ResolutionControl
  }

  interface VoteEliminationResolution {
    control: ResolutionControl
    postEliminationControl: ResolutionControl
  }

  const resolveVoteElimination = async (
    session: Session,
    elimination: EliminationContext,
    str_shield: string,
  ): Promise<VoteEliminationResolution> => {
    const context: VoteEliminationPipelineContext = {
      session,
      elimination,
      str_shield,
      postEliminationControl: continueResolution(),
    }
    const result = await runResolutionPipeline({
      context,
      order: VOTE_ELIMINATION_PIPELINE,
      trace: traceResolution("vote-elimination"),
      handlers: {
        [ResolutionCursor.Eliminate]: (current) => {
          announceVoteElimination(
            current.session,
            current.elimination,
            current.str_shield,
          )
          removeVoteEliminationTarget(current.elimination)
          return continueResolution()
        },
        [ResolutionCursor.CheckVictory]: (current) => {
          // Zhang can still take the white player with him. Only the white
          // survival result waits for that choice; other victory checks keep
          // their established order, including the fewer-than-three rule.
          return resolveEliminationVictory(current.session, whiteSurvivalSettlementPending
            && postEliminationHero(current.elimination.targetSeat, heros, 'vote') !== 'zhang-xian-zhong')
        },
        [ResolutionCursor.PostElimination]: async (current) => {
          current.postEliminationControl = await resolveVotePostEliminationEffect(
            current.session,
            current.elimination.targetSeat,
          )
          return continueResolution()
        },
        [ResolutionCursor.NextRound]: async (current) => {
          if (current.postEliminationControl.kind !== "continue") {
            return continueResolution()
          }
          await continueVoteAfterElimination(current.session)
          return game_off ? endResolution() : continueResolution()
        },
      },
    })
    return {
      control: result.control,
      postEliminationControl: context.postEliminationControl,
    }
  }

  const removeVoteEliminationTarget = (elimination: EliminationContext) => {
    historyDepartureReasons.set(elimination.targetSeat, 'vote')
    splice_player(elimination.targetSeat, false, false)
    boom_pending = false
  }

  const resolveVotePostEliminationEffect = async (
    session: Session,
    outplayer: number,
  ): Promise<ResolutionControl> => {
    //张献忠
    if (postEliminationHero(outplayer, heros, 'vote') === "zhang-xian-zhong") {
      promptZhangXianZhongTarget(session, outplayer)
      if(order.indexOf(heros[HERO.LI_ZI_CHENG]) !== -1 && liZiChengModule.hasRewardPending(heroState)){
        grantLiZiChengReward(session)
      }
      for (let k = 0; k < player.length; k++) {
        if (flag_fa[order[k] - 1] > 0) {
          vote_num[order[k] - 1] -= flag_fa[order[k] - 1]
          flag_fa[order[k] - 1] = 0
        }
      }
      vote_off = true
      beginZhangXianZhongTarget(session)
      return pauseResolution(ResolutionCursor.PostElimination)
    }
    //史可法
    if(postEliminationHero(outplayer, heros, 'vote') === "shi-ke-fa"){
      promptShiKeFaGift(session, outplayer)
    }
    return continueResolution()
  }

  const continueVoteAfterElimination = async (session: Session) => {
    round += 1
    if (!await new_round(session)) return
    shield = Array(player_copy.length).fill(false)
    vote_off = true
    ann_off = false
    notifyGroup(session, "游戏继续，开始第" + round + "轮发言。", "投票出局后下一轮通知")
  }

  const runVoteNextRoundCursor = async (session: Session) => {
    await runResolutionPipeline({
      context: { session },
      order: [ResolutionCursor.NextRound],
      trace: traceResolution("vote-next-round"),
      handlers: {
        [ResolutionCursor.NextRound]: async (current) => {
          await continueVoteAfterElimination(current.session)
          return game_off ? endResolution() : continueResolution()
        },
      },
    })
  }

  const resumeZhangXianZhongAtNextRound = async (session: Session) => {
    await runVoteNextRoundCursor(session)
    if (game_off) return
    ann = Array(player.length)
    add_ann = Array(add_indices.length)
    if (add_flag) add_vote.push(Array(add_voter.length))
    else vote.push(Array(player.length))
    poll = Array(player.length).fill(0)
    shield = Array(player_copy.length).fill(false)
    annstr = "本轮发言结果：\n"
    vstr = "本轮投票结果：\n"
  }

  const completeVoteResolutionState = (session: Session) => {
    if(order.indexOf(heros[HERO.LI_ZI_CHENG]) !== -1 && liZiChengModule.hasRewardPending(heroState)){
      grantLiZiChengReward(session)
    }
    for (let k = 0; k < player.length; k++) {
      if (flag_fa[order[k] - 1] > 0) {
        vote_num[order[k] - 1] -= flag_fa[order[k] - 1]
        flag_fa[order[k] - 1] = 0
      }
    }
    ann = Array(player.length)
    add_ann = Array(add_indices.length)
    if (add_flag) add_vote.push(Array(add_voter.length))
    else vote.push(Array(player.length))
    poll = Array(player.length).fill(0)
    annstr = "本轮发言结果：\n"
    vstr = "本轮投票结果：\n"
  }

  const resolveFinalVote = async ({
    maximum,
    session,
  }: FinalVoteResolutionInput): Promise<ResolutionControl> => {
    whiteSurvivalSettlementPending = flag_white && white_only
      && (!add_flag || add_indices.some(index => order[index] === white))
    const historyVoters = add_flag ? add_voter : player
    const historyBallots = add_flag ? add_vote[round - 1] : vote[round - 1]
    const historyEntries = historyVoters.filter(id => player.includes(id)).map(id => {
      const raw = historyBallots?.[historyVoters.indexOf(id)]
      const voterSeat = order[player.indexOf(id)]
      const targetSeat = Number.isInteger(raw) && order.includes(raw) ? raw : null
      // Mao Wenlong's 据岛 leaves the regular ballot empty; 塘报 is settled
      // separately after the ordinary voters, so an empty ballot here is a
      // skipped phase rather than a timeout.
      const maoSkippedRegularBallot = voterSeat === heros[HERO.MAO_WEN_LONG]
        && (raw === undefined || raw === null)
      const status: 'vote' | 'skip' | 'abstain' | 'locked' | 'timeout' = targetSeat !== null ? 'vote'
        : maoSkippedRegularBallot ? 'skip'
          : vote_num[voterSeat - 1] === 0 ? 'skip'
          : raw === 0 ? 'abstain'
            : raw === -1 && lockedVoteSeats.has(votePhaseKey(voterSeat)) ? 'locked' : 'timeout'
      const targetIndex = targetSeat === null ? -1 : order.indexOf(targetSeat)
      return {
        voterSeat,
        targetSeat,
        ...(targetIndex >= 0 ? { targetNickname: player_name[targetIndex] } : {}),
        weight: vote_num[voterSeat - 1],
        status,
      }
    })
    capture(r => r.vote(historyEntries, order.map((seat, i) => ({ seat, count: poll[i] }))))
    if (order.includes(heros[HERO.LIN_DAN_HAN]) && (heroState.linDanHan.preventedVotePower > 0 || linDanHanModule.isOwnVoteInvalidated(heroState))) {
      const linSeat = heros[HERO.LIN_DAN_HAN]
      const attackers = historyEntries
        .filter(entry => entry.voterSeat !== linSeat && entry.targetSeat === linSeat
          && linDanHanModule.hasPendingVoteAttack(heroState, entry.voterSeat))
        .map(entry => entry.voterSeat)
      recordSkill(HERO.LIN_DAN_HAN,
        `避实抵消${heroState.linDanHan.preventedVotePower}票${linDanHanModule.isOwnVoteInvalidated(heroState) ? '；本人投票失效' : ''}`,
        attackers)
    }
    gameTimers.cancel(timer_hurry)
    gameTimers.cancel(timer_vote)
    flag_just_vote = false
    notifyGroup(session, vstr, "投票结果通知")
    const outcome = classifyVoteOutcome({
      poll,
      maximum,
      activeSeats: order,
      playerNames: player_name,
      shieldsBySeat: shield,
      overtime: add_flag,
    })
    add_indices = outcome.candidateIndices
    const str_shield = outcome.shieldedDescription
    let postEliminationControl: ResolutionControl = continueResolution()
    if (outcome.kind !== "elimination") {
      if (outcome.kind === "safe-night") {
        await resolveSafeNight(session, str_shield)
        return game_off ? endResolution() : continueResolution()
      }
      if (flag_white && isEmpty(uc) && canSettleWhiteSurvival(whiteSurvivalSettlementPending) && add_indices.indexOf(order.indexOf(white)) === -1) {
        if (!isEmpty(str_shield)) {
          notifyGroup(session, str_shield + "因武将技能，免于参与加时。", "白板结算保护通知")
          sumup += str_shield + "因武将技能，免于参与加时。\n"
        }
        sumup += "白板未参与加时，游戏结束，白板胜利。"
        capture(r => r.outcome("白板未参与加时，游戏结束，白板胜利。"))
        increment = config.scoreWhiteWin
        await addScore(player_copy[white - 1], increment, 'overtime-white-win')
        ptsstr += player_copy[white - 1] + "加" + increment + "分。"
        await sendScoreSummary(session, 'white')
        notifyGroup(session, "白板未参与加时，游戏结束，白板胜利。", "白板未参与加时胜利通知")
        end_game({ kind: 'completed', reason: 'white-survival', winner: 'white' })
        annstr = "本轮发言结果：\n"
        vstr = "本轮投票结果：\n"
        return endResolution()
      }
      else {
        if (!isEmpty(str_shield)) {
          notifyGroup(session, str_shield + "因武将技能，免于参与加时。", "加时保护通知")
          sumup += str_shield + "因武将技能，免于参与加时。\n"
        }
        add_str_simp = ""
        add_str_at = ""
        for (let i = 0; i < add_indices.length; i++) {
          add_str_simp += order[add_indices[i]] + "号玩家" + player_name[add_indices[i]] + ","
          add_str_at += order[add_indices[i]] + "号玩家" + player_name[add_indices[i]] + h('at', { id: player[add_indices[i]] }) + ","
        }
        add_str_simp = add_str_simp.slice(0, -1)
        add_str_at = add_str_at.slice(0, -1)
        if (tryPauseForWuSanguiOvertime(session, add_str_simp, add_str_at)) {
          return pauseResolution(ResolutionCursor.WuSanGuiOvertimeChoice)
        }
        await beginOrdinaryOvertime(session, add_str_at, add_str_simp)
      }
      vote_off = true
      ann_off = false
    }
    else {
      const elimination = snapshotEliminationContext({
        gameEpoch: gameTimers.epoch,
        round,
        source: "vote",
        targetSeat: order[add_indices[0]],
        activeSeats: order,
        chainDepth: 0,
      })
      const eliminationResolution = await resolveVoteElimination(
        session,
        elimination,
        str_shield,
      )
      if (eliminationResolution.control.kind === "game-end") {
        return eliminationResolution.control
      }
      postEliminationControl = eliminationResolution.postEliminationControl
    }
    completeVoteResolutionState(session)
    return postEliminationControl
  }
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//投票阶段
    if (game_off || !matchesActiveSession(session)) return next()
    if (session.userId === hostid) return next()
    if (pendingAction.matches("shi-ke-fa-gift", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })) return next()
    let quan_continue = false
    let mao_continue = false
    quan_continue = pendingAction.matches("huang-tai-ji-quan", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })
    mao_continue = pendingAction.matches("mao-wen-long-late-vote", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })
    if (vote_off && !quan_continue && !mao_continue) {
      // notifySession(session, "未到投票阶段，bot暂不识别私信内容。如果你是玩家，请投票阶段再来。")
      return next()
    }
    if (!quan_continue && !mao_continue && voteSettlement.isRunning(currentVoteSettlementKey())) {
      return "投票正在结算，请稍候。"
    }
    let str_vote = session.content.replace(/\s/g, "")
    if (session.userId === player[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])] && str_vote.indexOf("守") === 0 && !quan_continue && !mao_continue) return next()
    if (session.userId === player[order.indexOf(heros[HERO.DUO_ER_GUN])] && (str_vote.indexOf("立") === 0 || (str_vote.indexOf("保") !== -1 && str_vote.indexOf("弃") !== -1)) && !quan_continue && !mao_continue) return next()
    // if(player.indexOf(session.userId) !== -1 && str_vote.indexOf("权") !== -1 && (!add_flag || add_indices.indexOf(player.indexOf(session.userId)) !== -1)){
    //   let o = order[player.indexOf(session.userId)]
    //   if(str_vote === "权") str_vote = "权1"
    //   let n_quan = Number(str_vote.replace("权",""))
    //   if(!isEmpty(n_quan) && n_quan>0 ){
    //     if(quan[o - 1] === 0) return("你目前没有权，无法使用权。")
    //     if(n_quan > quan[o - 1]) return("你目前只有" + quan[o - 1] + "个权，无法使用更多的权。")
    //     else{
    //       quan[o - 1] -= n_quan
    //       poll[order.indexOf(o)] -= n_quan
    //       notifySession(session, "本次投票你的得票数将会减少"+ n_quan + "票。\n剩余权数："+ quan[o - 1])
    //       sumup += o + "号玩家" + player_name[order.indexOf(o)] +"消耗" + n_quan + "个权，使自己本轮得票数减少" + n_quan +"。\n"
    //       return
    //     }
    //   }
    //   else return next()
    // }
    if (player.indexOf(session.userId) !== -1 && str_vote.indexOf("伐") !== -1 && (!add_flag || add_indices.indexOf(player.indexOf(session.userId)) === -1) && !quan_continue) {
      let o = order[player.indexOf(session.userId)]
      if (str_vote === "伐") str_vote = "伐1"
      let n_fa = Number(str_vote.replace("伐", ""))
      if (!isEmpty(n_fa) && n_fa > 0) {
        if (fa[o - 1] === 0) return ("你目前没有伐，无法使用伐。")
        if (n_fa > fa[o - 1]) return ("你目前只有" + fa[o - 1] + "个伐，无法使用更多的伐。")
        else {
          fa[o - 1] -= n_fa
          vote_num[o - 1] += n_fa
          flag_fa[o - 1] += n_fa
          if ((add_flag && add_vote[round - 1][add_voter.indexOf(session.userId)] > 0) && !(linDanHanModule.hasPendingVoteAttack(heroState, order[player.indexOf(session.userId)]) && add_vote[round - 1][add_voter.indexOf(session.userId)] === heros[HERO.LIN_DAN_HAN])) poll[order.indexOf(add_vote[round - 1][add_voter.indexOf(session.userId)])] += n_fa
          else if ((!add_flag && vote[round - 1][player.indexOf(session.userId)] > 0) && !(linDanHanModule.hasPendingVoteAttack(heroState, order[player.indexOf(session.userId)]) && vote[round - 1][player.indexOf(session.userId)] === heros[HERO.LIN_DAN_HAN])) poll[order.indexOf(vote[round - 1][player.indexOf(session.userId)])] += n_fa
          notifySession(session, "本次投票你的投票数将会增加" + flag_fa[o - 1] + "票。\n本次投票你投" + vote_num[o - 1] +"票。\n剩余伐数：" + fa[o - 1])
          sumup += o + "号玩家" + player_name[order.indexOf(o)] + "消耗" + n_fa + "个伐，使自己本次投票数增加" + n_fa + "。\n"
          return
        }
      }
    }
    if (add_flag && !quan_continue && !mao_continue) {
      let d = add_voter.indexOf(session.userId)
      let q = player.indexOf(session.userId)
      if (d == -1) return ("你未参加游戏，或已出局，或加时阶段与他人平票，无法投票。")
      const firstBallot = isEmpty(add_vote[round - 1][d])
      if (order[q] === heros[HERO.MAO_WEN_LONG]) return ("毛帅莫急，且待塘报至再做决断。")
      if (vote_num[order[q] - 1] === 0) {
        return ("因武将技能，你已跳过本次投票阶段。")
      }
      let v = Number(str_vote)
      if (str_vote === "弃" || str_vote === "弃权") {
        if (!isEmpty(add_vote[round - 1][d]) && add_vote[round - 1][d] !== 0) {
          notifySession(session, "已改票。")
          if (flag_notify) notifyPrivate(session, hostid, order[q] + "号玩家" + player_name[q] + "改票为弃权。", "实时改票通知")
            if (add_vote[round - 1][d] === heros[HERO.LIN_DAN_HAN] && linDanHanModule.hasPendingVoteAttack(heroState, order[q])) {
              linDanHanModule.undoVoteAttack(heroState, order[q])
            }
            else {
              poll[order.indexOf(add_vote[round - 1][d])] -= vote_num[order[q] - 1]
              if(add_vote[round - 1][d] === heros[HERO.SHI_KE_FA] && ((uc.indexOf(heros[HERO.SHI_KE_FA]) + 0.5) * (uc.indexOf(order[q]) + 0.5) > 0 && order[q]!==white)){
                shiKeFaModule.removeTeammateAttacker(heroState, order[q])
              }
            }
        }
        else if (add_vote[round - 1][d] === 0) waiver -= 1
        else if (flag_notify) notifyPrivate(session, hostid, order[q] + "号玩家" + player_name[q] + "弃权。", "实时弃票通知")
        add_vote[round - 1][d] = 0
        waiver += 1
      }
      else if (add_indices.indexOf(order.indexOf(v)) !== -1 && v !== order[q]) {
        if (heros[HERO.LIN_DAN_HAN] == order[q] && !linDanHanModule.votableTargets(heroState, [v]).includes(v)) {
          return ("可汗，由于您之前西迁，不能再投票给" + v + "号玩家" + player_name[order.indexOf(v)] + "。")
        }
        if (isEmpty(add_vote[round - 1][d])) {
          if (!(v === heros[HERO.LIN_DAN_HAN] && linDanHanModule.markVoteAttack(heroState, order[q]))) {
            poll[order.indexOf(v)] += vote_num[order[q] - 1]
          }
          if(v === heros[HERO.SHI_KE_FA] && ((uc.indexOf(v) + 0.5) * (uc.indexOf(order[q]) + 0.5) > 0 && order[q]!==white)){
            shiKeFaModule.addTeammateAttacker(heroState, order[q])
          }
          if (flag_notify) notifyPrivate(session, hostid, order[q] + "号玩家" + player_name[q] + "投给了" + v + "号玩家" + player_name[order.indexOf(v)] + "。", "实时投票通知")
        }
        else {
          notifySession(session, "已改票。")
          if (flag_notify) notifyPrivate(session, hostid, order[q] + "号玩家" + player_name[q] + "改票，投给了" + v + "号玩家" + player_name[order.indexOf(v)] + "。", "实时改票通知")
          if (add_vote[round - 1][d] === heros[HERO.LIN_DAN_HAN] && linDanHanModule.hasPendingVoteAttack(heroState, order[q])) {
            linDanHanModule.undoVoteAttack(heroState, order[q])
          }
          else if (add_vote[round - 1][d] !== 0){
            poll[order.indexOf(add_vote[round - 1][d])] -= vote_num[order[q] - 1]
            if(add_vote[round - 1][d] === heros[HERO.SHI_KE_FA] && ((uc.indexOf(heros[HERO.SHI_KE_FA]) + 0.5) * (uc.indexOf(order[q]) + 0.5) > 0 && order[q]!==white)){
              shiKeFaModule.removeTeammateAttacker(heroState, order[q])
            }
          }
          else waiver -= 1
          if (!(v === heros[HERO.LIN_DAN_HAN] && linDanHanModule.markVoteAttack(heroState, order[q]))) {
            poll[order.indexOf(v)] += vote_num[order[q] - 1]
          }
          if(v === heros[HERO.SHI_KE_FA] && ((uc.indexOf(v) + 0.5) * (uc.indexOf(order[q]) + 0.5) > 0 && order[q]!==white)){
            shiKeFaModule.addTeammateAttacker(heroState, order[q])
          }
        }
        add_vote[round - 1][d] = v
      }
      else return ("无效的投票语句，请重新输入。")
      if (firstBallot && notifications.voteFirstSuccessReceipt) {
        notifySession(session, "投票已记录；在本轮结算开始前，你仍可改票。")
      }
      flag = true
      unvote = 0
      fa_tot = 0
      quan_tot = 0
      skip = 0
      let comp = 0
      for (let i = 1; i <= add_voter.length; i++) {
        if (isEmpty(add_vote[round - 1][i - 1]) && vote_num[order[player.indexOf(add_voter[i - 1])] - 1] !== 0) {
          if(order[player.indexOf(add_voter[i - 1])] !== heros[HERO.MAO_WEN_LONG]){
            flag = false
            unvote += vote_num[order[player.indexOf(add_voter[i - 1])] - 1]
          }
          else comp += vote_num[order[player.indexOf(add_voter[i - 1])] - 1]
        }
        else if (vote_num[order[player.indexOf(add_voter[i - 1])] - 1] === 0) {
          skip += 1
        }
        if (vote_num[order[player.indexOf(add_voter[i - 1])] - 1] !== 0) {
          fa_tot += fa[order[player.indexOf(add_voter[i - 1])] - 1]
        }
      }
      for (let j = 1; j <= player.length; j++) {
        quan_tot += quan[order[j - 1] - 1]
      }
      if (flag === false) {
        let max = poll.reduce((a, b) => Math.max(a, b), -Infinity)
        let temp_max_idx = poll.indexOf(max)
        if(order.indexOf(heros[HERO.SHI_KE_FA])!==-1 && shiKeFaModule.isResistanceAvailable(heroState) && shiKeFaModule.hasTeammateAttackers(heroState)){
          poll[order.indexOf(heros[HERO.SHI_KE_FA])] -= 1
        }
        let flag_dorgun_val = false
        const dorgonMark = duoErGunModule.strategyMark(heroState)
        let d = dorgonMark.kind === "new" ? dorgonMark.seat : 0
        if(dorgonMark.kind === "new" && poll[order.indexOf(d)] > 0){
          poll[order.indexOf(d)] -= 1
          flag_dorgun_val = true
        }
        if (poll.indexOf(max, temp_max_idx + 1) === -1) {
          let poll_beheaded = poll.slice(0, temp_max_idx).concat(poll.slice(temp_max_idx + 1))
          let max_2 = poll_beheaded.reduce((a, b) => Math.max(a, b), -Infinity)
          if (max_2 + unvote + comp + fa_tot + quan_tot < max) {
            flag = true
            for (let i = 1; i <= add_voter.length; i++) {
              if (isEmpty(add_vote[round - 1][i - 1]) && vote_num[order[player.indexOf(add_voter[i - 1])] - 1] !== 0) {
                add_vote[round - 1][i - 1] = -1
                lockedVoteSeats.add(votePhaseKey(order[player.indexOf(add_voter[i - 1])]))
                notifyPrivate(session, add_voter[i - 1], "票数已够，无需你再进行投票。", "提前锁票通知")
              }
            }
          }
        }
        if(order.indexOf(heros[HERO.SHI_KE_FA])!==-1 && shiKeFaModule.isResistanceAvailable(heroState) && shiKeFaModule.hasTeammateAttackers(heroState)){
          poll[order.indexOf(heros[HERO.SHI_KE_FA])] += 1
        }
        if(flag_dorgun_val){
          poll[order.indexOf(d)] += 1
          flag_dorgun_val = false
        }
      }
    }
    else if (!quan_continue && !mao_continue) {
      let d = player.indexOf(session.userId)
      if (d == -1) return ("你未参加游戏或已出局，无法投票。")
      const firstBallot = isEmpty(vote[round - 1][d])
      let v_pre = vote[round - 1][d]
      if (order[d] === heros[HERO.MAO_WEN_LONG]) return ("毛帅莫急，且待塘报至再做决断。")
      if (vote_num[order[d] - 1] === 0) {
        return ("因武将技能，你已跳过本次投票阶段。")
      }
      let v = Number(str_vote)
      if (str_vote === "弃" || str_vote === "弃权") {
        if (!isEmpty(vote[round - 1][d]) && vote[round - 1][d] !== 0) {
          notifySession(session, "已改票。")
          if (flag_notify) notifyPrivate(session, hostid, order[d] + "号玩家" + player_name[d] + "改票为弃权。", "实时加时改票通知")
          if (vote[round - 1][d] === heros[HERO.LIN_DAN_HAN] && linDanHanModule.hasPendingVoteAttack(heroState, order[d])) {
            linDanHanModule.undoVoteAttack(heroState, order[d])
          }
          else{
            if (order[d] !== heros[HERO.LIN_DAN_HAN] || !linDanHanModule.isOwnVoteInvalidated(heroState)) {
              poll[order.indexOf(vote[round - 1][d])] -= vote_num[order[d] - 1]
            }
            if(vote[round - 1][d] === heros[HERO.SHI_KE_FA] && ((uc.indexOf(heros[HERO.SHI_KE_FA]) + 0.5) * (uc.indexOf(order[d]) + 0.5) > 0 && order[d]!==white)){
              shiKeFaModule.removeTeammateAttacker(heroState, order[d])
            }
          }
        }
        else if (vote[round - 1][d] === 0) waiver -= 1
        else if (flag_notify) notifyPrivate(session, hostid, order[d] + "号玩家" + player_name[d] + "弃权。", "实时加时弃票通知")
        vote[round - 1][d] = 0
        waiver += 1
      }
      else if (order.indexOf(v) !== -1 && v !== order[d]) {
        if (heros[HERO.LIN_DAN_HAN] == order[d] && !linDanHanModule.votableTargets(heroState, [v]).includes(v)) {
          return ("可汗，由于您之前西迁，不能再投票给" + v + "号玩家" + player_name[order.indexOf(v)] + "。")
        }
        if (isEmpty(vote[round - 1][d])) {
          if (!(v === heros[HERO.LIN_DAN_HAN] && linDanHanModule.markVoteAttack(heroState, order[d]))) {
            poll[order.indexOf(v)] += vote_num[order[d] - 1]
          }
          if(v === heros[HERO.SHI_KE_FA] && ((uc.indexOf(v) + 0.5) * (uc.indexOf(order[d]) + 0.5) > 0 && order[d]!==white)){
            shiKeFaModule.addTeammateAttacker(heroState, order[d])
          }
          if (flag_notify) notifyPrivate(session, hostid, order[d] + "号玩家" + player_name[d] + "投给了" + v + "号玩家" + player_name[order.indexOf(v)] + "。", "实时加时投票通知")
        }
        else {
          notifySession(session, "已改票。")
          if (flag_notify) notifyPrivate(session, hostid, order[d] + "号玩家" + player_name[d] + "改票，投给了" + v + "号玩家" + player_name[order.indexOf(v)] + "。", "实时加时改票通知")
          if (vote[round - 1][d] === heros[HERO.LIN_DAN_HAN] && linDanHanModule.hasPendingVoteAttack(heroState, order[d])) {
            linDanHanModule.undoVoteAttack(heroState, order[d])
          }
          else if (vote[round - 1][d] !== 0) {
            if (order[d] !== heros[HERO.LIN_DAN_HAN] || !linDanHanModule.isOwnVoteInvalidated(heroState)) {
              poll[order.indexOf(vote[round - 1][d])] -= vote_num[order[d] - 1]
            }
            if(vote[round - 1][d] === heros[HERO.SHI_KE_FA] && ((uc.indexOf(heros[HERO.SHI_KE_FA]) + 0.5) * (uc.indexOf(order[d]) + 0.5) > 0 && order[d]!==white)){
              shiKeFaModule.removeTeammateAttacker(heroState, order[d])
            }
          }
          else waiver -= 1
          if (!(v === heros[HERO.LIN_DAN_HAN] && linDanHanModule.markVoteAttack(heroState, order[d]))) {
            poll[order.indexOf(v)] += vote_num[order[d] - 1]
          }
          if(v === heros[HERO.SHI_KE_FA] && ((uc.indexOf(v) + 0.5) * (uc.indexOf(order[d]) + 0.5) > 0 && order[d]!==white)){
            shiKeFaModule.addTeammateAttacker(heroState, order[d])
          }
        }
        vote[round - 1][d] = v
      }
      else return ("无效的投票语句，请重新输入。")
      if (firstBallot && notifications.voteFirstSuccessReceipt) {
        notifySession(session, "投票已记录；在本轮结算开始前，你仍可改票。")
      }
      if (linDanHanModule.isAwakened(heroState) && (order[d] === heros[HERO.LIN_DAN_HAN] || v === heros[HERO.LIN_DAN_HAN] || (!isEmpty(v_pre) && v_pre!==0 && v_pre === heros[HERO.LIN_DAN_HAN]))) {
        if (vote[round - 1][order.indexOf(v)] === order[d]) {
          if (!linDanHanModule.isOwnVoteInvalidated(heroState) || order[d] === heros[HERO.LIN_DAN_HAN]) {
            linDanHanModule.invalidateOwnVote(heroState)
            poll[order.indexOf(vote[round - 1][order.indexOf(heros[HERO.LIN_DAN_HAN])])] -= vote_num[heros[HERO.LIN_DAN_HAN] - 1]
            shiKeFaModule.removeTeammateAttacker(heroState, heros[HERO.LIN_DAN_HAN])
          }
        }
        else {
          if (linDanHanModule.isOwnVoteInvalidated(heroState) && v_pre === heros[HERO.LIN_DAN_HAN]) {
            poll[order.indexOf(vote[round - 1][order.indexOf(heros[HERO.LIN_DAN_HAN])])] += vote_num[heros[HERO.LIN_DAN_HAN] - 1]
          }
          if (heros[HERO.LIN_DAN_HAN] !== vote[round - 1][order.indexOf(vote[round - 1][order.indexOf(heros[HERO.LIN_DAN_HAN])])]) {
            linDanHanModule.restoreOwnVote(heroState)
          }
        }
      }
      if (order[d] === heros[HERO.HUANG_TAI_JI]) {
        const trackedTarget = vote[round - 1][d] || null
        huangTaiJiModule.recordVoteTarget(heroState, trackedTarget)
        if (trackedTarget !== null) notifySession(session, "谨遵陛下旨意，如果在第" + (round + 1) + "轮发言开始前，" + trackedTarget + "号玩家" + player_name[order.indexOf(trackedTarget)] + "出局，则陛下可以获得一个“权”标记。")
      }
      flag = true
      unvote = 0
      fa_tot = 0
      quan_tot = 0
      skip = 0
      let comp = 0
      for (let i = 1; i <= player.length; i++) {
        if (isEmpty(vote[round - 1][i - 1]) && vote_num[order[i - 1] - 1] !== 0) {
          if(order[i - 1] !== heros[HERO.MAO_WEN_LONG]){
            flag = false
            unvote += vote_num[order[i - 1] - 1]
          }
          else comp += vote_num[order[i - 1] - 1]
        }
        else if (vote_num[order[i - 1] - 1] === 0) {
          skip += 1
        }
        if (vote_num[order[i - 1] - 1] !== 0) {
          fa_tot += fa[order[i - 1] - 1]
        }
        quan_tot += quan[order[i - 1] - 1]
      }
      if (flag === false) {
        let flag_skf_val = true
        if(order.indexOf(heros[HERO.SHI_KE_FA])!==-1 && shiKeFaModule.isResistanceAvailable(heroState)){
          let v_skf = vote[round - 1][order.indexOf(heros[HERO.SHI_KE_FA])]
          if(!isEmpty(v_skf) && order.indexOf(v_skf)!==-1 && ((uc.indexOf(heros[HERO.SHI_KE_FA]) + 0.5) * (uc.indexOf(v_skf) + 0.5) > 0 && v_skf!==white)){
            flag_skf_val = false
          }
        }
        else{
          flag_skf_val = false
        }
        if(flag_skf_val && shiKeFaModule.hasTeammateAttackers(heroState)){
          poll[order.indexOf(heros[HERO.SHI_KE_FA])] -= 1
        }
        let flag_dorgun_val = false
        const dorgonMark = duoErGunModule.strategyMark(heroState)
        let d = dorgonMark.kind === "new" ? dorgonMark.seat : 0
        if(dorgonMark.kind === "new" && poll[order.indexOf(d)] > 0){
          poll[order.indexOf(d)] -= 1
          flag_dorgun_val = true
        }
        let max = poll.reduce((a, b) => Math.max(a, b), -Infinity)
        let temp_max_idx = poll.indexOf(max)
        if (poll.indexOf(max, temp_max_idx + 1) === -1) {
          let poll_beheaded = poll.slice(0, temp_max_idx).concat(poll.slice(temp_max_idx + 1))
          let max_2 = poll_beheaded.reduce((a, b) => Math.max(a, b), -Infinity)
          if (max_2 + unvote + comp + fa_tot + quan_tot < max) {
            flag = true
            for (let i = 1; i <= player.length; i++) {
              if (isEmpty(vote[round - 1][i - 1]) && vote_num[order[i - 1] - 1] !== 0) {
                vote[round - 1][i - 1] = -1
                lockedVoteSeats.add(votePhaseKey(order[i - 1]))
                notifyPrivate(session, player[i - 1], "票数已够，无需你再进行投票。", "普通轮提前锁票通知")
              }
            }
          }
        }
        if(flag_skf_val && shiKeFaModule.hasTeammateAttackers(heroState)){
          poll[order.indexOf(heros[HERO.SHI_KE_FA])] += 1
        }
        if(flag_dorgun_val){
          poll[order.indexOf(d)] += 1
          flag_dorgun_val = false
        }
      }
    }
    if (flag || quan_continue || mao_continue) {
      if (quan_continue) {
        if (huangTaiJiQuanMode === null) throw new Error("Huang Taiji input has no active quan mode.")
        const choice = huangTaiJiModule.classifyQuanChoice({
          content: session.content,
          mode: huangTaiJiQuanMode,
          leaderSeats: add_indices_0.map(index => order[index]),
          requiredInfluence: quan_diff,
        })
        if (choice.kind === "invalid-leader") {
          return ("不识别的语句，请从得票数最多的玩家中进行选择。")
        }
        if (choice.kind === "invalid-option") {
          return choice.maximumOption === 2
            ? ("不识别的语句，请选择1或2。")
            : ("不识别的语句，请选择1或2或3。")
        }
        if (choice.kind === "apply") {
          const huangSeat = heros[HERO.HUANG_TAI_JI]
          const targetIndex = order.indexOf(choice.targetSeat)
          quan[huangSeat - 1] -= choice.cost
          poll[targetIndex] -= choice.reduction
          sumup += huangSeat + "号玩家" + player_copy[huangSeat - 1] + "使用" + choice.cost + "个权，为" + choice.targetSeat + "号玩家" + player_name[targetIndex] + "减少" + choice.reduction + "票。\n"
          recordSkill(HERO.HUANG_TAI_JI, '消耗' + choice.cost + '个权，减票' + choice.reduction, [choice.targetSeat])
        }
        await resumeHuangTaiJiQuan(session, "input")
        return
      }
      else if(mao_continue){
        const targetInput = maoWenLongModule.classifyTargetInput({
          content: session.content,
          activeSeats: order,
          overtime: add_flag,
          overtimeCandidateSeats: add_indices.map(index => order[index]),
        })
        if (targetInput.kind === "invalid-target") {
          if (add_flag && order.includes(targetInput.chosenSeat)) return ("不识别的语句，请从加时的玩家中进行选择。")
          return ("不识别的语句，请从在场的玩家中进行选择。")
        }
        await resumeMaoWenLongLateVote(
          session,
          targetInput.kind === "abandon" ? null : targetInput.seat,
          "input",
        )
        return
      }
      if (!quan_continue && !mao_continue) {
        await timeout_vote(session)
        return
      }
    }
    return
  })
  kickActivePlayer = async (session, outcast, cause) => {
    const out_index = order.indexOf(outcast)
    if (out_index === -1) return "missing"
    if (isRosterChangeBlocked()) return "blocked"
    const guildId = gameRoute.guildId
    const out_player = player[out_index]
    const out_name = player_name[out_index]
    const voteSnapshot = !vote_off ? captureVoteRoster() : null
    kickout.push(outcast)
    const reason = cause === "host"
      ? "被主持人踢出"
      : cause === "selection-timeout"
        ? "选人超时，被自动踢出"
        : "主动退出游戏"
    sumup += outcast + "号玩家" + out_name + reason + "。\n"
    historyDepartureReasons.set(outcast, cause === 'host' ? 'kick' : cause === 'selection-timeout' ? 'timeout' : 'self-exit')
    await player_out(session, outcast, true, true)
    if (modeInteraction.mode === "deer") syncDeerHostReviewClock(session, false)
    await sendGroupNotice(session, outcast + "号玩家" + out_name + reason + "。", "玩家离场通知", guildId)
    if (game_off) return "removed"
    if (!ann_off) {
      if (add_flag) {
        if (add_indices.indexOf(out_index) !== -1) {
          gameTimers.cancel(timer_htj)
          gameTimers.cancel(timer_zxz)
          gameTimers.cancel(timer_mwl)
          gameTimers.cancel(timer_wsg)
          gameTimers.cancel(timer_hurry)
          gameTimers.cancel(timer_vote)
          flag_just_vote = false
          gameTimers.cancel(timer_ann)
          round += 1
          add_flag = false
          if (!await new_round(session)) return "removed"
          ann = Array(player.length)
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = "本轮发言结果：\n"
          vstr = "本轮投票结果：\n"
          notifyGroup(session, "踢出正在进行加时的玩家，结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "发言加时离场后续通知", guildId)
          return "removed"
        }
        const addVoterIndex = add_voter.indexOf(out_player)
        if (addVoterIndex !== -1) add_voter.splice(addVoterIndex, 1)
        for (let i = 0; i < add_indices.length; i++) {
          if (out_index < add_indices[i]) add_indices[i] -= 1
        }
        add_vote[round - 1] = Array(add_voter.length)
      }
      else {
        ann.splice(out_index, 1)
        vote[round - 1].splice(out_index, 1)
        end_ann(session)
      }
    }
    else if (!vote_off) {
      if (add_flag) {
        if (add_indices.indexOf(out_index) === -1) {
          for (let i = 0; i < add_indices.length; i++) {
            if (out_index < add_indices[i]) add_indices[i] -= 1
          }
          await reconcileVoteAfterRosterChange(session, outcast + "号玩家已被踢出", voteSnapshot!)
        }
        else {
          gameTimers.cancel(timer_htj)
          gameTimers.cancel(timer_zxz)
          gameTimers.cancel(timer_mwl)
          gameTimers.cancel(timer_wsg)
          flag_just_vote = false
          gameTimers.cancel(timer_ann)
          round += 1
          gameTimers.cancel(timer_hurry)
          gameTimers.cancel(timer_vote)
          flag_just_vote = false
          add_flag = false
          if (!await new_round(session)) return "removed"
          vote_off = true
          ann_off = false
          for (let k = 0; k < player.length; k++) {
            if (flag_fa[order[k] - 1] > 0) {
              vote_num[order[k] - 1] -= flag_fa[order[k] - 1]
              fa[order[k] - 1] += flag_fa[order[k] - 1]
              notifyPrivate(session, player[k], "未能成功使用伐，已将本次投票阶段使用的" + flag_fa[order[k] - 1] + "个伐返还。你现在有" + fa[order[k] - 1] + "个伐。", "名单变化后伐返还通知")
              flag_fa[order[k] - 1] = 0
            }
          }
          if (order.indexOf(heros[HERO.LI_ZI_CHENG]) !== -1 && add_indices.indexOf(order.indexOf(heros[HERO.LI_ZI_CHENG])) === -1) {
            grantLiZiChengReward(session)
          }
          ann = Array(player.length)
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = "本轮发言结果：\n"
          vstr = "本轮投票结果：\n"
          notifyGroup(session, "踢出正在进行加时的玩家，结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "投票加时离场后续通知", guildId)
          return "removed"
        }
      }
      else {
        await reconcileVoteAfterRosterChange(session, outcast + "号玩家已被踢出", voteSnapshot!)
      }
    }
    else {
      if (add_flag) {
        if (add_indices.indexOf(out_index) !== -1) {
          gameTimers.cancel(timer_htj)
          gameTimers.cancel(timer_zxz)
          gameTimers.cancel(timer_mwl)
          gameTimers.cancel(timer_wsg)
          gameTimers.cancel(timer_hurry)
          gameTimers.cancel(timer_vote)
          flag_just_vote = false
          gameTimers.cancel(timer_ann)
          round += 1
          add_flag = false
          if (!await new_round(session)) return "removed"
          ann = Array(player.length)
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = "本轮发言结果：\n"
          vstr = "本轮投票结果：\n"
          notifyGroup(session, "踢出正在进行加时的玩家，结束加时，不再另外出人，同时技能发动超时，游戏继续，开始第" + round + "轮发言。", "结算加时离场后续通知", guildId)
          return "removed"
        }
        const addVoterIndex = add_voter.indexOf(out_player)
        if (addVoterIndex !== -1) add_voter.splice(addVoterIndex, 1)
        for (let i = 0; i < add_indices.length; i++) {
          if (out_index < add_indices[i]) add_indices[i] -= 1
        }
        if (addVoterIndex !== -1) add_vote[round - 1].splice(addVoterIndex, 1)
      }
      else {
        vote[round - 1].splice(out_index, 1)
      }
      poll.splice(out_index, 1)
    }
    return "removed"
  }
  ctx.guild().middleware(async (session: Session<"authority">, next) => {//踢人
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_host = session.content.replace(/\s/g, "")
    if (session.user.authority >= 2 && (str_host === "停止卧底" || str_host === "中止卧底" || str_host === "终止卧底" || str_host === "结束卧底")) {
      if (session.userId === hostid) {
        const outcome = "卧底被主持人终止。"
        end_game({ kind: 'aborted', reason: 'host-stop' }, outcome)
        sumup += "卧底被主持人终止。"
        return outcome
      }
      else {
        const outcome = "卧底被bot管理员终止。"
        end_game({ kind: 'aborted', reason: 'host-stop' }, outcome)
        sumup += "卧底被bot管理员终止。"
        return outcome
      }

    }
    if (session.userId !== hostid) return next()
    if (str_host === "停止卧底" || str_host === "中止卧底" || str_host === "终止卧底" || str_host === "结束卧底") {
      const outcome = "卧底被主持人终止。"
      end_game({ kind: 'aborted', reason: 'host-stop' }, outcome)
      sumup += outcome
      return outcome
    }
    else if (wait_off) {
      if (str_host.indexOf("踢出") === 0) {
        const outcast = Number(str_host.replace("踢出", ""))
        const result = await kickActivePlayer(session, outcast, "host")
        if (result === "blocked") return ("正在等待武将技能或主持人判定，请稍候再踢人。")
        return
      }
      else return next()
    }
    else return next()
  })
  ctx.guild().middleware(async (session: Session, next) => {//加人
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_nos = session.content.replace(/\s/g, "")
    if (str_nos !== "1") return next()
    const applicantName = await ensurePlayerNickname(session)
    if (session.userId === hostid || personAlreadyRecorded(applicantName)) return next()
    if (hasPendingReplacement()) return ("当前已有玩家正在申请补位，请等待该申请结束。")
    if (isRosterChangeBlocked()) return ("正在等待武将技能或主持人判定，暂时无法申请补位。")
    if (isEmpty(kickout)) return ("游戏已经开始且暂无人跳车，无法加人。")

    const formerSeat = formerSeatByName.get(personKey(applicantName))
    if (formerSeat !== undefined && !isReplacementSeatAvailable(formerSeat)) {
      return ("你之前的" + formerSeat + "号座位已被其他玩家接替，不能改补其他空位。")
    }

    if (!await occupyPlayer(session.userId, applicantName, session.platform)) return
    replacementRequest.begin(
      { userId: session.userId, nickname: applicantName },
      replacementTimeoutMs(),
      Date.now(),
      isRosterChangeBlocked(),
    )
    scheduleReplacementTimeout(session)
    notifySession(session, "是否同意" + applicantName + "加入游戏？请主持人发送“是”或“否”。主持人也可以发送“取消补位”终止申请。")
    return
  })
  ctx.guild().middleware(async (session, next) => {
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_nos = session.content.replace(/\s/g, "")
    if (session.userId === hostid && hasPendingReplacement() && replacementCancelCommands.has(str_nos)) {
      const cancelledName = replacementRequest.applicant!.nickname
      resetReplacementRequest()
      return ("已取消" + cancelledName + "的补位申请。")
    }
    const pendingApplicant = replacementRequest.applicant
    if (session.userId !== hostid && session.userId !== pendingApplicant?.userId) return next()

    if (replacementRequest.phase === "awaiting-host") {
      if (session.userId !== hostid) return next()
      if (str_nos === "否") {
        const rejectedName = replacementRequest.applicant!.nickname
        resetReplacementRequest()
        return ("已拒绝" + rejectedName + "加入游戏。")
      }
      if (str_nos !== "是") return ("不识别的语句，请主持人发送“是”或“否”。")
      if (isRosterChangeBlocked()) return ("正在等待武将技能或主持人判定，补位申请计时已暂停；请相关流程结束后再次发送“是”。")
      if (isEmpty(kickout)) {
        const failedName = replacementRequest.applicant!.nickname
        resetReplacementRequest()
        return (failedName + "申请补位时已无空位，申请自动取消。")
      }

      const applicantName = replacementRequest.applicant!.nickname
      const formerSeat = formerSeatByName.get(personKey(applicantName))
      if (formerSeat !== undefined) {
        if (!isReplacementSeatAvailable(formerSeat)) {
          const failedName = applicantName
          resetReplacementRequest()
          return (failedName + "之前的" + formerSeat + "号座位已被其他玩家接替，不能改补其他空位。")
        }
        replacementRequest.selectSeat(formerSeat)
      }
      else if (kickout.length === 1) {
        replacementRequest.selectSeat(kickout[0])
      }
      else {
        let kick_str = ""
        for (let i = 0; i < kickout.length; i++) kick_str += kickout[i] + "号玩家，"
        kick_str = kick_str.slice(0, -1)
        replacementRequest.awaitSeatChoice(
          replacementTimeoutMs(),
          Date.now(),
          isRosterChangeBlocked(),
        )
        scheduleReplacementTimeout(session)
        notifySession(session, "已有" + kick_str + "被踢出。请" + applicantName + "在以上序号中选择替代（在群聊中发送序号）。")
        return
      }
    }

    if (replacementRequest.phase === "awaiting-seat") {
      if (session.userId !== replacementRequest.applicant!.userId) return next()
      if (isRosterChangeBlocked()) return ("正在等待武将技能或主持人判定，补位申请计时已暂停；请相关流程结束后再选择座位。")
      let n = Number(str_nos)
      if (kickout.indexOf(n) === -1) return ("不识别的语句，请" + replacementRequest.applicant!.nickname + "发送被踢出的玩家序号。")
      replacementRequest.selectSeat(n)
    }

    if (replacementRequest.phase === "ready") {
      if (isRosterChangeBlocked()) return ("正在等待武将技能或主持人判定，补位申请计时已暂停；请稍候再加人。")
      const applicant = replacementRequest.applicant!
      const replacementSeat = replacementRequest.selectedSeat!
      if (!isReplacementSeatAvailable(replacementSeat)) {
        const failedName = applicant.nickname
        resetReplacementRequest()
        return (failedName + "选择的座位已不可用，补位申请自动取消。")
      }
      gameTimers.cancel(timer_replace)
      const voteSnapshot = !vote_off ? captureVoteRoster() : null
      let j = 0
      while (order[j] < replacementSeat) {
        j += 1
      }
      player.splice(j, 0, applicant.userId)
      player_name.splice(j, 0, applicant.nickname)
      order.splice(j, 0, replacementSeat)
      stalemate.reset()
      player_copy[replacementSeat - 1] = applicant.nickname
      player_id_copy[replacementSeat - 1] = applicant.userId
      kickout.splice(kickout.indexOf(replacementSeat), 1)
      if (vote_off) notifySession(session, applicant.nickname + "成为第" + replacementSeat + "号玩家。")
      sumup += applicant.nickname + "加入游戏，成为第" + replacementSeat + "号玩家。\n"
      const replacementIsUndercover = uc_copy.indexOf(replacementSeat) !== -1
      if (replacementIsUndercover) {
        uc.push(replacementSeat)
        if (white_only) white_only = false
      }
      else if (replacementSeat === white_copy) {
        white = replacementSeat
        flag_white = true
        if (isEmpty(uc) && flag_white && (!add_flag || add_indices.some(index => order[index] === white))) white_only = true
      }
      if (modeInteraction.mode === "deer") modeInteraction.syncDeerRoster(currentModeRoster(), white)
      capture(r => {
        r.join(replacementSeat, historyIdentity(applicant.userId, applicant.nickname), historyCamp(replacementSeat),
          heros.includes(replacementSeat) ? heros.indexOf(replacementSeat) : null, Date.now())
        if (!add_flag) r.allowSpeakers([replacementSeat])
        if (modeInteraction.mode === 'deer') r.choice(replacementSeat, null)
      })
      const needsBackfill = !add_flag && ann_off && !vote_off && !speechHistory.bySeat(replacementSeat)
        .some(record => record.round === round && !record.overtime)
      const replacementFailures: DealItem[] = []
      try {
        await sendTopicAssignment(session, player[j], replacementSeat, modeInteraction.mode === "deer")
      }
      catch (error) {
        replacementFailures.push("题面")
        ctx.logger.warn("补位%d号玩家题面私聊发送失败：%s", replacementSeat, safeErrorSummary(error))
      }
      if (heros.indexOf(replacementSeat) !== -1) {
        try {
          await sendPrivateWithDealTimeout(
            session,
            player[j],
            "你本局抽到的武将为：" + hero_name[heros.indexOf(replacementSeat)] + await heroCards.image(heros.indexOf(replacementSeat)),
          )
        }
        catch (error) {
          replacementFailures.push("武将牌")
          ctx.logger.warn("补位%d号玩家武将牌私聊发送失败：%s", replacementSeat, safeErrorSummary(error))
        }
      }
      if (replacementFailures.length > 0) {
        await sendGroupNotice(
          session,
          replacementSeat + "号补位玩家的" + replacementFailures.join("、") + "私聊发送失败；该玩家可发送“重发我的信息”补取。",
          "补位发牌失败通知",
        )
      }
      if (vote_off) {
        if (ann_off) {
          let subs = 0
          if (add_flag) {
            for (let i = 0; i < add_indices.length; i++) {
              if (add_indices[i] >= j) add_indices[i] += 1
              else subs += 1
            }
            add_voter.splice(j - subs, 0, applicant.userId)
            add_vote[round - 1].splice(j - subs, 0, -1)
          }
          else {
            vote[round - 1].splice(j, 0, -1)
          }
          poll.splice(j, 0, 0)
        }
        else {
          let subs = 0
          if (add_flag) {
            for (let i = 0; i < add_indices.length; i++) {
              if (add_indices[i] >= j) add_indices[i] += 1
              else subs += 1
            }
            //add_vote[round - 1].splice(j-subs,0,null)
            add_voter.splice(j - subs, 0, applicant.userId)
            add_vote[round - 1] = Array(add_voter.length)
          }
          else {
            ann.splice(j, 0, "")
            vote[round - 1] = Array(player.length)
          }
          poll = Array(player.length).fill(0)
        }
      }
      else {
        if (add_flag) {
          for (let i = 0; i < add_indices.length; i++) {
            if (add_indices[i] >= j) add_indices[i] += 1
          }
        }
        await reconcileVoteAfterRosterChange(session, applicant.nickname + "成为第" + replacementSeat + "号玩家", voteSnapshot!)
      }
      if (modeInteraction.mode === "turtle" && vote_off && !ann_off) {
        const eligibleSeats = turtleEligibleSeats()
        modeInteraction.syncTurtleRoundRoster(
          currentModeRoster(), eligibleSeats, turtlePerPlayerMs(eligibleSeats.length), Date.now(),
        )
        if (eligibleSeats.includes(replacementSeat)) {
          armTurtleSpeechTimer(session, replacementSeat)
          notifyGroup(session, replacementSeat + "号补位玩家须完成本轮龟模式问答。", "龟模式补位问答通知")
        }
      }
      else if (modeInteraction.mode === "turtle" && !vote_off && ann_off && needsBackfill) {
        // The prior question phase is still the active mode/history phase while
        // voting is in progress.  Add the replacement to that phase, but do
        // not prompt or start a mandatory clock: sending seat+question is an
        // optional backfill action during this vote window.
        modeInteraction.syncTurtleRoundRoster(
          currentModeRoster(), turtleEligibleSeats(), Infinity, Date.now(),
        )
        turtleBackfillSeats.add(replacementSeat)
        turtleBackfillUsers.set(replacementSeat, applicant.userId)
        capture(r => r.allowSpeakers([replacementSeat]))
        notifyGroup(
          session,
          replacementSeat + "号补位玩家可以补发上一轮问答；如需补发，请发送“" + replacementSeat + "加问题”，不补发也可继续投票。",
          "龟模式补位补问提示",
        )
      }
      else if (needsBackfill && !vote_off && ann_off) {
        speechBackfillSeats.add(replacementSeat)
        speechBackfillUsers.set(replacementSeat, applicant.userId)
        capture(r => r.allowSpeakers([replacementSeat]))
        notifyGroup(
          session,
          replacementSeat + "号补位玩家可以补发上一轮发言；如需补发，请发送“" + replacementSeat + "加发言内容”，不补发也可继续投票。",
          "补位补发言提示",
        )
      }
      if (modeInteraction.mode === "deer" && replacementSeat === white_copy && vote_off && !ann_off) {
        armDeerSpeechClock(session, replacementSeat)
      }
      resetReplacementRequest()
      return
    }
    else return next()
  })
  ctx.guild().middleware(async (session: Session, next) => {//结束投票
    if (vote_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (session.userId !== hostid) return next()
    let str_nos = session.content.replace(/\s/g, "")
    if (str_nos !== "结束投票" && str_nos !== "跳过投票" && str_nos !== "终止投票" && str_nos !== "中止投票" && str_nos !== "停止投票") return next()
    let drag = 0
    let novote = "目前，还有"
    if (add_flag) {
      for (let i = 0; i < add_voter.length; i++) {
        let d = player.indexOf(add_voter[i])
        if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[d] + "号玩家" + player_name[d] + "，"
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
          drag += 1
          novote += order[i] + "号玩家" + player_name[i] + "，"
        }
      }
    }
    novote = novote.slice(0, -1)
    novote += "共" + drag + "位玩家未投票，"
    if (drag >= (add_flag ? add_voter.length : player.length) / 3) {
      novote += "人数有点多呢，还请" + resolvePlayerNickname(session) + "大人不要心急，等大家再投一会票吧！"
      return (novote)
    }
    else {
      if (add_flag) {
        for (let i = 0; i < add_voter.length; i++) {
          let d = player.indexOf(add_voter[i])
          if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
            add_vote[round - 1][i] = -1
            notifyPrivate(session, add_voter[i], "你投票太慢啦，主持人已经结束了投票阶段~", "主持结束加时投票通知")
          }
        }
      }
      else {
        for (let i = 0; i < player.length; i++) {
          if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
            vote[round - 1][i] = -1
            notifyPrivate(session, player[i], "你投票太慢啦，主持人已经结束了投票阶段~", "主持结束投票通知")
          }
        }
      }
      novote += "不等他" + (drag === 1 ? "" : "们") + "投票了，已跳过投票阶段！"
      notifySession(session, novote)
      await timeout_vote(session)
    }
  })
  ctx.guild().middleware((session, next) => {//谁没投
    if (vote_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_sm = session.content.replace(/[《》·\s]/g, "").replace(regex, "")
    if (str_sm.indexOf("谁") !== -1 && (str_sm.indexOf("没投") !== -1 || str_sm.indexOf("没有投") !== -1)) {
      if (flag_just_vote) {
        return ("开始投票到现在还没到" + formatConfiguredDuration(config.hurryTimeout) + "呢，别着急嘛~")
      }
      let novote = "目前，还有"
      if (add_flag) {
        for (let i = 0; i < add_voter.length; i++) {
          let d = player.indexOf(add_voter[i])
          if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) novote += order[d] + "号玩家" + player_name[d] + h('at', { id: player[d] }) + "，"
        }
      }
      else {
        for (let i = 0; i < player.length; i++) {
          if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) novote += order[i] + "号玩家" + player_name[i] + h('at', { id: player[i] }) + "，"
        }
      }
      if (novote === "目前，还有") return "目前没有需要投票的玩家。"
      return novote.slice(0, -1) + "未投票。"
    }
    else return next()
  })
  ctx.guild().middleware((session, next) => {//谁没发言
    if (ann_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_sm = session.content.replace(/[《》·\s]/g, "").replace(regex, "")
    if (str_sm.indexOf("谁") !== -1 && (str_sm.indexOf("没发言") !== -1 || str_sm.indexOf("没有发言") !== -1)) {
      let noann = "目前，还有"
      if (add_flag) {
        for (let i = 0; i < add_indices.length; i++) {
          if (isEmpty(add_ann[i])) noann += order[add_indices[i]] + "号玩家" + player_name[add_indices[i]] + h('at', { id: player[add_indices[i]] }) + "，"
        }
      }
      else {
        for (let i = 0; i < player.length; i++) {
          if (isEmpty(ann[i])) noann += order[i] + "号玩家" + player_name[i] + h('at', { id: player[i] }) + "，"
        }
      }
      if (noann === "目前，还有") return "目前没有需要发言的玩家。"
      return noann.slice(0, -1) + "未发言。"
    }
    else return next()
  })
  //武将判定阶段
  ctx.guild().middleware(async (session: Session, next) => {//张献忠
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (!pendingAction.matches("zhang-xian-zhong-target", {
      userId: session.userId,
      nickname: resolvePlayerNickname(session),
      scope: "group",
      guildId: session.guildId,
      gameEpoch: gameTimers.epoch,
    })) return next()
    const zhangAction = zhangXianZhongModule.classifyTargetInput({
      content: session.content,
      activeSeats: order,
    })
    if (zhangAction.kind === "abandon") {
      gameTimers.cancel(timer_zxz)
      zhangXianZhongModule.finishTargetSelection(heroState)
      notifySession(session, "张献忠大发慈悲，放弃了图图。")
      const action = pendingAction.complete("zhang-xian-zhong-target")
      sumup += player_copy[heros[HERO.ZHANG_XIAN_ZHONG] - 1] + "（张献忠）放弃发动技能。\n"
      recordSkill(HERO.ZHANG_XIAN_ZHONG, '放弃发动技能')
      resumeSpeechAfterZhang(session)
      if (action.resumeAt === ResolutionCursor.NextRound) {
        await resumeZhangXianZhongAtNextRound(session)
      }
      return
    }
    if (zhangAction.kind === "invalid-target") {
      return ("不识别的语句，请张献忠发送目前还在场的玩家序号。")
    }
    else {
      let n_zxz = zhangAction.seat
      let out_index = order.indexOf(n_zxz)
      let out_player = player[out_index]
      if (out_index !== -1) {
        gameTimers.cancel(timer_zxz)
        zhangXianZhongModule.finishTargetSelection(heroState)
        const action = pendingAction.complete("zhang-xian-zhong-target")
        const resumeAtNextRound = action.resumeAt === ResolutionCursor.NextRound
        const linProtection = n_zxz === heros[HERO.LIN_DAN_HAN] && !shield[n_zxz - 1]
          ? linDanHanModule.protectFromSkill(heroState, heros[HERO.ZHANG_XIAN_ZHONG])
          : { protected: false, awakenedNow: false }
        if (shield[n_zxz - 1] || linProtection.protected) {
          if (linProtection.awakenedNow) announceLinDanHanAwakening(session)
          notifySession(session, n_zxz + "号玩家" + player_name[order.indexOf(n_zxz)] + "受武将技能保护，不出局，张献忠技能发动失效。")
          sumup += (n_zxz + "号玩家" + player_name[order.indexOf(n_zxz)] + "受武将技能保护，不出局，张献忠技能发动失效。\n")
          if (resumeAtNextRound) {
            await resumeZhangXianZhongAtNextRound(session)
          }
          resumeSpeechAfterZhang(session)
          return
        }
        const zhangEliminationText = publicHeroEliminationText(
          n_zxz,
          n_zxz + "号玩家" + player_name[out_index],
          "被张献忠带走。",
        )
        sumup += zhangEliminationText + "\n"
        recordSkill(HERO.ZHANG_XIAN_ZHONG, '出局带走', [n_zxz])
        notifySession(session, zhangEliminationText)
        nv_out.push(n_zxz)
        const extra2 = async (session, outplayer) => {
          if (!resumeAtNextRound) {
            if (add_flag) {
              if (add_indices.indexOf(out_index) !== -1 || add_voter.indexOf(session.userId) === -1) {
                gameTimers.cancel(timer_htj)
                gameTimers.cancel(timer_zxz)
                gameTimers.cancel(timer_mwl)
                gameTimers.cancel(timer_wsg)
                gameTimers.cancel(timer_hurry)
                gameTimers.cancel(timer_vote)
                flag_just_vote = false
                gameTimers.cancel(timer_ann)
                round += 1
                if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
                  promptShiKeFaGift(session, outplayer)
                }
                add_flag = false
                if (!await new_round(session)) return
                ann = Array(player.length)
                vote.push(Array(player.length))
                poll = Array(player.length).fill(0)
                shield = Array(player_copy.length).fill(false)
                annstr = "本轮发言结果：\n"
                vstr = "本轮投票结果：\n"
                notifyGroup(session, "正在进行加时的玩家出局，结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "张献忠加时出局后新轮通知")
                return
              }
              else {
                if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
                  promptShiKeFaGift(session, outplayer)
                }
                if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
                add_voter.splice(add_voter.indexOf(session.userId), 1)
                add_voter.splice(add_voter.indexOf(out_player), 1)
                for (let i = 0; i < add_indices.length; i++) {
                  if (out_index < add_indices[i]) add_indices[i] -= 1
                }
                add_vote[round - 1] = Array(add_voter.length)
              }
            }
            else {
              if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
                promptShiKeFaGift(session, outplayer)
              }
              if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
              ann.splice(out_index, 1)
              vote[round - 1].splice(out_index, 1)
              zhangXianZhongModule.finishTargetSelection(heroState)
              end_ann(session)
            }
          }
          else {
            if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
              promptShiKeFaGift(session, outplayer)
            }
            await resumeZhangXianZhongAtNextRound(session)
            return
          }
        }
        await player_out_long(session, n_zxz, extra2, false, true)
        resumeSpeechAfterZhang(session)
      }
      else return ("不识别的语句，请张献忠发送目前还在场的玩家序号。")
    }
  })
  ctx.guild().middleware(async (session, next) => {//朱由检
    if (ann_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (!zhuYouJianModule.isAvailable(heroState) || order.indexOf(heros[HERO.ZHU_YOU_JIAN]) === -1) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.ZHU_YOU_JIAN])]) return next()
    const zhuAction = zhuYouJianModule.onSpeechAction({
      content: session.content,
      actorSeat: heros[HERO.ZHU_YOU_JIAN],
      activeSeats: order,
      undercoverSeats: uc,
      whiteSeat: white,
    })
    if (zhuAction.kind === "ignore") return next()
    if (!isEligibleSpeechSeat({
      seat: heros[HERO.ZHU_YOU_JIAN],
      activeSeats: order,
      overtime: add_flag,
      overtimeSeats: add_indices.map(index => order[index]),
    })) {
      return "你不属于本次加时的发言玩家，不能发动处决。"
    }
    if (modeInteraction.mode === "deer" && deerSeatNeedsSelection(heros[HERO.ZHU_YOU_JIAN])) {
      return "你需要先完成鹿模式选人并通过主持人审核，才能发动处决。"
    }
    // if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) {
    //   return
    // }
    if(boom_pending){
      notifyPrivate(session, player[order.indexOf(heros[HERO.ZHU_YOU_JIAN])], "陛下，有玩家自爆了，恕臣无法将旨意送达。", "朱由检自爆期间处决拒绝通知")
      return
    }
    if (zhuAction.kind === "invalid-target") {
      notifyPrivate(session, player[order.indexOf(heros[HERO.ZHU_YOU_JIAN])], "陛下，您要处决的对象似乎查无此人。", "朱由检无效处决目标通知")
      return
    }
    const kill = zhuAction.chosenSeat
    const zhuIdentity = publicHeroIdentity(heros[HERO.ZHU_YOU_JIAN], true)
    notifySession(session, zhuIdentity + "，并选择处决" + kill + "号玩家" + player_name[order.indexOf(kill)] + "!")
    sumup += zhuIdentity + "，并选择处决" + kill + "号玩家" + player_name[order.indexOf(kill)] + ";"
    recordSkill(HERO.ZHU_YOU_JIAN, '处决：' + ({ success: '命中异阵营', 'self-execution': '自裁', backlash: '同阵营反噬' }[zhuAction.verdict] ?? '同阵营反噬'), [kill])
    zhuYouJianModule.activate(heroState)
    const outcast = zhuAction.eliminatedSeat
    if (zhuAction.verdict === "success") {
      notifySession(session, "处决成功！")
      sumup += "处决成功，"
    }
    else if (zhuAction.verdict === "self-execution") {
      let case_zyj = getRandomIntInclusive(1, 3)
      switch (case_zyj) {
        case 1:
          notifySession(session, "陛下————😭")
          break
        case 2:
          notifySession(session, player_name[order.indexOf(heros[HERO.ZHU_YOU_JIAN])] + "：任贼分裂朕尸，勿伤百姓一人😰")
          break
        case 3:
          notifySession(session, player_name[order.indexOf(heros[HERO.ZHU_YOU_JIAN])] + "：皆诸臣误朕也😡")
          break
        default:
          notifySession(session, "出错了。")
      }
      sumup += "朱由检自裁，"
    }
    else {
      notifySession(session, "处决失败。")
      sumup += "处决失败，"
    }
    const linProtection = outcast === heros[HERO.LIN_DAN_HAN] && !shield[outcast - 1]
      ? linDanHanModule.protectFromSkill(heroState, heros[HERO.ZHU_YOU_JIAN])
      : { protected: false, awakenedNow: false }
    if (shield[outcast - 1] || linProtection.protected) {
      if (linProtection.awakenedNow) announceLinDanHanAwakening(session)
      notifySession(session, outcast + "号玩家" + player_name[order.indexOf(outcast)] + "受武将技能保护，不出局，朱由检技能发动失效。")
      recordSkill(HERO.ZHU_YOU_JIAN, '处决被保护抵消', [outcast])
      sumup += (outcast + "号玩家" + player_name[order.indexOf(outcast)] + "受武将技能保护，不出局，朱由检技能发动失效。\n")
      return
    }
    const executionText = zhuAction.verdict === "self-execution"
      ? "第" + outcast + "号玩家" + player_name[order.indexOf(outcast)] + "自裁。"
      : publicHeroEliminationText(outcast, "第" + outcast + "号玩家" + player_name[order.indexOf(outcast)], "出局。")
    notifySession(session, executionText)
    sumup += executionText + "\n"
    nv_out.push(outcast)
    let out_index = order.indexOf(outcast)
    let out_player = player[out_index]
    const extra3 = async (session, outplayer) => {
      if (add_flag) {
        if (add_indices.indexOf(out_index) !== -1) {
          round += 1
          if (postEliminationHero(outplayer, heros, 'skill') === "zhang-xian-zhong" && !game_off) {
            if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
            for (let i = 0; i < add_indices.length; i++) {
              if (out_index === add_indices[i]) add_indices.splice(i, 1)
              else if (out_index < add_indices[i]) add_indices[i] -= 1
            }
            promptZhangXianZhongTarget(session, outplayer)
            vote_off = true
            beginZhangXianZhongTarget(session)
            return
          }
          if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
            promptShiKeFaGift(session, outplayer)
          }
          gameTimers.cancel(timer_htj)
          gameTimers.cancel(timer_zxz)
          gameTimers.cancel(timer_mwl)
          gameTimers.cancel(timer_wsg)
          gameTimers.cancel(timer_hurry)
          gameTimers.cancel(timer_vote)
          flag_just_vote = false
          gameTimers.cancel(timer_ann)
          add_flag = false
          if (!await new_round(session)) return
          ann = Array(player.length)
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = "本轮发言结果：\n"
          vstr = "本轮投票结果：\n"
          notifyGroup(session, "正在进行加时的玩家出局，结束加时，不再另外出人，游戏继续，开始第" + round + "轮发言。", "朱由检加时出局后新轮通知")
          return
        }
        else {
          if (postEliminationHero(outplayer, heros, 'skill') === "zhang-xian-zhong" && !game_off) {
            if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
            for (let i = 0; i < add_indices.length; i++) {
              if (out_index === add_indices[i]) add_indices.splice(i, 1)
              else if (out_index < add_indices[i]) add_indices[i] -= 1
            }
            promptZhangXianZhongTarget(session, outplayer)
            vote_off = true
            beginZhangXianZhongTarget(session)
            return
          }
          if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa" && !game_off){
            promptShiKeFaGift(session, outplayer)
          }
          if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
          add_voter.splice(add_voter.indexOf(out_player), 1)
          for (let i = 0; i < add_indices.length; i++) {
            if (out_index < add_indices[i]) add_indices[i] -= 1
          }
          add_vote[round - 1] = Array(add_voter.length)
        }
      }
      else {
        if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(session, roundCapabilityText("从现在起"))
        ann.splice(out_index, 1)
        vote[round - 1].splice(out_index, 1)
        if (postEliminationHero(outplayer, heros, 'skill') === "zhang-xian-zhong") {
          promptZhangXianZhongTarget(session, outplayer)
          vote_off = true
          beginZhangXianZhongTarget(session)
          return
        }
        if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa"){
          promptShiKeFaGift(session, outplayer)
        }
        end_ann(session)
      }
    }
    await player_out_long(session, outcast, extra3, false, true)
  })
  ctx.guild().middleware(async (session, next) => {//吴三桂
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (!pendingAction.matches("wu-san-gui-overtime-choice", {
      userId: session.userId,
      scope: "group",
      guildId: session.guildId,
      gameEpoch: gameTimers.epoch,
    })) return next()
    const choice = wuSanGuiModule.classifyChoiceInput(
      session.content,
      add_indices.map(index => order[index]),
    )
    if (choice.kind === "abandon") {
      gameTimers.cancel(timer_wsg)
      sumup += player_name[order.indexOf(heros[HERO.WU_SAN_GUI])] + "（吴三桂）放弃发动技能。\n"
      recordSkill(HERO.WU_SAN_GUI, '放弃发动“权计”')
      add_flag = true
      wuSanGuiModule.abandonChoice(heroState)
      pendingAction.complete("wu-san-gui-overtime-choice")
      shiKeFaModule.clearTeammateAttackers(heroState)
      let add_str = "进入第" + round + "轮加时，请" + add_str_at + "发言。"
      add_voter = player.filter((a) => add_indices.indexOf(player.indexOf(a)) === -1)
      sumup += add_str_simp + "平票，进入第" + round + "轮加时。\n"
      capture(r => r.outcome(add_str_simp + "平票，进入第" + round + "轮加时。"))
      waiver = 0
      vote_off = true
      ann_off = false
      ann = Array(player.length)
      add_ann = Array(add_indices.length)
      add_vote.push(Array(add_voter.length))
      poll = Array(player.length).fill(0)
      annstr = "本轮发言结果：\n"
      vstr = "本轮投票结果：\n"
      if (modeInteraction.mode === "deer") {
        startDeerSpeechRound(session)
      }
      else if (modeInteraction.mode === "turtle") {
        startTurtleRound(session)
      }
      else startClassicSpeechPhase(session)
      notifyGroup(session, add_str, "吴三桂放弃后加时通知")
    }
    else if (choice.kind === "target") {
      gameTimers.cancel(timer_wsg)
      const outcast = choice.seat
      let out_index = order.indexOf(outcast)
      const completion = wuSanGuiModule.completeChoice(heroState)
      pendingAction.complete("wu-san-gui-overtime-choice")
      if(completion.skipNextVote){
        vote_num[heros[HERO.WU_SAN_GUI] - 1] = 0
      }
      const linProtection = outcast === heros[HERO.LIN_DAN_HAN] && !shield[outcast - 1]
        ? linDanHanModule.protectFromSkill(heroState, heros[HERO.WU_SAN_GUI])
        : { protected: false, awakenedNow: false }
      if (shield[outcast - 1] || linProtection.protected) {
        if (linProtection.awakenedNow) announceLinDanHanAwakening(session)
        notifySession(session, outcast + "号玩家" + player_name[out_index] + "受武将技能保护，不出局，吴三桂技能发动失效。")
        recordSkill(HERO.WU_SAN_GUI, '“权计”被保护抵消', [outcast])
        sumup += (outcast + "号玩家" + player_name[out_index] + "受武将技能保护，不出局，吴三桂技能发动失效。\n")
        round += 1
        add_flag = false
        if (!await new_round(session)) return
        notifySession(session, "游戏继续，开始第" + round + "轮发言。")
        vote_off = true
        ann_off = false
        ann = Array(player.length)
        add_vote.push([])
        vote.push(Array(player.length))
        poll = Array(player.length).fill(0)
        shield = Array(player_copy.length).fill(false)
        annstr = "本轮发言结果：\n"
        vstr = "本轮投票结果：\n"
        return
      }
      const wuEliminationText = publicHeroEliminationText(
        outcast,
        "本轮" + outcast + "号玩家" + player_name[out_index],
        "被吴三桂指定出局。",
      )
      notifySession(session, wuEliminationText)
      sumup += "第" + round + "轮" + wuEliminationText.slice(2) + "\n"
      recordSkill(HERO.WU_SAN_GUI, '权计指定出局', [outcast])
      nv_out.push(outcast)
      const extra4 = async (session, outplayer) => {
        if (postEliminationHero(outplayer, heros, 'skill') === "zhang-xian-zhong") {
          add_vote.push([])
          promptZhangXianZhongTarget(session, outplayer)
          vote_off = true
          beginZhangXianZhongTarget(session)
          return
        }
        if(postEliminationHero(outplayer, heros, 'skill') === "shi-ke-fa"){
          promptShiKeFaGift(session, outplayer)
        }
        round += 1
        add_flag = false
        if (!await new_round(session)) return
        notifySession(session, "游戏继续，开始第" + round + "轮发言。")
        vote_off = true
        ann_off = false
        ann = Array(player.length)
        add_vote.push([])
        vote.push(Array(player.length))
        poll = Array(player.length).fill(0)
        shield = Array(player_copy.length).fill(false)
        annstr = "本轮发言结果：\n"
        vstr = "本轮投票结果：\n"
        return
      }
      await player_out_long(session, outcast, extra4, false, false)
    }
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//袁崇焕
    if (vote_off || add_flag || !matchesActiveSession(session)) return next()
    if (order.indexOf(heros[HERO.YUAN_CHONG_HUAN]) === -1 || yuanChongHuanModule.retaliationTarget(heroState) !== null) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])]) return next()
    const action = yuanChongHuanModule.classifyGuardInput(heroState, {
      content: session.content,
      activeSeats: order,
      heroSeat: heros[HERO.YUAN_CHONG_HUAN],
      whiteSeat: white,
    })
    if (action.kind === "ignore") return next()
    if (action.kind === "invalid-target") return ("督师，恕卑职找不到您要守的对象，还请重新选择。")
    if (action.kind === "previous-target-forbidden") return ("督师，您上一轮便守卫了" + action.seat + "号玩家" + player_name[order.indexOf(action.seat)] + "，陛下有令，还请您另作选择！")
    if (action.kind === "self-forbidden") return ("督师，您不是白板，无法守卫自己，还请您另作选择！")
    const guard = action.seat
    if (action.replacedSeat !== null) {
      notifySession(session, "得令！已放弃对" + action.replacedSeat + "号玩家" + player_name[order.indexOf(action.replacedSeat)] + "的守卫；" + guard + "号玩家" + player_name[order.indexOf(guard)] + "会得到守卫。")
      sumup += "第" + heros[HERO.YUAN_CHONG_HUAN] + "号玩家" + player_name[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])] + "（袁崇焕）放弃对" + action.replacedSeat + "号玩家" + player_name[order.indexOf(action.replacedSeat)] + "的守卫，转而选择守卫" + guard + "号玩家" + player_name[order.indexOf(guard)] + "。\n"
      recordSkill(HERO.YUAN_CHONG_HUAN, '更换守卫目标', [action.replacedSeat!, guard])
      shield[action.replacedSeat - 1] = false
    }
    else {
      notifySession(session, "得令！本轮" + guard + "号玩家" + player_name[order.indexOf(guard)] + "会得到守卫。")
      sumup += "第" + heros[HERO.YUAN_CHONG_HUAN] + "号玩家" + player_name[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])] + "（袁崇焕）选择守卫" + guard + "号玩家" + player_name[order.indexOf(guard)] + "。\n"
      recordSkill(HERO.YUAN_CHONG_HUAN, '设置守卫目标', [guard])
    }
    yuanChongHuanModule.selectGuard(heroState, guard)
    shield[guard - 1] = true
  })

  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//多尔衮
    if (vote_off || add_flag || !matchesActiveSession(session)) return next()
    if (order.indexOf(heros[HERO.DUO_ER_GUN]) === -1) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.DUO_ER_GUN])]) return next()
    const action = duoErGunModule.classifyStrategyInput(heroState, {
      content: session.content,
      activeSeats: order,
      heroSeat: heros[HERO.DUO_ER_GUN],
    })
    if (action.kind === "ignore") return next()
    if (action.kind === "skill-spent") return ("您已失去“定策”技能。")
    if (action.kind === "invalid-target") return ("王爷，恕奴才找不到您要立的对象，还请重新选择。")
    if (action.kind === "established-target-unchanged") return ("王爷，" + action.seat + "号玩家" + player_name[order.indexOf(action.seat)] + "已有“定策”标记了，本次操作无效。")
    if (action.kind === "self-forbidden") return ("王爷，您不能立自己，还请您另作选择！")
    if (action.kind === "established-target-locked") return ("摄政王，您之前拥立了" + action.seat + "号玩家" + player_name[order.indexOf(action.seat)] + "，其出局之前您不能再立他人。")

    const guard = action.seat
    if (action.previousSeat !== null) {
      notifySession(session, "遵命，已将“定策”标记从" + action.previousSeat + "号玩家" + player_name[order.indexOf(action.previousSeat)] + "转移到" + guard + "号玩家" + player_name[order.indexOf(guard)] + "。")
      sumup += "第" + heros[HERO.DUO_ER_GUN] + "号玩家" + player_name[order.indexOf(heros[HERO.DUO_ER_GUN])] + "（多尔衮）将“定策”标记从" + action.previousSeat + "号玩家" + player_name[order.indexOf(action.previousSeat)] + "转移到" + guard + "号玩家" + player_name[order.indexOf(guard)] + "。\n"
      recordSkill(HERO.DUO_ER_GUN, '转移定策', [action.previousSeat!, guard])
    }
    else {
      notifySession(session, "遵命，" + guard + "号玩家" + player_name[order.indexOf(guard)] + "得到“定策”标记。")
      sumup += "第" + heros[HERO.DUO_ER_GUN] + "号玩家" + player_name[order.indexOf(heros[HERO.DUO_ER_GUN])] + "（多尔衮）将“定策”标记给予" + guard + "号玩家" + player_name[order.indexOf(guard)] + "。\n"
      recordSkill(HERO.DUO_ER_GUN, '设置定策', [guard])
    }
    duoErGunModule.selectStrategy(heroState, action)
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//多尔衮
    if (game_off || !matchesActiveSession(session)) return next()
    if (order.indexOf(heros[HERO.DUO_ER_GUN]) === -1) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.DUO_ER_GUN])]) return next()
    const action = duoErGunModule.classifyRegencyInput(heroState, {
      content: session.content,
      activeSeats: order,
    })
    if (action.kind === "ignore") return next()
    if (action.kind === "skill-spent") return("您已发动过“摄政”，无法再发动了。")
    if (action.kind === "not-awakened") return("您尚未“入关”，不能发动“摄政”。")
    if (action.kind === "new-strategy-not-established") return("您刚刚拥立" + action.seat + "号玩家" + player_name[order.indexOf(action.seat)] + "，暂时还不能发动摄政技能。")
    if (action.kind === "already-armed") return("您已经发动过技能了，除非" + action.strategySeat + "号玩家" + player_name[order.indexOf(action.strategySeat)] + "在技能生效前出局，你无法进行任何操作。")
    if (action.kind === "strategy-missing") return("目前场上没有“定策”标记，您不能发动摄政技能，请先发动“定策”。")
    if (action.kind === "same-target") return("王爷，您所保和所弃的对象不能是同一人！")
    if (action.kind === "invalid-target") return("输入无效，请输入在场的玩家序号。")
    if (action.kind === "strategy-not-in-pair") return("发动摄政失败，选择的二人之一必须是拥有“定策”标记的玩家（" + action.strategySeat + "号玩家" + player_name[order.indexOf(action.strategySeat)] + "）。")

    const { discardSeat: discard, keepSeat: keep } = action
    sumup += "第" + heros[HERO.DUO_ER_GUN] + "号玩家" + player_name[order.indexOf(heros[HERO.DUO_ER_GUN])] + "（多尔衮）发动“摄政”，用"+ discard + "号玩家" + player_name[order.indexOf(discard)] + "保" + keep + "号玩家" + player_name[order.indexOf(keep)] + "。\n"
    recordSkill(HERO.DUO_ER_GUN, '配置摄政', [keep, discard])
    duoErGunModule.armRegency(heroState, action)
    return("成功发动摄政，下一次"+ keep + "号玩家" + player_name[order.indexOf(keep)] + "成为唯一得票最多的玩家时，将与" + discard + "号玩家" + player_name[order.indexOf(discard)] + "互换得票数。\n")
  })
  // ctx.guild().middleware(async(session,next)=>{ //皇太极
  //   if(flag_quan === Array(player.length).fill(0) || isEmpty(flag_quan)) return next()
  //   if(session.userId !== player[order.indexOf(heros[HERO.HUANG_TAI_JI])]) return next()
  //   let str_htj = session.content.replace(/\s/g,"")
  //   if(flag_quan[heros[HERO.HUANG_TAI_JI] - 1]===1){
  //     let n_htj = Number(str_htj)
  //     if(add_indices_0.indexOf(n_htj) === -1) return("不识别的语句，请皇太极选择得票数最多的一名玩家。")
  //     else{
  //       flag_quan[heros[HERO.HUANG_TAI_JI] - 1] = 2
  //       if(add_indices_0.length === 1){

  //       }
  //     }
  //   }
  // })
  ctx.exclude(ctx.guild()).middleware( (session, next) => {//史可法
    if (game_off || !matchesActiveSession(session)) return next()
    if (!pendingAction.matches("shi-ke-fa-gift", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })) return next()
    const action = shiKeFaModule.classifyGiftInput({
      content: session.content,
      activeSeats: order,
    })
    if (action.kind === "abandon"){
      shiKeFaModule.abandonGift(heroState)
      pendingAction.complete("shi-ke-fa-gift")
      notifySession(session, "您已放弃发动技能。")
    }
    else if(action.kind === "target"){
      const n_skf = action.seat
      const amount = shiKeFaModule.consumeGift(heroState)
      fa[n_skf - 1] += amount
      sumup += heros[HERO.SHI_KE_FA] + "号玩家" + player_copy[heros[HERO.SHI_KE_FA] - 1] + "（史可法）赠予" + n_skf + "号玩家" + player_copy[n_skf - 1] + amount + "个“伐”标记。\n"
      recordSkill(HERO.SHI_KE_FA, '赠予' + amount + '个伐', [n_skf])
      pendingAction.complete("shi-ke-fa-gift")
      notifySession(session, "遵令，已将" + amount + "个伐赠予" + n_skf + "号玩家" + player_copy[n_skf - 1] + "。")
      notifyPrivate(session, player[order.indexOf(n_skf)], "史阁部赠予您" + amount + "个“伐”标记，可以用来增加自己的投票数量。", "史可法赠予目标通知")
    }
    else{
      notifySession(session, "不识别的语句，请阁部发送在场的玩家序号。")
    }
  })
}
