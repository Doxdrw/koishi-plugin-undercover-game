import { App, Command, Context, Schema, h, $, Session } from "koishi"
import { randomUUID } from 'node:crypto'
import { HEROES, HERO_NUM, HERO_NAMES, HERO_ABILITIES, HERO, HeroState } from './heroes'
import { createHeroStateStore, HeroStateStore } from './game/hero-state'
import { createZhuYouXiaoState, beginZhuYouXiaoVotePhase, clearZhuYouXiaoPhase, detachZhuYouXiaoCurrent, recordZhuYouXiaoProxyVote, setZhuYouXiaoDelegate, zhuYouXiaoSuccessfulDelegates } from './game/zhu-you-xiao-state'
import { PendingActionCoordinator, type PendingAction, type PendingActionKind } from './game/pending-action'
import { GameTimerManager } from './game/game-timer-manager'
import { ReplacementRequestCoordinator } from './game/replacement-request'
import { GameRouteCoordinator } from './game/game-route'
import { AsyncSerialQueue } from './game/async-serial-queue'
import { VoteSettlementCoordinator } from './game/vote-settlement'
import { GameMessageDelivery, hasMessageReceipt, type MessageDeliveryOutcome } from './game/message-delivery'
import {
  ModeInteractionCoordinator,
  formatModeRoundCapabilities,
  parseGameModeSelection,
  parseModeStart,
  parseTurtleHostInput,
  parseTurtleQuestion,
  resolveModeMessageReference,
} from './game/game-mode'
import { ScoreService, type ScoreWriteInput } from './game/score-service'
import { withinBudget } from './game/operation-budget'
import { HistoryRecorder } from './game/history-recorder'
import { HistoryStore, registerHistoryModels, type HistoryMediaRetention } from './game/history-store'
import { HistoryPersistence, FileHistoryRetryQueue } from './game/history-retry'
import { HistoryQueries, historyTextPages } from './game/history-query'
import { DeerHistoryControls } from './game/history-deer'
import { registerHistoryCommands } from './game/history-commands'
import { registerWinrateCommands } from './game/winrate-commands'
import { ReportImages, type ReportBrowser } from './game/report-images'
import { createHistoryDeletionConsumer } from './game/history-deletion-consumer'
import { archiveDisposition, type HistoryEnding, type HistoryCamp, type HistorySpeechSegment } from './game/history-snapshot'
import { defaultAiHistoryLimits, type ArchiveHint } from './game/history-ai-pagination'
import { DiagnosticLog, GameDiagnostics, type DiagnosticConfig } from './game/diagnostics'
import { removeRosterSeat } from './game/roster-service'
import { isEligibleSpeechSeat } from './game/speech-eligibility'
import { removeArrayIndicesInPlace } from './game/sparse-array'
import { SpeechPhaseCoordinator } from './game/speech-phase'
import { SpeechHistory } from './game/speech-history'
import { DeerRevisionCoordinator, type DeerSpeechReview } from './game/deer-revision'
import { HostSupportCoordinator } from './game/host-support'
import { PublicHeroRevealState } from './game/hero-reveal'
import { projectPublicGameState, PublicGameTimelineStore, publicMessageText, type PublicGameEvent, type PublicGameStateQuery } from './game/public-game-state'
import { installChatLunaGameTools, installChatLunaHistoryTool } from './game/chatluna-game-tools'
import { postEliminationHero } from './game/post-elimination'
import { classifyEliminationVictory } from './game/elimination-outcome'
import { isStalemateEligible, StalemateTracker } from './game/stalemate'
import { snapshotEliminationContext, snapshotVoteContext, VoteContext } from './game/resolution-context'
import type { EliminationContext } from './game/resolution-context'
import { rebuildVoteState, type BallotEffect } from './game/vote-ballots'
import { captureVoteFacts, type VoteFact } from './game/vote-facts'
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
  VOTE_RESOLUTION_TAIL_AFTER_HUANG_TAI_JI,
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
import { normalizeHeroCommand, parseHeroNumber } from './game/hero-command'
import { zhuYouJianModule } from './heroes/zhu-you-jian'
import { weiZhongXianModule } from './heroes/wei-zhong-xian'
import { claimWeiZhongXianReward, hasWeiZhongXianReward, type WeiZhongXianRewardSource } from './game/wei-zhong-xian-state'
import { resetNativeHeroState } from './game/hero-reset'
import { ZhuYouXiaoHeirOption, classifyDelegationInput, classifyHeirChoiceInput, classifyHeirTargetInput, classifyProxyVoteInput, zhuYouXiaoHeirOptions } from './heroes/zhu-you-xiao'
import { HeroCardService, HeroCardValidationError, registerHeroCardModel } from './game/hero-card-service'
import { GameUserError, safeErrorSummary } from './game/errors'
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
      getPeriodWindow?(systemKey: string, options: { kind: 'day' | 'week' | 'month' | 'year' | 'season'; offset?: number }): Promise<{ start: number; end: number } | undefined>
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

export const inject = { required: ["database"], optional: ["xpPoints", "puppeteer"] }

export interface Config {
  debug?: DiagnosticConfig
  aiTools?: { enabled: boolean; history?: { enabled: boolean; pageSize?: number; maxChars?: number } }
  reportImages?: { enabled: boolean; timeout: number }
  history?: {
    enabled: boolean
    sandbox: boolean
    retentionDays: number
    winrateMinimumGames?: number
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
  realtimeSkillNoticeDefault?: boolean
  notifications: {
    voteStartPrivate: boolean
    voteFirstSuccessReceipt: boolean
    voteHurryPrivate: boolean
    voteHurryGroup: boolean
    turtleAnswerPrivate: boolean
    turtleHostHalfReminder: boolean
    whiteGuessHost?: boolean
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
  hostVoteEndMissingPercent?: number
  hostVoteEndMissingAllowance?: number
  replacementTimeout: number
  boomAdjudicationTimeout: number
  deerSelectionTimeout: number
  deerHostReviewTimeout: number
  deerReselectionDeadline: 'first-round' | 'discussion' | 'game-end'
  deerPreviousSpeechPolicy: 'review' | 'keep' | 'invalidate'
  deerMakeupTimeout: number
  deerSpeechReviewDefault: 'approve' | 'reject'
  deerHostTimeoutAction: 'auto' | 'abort' | 'recruit'
  boomHostTimeoutAction: 'auto' | 'abort' | 'recruit'
  turtleHostTimeoutAction: 'abort' | 'recruit'
  deerSpeechReviewTimeoutAction: 'auto' | 'abort' | 'recruit'
  hostRecruitmentTimeout: number
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
    skillTimeout: Schema.natural().default(120).description("等待武将发动技能的时限（秒）；也用于保护开票后的技能机会。"),
    hostVoteEndMissingPercent: Schema.number().min(0).max(100).step(1).default(50).description("主持手动结束投票时，尚未投票的票位达到此比例（%）则拒绝；未超过下方人数上限时直接允许。"),
    hostVoteEndMissingAllowance: Schema.natural().default(1).description("未投票位不超过此数时，主持可直接结束投票。0表示不额外放行缺票。"),
    replacementTimeout: Schema.natural().min(10).default(180).description("补位申请每个步骤的时限（秒）；等待武将技能时暂停。"),
    boomAdjudicationTimeout: Schema.natural().min(10).default(300).description("主持人判定疑似自爆的时限（秒）。"),
    deerSelectionTimeout: Schema.natural().min(30).default(900).description("鹿模式每名玩家的独立选词时限（秒）；超时踢出该座位。"),
    deerHostReviewTimeout: Schema.natural().min(30).default(300).description("鹿模式有待审核选词时的主持人空闲时限（秒）；有效审核后重新计时。"),
    deerProgressDelay: Schema.natural().default(300).description("鹿模式首轮开放后，公开查询或自动催促选词进度的等待时间（秒）。"),
    turtleAnswerTimeout: Schema.natural().min(10).default(300).description("龟模式每个问题的主持人回答时限（秒）；可开启过半提醒。"),
  }).description("发言、投票与技能时限"),
  Schema.object({
    deerReselectionDeadline: Schema.union([
      Schema.const('first-round').description('第一轮结束前'),
      Schema.const('discussion').description('解锁盘发言、带票前'),
      Schema.const('game-end').description('游戏结束前'),
    ]).default('first-round').description('已批准选词的重选申请截止节点；已提交的申请仍会继续审核。'),
    deerPreviousSpeechPolicy: Schema.union([
      Schema.const('review').description('主持人整批复核'), Schema.const('keep').description('保留前序发言'),
      Schema.const('invalidate').description('前序发言失效并补发言'),
    ]).default('review').description('新选词批准后，如何处理该玩家之前的发言。'),
    deerMakeupTimeout: Schema.natural().default(120).description('鹿模式补发言时限（秒），0为不限时；不早于当前或下个发言阶段的超时时刻。'),
    deerSpeechReviewDefault: Schema.union([Schema.const('reject').description('不通过'), Schema.const('approve').description('通过')])
      .default('reject').description('鹿模式前序发言复核超时的裁定结果。'),
  }).description('鹿模式重选与补发言'),
  Schema.object({
    deerHostTimeoutAction: Schema.union([Schema.const('auto').description('通过待审选词'), Schema.const('recruit').description('招募协同主持'), Schema.const('abort').description('终止本局')])
      .default('auto').description('鹿模式选词审核超时的处理方式；招募失败后通过选词。'),
    boomHostTimeoutAction: Schema.union([Schema.const('auto').description('判定自爆失败'), Schema.const('recruit').description('招募协同主持'), Schema.const('abort').description('终止本局')])
      .default('auto').description('未匹配词条的自爆判定超时的处理方式；招募失败后判定自爆失败。'),
    turtleHostTimeoutAction: Schema.union([Schema.const('abort').description('终止本局'), Schema.const('recruit').description('招募协同主持')])
      .default('abort').description('龟模式回答超时的处理方式；招募失败后终止本局。'),
    deerSpeechReviewTimeoutAction: Schema.union([Schema.const('auto').description('使用复核超时默认结果'), Schema.const('recruit').description('招募协同主持'), Schema.const('abort').description('终止本局')])
      .default('auto').description('鹿模式前序发言复核超时的处理方式；招募失败后使用复核超时默认结果。'),
    hostRecruitmentTimeout: Schema.natural().min(30).default(300).description('等待协同主持应答的时限（秒）；原主持在此期间仍可处理待办。'),
  }).description('主持人超时与协同主持'),
  Schema.object({
    realtimeVoteNoticeDefault: Schema.boolean().default(false).description("默认向主持人私聊实时票况；主持人可在局内切换。"),
    realtimeSkillNoticeDefault: Schema.boolean().default(false).description('默认向所有主持人私聊技能选择、变化和结果；与实时票况独立，可在局内切换。'),
    notifications: Schema.object({
      voteStartPrivate: Schema.boolean().default(true).description("投票开始时私聊应投票玩家，合并可投对象和技能提示。"),
      voteFirstSuccessReceipt: Schema.boolean().default(false).description("首次投票成功后私聊确认；改票和非法输入提示保持现状。"),
      voteHurryPrivate: Schema.boolean().default(true).description("自动催票时私聊尚未投票的玩家。"),
      voteHurryGroup: Schema.boolean().default(true).description("自动催票时在群内显示尚未投票的玩家。"),
      whiteGuessHost: Schema.boolean().default(true).description('白板猜词未匹配时私聊通知主持人，可引用通知认可其加入阵营。'),
      turtleAnswerPrivate: Schema.boolean().default(false).description("龟模式群内回答后，额外私聊玩家确认。"),
      turtleHostHalfReminder: Schema.boolean().default(true).description("龟模式等待回答过半时私聊提醒主持人。"),
    }),
  }).description("消息提醒"),
  Schema.object({
    enablePersistentScoring: Schema.boolean().default(true).description("接入 xp-points 并保存结算积分；关闭后不读写积分或发送积分服务告警。"),
    scoreSystemKey: Schema.string().default("undercover").description("结算使用的 xp-points 系统 key；同 key 接入同一积分系统。"),
    scoreGoodWin: Schema.number().default(1).description("好人常规胜利得分。"),
    scoreGoodWinSpeedrun: Schema.number().default(0.5).description("普通清场好人速通得分；总轮次和实际出局人数均不超过本局初始非好人数量。"),
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
      winrateMinimumGames: Schema.natural().min(1).default(5).description('胜率榜的最低参赛局数；个人胜率查询不设门槛。'),
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
    reportImages: Schema.object({
      enabled: Schema.boolean().default(true).description('优先将总结、复盘和选词公布渲染为图片；需可选 puppeteer 服务，缺少服务或失败时发送完整文字。'),
      timeout: Schema.natural().min(1).default(15).description('单次图片渲染总时限（秒）；长内容自动拆为多张。'),
    }),
  }).description('总结与选词图片'),
  Schema.object({
    aiTools: Schema.object({
      enabled: Schema.boolean().default(false).description("向 ChatLuna 提供按需规则查询和当前群公开状态工具。由 AI 在需要时调用；接入说明见 ChatLuna 协作指南。"),
      history: Schema.object({
        enabled: Schema.boolean().default(false).description('允许 AI 查询本群已归档对局；需同时开启 AI 工具和历史存档。'),
        pageSize: Schema.natural().min(1).max(10).default(defaultAiHistoryLimits.pageSize).description('AI 历史每页最多返回的条数。'),
        maxChars: Schema.natural().min(500).max(8000).default(defaultAiHistoryLimits.maxChars).description('AI 历史单次完整返回的字符上限，含分页信息。'),
      }).description('AI 历史查询'),
    }),
  }).description("AI 工具"),
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
    whiteGuessHost: true,
    ...config.notifications,
  }
  const enabledSpecialModes = new Set(config.enabledSpecialModes ?? ['deer', 'turtle'])
  const messages = new GameMessageDelivery((label, error) => {
    ctx.logger.warn("%s发送结果未确认：%s", label, safeErrorSummary(error))
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
  const historyQueries = new HistoryQueries(ctx.database, historyPerson, historyCanonical,
    (platform, selfId, endedAt) => historyStore.canReadMedia(platform, selfId, endedAt), config.history?.retentionDays ?? 0)
  const deerHistory = new DeerHistoryControls(ctx.database, historyPerson, historyCanonical)
  const pendingHistoryWrites = new Set<Promise<unknown>>()
  const archiveRouteKey = (platform: string, selfId: string, guildId: string) => JSON.stringify([platform, selfId, guildId])
  const recentArchiveHints = new Map<string, ArchiveHint>()
  const reportImages = new ReportImages(() => ctx.get('puppeteer') as ReportBrowser | undefined,
    { enabled: config.reportImages?.enabled ?? true, timeoutMs: Math.max(1, config.reportImages?.timeout ?? 15) * 1000 },
    error => ctx.logger.warn('图片输出未完成，使用文字回退：%s', safeErrorSummary(error)))
  const deerHiddenChoices = new Set<string>()
  const deerHiddenKey = (seat: number, userId: string) => JSON.stringify([seat, profileIdByNickname.get(player_copy?.[seat - 1]) ?? userId])
  registerHistoryCommands(ctx, historyQueries, deerHistory, historyStore, async () => {
    try { await withinBudget(Promise.allSettled([...pendingHistoryWrites]), 2000) }
    catch { throw new GameUserError('历史存档正在处理，请稍后重试。') }
  },
    async (session, op) => {
      if (!game_off && modeInteraction.mode === 'deer' && matchesActiveSession(session)) {
        if (session.isDirect || !session.guildId) return '请在本局所在群使用该指令。'
        if (op === 'reveal') return '本局仍在进行，结束后才能公布选词；查看旧局请附对局编号。'
        const index = player.indexOf(session.userId)
        const seat = index < 0 ? player_id_copy.indexOf(session.userId) + 1 : order[index]
        const person = await historyPerson(session.platform, session.userId)
        const count = historyRecorder?.hideChoices(session.platform, session.userId, person) ?? 0
        if (!(seat > 0) && !count) return '只有本局玩家可以隐藏自己的选词。'
        if (seat > 0) deerHiddenChoices.add(deerHiddenKey(seat, session.userId))
        return '已隐藏本局中你的选词；结束后主持人的批量公布不会包含它。'
      }
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
      if (session.userId === snapshot.hostId) return deerRevealView(snapshot, snapshot.rows.filter(r => !r.hidden))
      if (!own) return '只有上一把鹿模式的主持人或玩家可以公布选人。'
      own.hidden = false
      return deerRevealView(snapshot, [own])
    }, async () => {
      const result = await historyPersistence.retry()
      if (result.failed) throw new Error('历史数据库清理已完成，但部分本地待重试文件未清理，请检查日志。')
    }, reportImages)
  registerWinrateCommands(ctx, historyQueries, {
    minimumGames: Math.max(1, config.history?.winrateMinimumGames ?? 5),
    flush: async () => { await Promise.allSettled([...pendingHistoryWrites]) },
    period: async (_session, selection) => {
      if (!ctx.xpPoints?.getPeriodWindow) throw new GameUserError('周期胜率需要 xp-points 的周期功能；仍可查询累计胜率。')
      return ctx.xpPoints.getPeriodWindow(config.scoreSystemKey, selection)
    },
  })
  const maintainHistory = async () => {
    await historyStore.prune()
    await historyStore.pruneExpiredMedia()
    await historyPersistence.retry()
  }
  ctx.on('ready', () => withinBudget(maintainHistory(), 2000)
    .catch(error => ctx.logger.warn('历史维护暂未完成：%s', safeErrorSummary(error))))
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
    const epoch = gameInstanceId
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
    if (identity && !game_off && gameInstanceId === epoch) {
      profileIdByNickname.set(identity.nickname, identity.profileId)
      identityByUserId.set(session.userId, identity)
    }
    return identity?.nickname ?? resolvePlayerNickname(session)
  }
  var hostid: string
  var hostname: string
  var boomname: string
  let boomSeat = 0
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
  const recordActorSkill = (seat: number, heroId: number, effect: string, targetSeats: number[] = [],
    details?: Extract<import('./game/history-snapshot').HistoryPhase['events'][number], { kind: 'skill' }>['details'],
    position?: { sequence?: number; timing?: import('./game/history-snapshot').HistoryPhase['events'][number]['timing'] }) => {
    if (!(seat > 0)) return
    capture(r => r.event(seat, { kind: 'skill', heroId, effect, targetSeats, ...(details ? { details } : {}) },
      position ?? { timing: voteFactStage === 'published' ? 'resolution' : 'before-vote' }))
    queueHostSkillNotice(seat, effect, targetSeats)
  }
  const recordSkill = (heroId: number, effect: string, targetSeats: number[] = [],
    details?: Extract<import('./game/history-snapshot').HistoryPhase['events'][number], { kind: 'skill' }>['details'],
    position?: { sequence?: number; timing?: import('./game/history-snapshot').HistoryPhase['events'][number]['timing'] }) =>
    recordActorSkill(heros?.[heroId], heroId, effect, targetSeats, details, position)
  const historyCamp = (seat: number): HistoryCamp => flag_white && seat === white ? 'white' : uc.includes(seat) ? 'undercover' : 'good'
  const historyIdentity = (userId: string, nickname: string) => ({ platform: gameRoute.platform, userId, nickname,
    personId: profileIdByNickname.get(nickname), accountId: identityByUserId.get(userId)?.accountId ?? accountIdByNickname.get(nickname) })
  const startHistoryCapture = () => {
    deerHiddenChoices.clear()
    historyRecorder = undefined; historyCaptureFailed = false; historyOvertime = 0
    if (!historyOptions.enabled || gameRoute.platform.startsWith('sandbox') && !historyOptions.sandbox) return
    const rules: Record<string, string | number | boolean | null> = { timeoutMode: timeout_mode }
    for (const key of ['minPlayers', 'undercoverDivisor', 'whiteMinPlayers', 'allowLateJoinByDefault', 'enablePersistentScoring',
      'gatherTimeout', 'setupTimeout', 'dealMessageInterval', 'dealMessageTimeout', 'speakTimeoutMode1', 'speakTimeoutMode2', 'speakTimeoutMode3PerPlayer',
      'voteTimeout', 'skillTimeout', 'hostVoteEndMissingPercent', 'hostVoteEndMissingAllowance', 'replacementTimeout', 'boomAdjudicationTimeout', 'deerSelectionTimeout', 'deerHostReviewTimeout', 'deerProgressDelay', 'turtleAnswerTimeout',
      'scoreGoodWin', 'scoreGoodWinSpeedrun', 'scoreUndercoverWin', 'scoreUndercoverBoomBonus', 'scoreWhiteWin', 'scoreWhiteBoomWin', 'scoreGoodBoomNoWin']) {
      if (typeof config[key] === 'number' || typeof config[key] === 'boolean') rules[key] = config[key]
    }
    rules.enabledHeroes = JSON.stringify(config.enabledHeroes ?? [])
    rules.enabledSpecialModes = JSON.stringify(config.enabledSpecialModes ?? [])
    historyRecorder = new HistoryRecorder({ gameId: gameInstanceId, startedAt: gameStartedAt, mode: modeInteraction.mode,
      platform: gameRoute.platform, selfId: gameRoute.bot!.selfId, guildId: gameRoute.guildId,
      sandbox: gameRoute.platform.startsWith('sandbox'), host: historyIdentity(hostid, hostname), ruleVersion: '0.4.0', rules })
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
    personKey(hostname) === personKey(nickname) || assistantIdentityKeys.has(personKey(nickname))
      || player_copy.some(name => !isEmpty(name) && personKey(name) === personKey(nickname))
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
  const scoreAwards: ScoreWriteInput[] = []
  type CompletedEnding = Extract<HistoryEnding, { kind: 'completed' }>
  type TerminalNotice = { text: string; label: string }
  type TerminalSettlement = { endedAt: number; deadline: number; finish: () => void }
  let terminalSettlement: TerminalSettlement | undefined
  let lobbyPreparing = false
  const TERMINAL_SETTLEMENT_MS = 15_000
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
  let flag_skill_notify = false
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
  let voteOpportunity: {
    epoch: number; serial: number; expiresAt: number; hardDeadline: number
    decidedSeats: Set<number>; timer?: ReturnType<typeof setTimeout>
  } | undefined
  let weiInquiryWindow: { epoch: number, serial: number } | null = null
  let voteFactStage: 'none' | 'open' | 'counting' | 'published' = 'none'
  let liRewardSnapshot: { serial: number; weight: number; sequence?: number } | undefined
  let liRewardedSerial = -1
  let frozenVoteFacts: VoteFact[] = []
  const anonymousVoteContributions = new Map<number, number>()
  const isWeiInquiryWindowOpen = () => !game_off && weiInquiryWindow?.epoch === gameTimers.epoch
    && weiInquiryWindow.serial === votePhaseSerial && order.includes(heros[HERO.WEI_ZHONG_XIAN])
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
  const publicTimeline = new PublicGameTimelineStore()
  const currentPublicPhase = (): PublicGameEvent['phase'] =>
    terminalSettlement ? 'resolving' : !wait_off ? 'gathering' : flag_start ? (flag_fati ? 'dealing' : 'setup')
      : boom_pending ? 'adjudication' : !ann_off ? 'speech' : !vote_off ? 'voting' : 'resolving'
  const sendPublicNotice = async (bot: Session['bot'], guildId: string, content: h.Fragment,
    delivery: Promise<MessageDeliveryOutcome>): Promise<boolean> => {
    const event = (!game_off || terminalSettlement) && gameRoute.matchesSession(bot.platform, guildId, bot.selfId)
      ? publicTimeline.record({ round: Math.max(0, Math.floor(round || 0)), phase: currentPublicPhase(),
        overtime: !!add_flag, text: publicMessageText(content), delivery: '发送未确认' }) : undefined
    const receipt = await delivery
    if (receipt.status !== 'confirmed') return false
    if (hasMessageReceipt(receipt.value)) publicTimeline.confirm(event)
    return true
  }
  const matchesActiveSession = (session: Session): boolean => session.guildId
    ? gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
    : gameRoute.matchesBot(session.platform, session.selfId)
  const sendGroupNotice = (
    session: Session,
    content: h.Fragment,
    label: string,
    guildId = gameRoute.guildId,
  ): Promise<boolean> => sendPublicNotice(session.bot, guildId, content,
    messages.outcome(label, () => session.bot.sendMessage(guildId, content)))
  const sendPrivateNotice = (
    session: Session,
    userId: string,
    content: h.Fragment,
    label: string,
  ): Promise<boolean> => Promise.all((userId === hostid ? gameHostIds() : [userId])
    .map(target => messages.state(label, () => session.bot.sendPrivateMessage(target, content)))).then(results => results.some(Boolean))
  const notifyGroup = (
    session: Session,
    content: h.Fragment,
    label: string,
    guildId = gameRoute.guildId,
  ): void => {
    void sendGroupNotice(session, content, label, guildId)
  }
  const notifyPrivate = (
    session: Session,
    userId: string,
    content: h.Fragment,
    label: string,
  ): void => {
    for (const target of userId === hostid ? gameHostIds() : [userId]) messages.bestEffort(label, () => session.bot.sendPrivateMessage(target, content))
  }
  const notifySession = (
    session: Session,
    content: h.Fragment,
    label = "会话通知",
  ): void => {
    if (!session.isDirect && session.guildId) {
      void sendPublicNotice(session.bot, session.guildId, content, messages.outcome(label, () => session.send(content)))
    } else messages.bestEffort(label, () => session.send(content))
  }
  const notifyBotGroup = (
    bot: Session["bot"] | undefined,
    guildId: string,
    content: h.Fragment,
    label: string,
  ): void => {
    if (!bot || !guildId) return
    void sendPublicNotice(bot, guildId, content, messages.outcome(label, () => bot.sendMessage(guildId, content)))
  }
  const notifyBotPrivate = (
    bot: Session["bot"] | undefined,
    userId: string,
    content: h.Fragment,
    label: string,
  ): void => {
    if (!bot || !userId) return
    messages.bestEffort(label, () => bot.sendPrivateMessage(userId, content))
  }
  const skillNoticeBatches = new Map<string, { bot: Session['bot'], userId: string, lines: string[] }>()
  let skillNoticeFlush: ReturnType<typeof setImmediate> | undefined
  const queueHostSkillNotice = (seat: number, effect: string, targets: readonly number[]) => {
    const bot = gameRoute.bot
    if (!flag_skill_notify || game_off || !bot) return
    const targetText = targets.length ? '（' + targets.map(target => `${target}号玩家${player_copy[target - 1] ?? ''}`).join('、') + '）' : ''
    const heroName = HEROES[heros.indexOf(seat)]?.name
    const line = `${seat}号玩家${player_copy[seat - 1] ?? ''}${heroName ? `（${heroName}）` : ''}：${effect}${targetText}`
    for (const userId of gameHostIds()) {
      const key = gameInstanceId + ':' + userId
      const batch = skillNoticeBatches.get(key) ?? { bot, userId, lines: [] }
      batch.lines.push(line)
      skillNoticeBatches.set(key, batch)
    }
    if (skillNoticeFlush) return
    skillNoticeFlush = setImmediate(() => {
      skillNoticeFlush = undefined
      const batches = [...skillNoticeBatches.values()]
      skillNoticeBatches.clear()
      for (const batch of batches) notifyBotPrivate(batch.bot, batch.userId,
        '技能动态：\n' + batch.lines.join('\n'), '主持实时技能通知')
    })
  }
  const modeInteraction = new ModeInteractionCoordinator()
  const hostSupport = new HostSupportCoordinator()
  const hostParticipantKeys = new Set<string>()
  const assistantIdentityKeys = new Set<string>()
  const isGameHost = (userId: string) => userId === hostid || hostSupport.isAssistant(userId)
  const gameHostIds = () => [hostid, ...hostSupport.assistantIds()].filter(Boolean)
  let hostRecruitmentTimer: ReturnType<typeof setTimeout> | undefined
  let boomAdjudicationClaimed = false
  let boomAttemptText = ''
  const turtleAnswerOwners = new WeakMap<object, string>()
  const deerRevisions = new DeerRevisionCoordinator()
  const deerMakeupTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const deerReviewTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const deerResetNeedsMakeup = new Set<number>()
  let deerSpeechPhaseSerial = 0
  let deerPhaseDeadline = 0
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
    const observer = ctx.get('undercoverGameResolutionTrace') as RuntimeResolutionTraceSink | undefined
    observer?.({
      segment,
      cursor,
      gameEpoch: gameTimers.epoch,
      round,
      overtime: add_flag,
    })
  }
  const createGameHeroState = () => {
    liRewardSnapshot = undefined
    liRewardedSerial = -1
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
  interface ZhangBeforeDeparture {
    readonly elimination: EliminationContext
    readonly resume: (session: Session, carriedOvertimeCandidate: boolean) => Promise<void>
  }
  let zhangSelection: { action: PendingAction; voterText?: string; beforeDeparture?: ZhangBeforeDeparture } | undefined
  const zhangPastVoterNames = new Map<number, string>()
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
  var kickActivePlayer: (session: Session, seat: number, cause: "host" | "selection-timeout" | "makeup-timeout" | "self") => Promise<"removed" | "blocked" | "missing">
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
  interface WhiteGuessRequest { id: number; epoch: number; seat: number; userId: string; text: string; references: Set<string> }
  const whiteGuessRequests = new Map<number, WhiteGuessRequest>()
  let whiteGuessSequence = 0
  let whiteGuessNotifications = notifications.whiteGuessHost
  const zhuYouXiaoVotes = createZhuYouXiaoState()
  let zhuYouXiaoHeirTargetSeat: number | null = null
  let zhuYouXiaoHeirOwnerSeat: number | null = null
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
      () => session.bot.sendPrivateMessage(prompt.userId, recorded.content
        + (prompt.kind !== 'zhu-you-xiao-proxy-vote' && unfinishedVoteFor(prompt.userId)
          ? '\n' + skillFirstNotice(prompt.userId) : '')),
    ).catch(error => ctx.logger.error("可恢复私聊提示后处理失败：%s", safeErrorSummary(error)))
  }
  const pendingActionNames: Record<PendingActionKind, string> = {
    'mao-wen-long-late-vote': '塘报投票',
    'huang-tai-ji-quan': '使用权',
    'wu-san-gui-overtime-choice': '权计选择',
    'zhang-xian-zhong-target': '殒阵选人',
    'shi-ke-fa-gift': '落梅选人',
    'zhu-you-xiao-heir-target': '传弟选人',
    'zhu-you-xiao-heir-choice': '传弟选项',
    'zhu-you-xiao-proxy-vote': '代理投票',
    'host-adjudication': '主持判定',
  }
  const pendingSkillsFor = (userId: string): readonly PendingAction[] => pendingAction.activeActions
    .filter(action => action.gameEpoch === gameTimers.epoch && action.ownerUserId === userId
      && action.kind !== 'zhu-you-xiao-proxy-vote' && action.kind !== 'host-adjudication')
    .sort((a, b) => Number(b.blocksRosterChanges) - Number(a.blocksRosterChanges))
  const skillFirstNotice = (userId: string): string => {
    const actions = pendingSkillsFor(userId)
    if (!actions.length) return ''
    const first = actions[0]
    if (vote_off) return `你仍可在原期限内完成“${pendingActionNames[first.kind]}”选择；本次投票已结束，不会重开。`
    return `请先完成“${pendingActionNames[first.kind]}”技能选择，再投票；可发送“我的待处理”查看用法和剩余时间。`
  }
  const pendingTimeText = (action: PendingAction): string => {
    if (action.kind === 'zhu-you-xiao-proxy-vote') return vote_off ? '本次投票已结束' : '须在本次投票结束前完成'
    const remaining = pendingAction.remainingMs(Date.now(), action.kind)
    return Number.isFinite(remaining) ? `剩余约${Math.ceil(remaining / 1000)}秒` : '按原规则不限时'
  }
  const recoveredActionText = (action: PendingAction): string => {
    let content = recoverablePendingPrompts.get(action.kind)?.content ?? '请按当前技能提示操作。'
    if (action === zhangSelection?.action && zhangSelection.voterText) content += '\n' + zhangSelection.voterText
    if (action.kind === 'zhu-you-xiao-heir-choice') content += '\n也可发送“传弟选+选项序号”；发送“弃传弟”放弃。'
    if (action.kind === 'zhu-you-xiao-heir-target') content += '\n也可发送“传+玩家序号”；发送“弃传弟”放弃。'
    if (action.kind === 'zhu-you-xiao-proxy-vote') {
      const owner = zhuYouXiaoVotes.current?.ownerSeat
      if (owner != null) content = delegationPrompt(action.ownerSeat, owner)
      if (owner != null) {
        const location = zhuYouXiaoBallotLocation(owner, add_flag)
        const ballot = location?.ballots[location.index]
        content += '\n当前代理票：' + (isEmpty(ballot) ? '尚未投票' : ballot === 0 ? '已弃票'
          : ballot! > 0 ? `已投给${ballot}号玩家${player_copy[ballot! - 1]}` : '本次无需继续投票') + '。'
      }
    }
    return `【${pendingActionNames[action.kind]}】${pendingTimeText(action)}；请在${action.channel.scope === 'private' ? '私聊' : '原群'}操作。\n${content}`
  }
  const unfinishedVoteFor = (userId: string): boolean => {
    if (vote_off) return false
    const ids = add_flag ? add_voter : player
    const ballots = add_flag ? add_vote[round - 1] : vote[round - 1]
    return ids.some((id, index) => {
      const seat = order[player.indexOf(id)]
      return seat !== heros[HERO.MAO_WEN_LONG] && vote_num[seat - 1] !== 0
        && isEmpty(ballots?.[index]) && zhuYouXiaoVoteReporter(seat, add_flag).userId === userId
    })
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
  installChatLunaGameTools(ctx, config.aiTools?.enabled === true, (session, query?: PublicGameStateQuery) => {
    if ((game_off && !terminalSettlement) || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return
    return projectPublicGameState({
      route: { platform: gameRoute.platform, selfId: gameRoute.bot!.selfId, guildId: gameRoute.guildId },
      mode: modeInteraction.mode, heroesEnabled,
      phase: currentPublicPhase(),
      round: round ?? 0, overtime: add_flag, hostNickname: hostname,
      players: player_copy.map((nickname, index) => {
        const seat = index + 1, hero = heros?.indexOf(seat) ?? -1
        return { seat, nickname,
          status: !wait_off || order.includes(seat) ? '在场' : kickout.includes(seat) ? '待补位' : '出局',
          ...(hero !== -1 && publicHeroReveals.isRevealed(seat) ? { revealedHero: hero_name[hero] } : {}),
        }
      }),
      publicEvents: publicTimeline.snapshot(),
    }, session, query)
  }, undefined, () => [
    `好人常规胜利：${config.scoreGoodWin}分；速通：${config.scoreGoodWinSpeedrun}分。`,
    `卧底胜利：${config.scoreUndercoverWin}分；自爆成功者额外${config.scoreUndercoverBoomBonus}分。`,
    `白板苟赢：${config.scoreWhiteWin}分；自爆成功：${config.scoreWhiteBoomWin}分。`,
    `好人误自爆时非好人阵营：${config.scoreGoodBoomNoWin}分；白板存活安慰积分固定为1分。`,
    `积分写入：${config.enablePersistentScoring ? '开启，仍需有效积分系统及账号；沙盒不写分' : '关闭'}。`,
  ].join('\n'))
  installChatLunaHistoryTool(ctx, config.aiTools?.enabled === true && config.aiTools.history?.enabled === true && historyOptions.enabled,
    (session, query) => {
      const { platform, selfId, guildId } = session
      const key = archiveRouteKey(platform, selfId, guildId)
      const pending = terminalSettlement && historyRecorder && gameRoute.matchesSession(platform, guildId, selfId)
        ? { gameId: gameInstanceId, status: '正在归档' as const } : recentArchiveHints.get(key)
      return historyQueries.readForAi({ platform, selfId, guildId, userId: session.userId, isDirect: session.isDirect },
        query, config.aiTools?.history, pending)
    })
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
  const resolveBoomAdjudication = async (session: Session, str_ann: string) => {
    if (game_off || !boom_pending || boomAdjudicationClaimed) return
    if (str_ann !== "是" && str_ann !== "否") return "不识别的语句，请主持人发送“是”或“否”。"
    boomAdjudicationClaimed = true
    let outcomeText = ''
  if (str_ann === "是") {
    gameTimers.cancel(timer_boom)
    switch (boom_state) {
      case 1:
        sumup += "卧底自爆成功，游戏结束，卧底胜利"
        recordExplosionOutcome('undercover-win', true)
        outcomeText = '卧底自爆成功，游戏结束，卧底胜利'
        increment = config.scoreUndercoverWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
            queueScoreAward(player_copy[i], increment, 'confirmed-undercover-boom-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        queueScoreAward(boomname, config.scoreUndercoverBoomBonus, 'confirmed-undercover-boom-bonus')
        ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
        break
      case 2:
        sumup += "白板自爆成功，游戏结束，白板胜利"
        recordExplosionOutcome('white-win', true)
        outcomeText = '白板自爆成功，游戏结束，白板胜利'
        increment = config.scoreWhiteBoomWin
        queueScoreAward(boomname, increment, 'confirmed-white-boom-win-two')
        ptsstr += boomname + "加" + increment + "分。"
        break
      case 3:
        sumup += "白板自爆成功，游戏结束，白板胜利"
        recordExplosionOutcome('white-win', true)
        outcomeText = '白板自爆成功，游戏结束，白板胜利'
        increment = config.scoreWhiteBoomWin
        queueScoreAward(boomname, increment, 'confirmed-white-boom-win-three')
        ptsstr += boomname + "加" + increment + "分。"
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
        recordExplosionOutcome('good-win', true)
        outcomeText = '卧底自爆失败，游戏结束，好人胜利。'
        increment = config.scoreGoodWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
            queueScoreAward(player_copy[i], increment, 'boom-resolution-good-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        break
      case 2:
        let w = order.indexOf(white)
        recordExplosionOutcome('white-departure', true)
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
        recordExplosionOutcome('good-win', true)
        outcomeText = '白板自爆失败，场上已无卧底在场，游戏结束，好人胜利。'
        increment = config.scoreGoodWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
            queueScoreAward(player_copy[i], increment, 'boom-resolution-good-win-alternate')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        break
      default:
        notifySession(session, "出现未知bug，游戏已结束。")
    }
  }
  else {
    return ("不识别的语句，请主持人发送“是”或“否”。")
  }
  if (outcomeText) await completeGame(session, {
    kind: 'completed', reason: 'self-explosion', winner: str_ann === '否' ? 'good' : boom_state === 1 ? 'undercover' : 'white',
  }, { before: { text: outcomeText, label: '自爆裁定结算' }, whiteSelfExplosionFailed: str_ann === '否' && boom_state === 3 })
  else end_game({ kind: 'aborted', reason: 'system-error' })
  return
  }
  const beginBoomAdjudication = (session: Session, state: number) => {
    boomAdjudicationClaimed = false
    boomAttemptText = session.content
    boom_pending = true
    boom_state = state
    gameTimers.cancel(timer_ann)
    gameTimers.cancel(timer_boom)
    const delay = Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) * 1000
    const boomKey = 'boom:' + gameTimers.epoch + ':' + boomSeat + ':' + round
    const arm = () => { timer_boom = setGameTimeout(async () => {
      if (!boom_pending) return
      await handleHostTimeout(session, 'boom', boomKey, () => boom_pending && !boomAdjudicationClaimed, arm,
        async () => { if (boom_pending) { notifyGroup(session, '主持人判定超时，本次自爆按失败结算。', '自爆超时默认裁定'); await resolveBoomAdjudication(session, '否') } })
    }, delay) }
    arm()
  }
  const abortHostTimeout = (session: Session, detail = '主持人处理超时') => {
    const bot = session.bot, guild = gameRoute.guildId
    sumup += detail + '，本局自动终止且不计分。\n'
    end_game({ kind: 'aborted', reason: 'host-timeout' })
    notifyBotGroup(bot, guild, detail + '，本局已自动终止且不计分。', '主持人超时终止通知')
  }
  const handleHostTimeout = async (session: Session, kind: 'deer' | 'boom' | 'turtle' | 'speech-review', key: string,
    pending: () => boolean, resume: () => void, fallback: () => void | Promise<void>) => {
    if (game_off || !pending()) return
    const action = kind === 'deer' ? config.deerHostTimeoutAction ?? 'auto'
      : kind === 'boom' ? config.boomHostTimeoutAction ?? 'auto'
        : kind === 'turtle' ? config.turtleHostTimeoutAction ?? 'abort' : config.deerSpeechReviewTimeoutAction ?? 'auto'
    if (action === 'abort') return kind === 'turtle' ? fallback() : abortHostTimeout(session, kind === 'deer' ? '主持人长时间未处理待审核选人'
      : kind === 'boom' ? '主持人自爆判定超时' : '主持人前序发言复核超时')
    if (action === 'auto') return fallback()
    const result = hostSupport.request({ key, pending, resume, fallback })
    if (result.kind === 'fallback') return fallback()
    if (result.kind === 'joined') return
    const window = result.window, epoch = gameTimers.epoch
    gameTimers.cancel(hostRecruitmentTimer)
    hostRecruitmentTimer = setGameTimeout(async () => {
      for (const request of hostSupport.expire(window)) {
        if (game_off) break
        if (request.pending()) await request.fallback()
      }
    }, Math.max(30, config.hostRecruitmentTimeout ?? 300) * 1000)
    let callable: string[] = []
    try { callable = await subscriptions.getCallableUserIds(session.bot, session.platform, gameRoute.guildId) }
    catch (error) { ctx.logger.warn('协同主持招募成员检查未完成：%s', safeErrorSummary(error)) }
    if (game_off || gameTimers.epoch !== epoch || hostSupport.activeWindow !== window || !hostSupport.activeRequests().length) return
    const mentions = callable.filter(id => !isGameHost(id) && !hostSupport.isParticipant(id)).map(id => h('at', { id }))
    notifyGroup(session, h('template', {}, ...mentions, h.text('本局需要一名协同主持，未曾参加本局的群友可回复“1”接任。原主持仍可处理待办；'
      + Math.max(30, config.hostRecruitmentTimeout ?? 300) / 60 + '分钟无人接任则采用超时默认处理。')), '协同主持招募')
  }
  const hostBrief = () => {
    const state = modeInteraction.state
    const rows = player_copy.map((name, index) => name ? `${index + 1}号${name}｜${factionOfSeat(index + 1) === 'undercover' ? '卧底' : factionOfSeat(index + 1) === 'white' ? '白板' : '好人'}｜${heros.includes(index + 1) ? hero_name[heros.indexOf(index + 1)] : '无武将'}｜${order.includes(index + 1) ? '在场' : '已离场'}` : '').filter(Boolean)
    const details = state.kind === 'deer' ? ['易混：' + state.commonTerm, ...[...state.selections.values()].map(s => `${s.seat}号已批选词：${s.approvedCandidate ?? '未批准'}${s.status === 'pending-host' ? '；待审：' + s.candidate : ''}`),
      ...modeInteraction.deerProgress().pendingHost.map(deerHostReviewPrompt).filter(Boolean), ...deerRevisions.pendingReviews().map(deerSpeechReviewPrompt)]
      : state.kind === 'turtle' ? ['汤面：' + state.surface, ...modeInteraction.turtleProgress().pendingHost.map(turtleHostAnswerPrompt).filter(Boolean)] : ['好人雷点：' + instr1, '卧底雷点：' + instr2, '白板提示：' + instr3]
    const goodTerm = state.kind === 'turtle' ? state.goodTerm : state.kind === 'deer' ? state.goodRule : item1_copy
    const undercoverTerm = state.kind === 'turtle' ? state.undercoverTerm : state.kind === 'deer' ? state.undercoverRule : item2_copy
    return ['本局协同主持资料；原主持仍然有效。', '模式：' + modeInteraction.module.label + '；第' + round + '轮。', '好人词条/规则：' + goodTerm, '卧底词条/规则：' + undercoverTerm,
      ...rows, ...details, ...(boom_pending ? ['待判定自爆：' + boomAttemptText + '；请在群内回复“是”或“否”。'] : []), '可发送“待处理操作”补取待办。'].join('\n')
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
    // A published vote can still be resolving an elimination skill.  It only
    // becomes a past phase when the next speech phase actually starts.
    heroState.weiZhongXian.phaseSerial = null
    clearVoteOpportunity()
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
  const queueScoreAward = (nickname: string, amount: number, reason: string): void => {
    scoreAwards.push({
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
  const completeGame = (
    session: Session,
    ending: CompletedEnding,
    options: { before?: TerminalNotice; after?: TerminalNotice; whiteSelfExplosionFailed?: boolean } = {},
  ): Promise<void> => {
    if (terminalSettlement || game_off) return Promise.resolve()
    // Final active account, not an eliminated/recruited predecessor or the
    // old white seat. No-winner games already have their own award rule.
    if ((ending.winner === 'good' || ending.winner === 'undercover')
      && flag_white && order.includes(white) && !options.whiteSelfExplosionFailed) {
      const nickname = player_name[order.indexOf(white)]
      queueScoreAward(nickname, 1, 'white-survival-consolation')
      ptsstr += nickname + "仍在场，获得1分安慰积分。"
    }
    const awards = scoreAwards.splice(0)
    const scoreText = ptsstr
    const guildId = gameRoute.guildId
    const endedAt = Date.now()
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout>
      const settlement: TerminalSettlement = {
        endedAt, deadline: endedAt + TERMINAL_SETTLEMENT_MS,
        finish: () => {
          if (terminalSettlement !== settlement) return
          clearTimeout(timer)
          const acknowledged = new Set(scoreService.results.map(receipt => receipt.input.idempotencyKey))
          const scoreUnconfirmed = awards.some(award => award.enabled && award.amount !== 0 && !acknowledged.has(award.idempotencyKey))
          const text = scoreUnconfirmed ? '对局结果已确定；部分积分写入未确认，请管理员核对流水后处理。'
            : scoreText + scoreService.failureNotice()
          notifyGroup(session, text, '积分结算通知', guildId)
          if (options.after) notifyGroup(session, options.after.text, options.after.label, guildId)
          end_game(scoreUnconfirmed ? { ...ending, scoreUnconfirmed: true } : ending, undefined, settlement)
          resolve()
        },
      }
      // Claim before any I/O. Freeze all award payloads and disarm gameplay;
      // this independent watchdog works even if the adapter or storage hangs.
      terminalSettlement = settlement
      game_off = true
      vote_off = ann_off = true
      gameTimers.cancelAll()
      timer = setTimeout(settlement.finish, TERMINAL_SETTLEMENT_MS)
      const announcement = options.before && sendGroupNotice(session, options.before.text, options.before.label, guildId)
      void Promise.allSettled([announcement, ...awards.map(award => scoreService.add(award))]).then(settlement.finish)
    })
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
    flag_skill_notify = config.realtimeSkillNoticeDefault ?? false
    whiteGuessNotifications = notifications.whiteGuessHost
    whiteGuessRequests.clear()
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
    clearZhuYouXiaoPhase(zhuYouXiaoVotes)
    zhuYouXiaoVotes.records = []
    zhuYouXiaoHeirTargetSeat = null
    zhuYouXiaoHeirOwnerSeat = null
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
    identityKey: profileIdByNickname.has(player_name[index]) ? 'person:' + profileIdByNickname.get(player_name[index]) : 'user:' + player[index],
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
    if (modeInteraction.mode === "deer") return "请输入鹿模式易混（不能作为玩家选词，将公开到群聊并私聊给所有玩家）："
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
      if (step === "good-detail") return "请输入鹿模式好人阵营的选人/选词规则："
      if (step === "undercover") return "请输入鹿模式卧底阵营的选人/选词规则："
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
        ? ["易混：" + (instr3 || "（未填写）"), "好人规则：" + (item1 || "（未填写）"), "卧底规则：" + (item2 || "（未填写）")]
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
        instr3 = ""
        setSetupPromptStep("primary")
      }
      else if (step === "undercover") {
        item1 = ""
        setSetupPromptStep("good-detail")
      }
      else {
        item2 = ""
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
      const approved = modeInteraction.deerApprovedCandidate(seat)
      return "你是" + seat + "号玩家。\n鹿模式易混：" + instr3 + "\n你的选人/选词规则：" + rule + "\n"
        + (approved ? '已批准选词：' + approved + '。' : replacement
          ? "你不能继承原玩家的选人，请发送“选词＋内容”或“选人＋内容”提交，等待主持人审核。"
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
    record.seat + "号玩家" + record.nickname + "：" + (record.invalidReason ? '（已失效：' + record.invalidReason + '）' : '') + record.text
  const plainSpeechSegments = (segments: HistorySpeechSegment[]) => segments
    .map(segment => segment.kind === 'text' ? segment.text : segment.kind === 'face' ? '[表情]' : `[${segment.type === 'img' ? '图片' : '媒体'}]`).join('')
  const recordSpeech = (session: Session, seat: number, text: string, question?: string, answer?: string, targetRound?: number) => {
    // Turtle records the player's question and the host's final answer, not
    // the host reply session alone. Parse the combined public Q/A fragment.
    const segments = extractSpeechSegments(question === undefined ? ((session as any).elements ?? session.content) : text)
    // Media remains a structured fragment, never an XML string containing
    // authorization-bearing URLs in searchable text or text-only fallback.
    const plainText = segments.some(segment => segment.kind !== 'text') || /<face\b/i.test(text)
      ? plainSpeechSegments(segments)
      : text
    speechHistory.record({
      round: targetRound ?? round,
      overtime: targetRound === undefined && add_flag,
      seat,
      nickname: player_copy[seat - 1] || (order.indexOf(seat) === -1 ? "" : player_name[order.indexOf(seat)]),
      text: plainText,
      segments,
      identityKey: currentModeRoster().find(member => member.seat === seat)?.identityKey,
    })
    const nickname = player_copy[seat - 1] || (order.indexOf(seat) === -1 ? "" : player_name[order.indexOf(seat)])
    const publicSpeech = question === undefined
      ? `${seat}号玩家${nickname}：${plainText}`
      : `${seat}号玩家${nickname}提问：${plainSpeechSegments(extractSpeechSegments(question))}\n回答：${plainSpeechSegments(extractSpeechSegments(answer ?? ''))}`
    if (!game_off) publicTimeline.record({ round: Math.max(0, Math.floor(round || 0)), phase: 'speech', overtime: !!add_flag, text: publicSpeech })
    if (targetRound !== undefined) {
      capture(r => r.speechAt(seat, targetRound, plainText, persistentSpeechSegments(segments)))
      return
    }
    capture(r => r.speech(seat, plainText,
      question === undefined ? undefined : plainSpeechSegments(extractSpeechSegments(question)),
      answer === undefined ? undefined : plainSpeechSegments(extractSpeechSegments(answer)),
      persistentSpeechSegments(segments)))
  }
  const recordSelfExplosion = (seat: number, text: string) => {
    boomSeat = seat
    capture(r => r.explosion(seat, plainSpeechSegments(extractSpeechSegments(text))))
  }
  const recordExplosionOutcome = (outcome: Parameters<HistoryRecorder['resolveExplosion']>[1], adjudicated = false) => {
    capture(r => r.resolveExplosion(boomSeat, outcome, adjudicated))
  }
  const speechOverviewText = () => {
    const phases = speechHistory.phases()
    if (phases.length === 0) return "本局目前还没有已记录的发言。"
    return phases.map(phase =>
      speechPhaseLabel(phase.round, phase.overtime) + "：\n" + phase.records.flatMap(record => [
        ...(record.previousInvalid ?? []).map(old => speechRecordText({ ...record, text: old.text, invalidReason: old.reason })), speechRecordText(record),
      ]).join("\n"),
    ).join("\n\n")
  }
  const speechRecordFragment = (record: ReturnType<SpeechHistory['bySeat']>[number]): any => {
    const prefix = record.seat + "号玩家" + record.nickname + "：" + (record.invalidReason ? '（已失效：' + record.invalidReason + '）' : '')
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
      phase.records.flatMap(record => [
        ...(record.previousInvalid ?? []).flatMap(old => [speechRecordFragment({ ...record, text: old.text, segments: old.segments, invalidReason: old.reason }), h.text('\n')]),
        speechRecordFragment(record), h.text("\n"),
      ]),
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
  const publicHeroIdentity = (seat: number, ordinal = false, afterNickname = "",
    timing?: import('./game/history-snapshot').HistoryPhase['events'][number]['timing']): string => {
    const heroIndex = heros.indexOf(seat)
    const nickname = player_copy[seat - 1] || (order.indexOf(seat) === -1 ? "" : player_name[order.indexOf(seat)])
    const base = (ordinal ? "第" : "") + seat + "号玩家" + nickname + afterNickname
    if (heroIndex === -1) return base
    const hero = hero_name[heroIndex]
    const first = publicHeroReveals.reveal(seat)
    if (first) capture(r => r.event(seat, { kind: 'hero-reveal', heroId: heroIndex }, timing ? { timing } : undefined))
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
      const choice = role === "白板" ? "（无需选人）" : (modeInteraction.deerApprovedCandidate(seat) ?? "（未通过）")
      rows.push({
        seat,
        userId: player_id_copy[seat - 1],
        profileId: profileIdByNickname.get(player_copy[seat - 1]),
        nickname: player_copy[seat - 1],
        role,
        rule,
        choice,
        hidden: deerHiddenChoices.has(deerHiddenKey(seat, player_id_copy[seat - 1])),
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
  const deerRevealView = (snapshot: DeerRevealSnapshot, rows: readonly DeerRevealRow[]) => ({
    text: formatDeerRevealRows(snapshot, rows),
    table: { caption: '易混：' + snapshot.commonTerm, headers: ['玩家', '身份', '选词规则', '选词'], rows: rows.map(row => [`${row.seat}号 ${row.nickname}`, row.role, row.rule, row.choice]) },
  })
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
    for (const timer of deerMakeupTimers.values()) gameTimers.cancel(timer)
    for (const timer of deerReviewTimers.values()) gameTimers.cancel(timer)
    deerMakeupTimers.clear(); deerReviewTimers.clear(); deerRevisions.reset(); deerResetNeedsMakeup.clear()
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
        notifyPrivate(session, hostid, "龟模式" + seat + "号玩家的问题等待回答时间已过半，请尽快在群内回答或驳回。", `龟模式${seat}号回答过半提醒`)
      }, Math.max(1, Math.floor(total / 2))))
    }
    turtleAnswerTimers.set(seat, setGameTimeout(async () => {
      if (modeInteraction.mode !== "turtle" || (ann_off && !turtleBackfillSeats.has(seat)) || !speechPhases.matches(phase)) return
      const current = modeInteraction.turtleTurnForSeat(seat)
      if (!current || current.status !== "pending-host" || current.pendingSince !== pendingSince) return
      await handleHostTimeout(session, 'turtle', 'turtle:' + modeInteraction.turtleActiveRoundKey + ':' + seat + ':' + pendingSince,
        () => modeInteraction.mode === 'turtle' && modeInteraction.turtleTurnForSeat(seat)?.status === 'pending-host'
          && modeInteraction.turtleTurnForSeat(seat)?.pendingSince === pendingSince,
        () => armTurtleAnswerTimer(session, seat), () => abortHostTimeout(session, '主持人未在限时内回答' + seat + '号玩家的问题'))
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
    notifyGroup(session,
      (add_flag ? "龟模式加时问答开始。" : `龟模式问答开始（第${round}轮）。`) + onboarding + timing,
      '龟模式问答开始通知')
    return true
  }
  const deerSeatDisplay = (seat: number, mention = false): string => {
    const index = order.indexOf(seat)
    const name = index === -1 ? (player_copy[seat - 1] ?? "") : player_name[index]
    const userId = index === -1 ? player_id_copy[seat - 1] : player[index]
    return seat + "号玩家" + name + (mention && userId ? String(h("at", { id: userId })) : "")
  }
  const deerProgressPrivate = (): boolean => modeInteraction.mode === 'deer' && white_copy > 0
  const rejectUnapprovedDeerSpeech = (session: Session, reason: string): string | void => {
    if (!deerProgressPrivate()) return reason
    notifyPrivate(session, session.userId, reason, '鹿模式发言资格私聊提示')
  }
  const deerProgressText = (mention = true): string => {
    const progress = modeInteraction.deerProgress()
    if (progress.waitingPlayer.length === 0 && progress.pendingHost.length === 0) {
      return "所有在场非白板玩家均已通过选人审核。"
    }
    const parts: string[] = []
    if (progress.waitingPlayer.length > 0) {
      parts.push("尚未提交：" + progress.waitingPlayer.map(seat => deerSeatDisplay(seat, mention)).join("，"))
    }
    if (progress.pendingHost.length > 0) {
      parts.push("待主持审核：" + progress.pendingHost.map(seat => deerSeatDisplay(seat)).join("，")
        + (hostid && mention ? "；请主持人" + String(h("at", { id: hostid })) + "尽快处理" : ""))
    }
    return "鹿模式选人进度：" + parts.join("；") + "。"
  }
  const deerProgressSignature = (): string => {
    const progress = modeInteraction.deerProgress()
    return progress.waitingPlayer.join(",") + "|" + progress.pendingHost.join(",")
  }
  const remindDeerPrivately = (session: Session): void => {
    for (const host of gameHostIds()) notifyPrivate(session, host, deerProgressText(false), '鹿模式私有选词进度')
    for (const seat of modeInteraction.deerProgress().waitingPlayer) {
      const selection = modeInteraction.deerSelectionForSeat(seat)
      if (selection) notifyPrivate(session, selection.userId, '请完成鹿模式选词，发送“选词＋内容”或“选人＋内容”提交。', '鹿模式选词提醒')
    }
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
    if (deerProgressPrivate()) remindDeerPrivately(session)
    else notifyGroup(session, deerProgressText(), '鹿模式自动选人进度')
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
      for (const host of gameHostIds()) notifyPrivate(session, host, "鹿模式仍有待审核选人，请尽快处理。\n" + deerProgressText(false), '鹿模式主持审核过半提醒')
    }, Math.max(1, Math.floor(total / 2)))
    timer_deer_host_review = setGameTimeout(async () => {
      if (modeInteraction.mode !== "deer" || deerHostReviewDeadlineAt !== expectedDeadline
        || modeInteraction.deerProgress().pendingHost.length === 0) return
      const proposals = modeInteraction.deerProgress().pendingHost.map(seat => ({ seat, version: modeInteraction.deerSelectionForSeat(seat)!.version }))
      for (const proposal of proposals) {
        if (game_off) return
        const applicant = modeInteraction.deerSelectionForSeat(proposal.seat)?.userId
        await handleHostTimeout(session, 'deer', 'deer:' + proposal.seat + ':' + applicant + ':' + proposal.version,
          () => { const s = modeInteraction.deerSelectionForSeat(proposal.seat); return modeInteraction.mode === 'deer' && s?.userId === applicant && s.status === 'pending-host' && s.version === proposal.version },
          () => syncDeerHostReviewClock(session, true), async () => {
            const selection = modeInteraction.deerSelectionForSeat(proposal.seat)
            if (selection?.userId !== applicant || selection.status !== 'pending-host' || selection.version !== proposal.version) return
            await applyDeerSelectionReview(session, { ...proposal, approved: true })
            for (const host of gameHostIds()) notifyPrivate(session, host, proposal.seat + '号玩家的选词审核超时，已按设置自动通过。', '鹿模式选词自动通过')
          })
      }
    }, total)
  }
  const deerSeatNeedsSelection = (seat: number): boolean => {
    if (modeInteraction.mode !== "deer") return false
    const selection = modeInteraction.deerSelectionForSeat(seat)
    return !!selection && !modeInteraction.deerApprovedCandidate(seat)
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
    const task = deerRevisions.makeup(seat)
    const deadline = Math.max(Date.now() + duration, task ? deerRevisions.deadline(task) : 0)
    if (!Number.isFinite(deadline)) return
    deerSpeechDeadlines.set(seat, deadline)
    deerPhaseDeadline = Math.max(deerPhaseDeadline, deadline)
    deerRevisions.noteSpeechDeadline(deerSpeechPhaseSerial, deerPhaseDeadline)
    scheduleDeerMakeups(session)
    if (zhangXianZhongModule.isAwaitingTarget(heroState)) return
    deerSpeechTimers.set(seat, setGameTimeout(() => {
      if (!speechPhases.matches(phase)) return
      return processDeerSpeechExpiries(session)
    }, Math.max(1, deadline - Date.now())))
  }
  const startDeerSpeechRound = (session: Session, firstRound = false): boolean => {
    if (modeInteraction.mode !== "deer" || game_off) return false
    gameTimers.cancel(timer_ann)
    for (const seat of [...deerSpeechTimers.keys()]) cancelDeerSpeechClock(seat)
    ann_off = false
    deerSpeechPhaseSerial++
    const phaseDuration = deerSpeechDurationMs()
    deerPhaseDeadline = Number.isFinite(phaseDuration) ? Date.now() + phaseDuration : Infinity
    deerRevisions.noteSpeechDeadline(deerSpeechPhaseSerial, deerPhaseDeadline)
    scheduleDeerMakeups(session)
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
    if (firstRound) {
      const timing = Number.isFinite(duration) ? "每名获得发言资格的玩家独立限时" + duration / 60000 + "分钟。" : "本轮发言不限时。"
      notifyGroup(session, "鹿模式易混：" + instr3 + "\n鹿模式第1轮发言已开放：已获得发言资格的玩家可以发言，其他玩家请继续完成私聊选人流程。" + timing, '鹿模式发言开始通知')
    }
    else if (Number.isFinite(duration)) {
      notifyGroup(session, "本次发言阶段限时：" + duration / 60000 + "分钟", '鹿模式发言限时通知')
    }
    return true
  }
  const deerChangesOpen = (): boolean => {
    const deadline = config.deerReselectionDeadline ?? 'first-round'
    if (game_off || deadline === 'first-round' && round > 1
      || deadline === 'discussion' && speechReviewUnlocked()) deerRevisions.closeApplications()
    return !deerRevisions.applicationsClosed
  }
  const deerReselectionHint = (): string => {
    if (!deerChangesOpen()) return ''
    const deadline = config.deerReselectionDeadline ?? 'first-round'
    const label = deadline === 'first-round' ? '第一轮结束前'
      : deadline === 'discussion' ? '解锁盘发言、带票前' : '游戏结束前'
    return `\n${label}，可发送“选词＋新内容”或“选人＋新内容”重新申请。`
  }
  const clearDeerRevisionSeat = (seat: number) => {
    gameTimers.cancel(deerMakeupTimers.get(seat)); deerMakeupTimers.delete(seat)
    gameTimers.cancel(deerReviewTimers.get(seat)); deerReviewTimers.delete(seat)
    deerRevisions.clearSeat(seat)
  }
  const scheduleDeerMakeups = (session: Session) => {
    for (const task of deerRevisions.pendingMakeups()) {
      gameTimers.cancel(deerMakeupTimers.get(task.seat)); deerMakeupTimers.delete(task.seat)
      const deadline = deerRevisions.deadline(task)
      if (!Number.isFinite(deadline)) continue
      const check = async () => {
        if (game_off || deerRevisions.makeup(task.seat) !== task || player[order.indexOf(task.seat)] !== task.userId) return
        if (isRosterChangeBlocked()) {
          deerMakeupTimers.set(task.seat, setGameTimeout(check, 1000)); return
        }
        clearDeerRevisionSeat(task.seat)
        await kickActivePlayer(session, task.seat, 'makeup-timeout')
      }
      deerMakeupTimers.set(task.seat, setGameTimeout(check, Math.max(1, deadline - Date.now())))
    }
  }
  const requestDeerMakeup = (session: Session, seat: number, version: number) => {
    const index = order.indexOf(seat)
    if (index < 0 || game_off) return
    deerRevisions.requestMakeup({ seat, userId: player[index], version, round,
      now: Date.now(), durationMs: Math.max(0, config.deerMakeupTimeout ?? 120) * 1000,
      ...(!ann_off ? { referencePhase: deerSpeechPhaseSerial, referenceDeadline: deerPhaseDeadline } : {}) })
    if (!ann_off && !add_flag) ann[index] = ''
    scheduleDeerMakeups(session)
    if (!ann_off) armDeerSpeechClock(session, seat, deerPhaseDeadline)
    const prompt = deerSeatDisplay(seat) + '的前序发言已失效，请发送“' + seat + '补发言内容”补一次本轮发言；当前投票和技能照常进行。'
    if (deerProgressPrivate()) {
      notifyPrivate(session, player[index], prompt, '鹿模式补发言提示')
      notifyPrivate(session, hostid, prompt, '鹿模式补发言主持通知')
    } else notifyGroup(session, prompt, '鹿模式补发言提示')
  }
  const invalidateDeerSpeeches = (records: DeerSpeechReview['records']) => {
    const reason = '更换选词后复核未通过'
    speechHistory.invalidate(records, reason)
    for (const record of records) capture(r => r.invalidateSpeech(record.seat, record.round, record.overtime, record.text, reason))
  }
  const deerSpeechReviewPrompt = (review: DeerSpeechReview) =>
    deerSeatDisplay(review.seat) + '已更换选词，请整批复核以下前序发言是否仍然成立：\n'
    + review.records.map(record => speechPhaseLabel(record.round, record.overtime) + '：' + record.text).join('\n')
    + '\n请私聊发送“复核' + review.seat + '是”或“复核' + review.seat + '否”。'
  const finishDeerSpeechReview = async (session: Session, seat: number, approved: boolean, version?: number) => {
    const selection = modeInteraction.deerSelectionForSeat(seat)
    const pending = deerRevisions.review(seat)
    if (!selection || !pending || selection.approvedVersion !== pending.version || version !== undefined && pending.version !== version) return false
    const review = deerRevisions.finishReview(seat, selection.userId, pending.version)
    if (!review) return false
    gameTimers.cancel(deerReviewTimers.get(seat)); deerReviewTimers.delete(seat)
    if (!approved && !game_off) {
      invalidateDeerSpeeches(review.records)
      requestDeerMakeup(session, seat, pending.version)
    }
    return true
  }
  const onDeerWordApproved = async (session: Session, seat: number, previousCandidate?: string) => {
    const selection = modeInteraction.deerSelectionForSeat(seat)!
    const existingMakeup = deerRevisions.makeup(seat)
    const existingReview = deerRevisions.review(seat)
    if (previousCandidate && previousCandidate === selection.approvedCandidate) {
      if (existingReview || existingMakeup) selection.approvedVersion = (existingReview ?? existingMakeup)!.version
      return
    }
    const identityKey = currentModeRoster().find(member => member.seat === seat)?.identityKey
    const records = speechHistory.bySeat(seat).filter(record => !record.invalidReason && record.identityKey === identityKey)
    clearDeerRevisionSeat(seat)
    if (deerResetNeedsMakeup.delete(seat) || existingMakeup && !records.length) {
      requestDeerMakeup(session, seat, selection.approvedVersion!); return
    }
    if (!previousCandidate || previousCandidate === selection.approvedCandidate || !records.length) return
    const policy = config.deerPreviousSpeechPolicy ?? 'review'
    if (policy === 'keep') return
    if (policy === 'invalidate') {
      invalidateDeerSpeeches(records); requestDeerMakeup(session, seat, selection.approvedVersion!); return
    }
    const review = { seat, userId: selection.userId, version: selection.approvedVersion!, records }
    deerRevisions.beginReview(review)
    await armDeerSpeechReview(session, deerRevisions.review(seat)!)
  }
  async function armDeerSpeechReview(session: Session, review: DeerSpeechReview) {
    const seat = review.seat
    const total = Math.max(1, (review.deadlineAt ?? (Date.now() + Math.max(30, config.deerHostReviewTimeout ?? 300) * 1000)) - Date.now())
    review.deadlineAt = Date.now() + total
    const armReview = () => deerReviewTimers.set(seat, setGameTimeout(() => handleHostTimeout(session, 'speech-review', 'speech:' + seat + ':' + review.userId + ':' + review.version,
      () => deerRevisions.review(seat) === review, armReview,
      async () => { await finishDeerSpeechReview(session, seat, config.deerSpeechReviewDefault === 'approve', review.version) }), total))
    armReview()
    await sendPrivateNotice(session, hostid, deerSpeechReviewPrompt(review), '鹿模式前序发言复核')
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
      await sendPrivateNotice(
        session,
        hostid,
        "以下私聊发送结果未能确认：" + dealFailures.map(({ seat, item }) => seat + "号" + item).join("、")
          + "。玩家可能已经收到，请先确认；未收到时可私聊发送“题面”“武将”或“重发信息”补取。",
        "发牌结果汇总",
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
    return `发题配置已完成。实时投票通知当前已${flag_notify ? '开启' : '关闭'}，技能通知当前已${flag_skill_notify ? '开启' : '关闭'}；主持人可发送“开启/关闭投票通知”或“开启/关闭技能通知”切换。`
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
题面 / 武将 / 重发信息：玩家私聊补取本局信息，保留带“我的”的原名称
待办 / 待处理 / 待审：玩家查看选词、发言、投票与技能任务；主持查看审核等待办，群查详情转私聊（保留原入口）
谁没发言 / 谁没投票：经典与鹿进度　龟进度：龟模式问答进度
凑人进度 / 几个人了：查看当前人数　发言总览：合并查看本局各轮发言
盘3：解锁盘发言后，由在场玩家查看3号从开局至今的全部发言
亮将情况：查看本局当前已公开武将牌的固定座位
结束投票：主持可按配置的未投票门槛结束投票　总结 / 复盘：查看上局记录
开启投票通知 / 关闭投票通知：主持人随时切换私聊票况；投票通知状态可查询
开启技能通知 / 关闭技能通知：独立切换主持人私聊技能动态；技能通知状态可查询
隐藏选人 [编号]：无编号优先隐藏当前鹿局自己的选词，否则处理最近鹿局；编号指定旧局
公布选人：原主持人公布全部未隐藏记录；上把玩家公布自己的记录并解除隐藏
查询武将 [武将名]：查看技能；省略名称可交互选择　停止卧底：终止本局

【重要规则】
使用前请先添加 bot 为好友；主持人不参与游戏。
结果公布前可以改发言、改票；鹿模式选词在本局配置的截止节点前可发送“选词+内容”申请更换。
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
  ctx.guild().middleware(async (session, next) => {
    if (game_off || hostSupport.activeWindow === undefined || session.content.trim() !== '1'
      || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (isGameHost(session.userId) || hostSupport.isParticipant(session.userId)) return '本局主持人及曾参赛玩家不能接任协同主持。'
    const epoch = gameTimers.epoch, expectedWindow = hostSupport.activeWindow
    const identity = await ctx.xpPoints?.getManagedIdentity?.(session.platform, session.userId)
    if (game_off || gameTimers.epoch !== epoch || hostSupport.activeWindow !== expectedWindow) return
    if (identity && hostParticipantKeys.has('person:' + identity.profileId)) return '本局曾参赛玩家的关联账号不能接任协同主持。'
    const window = hostSupport.claim(session.userId)
    if (window === undefined) return next()
    const delivered = await messages.state('协同主持资料交付', () => session.bot.sendPrivateMessage(session.userId, h.text(hostBrief())))
    if (game_off || gameTimers.epoch !== epoch) return
    if (!delivered) {
      hostSupport.releaseClaim(session.userId, window)
      return '主持资料私聊发送失败，尚未接任；请允许机器人私聊后重试，其他符合条件的群友也可回复1。'
    }
    const requests = hostSupport.grant(session.userId, window)
    if (!requests) return '原待办已处理，无需接任。'
    assistantIdentityKeys.add(identity ? 'person:' + identity.profileId : personKey(resolvePlayerNickname(session)))
    gameTimers.cancel(hostRecruitmentTimer)
    for (const request of requests) if (request.pending()) request.resume()
    return resolvePlayerNickname(session) + '已接任协同主持，原主持仍然有效。'
  })
  ctx.command("叫人")
  .userFields(["authority"])
  .alias("召唤术")
  .action(async ({session})=>{
    if (!session.guildId) {
      return("本功能仅支持qq群内使用哦~")
    }
    if(session.user.authority < 2 && (!isGameHost(session.userId) || (wait_off && !flag_start && isEmpty(kickout)))) return(resolvePlayerNickname(session) + "，你又不是bot管理员，也没在凑人，我才不理你呢！")
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
    if (game_off || !isGameHost(session.userId)) return next()
    if (!matchesActiveSession(session)) return next()
    const input = session.content.replace(/\s/g, "")
    if (/^(?:开启|打开|关闭)白板通知$/u.test(input)) {
      whiteGuessNotifications = !input.startsWith('关闭')
      return '白板未匹配猜词通知已' + (whiteGuessNotifications ? '开启。' : '关闭。')
    }
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
    if (/^(?:开启|打开|关闭)(?:实时)?技能通知$/u.test(input)) {
      flag_skill_notify = !input.startsWith('关闭')
      return '实时技能通知已' + (flag_skill_notify ? '开启。' : '关闭。')
    }
    if (/^(?:实时)?技能通知状态$/u.test(input)) return '实时技能通知当前已' + (flag_skill_notify ? '开启。' : '关闭。')
    return next()
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {
    if (game_off || !isGameHost(session.userId) || !matchesActiveSession(session)) return next()
    const input = normalizeHeroCommand(session.content)
    const byId = input.match(/^白板判定([1-9][0-9]*)(好人|卧底)$/u)
    const reference = resolveModeMessageReference({ quote: session.quote, eventQuote: session.event.message?.quote,
      rawMessage: session.event._data?.message, onebotMessage: (session as any).onebot?.message })
    const camp = byId?.[2] ?? (reference && /^(?:好人|卧底)$/u.test(input) ? input : undefined)
    if (!camp) return next()
    const request = byId ? whiteGuessRequests.get(Number(byId[1])) : [...whiteGuessRequests.values()].find(item =>
      !!reference?.messageId && item.references.has(session.userId + ':' + reference.messageId))
    return gameInputQueue.run(async () => {
      if (!request || request.epoch !== gameTimers.epoch || !flag_white || white !== request.seat
        || player[order.indexOf(request.seat)] !== request.userId || !whiteGuessRequests.has(request.id)) return '这次白板猜词已失效或已处理。'
      if (zhangSelection?.beforeDeparture) return '请等待“殒阵”结算后再处理这次猜词。'
      whiteGuessRequests.clear()
      await recruitWhite(session, camp === '好人' ? item1 : item2, request.text)
      return '已认可这次猜词，白板加入' + camp + '阵营。'
    })
  })
  const deerHostReviewPrompt = (seat: number): string | undefined => {
    const state = modeInteraction.state
    if (state.kind !== 'deer') return
    const selection = state.selections.get(seat)
    if (!selection || selection.status !== 'pending-host' || !selection.candidate) return
    const isUndercover = uc_copy.includes(seat)
    const role = isUndercover ? '卧底' : '好人'
    const rule = isUndercover ? state.undercoverRule : state.goodRule
    return "鹿模式" + seat + "号玩家" + selection.nickname + (selection.version > 1 ? "重新申请选人：“" : "提交选人：“") + selection.candidate + "”"
      + (selection.version > 1 ? `（第${selection.version}次）` : '') + "。"
      + "\n该座位身份：" + role + "；对应规则：" + rule + "；本局易混：" + state.commonTerm + "。"
      + "\n请引用本消息回复“是”或“否”，也可以发送“" + seat + "是”或“" + seat + "否 原因”。"
  }
  const sendDeerSelectionRequest = async (session: Session, seat: number) => {
    const selection = modeInteraction.deerSelectionForSeat(seat)
    const request = deerHostReviewPrompt(seat)
    if (!selection || !request) return
    const version = selection.version
    const epoch = gameTimers.epoch
    modeInteraction.recordDeerRequestMessage(seat, undefined, request, version)
    let ids: string[] = []
    const results = await Promise.all(gameHostIds().map(target => messages.state('鹿模式选词审核提示', async () => {
      const result = await session.bot.sendPrivateMessage(target, request)
      ids.push(...(Array.isArray(result) ? result : [result]).filter(Boolean).map(String))
      return result
    })))
    const delivered = results.some(Boolean)
    if (delivered && !game_off && epoch === gameTimers.epoch && modeInteraction.mode === 'deer') modeInteraction.recordDeerRequestMessage(seat, ids, request, version)
    // A rejected transport receipt may still have delivered the message.
    // Keep the request recoverable without publishing applicant identities.
  }
  const applyDeerSelectionReview = async (session: Session, input: Parameters<ModeInteractionCoordinator['reviewDeerSelection']>[0]) => {
    const review = modeInteraction.reviewDeerSelection(input)
    if (review.kind === 'not-found') return '没有找到对应的待审核选人，请检查座位号或引用消息。'
    if (review.kind === 'not-pending') return '该座位当前没有待审核的选人。'
    if (review.kind === 'superseded') return '这条选人申请已被新的提交替代，请引用该玩家最新的待审核提示，或用座位号审核当前申请。'
    if (review.kind === 'processed') return '这条选人申请已处理，无需重复审核。'
    if (review.kind === 'inactive-reference') return '这条选人申请已失效，请通过“待审”获取当前待审核内容。'
    const { selection } = review
    syncDeerHostReviewClock(session, true)
    if (review.kind === 'approved') {
      capture(r => r.choice(selection.seat, selection.approvedCandidate ?? null))
      if (!ann_off) armDeerSpeechClock(session, selection.seat)
      await onDeerWordApproved(session, selection.seat, review.previousCandidate)
      notifyPrivate(session, selection.userId, '主持人已通过你的选人“' + selection.approvedCandidate + '”。' + deerReselectionHint(), '鹿模式选词通过通知')
      const speechHint = deerRevisions.makeup(selection.seat) ? '该玩家可按补发言提示补发言。'
        : !ann_off && !deerSeatHasSpoken(selection.seat) ? '该玩家现在可以发言。' : ''
      return '已通过' + selection.seat + '号玩家的选人，选人已生效。' + speechHint
    }
    if (!selection.approvedCandidate) armDeerPlayerSelectionClock(session, selection.seat)
    notifyPrivate(session, selection.userId, '主持人驳回了本次选人。' + (selection.approvedCandidate ? '原选词“' + selection.approvedCandidate + '”继续有效。' : '请重新提交。')
      + (review.reason ? '原因：' + review.reason : ''), '鹿模式选词驳回通知')
    return '已驳回' + selection.seat + '号玩家本次选人。'
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
    const shortTodo = ['待办', '待处理', '待审'].includes(input)
    if (input === "待处理操作" || shortTodo && isGameHost(session.userId)) {
      if (!isGameHost(session.userId)) return next()
      const actions = pendingAction.activeActions.filter(action => action.gameEpoch === gameTimers.epoch)
      const actionLines = actions.map(action => {
        const owner = action.ownerSeat ? `${action.ownerSeat}号玩家` : "主持人"
        return `正在等待${owner}处理“${pendingActionNames[action.kind]}”，${pendingTimeText(action)}。`
      })
      const modeStatus: string[] = []
      const modeDetails: string[] = []
      const deerRequests: Array<{ seat: number; version: number; content: string }> = []
      if (boom_pending) {
        modeStatus.push('正在等待主持人判定自爆。')
        modeDetails.push('自爆发言：' + boomAttemptText + '；请在群内回复“是”或“否”。')
      }
      if (modeInteraction.mode === 'deer') {
        const seats = modeInteraction.deerProgress().pendingHost
        if (seats.length) {
          modeStatus.push(`鹿模式待主持审核座位：${seats.join('、')}。`)
          for (const seat of seats) {
            const selection = modeInteraction.deerSelectionForSeat(seat), content = deerHostReviewPrompt(seat)
            if (selection && content) deerRequests.push({ seat, version: selection.version, content })
          }
          if (deerRequests.length === 1) modeDetails.push(deerRequests[0].content)
        }
        const reviews = deerRevisions.pendingReviews()
        if (reviews.length) {
          modeStatus.push('鹿模式待复核前序发言座位：' + reviews.map(r => r.seat).join('、') + '。')
          modeDetails.push(...reviews.map(deerSpeechReviewPrompt))
        }
      }
      if (modeInteraction.mode === 'turtle') {
        const seats = modeInteraction.turtleProgress().pendingHost
        if (seats.length) {
          modeStatus.push(`龟模式待主持回答座位：${seats.join('、')}。`)
          modeDetails.push(...seats.map(turtleHostAnswerPrompt).filter((value): value is string => !!value))
        }
      }
      if (!disp_off && currentSetupPromptStep() !== 'idle') modeDetails.push(setupStatusText() + '\n' + setupPromptText())
      for (const request of whiteGuessRequests.values()) modeDetails.push(`${request.seat}号白板猜词待判定：${request.text}；发送“白板判定${request.id}好人/卧底”。`)
      const content = [...actionLines, ...modeStatus, ...modeDetails].join('\n\n') || '当前没有等待处理的主持操作。'
      const epoch = gameTimers.epoch
      let ids: string[] = []
      let delivered = await messages.state('主持待办私聊', async () => {
        ids = await session.bot.sendPrivateMessage(session.userId, content)
        return ids
      })
      if (deerRequests.length === 1 && delivered && !game_off && epoch === gameTimers.epoch && modeInteraction.mode === 'deer') {
        const request = deerRequests[0]
        modeInteraction.recordDeerRequestMessage(request.seat, ids, content, request.version)
      } else if (deerRequests.length > 1) {
        for (const request of deerRequests) {
          if (game_off || epoch !== gameTimers.epoch || modeInteraction.mode !== 'deer') break
          const sent = await messages.state('主持待审选词补取', async () => {
            ids = await session.bot.sendPrivateMessage(session.userId, request.content)
            return ids
          })
          delivered = sent && delivered
          if (sent && !game_off && epoch === gameTimers.epoch && modeInteraction.mode === 'deer') modeInteraction.recordDeerRequestMessage(request.seat, ids, request.content, request.version)
        }
      }
      if (session.guildId) return delivered ? '已私聊发送待办详情。' : '待办详情已尝试私聊发送，未收到可私聊发送“待办”补取。'
      return
    }
    if (input !== "我的待处理" && !shortTodo) return next()
    const actions = pendingAction.activeActions.filter(item =>
      item.gameEpoch === gameTimers.epoch && item.ownerUserId === session.userId,
    )
    const index = player.indexOf(session.userId), seat = index < 0 ? 0 : order[index]
    if (!actions.length && !seat && !player_id_copy.includes(session.userId)) return next()
    const modeTasks: string[] = []
    if (modeInteraction.mode === 'deer' && seat) {
      const selection = modeInteraction.deerSelectionForSeat(seat)
      if (selection?.status === 'pending-host') modeTasks.push('你的新选词正在等待主持人审核。')
      else if (selection && !selection.approvedCandidate) modeTasks.push('待选词：发送“选词＋内容”或“选人＋内容”。')
      if (deerRevisions.review(seat)) modeTasks.push('前序发言正在等待主持人复核。')
      if (deerRevisions.makeup(seat)) modeTasks.push(`待补发言：发送“${seat}＋发言内容”。`)
    }
    if (unfinishedVoteFor(session.userId)) modeTasks.push('待投票：请按当前投票提示完成投票。')
    if (seat && modeInteraction.mode === 'turtle') {
      const turn = modeInteraction.turtleTurnForSeat(seat)
      if (turn?.status === 'pending-host') modeTasks.push('你的问题正在等待主持人回答。')
      else if (turn?.status === 'waiting-question' && !ann_off) modeTasks.push(`待提问：在群内发送“${seat}＋问题”。`)
    } else if (seat && !ann_off && (!add_flag || add_indices.includes(index))
      && isEmpty(add_flag ? add_ann[add_indices.indexOf(index)] : ann[index])) {
      modeTasks.push(`待发言：在群内发送“${seat}＋发言内容”。`)
    }
    const content = [skillFirstNotice(session.userId), ...actions.map(recoveredActionText), ...modeTasks].filter(Boolean).join('\n\n') || '你当前没有等待处理的游戏操作。'
    if (!session.guildId) return content
    const results = [await messages.state('待办补取提示', () => session.bot.sendPrivateMessage(session.userId, content))]
    return results.every(Boolean) ? "已私聊发送待办详情。" : "待办详情已尝试私聊发送，未收到可私聊发送“待办”补取。"
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {
    if (game_off || !matchesActiveSession(session)) return next()
    const skills = pendingSkillsFor(session.userId)
    if (!skills.length) return next()
    const input = normalizeHeroCommand(session.content)
    const heir = skills.find(action => action.kind === 'zhu-you-xiao-heir-target' || action.kind === 'zhu-you-xiao-heir-choice')
    const resolutionChoice = skills.some(action => action.kind === 'huang-tai-ji-quan' || action.kind === 'mao-wen-long-late-vote' || action.kind === 'shi-ke-fa-gift')
    const numericChoice = /^(?:[0-9]+|弃|弃权)$/u.test(input)
    const explicitHeir = /^(?:传弟|传|弃传弟)/u.test(input)
    if (heir && (explicitHeir || numericChoice && !resolutionChoice)) {
      return heir.kind === 'zhu-you-xiao-heir-target'
        ? handleZhuYouXiaoHeirTarget(session, next)
        : handleZhuYouXiaoHeirChoice(session, next)
    }
    if ((numericChoice && !resolutionChoice) || /^(?:伐[0-9]*|代(?:投|伐)?(?:[0-9]+|弃|弃权))$/u.test(input)) {
      return skillFirstNotice(session.userId)
    }
    return next()
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
    const rawCommand = session.content.replace(/\s/g, "")
    const command = ({ '题面': '我的题面', '武将': '我的武将', '重发信息': '重发我的信息' } as Record<string, string>)[rawCommand] ?? rawCommand
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
      return "发送结果未能确认；如果尚未收到，可稍后补取。"
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
    if (terminalSettlement && startRequested) {
      if (!gameRoute.matchesBot(session.platform, session.selfId)) return next()
      return '本局已确定胜负，正在结算；请结算后再开局。'
    }
    if (!game_off) {
      if (!startRequested) return next()
      // A plugin instance may receive events from several bot connections.
      // Once a game is bound, a start command from another platform/selfId is
      // not this game's command and must be left for that connection's route.
      const sameBot = gameRoute.matchesBot(session.platform, session.selfId)
      const sameRoute = gameRoute.matchesSession(session.platform, session.guildId, session.selfId)
      if (!sameBot) return next()
      if (sameRoute) {
        return isGameHost(session.userId)
          ? "当前已有一局卧底正在进行中。如需重开，请先发送“停止卧底”。"
          : "当前已有一局卧底正在进行中，请继续当前游戏。"
      }
      else {
        return "当前机器人已在其他群进行一局卧底，暂时无法再次开局。"
      }
    }
    if (startRequested) {
      const isSandbox = session.platform.startsWith("sandbox:")
      score_enabled = (config.enablePersistentScoring ?? true) && !isSandbox
      gameRoute.bind(session.platform, session.guildId, session.bot)
      publicTimeline.clear()
      const startingEpoch = gameTimers.advanceEpoch()
      preDealRevision += 1
      modeInteraction.reset("classic")
      hostSupport.reset(); hostParticipantKeys.clear(); assistantIdentityKeys.clear(); gameTimers.cancel(hostRecruitmentTimer)
      heroesEnabled = config.heroesByDefault ?? true
      speechHistory.clear()
      publicHeroReveals.clear()
      cancelDeerTimers()
      cancelTurtleTimers()
      game_off = false
      wait_off = false
      lobbyPreparing = true
      // The store fences expired media synchronously. Neither the old
      // archive/retry nor the cleanup must hold the new lobby indefinitely.
      const mediaCleanup = mediaRetention.mode === 'permanent' ? undefined
        : historyStore.pruneMediaForBot(session.platform, session.selfId)
          .catch(error => ctx.logger.warn('历史多媒体清理未完成：%s', safeErrorSummary(error)))
      void historyPersistence.retry().catch(error => ctx.logger.warn('历史待重试存档未完成：%s', safeErrorSummary(error)))
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
      flag_skill_notify = config.realtimeSkillNoticeDefault ?? false
      whiteGuessNotifications = notifications.whiteGuessHost
      whiteGuessRequests.clear()
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
        const name = await withinBudget(ensurePlayerNickname(session), 4000)
        if (game_off || startingEpoch !== gameTimers.epoch) return
        hostname = name
        if (!await withinBudget(occupyPlayer(session.userId, hostname, session.platform), 4000)) return
      } catch (error) {
        if (game_off || startingEpoch !== gameTimers.epoch) return
        end_game({ kind: 'aborted', reason: 'system-error' })
        ctx.logger.warn('主持人账号初始化失败：%s', safeErrorSummary(error))
        return '账号服务暂不可用，本局未开始，请稍后重试。'
      }
      if (mediaCleanup) await withinBudget(mediaCleanup, 1000).catch(() => undefined)
      if (game_off || startingEpoch !== gameTimers.epoch) return
      annstr = "本轮发言结果：\n"
      vstr = "本轮投票结果：\n"
      scoreService.reset()
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
      lobbyPreparing = false
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
    if (game_off || lobbyPreparing || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return false
    if (wait_off && !flag_start) return false
    const content = session.content.replace(/\s/g, "")
    const selectedMode = parseGameModeSelection(session.content)
    const shortcutMode = parseModeStart(session.content)
    if (isGameHost(session.userId) && !flag_fati && selectedMode) return true
    if (isGameHost(session.userId) && (content === "普通局" || content === "武将局" || (flag_start && content === "自定义"))) return true
    if (!wait_off && !flag_start && content === "１") return true
    if (isGameHost(session.userId) && flag_start && (
      content === "停止加人" || content === "关闭加人" || content === "结束加人"
      || content === "终止加人" || content === "不加人了" || content === "不加了"
      || content === "开启加人" || content === "开始加人" || content === "继续加人"
    )) return true
    if (content === "1" && !flag_start) return true
    if (content === "1" && flag_start && !isGameHost(session.userId) && player.indexOf(session.userId) === -1) return true
    // Route host start requests through the roster queue even when the
    // minimum count is not true yet.  The queued task evaluates the latest
    // player list after earlier concurrent `1` messages have been processed;
    // deciding here would let a start sent in the same burst fall through to
    // ChatLuna/Character before those joins become visible.
    if (isGameHost(session.userId) && !flag_start
      && (content === "开始" || shortcutMode !== null)) return true
    return isGameHost(session.userId) && flag_start && content.indexOf("踢出") === 0
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
    if (isGameHost(session.userId) && !flag_fati && selectedMode) {
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
    if (isGameHost(session.userId) && !flag_start && shortcutMode && shortcutMode !== 'classic' && !enabledSpecialModes.has(shortcutMode)) {
      return "本实例未启用" + (shortcutMode === 'deer' ? '鹿模式' : '龟模式') + "。"
    }
    if (isGameHost(session.userId) && !flag_start && shortcutMode) modeInteraction.reset(shortcutMode)
    const startRequestedDuringGather = session.content.replace(/\s/g, "") === "开始" || shortcutMode !== null
    let str_nos = session.content.replace(/\s/g, "")
    if (!wait_off && !flag_start && str_nos === "１") {
      return "全角“１”不会加入游戏；如要参与请发送半角数字 1。"
    }
    if (isGameHost(session.userId) && !flag_start && (str_nos === "普通局" || str_nos === "武将局")) {
      heroesEnabled = str_nos === "武将局"
      return heroesEnabled ? "已设定本局为武将局。" : "已设定本局为无武将普通局。"
    }
    if (isGameHost(session.userId) && flag_start && add_player && (str_nos === "停止加人" || str_nos === "关闭加人" || str_nos === "结束加人" || str_nos === "终止加人" || str_nos === "不加人了" || str_nos === "不加了")) {
      add_player = false
      return ("已关闭加人模式，发送“开启加人”以继续加人。")
    }
    else if (isGameHost(session.userId) && flag_start && (!add_player) && (str_nos === "开启加人" || str_nos === "开始加人" || str_nos === "继续加人")) {
      add_player = true
      return ("已开启加人模式，群友可继续扣1。")
    }
    if (str_nos === "1" && !flag_start) {
      if (player.indexOf(session.userId) == -1 && !isGameHost(session.userId)) {
        const prepared = await prepareGatheringPlayer(session, inputEpoch)
        if (!prepared) return
        if ('error' in prepared) return prepared.error
        const joiningName = prepared.nickname
        player.push(session.userId)
        hostSupport.recordParticipant(session.userId); hostParticipantKeys.add(personKey(joiningName))
        player_id_copy.push(session.userId)
        player_name.push(joiningName)
        player_copy.push(joiningName)
      }
    }
    else {
      if ((startRequestedDuringGather && player.length >= config.minPlayers && isGameHost(session.userId) && !flag_start) || (str_nos === "1" && player.indexOf(session.userId) === -1 && !isGameHost(session.userId)) || (isGameHost(session.userId) && str_nos.indexOf("踢出") === 0 && flag_start)) {
        if (str_nos === "1") {
          if (!add_player) return ("主持人已经关闭了加人，你无法再加入。")
          if (flag_fati) return ("你来晚了，我已经在发题了")
          const prepared = await prepareGatheringPlayer(session, inputEpoch)
          if (!prepared) return
          if ('error' in prepared) return prepared.error
          const joiningName = prepared.nickname
          player.push(session.userId)
          hostSupport.recordParticipant(session.userId); hostParticipantKeys.add(personKey(joiningName))
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
      else if (isGameHost(session.userId) && (str_nos === "普通局" || str_nos === "武将局")) {
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
    if (!flag_ask_white || !isGameHost(session.userId) || str_askwh === "停止卧底" || str_askwh === "中止卧底" || str_askwh === "终止卧底" || str_askwh === "结束卧底" || str_askwh === "关闭卧底") return next()
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
    if (isGameHost(session.userId)) {
      const trimmed = session.content.trim()
      const speechReview = trimmed.match(/^复核\s*([1-9]\d*)\s*(是|否)$/u)
      if (speechReview) return await finishDeerSpeechReview(session, Number(speechReview[1]), speechReview[2] === '是')
        ? '已记录前序发言复核结果。' : '该座位没有待复核的前序发言。'
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
      return applyDeerSelectionReview(session, {
        seat: seatMatch ? Number(seatMatch[1]) : undefined,
        requestMessageId: quoteReference?.messageId,
        requestMessageContent: quoteReference?.content,
        approved,
        reason,
      })
    }
    const selection = [...state.selections.values()].find(value => value.userId === session.userId)
    if (!selection || !player.includes(session.userId)) return next()
    if ((selection.approvedCandidate || selection.explicitSubmissionRequired) && !/^(?:选词|选人)/u.test(session.content.trim())) return next()
    if (selection.approvedCandidate && !deerChangesOpen()) return '本局已超过选词重选截止节点。'
    const hadPendingReview = modeInteraction.deerProgress().pendingHost.length > 0
    const submitted = modeInteraction.submitDeerSelection(session.userId, session.content, Date.now())
    if (submitted.kind === "empty") return ("选人不能为空，请重新发送。")
    if (submitted.kind === "common-term") return ("不能选择易混本身，请重新选择符合阵营规则的词条。")
    if (submitted.kind !== "accepted") return next()
    cancelDeerSelectionClock(submitted.selection.seat)
    syncDeerHostReviewClock(session, !hadPendingReview)
    await sendDeerSelectionRequest(session, submitted.selection.seat)
    return ("已提交“" + submitted.selection.candidate + "”，请等待主持人审核。")
  })
  ctx.guild().middleware(async (session, next) => {//鹿模式重置选人
    if (game_off || modeInteraction.mode !== "deer" || !isGameHost(session.userId) || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const match = session.content.replace(/\s/g, "").match(/^重置选人(\d+)$/)
    if (!match) return next()
    const seat = Number(match[1])
    if (!deerChangesOpen()) return '本局已超过选词重选截止节点。'
    const selection = modeInteraction.resetDeerSelection(seat)
    if (!selection) {
      if (!deerProgressPrivate()) return '该座位当前没有可重置的选词。'
      notifyPrivate(session, session.userId, '该座位当前没有可重置的选词。', '鹿模式重置结果')
      return '已私聊发送操作结果。'
    }
    const records = speechHistory.bySeat(seat).filter(record => !record.invalidReason && record.identityKey === currentModeRoster().find(member => member.seat === seat)?.identityKey)
    clearDeerRevisionSeat(seat)
    if (records.length) { invalidateDeerSpeeches(records); deerResetNeedsMakeup.add(seat) }
    capture(r => r.choice(seat, null))
    syncDeerHostReviewClock(session, false)
    cancelDeerSpeechClock(selection.seat)
    armDeerPlayerSelectionClock(session, selection.seat)
    await sendPrivateNotice(session, selection.userId, "主持人要求你重新选人，请按原阵营规则重新提交。", `鹿模式${selection.seat}号重选通知`)
    const result = '已重置' + selection.seat + '号玩家的选人，请发送“选词＋内容”重新提交。'
    if (!deerProgressPrivate()) return result
    notifyPrivate(session, session.userId, result, '鹿模式重置结果')
    return '已私聊发送操作结果。'
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
    if (deerProgressPrivate()) {
      remindDeerPrivately(session)
      return '已私聊提醒相关玩家和主持人。'
    }
    return deerProgressText()
  })
  ctx.exclude(ctx.guild()).middleware((session, next) => {//主持人发题状态与回退
    if (game_off || !isGameHost(session.userId) || !matchesActiveSession(session)) return next()
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
    if (game_off || !isGameHost(session.userId) || !matchesActiveSession(session)) return next()
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
        instr3 = session.content.trim()
        if (isEmpty(instr3)) return ("易混不能为空，请重新输入。")
        ask_nice = false
        ask_nice_instr = true
        return ("请输入鹿模式好人阵营的选人/选词规则：")
      }
      if (ask_nice_instr) {
        item1 = session.content.trim()
        if (isEmpty(item1)) return ("好人规则不能为空，请重新输入。")
        ask_nice_instr = false
        ask_uc = true
        return ("请输入鹿模式卧底阵营的选人/选词规则：")
      }
      if (ask_uc) {
        item2 = session.content.trim()
        if (isEmpty(item2)) return ("卧底规则不能为空，请重新输入。")
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
    if (game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId) || !isGameHost(session.userId) || !flag_start) return next()
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
    if (!set_mode || !isGameHost(session.userId) || !matchesActiveSession(session)) return next()
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
    owner?: TerminalSettlement,
  )=>{
    if (terminalSettlement !== owner) return
    weiInquiryWindow = null
    if (ending.kind === 'aborted' && (voteFactStage === 'open' || voteFactStage === 'counting')) {
      if (voteFactStage === 'open') rebuildPollFromBallots()
      const facts = voteFactStage === 'counting' ? frozenVoteFacts : captureCurrentVoteFacts(false)
      capture(r => r.vote(facts, order.map((seat, i) => ({ seat, count: poll[i] })), false,
        [...anonymousVoteContributions].map(([seat, count]) => ({ seat, count }))))
    }
    if (historyRecorder) {
      const recorder = historyRecorder
      historyRecorder = undefined
      const bot = gameRoute.bot, guild = gameRoute.guildId
      try {
        if (historyCaptureFailed) throw new Error('本局采集不完整')
        if (ending.kind === 'aborted' && historyOutcome && recorder.hasPhase()) recorder.outcome(historyOutcome)
        const snapshot = recorder.finish(ending, owner?.endedAt ?? Date.now(), scoreService.results, config.scoreSystemKey)
        const key = archiveRouteKey(snapshot.platform, snapshot.selfId, snapshot.guildId)
        const hint: ArchiveHint | undefined = archiveDisposition(snapshot, historyOptions) === 'completed'
          ? { gameId: snapshot.gameId, status: '正在归档' } : undefined
        if (hint) {
          recentArchiveHints.delete(key)
          recentArchiveHints.set(key, hint)
          if (recentArchiveHints.size > 32) recentArchiveHints.delete(recentArchiveHints.keys().next().value!)
        }
        const write = historyPersistence.save(snapshot, historyOptions).then(result => {
          if (hint && recentArchiveHints.get(key) === hint) {
            if (result.kind === 'queued') hint.status = '归档待重试'
            else if (result.kind === 'failed') hint.status = '归档未确认'
            else recentArchiveHints.delete(key)
          }
          if (bot && guild && (result.kind === 'failed' || result.kind === 'queued')) {
            // Old archive receipts can arrive after another game in this
            // group has started. Deliver to the captured route, not its live timeline.
            const text = result.kind === 'queued' ? '已结束对局的历史暂未写入数据库，已保存本地待重试。'
              : '已结束对局的历史保存失败，请管理员检查日志。'
            messages.bestEffort('对局历史保存状态通知', () => bot.sendMessage(guild, text))
          }
        }).finally(() => pendingHistoryWrites.delete(write))
        pendingHistoryWrites.add(write)
      } catch (error) {
        ctx.logger.error('对局历史快照失败：%s', safeErrorSummary(error))
        notifyBotGroup(bot, guild, '本局历史采集不完整，未报告保存成功；请管理员检查日志。', '对局历史采集失败通知')
      }
    }
    stalemate.reset()
    rememberDeerReveal()
    hostSupport.reset(); hostParticipantKeys.clear(); assistantIdentityKeys.clear(); gameTimers.cancel(hostRecruitmentTimer)
    historyDepartureReasons.clear()
    cancelDeerTimers()
    cancelTurtleTimers()
    speechPhases.invalidate()
    speechBackfillSeats.clear()
    speechBackfillUsers.clear()
    pendingAction.clear()
    zhangSelection = undefined
    zhangPastVoterNames.clear()
    whiteGuessRequests.clear()
    recoverablePendingPrompts.clear()
    clearZhuYouXiaoPhase(zhuYouXiaoVotes)
    zhuYouXiaoVotes.records = []
    zhuYouXiaoHeirTargetSeat = null
    zhuYouXiaoHeirOwnerSeat = null
    voteSettlement.clear()
    clearVoteOpportunity()
    gameTimers.advanceEpoch()
    voteFactStage = 'none'
    frozenVoteFacts = []
    anonymousVoteContributions.clear()
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
    terminalSettlement = undefined
    lobbyPreparing = false
    scoreAwards.length = 0
    scoreService.reset()
    whiteSurvivalSettlementPending = false
    profileIdByNickname.clear()
    identityByUserId.clear()
    accountIdByNickname.clear()
    releaseAccountLeases()
    gameInstanceId = ''
    gameRoute.clear()
    publicTimeline.clear()
  }
  ctx.on("dispose", async () => {
    if (terminalSettlement) terminalSettlement.finish()
    else if (!game_off) end_game({ kind: 'aborted', reason: 'restart' })
    await withinBudget(Promise.allSettled([...pendingHistoryWrites]), 2000).catch(() => undefined)
  })
  const canSettleWhiteSurvival = (settled: boolean): boolean => settled
    && !(white === heros[HERO.YUAN_CHONG_HUAN]
      && yuanChongHuanModule.retaliationTarget(heroState) !== null)
  const resolveEliminationVictory = async (
    session: Session,
    whiteSurvivalSettled = false,
    beforeGameEnd?: () => void,
  ): Promise<ResolutionControl> => {
    if (game_off) return endResolution()
    const victory = classifyEliminationVictory({
      activePlayerCount: player.length,
      activeUndercoverCount: uc.length,
      whiteActive: flag_white,
      whiteOnly: white_only,
      whiteSurvivalSettled: canSettleWhiteSurvival(whiteSurvivalSettled),
    })
    if (victory !== null) beforeGameEnd?.()
    if (victory === "good") {
      sumup += "游戏结束，好人胜利。"
      if (round > uc_copy.length + (white_copy === 0 ? 0 : 1) || player_copy.length - player.length - kickout.length > uc_copy.length + (white_copy === 0 ? 0 : 1)) { increment = config.scoreGoodWin }
      else { increment = config.scoreGoodWinSpeedrun }
      for (let i = 0; i < player_copy.length; i++) {
        if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
          queueScoreAward(player_copy[i], increment, 'elimination-good-win')
          ptsstr += player_copy[i] + "，"
        }
      }
      ptsstr = ptsstr.slice(0, -1)
      ptsstr += "加" + increment + "分。"
      await completeGame(session, { kind: 'completed', reason: 'elimination', winner: 'good' },
        { before: { text: '游戏结束，好人胜利。', label: '好人胜利通知' } })
      return endResolution()
    }
    else if (victory === "white") {
      const winningWhiteSeat = white
      sumup += "游戏结束，白板胜利。"
      increment = config.scoreWhiteWin
      queueScoreAward(player_copy[winningWhiteSeat - 1], increment, 'elimination-white-win')
      ptsstr += player_copy[winningWhiteSeat - 1] + "加" + increment + "分。"
      await completeGame(session, { kind: 'completed', reason: 'white-survival', winner: 'white' },
        { before: { text: '游戏结束，白板胜利。', label: '白板胜利通知' } })
      return endResolution()
    }
    else if (victory === "undercover") {
      sumup += "游戏结束，卧底胜利。"
      increment = config.scoreUndercoverWin
      for (let i = 0; i < player_copy.length; i++) {
        if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
          queueScoreAward(player_copy[i], increment, 'elimination-undercover-win')
          ptsstr += player_copy[i] + "，"
        }
      }
      ptsstr = ptsstr.slice(0, -1)
      ptsstr += "加" + increment + "分。"
      await completeGame(session, { kind: 'completed', reason: 'elimination', winner: 'undercover' },
        { before: { text: '游戏结束，卧底胜利。', label: '卧底胜利通知' } })
      return endResolution()
    }
    return continueResolution()
  }
  const check_game_end = async (session, outplayer, extra, whiteSurvivalSettled = false, cause: 'skill' | 'kick' = 'skill') => {
    const control = await resolveEliminationVictory(session, whiteSurvivalSettled)
    if (control.kind === "game-end") return
    if (cause === 'skill' && typeof outplayer === 'number'
      && postEliminationHero(outplayer, heros, 'skill') === 'zhu-you-xiao') {
      beginZhuYouXiaoHeirTarget(session, outplayer)
    }
    await extra(session, outplayer)
  }
  const splice_player = (outplayer, is_kickout, is_check_white) => {
    const delegation = zhuYouXiaoVotes.current
    if (delegation && (delegation.delegateSeat === outplayer || delegation.ownerSeat === outplayer)) {
      const owner = zhuYouXiaoCurrentOwner()
      const delegatedSeat = delegation.delegateSeat
      // Once final-vote resolution is running, the raw ballot and its
      // historical delegate have already been accepted.  Removing the
      // delegate as the resolution's elimination target must not replay the
      // pre-resolution invalidation path; the successful relationship still
      // belongs to 传弟's later reveal.  Before settlement starts, a leaving
      // delegate still invalidates the pending proxy exactly as before.
      const settledDelegateLeavesDuringResolution = (voteSettlement.isRunning(currentVoteSettlementKey()) || !!zhangSelection?.beforeDeparture && voteFactStage === 'published')
        && delegatedSeat === outplayer
        && delegation.successfulDelegateSeat !== null
      const ownerLeavesAfterSuccessfulVote = !is_kickout
        && delegation.ownerSeat === outplayer
        && delegation.successfulDelegateSeat !== null
      if (owner !== null && !ownerLeavesAfterSuccessfulVote && !settledDelegateLeavesDuringResolution) {
        clearZhuYouXiaoBallot(owner, add_flag, true, false)
      }
      if (ownerLeavesAfterSuccessfulVote || settledDelegateLeavesDuringResolution) {
        // The final ballot has already been recorded.  Keep its historical
        // delegate for 传弟, but detach the live relation before the seat is
        // removed from the roster.
        detachZhuYouXiaoCurrent(zhuYouXiaoVotes, true)
      }
      else setZhuYouXiaoDelegate(zhuYouXiaoVotes, null)
      if (!vote_off && !voteSettlement.isRunning(currentVoteSettlementKey())) rebuildPollFromBallots()
      pendingAction.clear("zhu-you-xiao-proxy-vote")
      recoverablePendingPrompts.delete("zhu-you-xiao-proxy-vote")
      // Keep the hidden relation private.  An active owner is told only when
      // the delegate leaves; if the owner itself leaves there is no recipient.
      if (delegatedSeat === outplayer && owner !== null) {
        const ownerIndex = order.indexOf(owner)
        if (ownerIndex !== -1) notifyBotPrivate(gameRoute.bot, player[ownerIndex], "放权对象已离场，本次代投已失效；请重新投票或重新发送“放权+序号”。", "朱由校放权对象离场通知")
      }
    }
    if (zhuYouXiaoHeirTargetSeat === outplayer) {
      pendingAction.clear("zhu-you-xiao-heir-choice")
      recoverablePendingPrompts.delete("zhu-you-xiao-heir-choice")
      gameTimers.cancel(timer_zhu_you_xiao_heir)
      zhuYouXiaoHeirTargetSeat = null
      const ownerSeat = zhuYouXiaoHeirOwnerSeat
      zhuYouXiaoHeirOwnerSeat = null
      if (ownerSeat !== null && player_id_copy[ownerSeat - 1]) {
        notifyBotPrivate(gameRoute.bot, player_id_copy[ownerSeat - 1], "传弟对象已离场，本次传弟选择失效。", "朱由校传弟对象离场通知")
      }
    }
    weiZhongXianModule.recordDeparture(heroState, outplayer)
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
    const departedSelection = modeInteraction.mode === 'deer' ? modeInteraction.deerSelectionForSeat(outplayer) : undefined
    if (departedSelection) deerRevisions.suspend(outplayer, departedSelection.identityKey ?? departedSelection.userId, Date.now())
    clearDeerRevisionSeat(outplayer)
    for (const [id, request] of whiteGuessRequests) if (request.seat === outplayer) whiteGuessRequests.delete(id)
    deerResetNeedsMakeup.delete(outplayer)
    if (modeInteraction.mode === "turtle" && !ann_off) {
      modeInteraction.removeTurtleSeat(outplayer)
      cancelTurtleSeatTimers(outplayer)
    }
    if (is_kickout) {
      if (!isEmpty(result.departingName)) formerSeatByName.set(personKey(result.departingName), outplayer)
      if (result.departingName && heroState.zhangXianZhong.voterSeats.has(outplayer)) {
        zhangPastVoterNames.set(outplayer, result.departingName)
      }
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
    notifyGroup(session, yuanEliminationText, '袁崇焕反噬通知')
    return true
  }
  const player_out_long = async (session, outplayer, extra, is_kickout, is_check_white, orderedNotice?: { text: string; label: string }) => {
    splice_player(outplayer, is_kickout, is_check_white)
    boom_pending = false
    if (orderedNotice) notifyGroup(session, orderedNotice.text, orderedNotice.label)
    await check_game_end(session, outplayer, extra, whiteSurvivalSettlementPending, is_kickout ? 'kick' : 'skill')
  }
  const players_out = async (session, outplayers, extra, is_kickout, is_check_white) => {
    for (let i=0; i<outplayers.length; i++) {
      splice_player(outplayers[i], is_kickout, is_check_white)
    }
    boom_pending = false
    await check_game_end(session, outplayers, extra, false, is_kickout ? 'kick' : 'skill')
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
    settleWeiZhongXianCandidates(session)
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
      recordSkill(HERO.HUANG_TAI_JI, '获得1个“权”标记', [], undefined, { timing: 'round-start' })
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
      recordSkill(HERO.WU_SAN_GUI, '觉醒，获得' + wuSanGuiRound.faReward + '个“伐”标记', [], undefined, { timing: 'round-start' })
    }
    else if (wuSanGuiRound.restrictionAdded === 0) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后不能再于加时阶段自救了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡1效果：参与加时时不能发动“权计”。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：参与加时时不能发动“权计”', [], undefined, { timing: 'round-start' })
      }
    else if(wuSanGuiRound.restrictionAdded === 1) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后发动权计的下一轮不能投票了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡2效果：发动“权计”的下一轮不能投票。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：发动“权计”的下一轮不能投票', [], undefined, { timing: 'round-start' })
      }
    else if (wuSanGuiRound.restrictionAdded === 2) {
        notifyPrivate(session, player[order.indexOf(wuSanGuiSeat)], "元帅，您之后不能连续两轮发动权计了。", "吴三桂限制通知")
        sumup += wuSanGuiSeat + "号玩家" + player_name[order.indexOf(wuSanGuiSeat)] + "（吴三桂）获得援寡3效果：若前一轮发动了“权计”，则本轮无法发动。\n"
        recordSkill(HERO.WU_SAN_GUI, '获得“援寡”效果：若前一轮发动了“权计”，则本轮无法发动', [], undefined, { timing: 'round-start' })
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
      const dorgonIdentity = publicHeroIdentity(heros[HERO.DUO_ER_GUN], false, '', 'round-start')
      sumup += dorgonIdentity + "，入关，获得“摄政”。\n"
      recordSkill(HERO.DUO_ER_GUN, '入关，获得“摄政”', [], undefined, { timing: 'round-start' })
      notifyGroup(session, dorgonIdentity + "，入关，获得技能“摄政”。", "多尔衮入关通知")
      const d = dorgonRoundStart.strategySeat ?? 0
      notifyPrivate(session, player[dorgonIndex], "恭喜王爷获得摄政大权，您可向我发送“保A弃B”或“弃B保A”以发动技能（效果：下次A要被投出去时，AB得票数互换）\n注意A、B其一必须要在轮次开始时有“定策”标记；目前" + (order.indexOf(d)!==-1 ? (d + "号玩家" + player_name[order.indexOf(d)] + "拥有“定策”标记。") : "场上没有“定策”标记，您需要先拥立一人。"), "多尔衮摄政私聊通知")
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
  const linDanHanVoteAwakeningInput = (max: number) => {
    const linIndex = order.indexOf(heros[HERO.LIN_DAN_HAN])
    return {
      heroActive: linIndex !== -1,
      heroPoll: linIndex === -1 ? 0 : poll[linIndex],
      preventedVotePower: heroState.linDanHan.preventedVotePower,
      maximumPoll: max,
      unvote,
      shielded: shield[heros[HERO.LIN_DAN_HAN] - 1],
    }
  }
  // No await between locking the final guard and committing vote awakening.
  // Vote effects have already recorded eligible attacks; do not rebuild the
  // poll here, since Mao/Quan/Regency may have changed it in the meantime.
  const lockGuardAndAwakenLinDanHan = (session: Session, max: number) => {
    const yuanSeat = heros[HERO.YUAN_CHONG_HUAN]
    if (!add_flag && order.includes(yuanSeat)) {
      const locked = yuanChongHuanModule.lockVoteWindow(heroState, votePhaseSerial, yuanSeat)
      if (locked?.seat !== null && locked?.seat !== undefined) {
        shield[locked.seat - 1] = locked.effective
        if (locked.seat === yuanSeat) recordSkill(HERO.YUAN_CHONG_HUAN, '发动“专镇”，守卫自己', [yuanSeat])
      }
    }
    if (linDanHanModule.finalizeVoteAwakening(heroState, votePhaseSerial, linDanHanVoteAwakeningInput(max))) {
      linDanHanModule.awaken(heroState)
      notifyPrivate(session, player[order.indexOf(heros[HERO.LIN_DAN_HAN])], "可汗，由于您防下了一次致命伤害，您从现在获得“西迁”。", "林丹汗觉醒通知")
      sumup += heros[HERO.LIN_DAN_HAN] + "号玩家" + player_copy[heros[HERO.LIN_DAN_HAN] - 1] + "（林丹汗）觉醒，获得“西迁”。\n"
      recordSkill(HERO.LIN_DAN_HAN, '觉醒，获得“西迁”')
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
    recheckDuoErGunAfterHuangTaiJi?: boolean
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
  const runVoteResolutionTail = async (
    input: Omit<VoteResolutionTailContext, "vote">,
    order: readonly ResolutionCursor[] = VOTE_RESOLUTION_TAIL,
  ) => {
    const context: VoteResolutionTailContext = { ...input, vote: liveVoteContext(input) }
    const serial = votePhaseSerial
    const isCurrentVote = () => !game_off && context.vote.gameEpoch === gameTimers.epoch && serial === votePhaseSerial
    return runResolutionPipeline({
      context,
      order,
      trace: traceResolution("vote-tail"),
      handlers: {
        [ResolutionCursor.DuoErGunSwap]: (current) => {
          if (!isCurrentVote()) return endResolution()
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
        [ResolutionCursor.LinDanHanVoteQualification]: (current) => {
          if (!isCurrentVote()) return endResolution()
          linDanHanModule.recordVoteAwakening(heroState, votePhaseSerial, linDanHanVoteAwakeningInput(current.max))
          return continueResolution()
        },
        [ResolutionCursor.LinDanHanAwaken]: (current) => {
          if (!isCurrentVote()) return endResolution()
          lockGuardAndAwakenLinDanHan(current.session, current.max)
          return continueResolution()
        },
        [ResolutionCursor.HuangTaiJiQuan]: (current) => {
          if (!isCurrentVote()) return endResolution()
          if (!current.skipHuangTaiJiPrompt
            && resolveHuangTaiJi(current.session, current.max, current.max2, current.quanStr)) {
            return pauseResolution(ResolutionCursor.LinDanHanAwaken)
          }
          return continueResolution()
        },
        [ResolutionCursor.DuoErGunSwapAfterHuangTaiJi]: (current) => {
          if (!isCurrentVote()) return endResolution()
          if (current.recheckDuoErGunAfterHuangTaiJi) {
            current.quanStr = tryDuoergunSwap(
              current.session,
              current.idx,
              current.max,
              current.quanStr,
            )
          }
          return continueResolution()
        },
        [ResolutionCursor.FinalizeVote]: async (current) => {
          if (!isCurrentVote()) return endResolution()
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
    recheckDuoErGunAfterHuangTaiJi = false,
  ) => {
    const huangSeat = heros[HERO.HUANG_TAI_JI]
    huangTaiJiQuanMode = null
    gameTimers.cancel(timer_htj)
    if (completion === "timeout") pendingAction.clear("huang-tai-ji-quan")
    else pendingAction.complete("huang-tai-ji-quan")
    if (completion === 'timeout') recordSkill(HERO.HUANG_TAI_JI, '因减票选择超时，本次不减票')

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
      recheckDuoErGunAfterHuangTaiJi,
    }, VOTE_RESOLUTION_TAIL_AFTER_HUANG_TAI_JI)
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
      anonymousVoteContributions.set(targetSeat, (anonymousVoteContributions.get(targetSeat) ?? 0) + vote_num[maoSeat - 1])
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
  var timer_zhu_you_xiao_heir
  const nativeLimitedSkillName = (heroId: number): string => heroId === HERO.WEI_ZHONG_XIAN
    ? "诬诽" : heroId === HERO.YUAN_CHONG_HUAN ? "专镇" : "处决"
  const zhuYouXiaoResetDescription = (heroId: number): string => {
    switch (heroId) {
      case HERO.ZHANG_XIAN_ZHONG: return "殒阵恢复为1级；本局已结算的投票记录保留。"
      case HERO.LI_ZI_CHENG: return "清除本轮流兵待结算状态。"
      case HERO.ZHU_YOU_JIAN: return "处决恢复为未使用；已有额外处决次数保留。"
      case HERO.WU_SAN_GUI: return "权计次数、援寡限制和自立状态恢复初始；若正在等待权计选择，当前选择继续有效。"
      case HERO.HUANG_TAI_JI: return "清除集权当前记录的投票对象。"
      case HERO.YUAN_CHONG_HUAN: return "清除守卫、反噬和上一轮守卫记录，恢复专镇为未使用；已有额外专镇次数保留。"
      case HERO.LIN_DAN_HAN: return "恢复未觉醒状态，并按当前在场玩家重建避实记录。"
      case HERO.SHI_KE_FA: return "恢复抵诽，清除抵诽发动记录；已经赠出的伐不返还。"
      case HERO.WEI_ZHONG_XIAN: return "恢复诬诽为未使用，清除攻击、被攻击、历史伐异和缉访记录；已经获得的伐保留。"
      case HERO.MAO_WEN_LONG: return "清除塘报待处理状态。"
      case HERO.DUO_ER_GUN: return "清除定策发动次数和摄政状态；已有定策标记保留。"
      default: return "恢复该武将的原生技能状态。"
    }
  }
  const revealZhuYouXiaoDelegates = (session: Session) => {
    const lines: string[] = []
    for (const seat of zhuYouXiaoSuccessfulDelegates(zhuYouXiaoVotes)) {
      const heroIndex = heros.indexOf(seat)
      if (heroIndex === -1 || isEmpty(player_copy[seat - 1])) continue
      const activeIndex = order.indexOf(seat)
      const currentName = activeIndex === -1 ? player_copy[seat - 1] : player_name[activeIndex]
      if (publicHeroReveals.isRevealed(seat)) {
        lines.push(seat + "号玩家" + currentName + "（" + hero_name[heroIndex] + "）")
      }
      else {
        const first = publicHeroReveals.reveal(seat)
        if (first) capture(r => r.event(seat, { kind: 'hero-reveal', heroId: heroIndex }))
        lines.push(seat + "号玩家" + currentName + "亮出武将牌：" + hero_name[heroIndex])
      }
    }
    if (!lines.length) return
    const text = "朱由校的所有放权对象亮出武将牌：\n" + lines.join("\n")
    sumup += text + "\n"
    notifyGroup(session, text, "朱由校放权对象亮将通知")
  }
  const beginZhuYouXiaoHeirTarget = (session: Session, outplayer: number) => {
    const ownerUserId = player_id_copy[outplayer - 1]
    if (!ownerUserId) return
    zhuYouXiaoHeirOwnerSeat = outplayer
    zhuYouXiaoHeirTargetSeat = null
    pendingAction.clear("zhu-you-xiao-heir-target")
    pendingAction.clear("zhu-you-xiao-heir-choice")
    pendingAction.open({
      kind: "zhu-you-xiao-heir-target",
      ownerSeat: outplayer,
      ownerUserId,
      channel: { scope: "private" },
      blocksRosterChanges: false,
      gameEpoch: gameTimers.epoch,
      timeoutMs: null,
      resumeAt: ResolutionCursor.PostElimination,
    })
    sendRecoverablePrivatePrompt(session, {
      kind: "zhu-you-xiao-heir-target",
      userId: ownerUserId,
      content: "您已因出局触发“传弟”。请选择一名当前在场玩家，将其设为传弟对象（私聊发送玩家序号、“传弟+序号”或“传+序号”；发送“弃”放弃）。当前在场玩家：" + order.join("、") + "。",
    })
  }
  const beginZhuYouXiaoHeirChoice = (session: Session, targetSeat: number) => {
    const targetIndex = order.indexOf(targetSeat)
    if (targetIndex === -1) return
    const heroIndex = heros.indexOf(targetSeat)
    const options = zhuYouXiaoHeirOptions(heroIndex === -1 ? null : heroIndex)
    const optionText = options.map((option, index) => {
      if (option === ZhuYouXiaoHeirOption.Reset) return (index + 1) + ".所有技能恢复为游戏初始状态（已有的标记不清空）"
      if (option === ZhuYouXiaoHeirOption.GrantLimited) return (index + 1) + ".增加一次已有的限定技可发动次数（当前为“" + nativeLimitedSkillName(heroIndex) + "”）"
      return (index + 1) + ".获得技能“处决”"
    }).join("\n")
    const userId = player[targetIndex]
    pendingAction.clear("zhu-you-xiao-heir-choice")
    pendingAction.open({
      kind: "zhu-you-xiao-heir-choice",
      ownerSeat: targetSeat,
      ownerUserId: userId,
      channel: { scope: "private" },
      blocksRosterChanges: false,
      gameEpoch: gameTimers.epoch,
      timeoutMs: timeout,
      resumeAt: ResolutionCursor.PostElimination,
    })
    sendRecoverablePrivatePrompt(session, {
      kind: "zhu-you-xiao-heir-choice",
      userId,
      content: "朱由校选择了您作为“传弟”对象，请选择一项（私聊发送序号；发送“弃”放弃接受）：\n" + optionText,
    })
    gameTimers.cancel(timer_zhu_you_xiao_heir)
    timer_zhu_you_xiao_heir = setGameTimeout(() => {
      if (!pendingAction.matches("zhu-you-xiao-heir-choice", {
        userId,
        scope: "private",
        gameEpoch: gameTimers.epoch,
      })) return
      pendingAction.clear("zhu-you-xiao-heir-choice")
      recoverablePendingPrompts.delete("zhu-you-xiao-heir-choice")
      recordSkill(HERO.ZHU_YOU_XIAO, '传弟选择超时，放弃接受', [targetSeat])
      zhuYouXiaoHeirTargetSeat = null
      notifyPrivate(session, userId, "传弟选择超时，已放弃接受。", "朱由校传弟超时通知")
    }, timeout)
  }
  const beginZhangXianZhongTarget = (session: Session, beforeDeparture?: ZhangBeforeDeparture) => {
    const zhangSeat = heros[HERO.ZHANG_XIAN_ZHONG]
    const userId = player_id_copy[zhangSeat - 1]
    const name = player_copy[zhangSeat - 1]
    zhangXianZhongModule.beginTargetSelection(heroState)
    const action = pendingAction.open({
      kind: "zhang-xian-zhong-target",
      ownerSeat: zhangSeat,
      ownerUserId: userId,
      ownerNickname: name,
      channel: { scope: "group", guildId: gameRoute.guildId },
      blocksRosterChanges: true,
      gameEpoch: gameTimers.epoch,
      timeoutMs: timeout,
      resumeAt: beforeDeparture ? ResolutionCursor.Eliminate : ann_off ? ResolutionCursor.NextRound : ResolutionCursor.PostElimination,
    })
    const voters = heroState.zhangXianZhong.level < 2 ? undefined : [...heroState.zhangXianZhong.voterSeats].sort((a, b) => a - b)
    const voterText = voters && (voters.length ? '投过你的玩家：' + voters.map(seat =>
      `${seat}号玩家${player_copy[seat - 1] || zhangPastVoterNames.get(seat) || ''}`).join('、') + '。' : '本局没有其他玩家投过你。')
    const selection = { action, voterText, beforeDeparture }
    zhangSelection = selection
    const content = (beforeDeparture ? `${zhangSeat}号玩家${name}即将出局，先结算“殒阵”。请` : '技能触发，请')
      + name + h('at', { id: userId }) + '选择带出局的玩家。（在群里发送玩家序号，或发送“弃”放弃发动技能）'
    rememberPendingPrompt({ kind: action.kind, userId, content, scope: 'group', gameEpoch: action.gameEpoch })
    if (voterText) notifyBotPrivate(session.bot, userId, voterText, '殒阵获知投票者')
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
      if (!consumeZhangChoice(selection)) return
      recordSkill(HERO.ZHANG_XIAN_ZHONG, '因带人选择超时，放弃发动技能')
      sumup += name + "（张献忠）放弃发动技能。\n"
      if (beforeDeparture) {
        notifyGroup(session, "张献忠输入超时，已取消发动技能。", "张献忠技能超时通知", zhangGuildId)
        await finishZhangBeforeDeparture(session, selection, null)
        return
      }
      if (action.resumeAt === ResolutionCursor.NextRound) {
        await resumeZhangXianZhongAtNextRound(session)
      }
      resumeSpeechAfterZhang(session)
      notifyGroup(session, "张献忠输入超时，已取消发动技能。", "张献忠技能超时通知", zhangGuildId)
    }, timeout)
    notifyGroup(session, content, "张献忠技能提示")
  }

  const deferZhangDeparture = (session: Session, elimination: EliminationContext, resume: ZhangBeforeDeparture['resume'],
    onDeferred?: () => void): boolean => {
    if (elimination.targetSeat !== heros[HERO.ZHANG_XIAN_ZHONG] || heroState.zhangXianZhong.level !== 3) return false
    vote_off = true
    onDeferred?.()
    const source = elimination.source === 'vote' ? '投票' : elimination.source === 'execution' ? '处决' : '权计'
    recordSkill(HERO.ZHANG_XIAN_ZHONG, `因${source}即将出局，发动“殒阵”三级，先结算带人`)
    beginZhangXianZhongTarget(session, { elimination, resume })
    return true
  }

  function consumeZhangChoice(selection: NonNullable<typeof zhangSelection>): boolean {
    if (zhangSelection !== selection || selection.action.gameEpoch !== gameTimers.epoch
      || !pendingAction.activeActions.includes(selection.action)) return false
    gameTimers.cancel(timer_zxz)
    pendingAction.complete(selection.action.kind)
    recoverablePendingPrompts.delete(selection.action.kind)
    if (!selection.beforeDeparture) {
      zhangSelection = undefined
      zhangXianZhongModule.finishTargetSelection(heroState)
    }
    return true
  }

  function isZhangSelectionInput(session: Session): boolean {
    // In the pre-departure window the owner can still be a speaker. A
    // numeric skill choice must not be swallowed as their seat prefix.
    return !!zhangSelection?.beforeDeparture && /^(?:[0-9]+|弃|弃权)$/u.test(normalizeHeroCommand(session.content))
      && pendingAction.matches('zhang-xian-zhong-target', { userId: session.userId, nickname: resolvePlayerNickname(session),
        scope: 'group', guildId: session.guildId, gameEpoch: gameTimers.epoch })
  }

  /** Protection is resolved once, before publishing or committing a departure. */
  const prepareZhangCarry = (session: Session, target: number): { removesTarget: boolean; notice: string } => {
    const zhangSeat = heros[HERO.ZHANG_XIAN_ZHONG]
    const targetIndex = order.indexOf(target)
    weiZhongXianModule.recordAttack(heroState, zhangSeat, target, weiZhongXianSeat())
    const linProtection = target === heros[HERO.LIN_DAN_HAN] && !shield[target - 1]
      ? linDanHanModule.protectFromSkill(heroState, zhangSeat)
      : { protected: false, awakenedNow: false }
    if (shield[target - 1] || linProtection.protected) {
      if (linProtection.awakenedNow) announceLinDanHanAwakening(session)
      const notice = `${target}号玩家${player_name[targetIndex]}受武将技能保护，未被张献忠带走。`
      sumup += notice + '\n'
      recordSkill(HERO.ZHANG_XIAN_ZHONG, '殒阵带人被保护抵消', [target])
      return { removesTarget: false, notice }
    }
    const notice = publicHeroEliminationText(target, `${target}号玩家${player_name[targetIndex]}`, '被张献忠带走。')
    sumup += notice + '\n'
    recordSkill(HERO.ZHANG_XIAN_ZHONG, '出局带走', [target])
    nv_out.push(target)
    return { removesTarget: true, notice }
  }

  async function finishZhangBeforeDeparture(session: Session, selection: NonNullable<typeof zhangSelection>, target: number | null) {
    const before = selection.beforeDeparture!
    const { elimination } = before
    const isCurrent = () => zhangSelection === selection && !game_off && gameTimers.epoch === elimination.gameEpoch
    try {
      if (!isCurrent()) return
      let carriedOvertimeCandidate = false
      const carry = target === null ? undefined : prepareZhangCarry(session, target)
      if (target !== null && carry?.removesTarget) {
        const targetIndex = order.indexOf(target), targetUser = player[targetIndex]
        const candidateSeats = add_flag && !ann_off ? add_indices.map(index => order[index]) : []
        const candidateIndex = candidateSeats.indexOf(target)
        carriedOvertimeCandidate = candidateIndex >= 0
        splice_player(target, false, true)
        boom_pending = false
        if (!ann_off) {
          if (add_flag) {
            add_indices = candidateSeats.filter(seat => seat !== target).map(seat => order.indexOf(seat))
            if (carriedOvertimeCandidate) add_ann.splice(candidateIndex, 1)
            add_voter = add_voter.filter(id => id !== targetUser)
            add_vote[round - 1] = Array(add_voter.length)
          }
          else {
            ann.splice(targetIndex, 1)
            vote[round - 1].splice(targetIndex, 1)
          }
        }
        notifyGroup(session, carry.notice, '殒阵带人出局通知')
        // A white Zhang awaiting departure has not survived this vote. Keep
        // the independent forced endgame for fewer than three players intact.
        const control = await resolveEliminationVictory(session, white !== elimination.targetSeat && whiteSurvivalSettlementPending,
          () => recordSkill(HERO.ZHANG_XIAN_ZHONG, '因先结算“殒阵”触发终局，原定出局未执行'))
        if (control.kind === 'game-end' || !isCurrent()) return
        const post = postEliminationHero(target, heros, 'skill')
        if (post === 'shi-ke-fa') promptShiKeFaGift(session, target)
        if (post === 'zhu-you-xiao') beginZhuYouXiaoHeirTarget(session, target)
      }
      else if (carry) notifyGroup(session, carry.notice, '殒阵带人保护通知')
      if (!isCurrent() || !order.includes(elimination.targetSeat)) return
      zhangXianZhongModule.finishTargetSelection(heroState)
      await before.resume(session, carriedOvertimeCandidate)
      if (isCurrent()) resumeSpeechAfterZhang(session)
    }
    finally {
      if (zhangSelection === selection) {
        zhangSelection = undefined
        zhangXianZhongModule.finishTargetSelection(heroState)
      }
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
    if (boom_pending || zhangSelection?.beforeDeparture || pendingAction.isRosterChangeBlocked()
      || voteSettlement.isRunning(currentVoteSettlementKey())) return true
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
    if (voterOrder !== heros[HERO.ZHANG_XIAN_ZHONG]) targets = targets.filter(targetOrder => targetOrder !== voterOrder)
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
  const regularVoteSlots = () => {
    const { voterIds, ballots } = currentVoteData()
    return voterIds.flatMap((id, index) => {
      const seat = order[player.indexOf(id)]
      return !seat || vote_num[seat - 1] <= 0 || seat === heros[HERO.MAO_WEN_LONG] || !getVotableTargets(seat).length
        ? [] : [{ seat, id, index, ballot: ballots?.[index] }]
    })
  }
  const weiZhongXianSeat = () => heros[HERO.WEI_ZHONG_XIAN]
  const factionOfSeat = (seat: number): "undercover" | "white" | "good" =>
    uc_copy.includes(seat) ? "undercover" : seat === white_copy ? "white" : "good"
  const weiActualDifferent = (firstSeat: number, secondSeat: number): boolean =>
    factionOfSeat(firstSeat) !== factionOfSeat(secondSeat)
  const weiFactionOverride = (firstSeat: number, secondSeat: number, actualDifferent: boolean): boolean => {
    const weiSeat = weiZhongXianSeat()
    if (firstSeat === weiSeat && order.includes(secondSeat)) {
      return weiZhongXianModule.considersDifferent(heroState, secondSeat, actualDifferent)
    }
    if (secondSeat === weiSeat && order.includes(firstSeat)) {
      return weiZhongXianModule.considersDifferent(heroState, firstSeat, actualDifferent)
    }
    return actualDifferent
  }
  const weiSameFaction = (firstSeat: number, secondSeat: number): boolean =>
    !weiFactionOverride(firstSeat, secondSeat, weiActualDifferent(firstSeat, secondSeat))
  const weiDifferentFaction = (firstSeat: number, secondSeat: number): boolean =>
    !weiSameFaction(firstSeat, secondSeat)
  const weiCurrentBallotTarget = (): number | null => {
    const weiSeat = weiZhongXianSeat()
    const index = order.indexOf(weiSeat)
    if (index === -1) return null
    const { voterIds, ballots } = currentVoteData()
    const voterId = player[index]
    const ballotIndex = voterIds.indexOf(voterId)
    const ballot = ballotIndex === -1 ? undefined : ballots[ballotIndex]
    return typeof ballot === "number" && order.includes(ballot) ? ballot : null
  }
  const weiCanVoteCurrentPhase = (): boolean => {
    const weiSeat = weiZhongXianSeat()
    const index = order.indexOf(weiSeat)
    if (voteFactStage === 'counting') return frozenVoteFacts.some(entry => entry.voterSeat === weiSeat && entry.status !== 'skip')
    if (index === -1 || vote_num[weiSeat - 1] === 0) return false
    const voterIds = add_flag ? add_voter : player
    return voterIds.includes(player[index]) && getVotableTargets(weiSeat).length > 0
  }
  const warnWeiInquiryConflict = (session: Session, targetSeat: number): void => {
    const weiSeat = weiZhongXianSeat()
    const choice = heroState.weiZhongXian.inquiry
    if (!choice || choice.kind !== "voted-by" || choice.targetSeat !== targetSeat) return
    const index = order.indexOf(weiSeat)
    if (index === -1) return
    notifyPrivate(
      session,
      player[index],
      `你当前投给了${targetSeat}号玩家；若保持当前投票，缉访选项2将在结算时失效。你可以重新发送“缉访1/缉1/访1/查1”或“缉访2+座位号”修改选择。`,
      "魏忠贤缉访失效预警",
    )
  }
  const weiInquiryTargetStatus = (entry: Pick<VoteFact, 'targetSeat' | 'status' | 'invalidReasons'>): string => {
    const target = entry.targetSeat === null ? "未投有效票" : `投给${entry.targetSeat}号玩家${player_copy[entry.targetSeat - 1] ?? ''}`
    if (entry.status === "abstain") return "弃票"
    if (entry.status === "timeout") return "未及时投票"
    if (entry.status === "skip") return "跳过投票阶段"
    if (entry.status === "locked") return "无需投票"
    return target + (entry.invalidReasons?.length ? '（此票失效）' : '')
  }
  const weiInquirySeatStatus = (seat: number, entries: VoteFact[]): string => {
    const entry = entries.find(item => item.voterSeat === seat)
    if (entry) return weiInquiryTargetStatus(entry)
    const seatIndex = order.indexOf(seat)
    if (seatIndex === -1) return "当前已离场，未参与本次投票"
    const voterIds = add_flag ? add_voter : player
    const voterId = player[seatIndex]
    if (!voterIds.includes(voterId) || vote_num[seat - 1] === 0 || seat === heros[HERO.MAO_WEN_LONG]) {
      return "跳过投票阶段"
    }
    return "未记录有效投票"
  }
  const resolveWeiInquiry = (session: Session, entries: VoteFact[]) => {
    const wei = heroState.weiZhongXian
    const choice = wei.inquiry
    const weiSeat = weiZhongXianSeat()
    if (!choice) return
    let content = ""
    let historyContent = ""
    if (choice.kind === "vote-target") {
      const targetSeat = entries.find(entry => entry.voterSeat === weiSeat)?.targetSeat ?? null
      if (targetSeat === null) content = "本次投票没有有效的投票对象，缉访无结果。"
      else {
        content = `${targetSeat}号玩家${player_copy[targetSeat - 1] ?? player_name[order.indexOf(targetSeat)]}本次${weiInquirySeatStatus(targetSeat, entries)}。`
      }
    }
    else if (choice.kind === "voted-by") {
      const target = choice.targetSeat
      const currentTarget = weiCurrentBallotTarget()
      if (currentTarget === target) {
        content = `你本次最终投给了${target}号玩家，缉访选项2已失效。`
      }
      else {
        const voters = entries.filter(entry => entry.targetSeat === target)
          .map(entry => `${entry.voterSeat}号玩家${player_copy[entry.voterSeat - 1] ?? player_name[order.indexOf(entry.voterSeat)]}${weiInquiryTargetStatus(entry)}${entry.weight ? `（${entry.weight}票）` : ""}`)
        const total = poll[order.indexOf(target)] ?? 0
        const anonymous = anonymousVoteContributions.get(target) ?? 0
        const targetName = `${target}号玩家${player_copy[target - 1] ?? player_name[order.indexOf(target)]}`
        const result = `本次获得${total}票。`
          + (voters.length ? `\n投票情况：\n${voters.join("\n")}。` : anonymous ? '' : "没有玩家投向该座位。")
          + (anonymous ? `\n有${anonymous}票无来源。` : '')
        content = (target === weiSeat ? '你' : targetName) + result
        historyContent = targetName + result
      }
    }
    if (content) {
      const index = order.indexOf(weiSeat)
      if (index !== -1) notifyPrivate(session, player[index], content, "魏忠贤缉访结果")
      const target = choice.kind === 'voted-by' ? choice.targetSeat : entries.find(entry => entry.voterSeat === weiSeat)?.targetSeat
      recordSkill(HERO.WEI_ZHONG_XIAN, `通过“缉访”${choice.kind === 'vote-target' ? '查看所投玩家的投票情况' : '查看目标的被投票情况'}，获知：${(historyContent || content).replace(/\n/g, '；')}`,
        target == null ? [] : [target])
      sumup += `${weiSeat}号玩家${player_copy[weiSeat - 1]}通过“缉访”获知：${historyContent || content}\n`
    }
    weiZhongXianModule.clearInquiry(heroState.weiZhongXian)
  }
  const awardWeiZhongXianCandidate = (
    session: Session,
    candidate: typeof heroState.weiZhongXian.candidates[number],
    source: WeiZhongXianRewardSource = 'normal',
  ) => {
    const weiSeat = weiZhongXianSeat()
    if (order.indexOf(weiSeat) === -1) return
    const actualDifferent = weiActualDifferent(weiSeat, candidate.targetSeat)
    const effectiveDifferent = weiZhongXianModule.considersDifferent(
      heroState,
      candidate.targetSeat,
      actualDifferent,
    )
    if (!claimWeiZhongXianReward(candidate, effectiveDifferent, source)) return
    fa[weiSeat - 1] += 1
    const index = order.indexOf(weiSeat)
    if (source === 'normal' && index !== -1) notifyPrivate(session, player[index], `伐异生效：你投票的${candidate.targetSeat}号玩家出局，且与你非同阵营；你获得1个“伐”标记。`, "魏忠贤伐异通知")
    sumup += `${weiSeat}号玩家${player_copy[weiSeat - 1]}（魏忠贤）获得1个“伐”标记。\n`
    const rewardEffect = source === 'normal'
      ? `因所投的${candidate.targetSeat}号玩家${player_copy[candidate.targetSeat - 1]}在下轮开始前出局，且与其非同阵营，发动“伐异”，获得1个“伐”标记`
      : `因发动“诬诽”，与第${candidate.phaseSerial}次投票所投的${candidate.targetSeat}号玩家${player_copy[candidate.targetSeat - 1]}视为非同阵营，追补“伐异”，获得1个“伐”标记`
    recordSkill(HERO.WEI_ZHONG_XIAN, rewardEffect, [candidate.targetSeat],
      { kind: 'wei-fa', phaseSerial: candidate.phaseSerial, targetSeat: candidate.targetSeat, gainedFa: 1, source })
  }
  const settleWeiZhongXianCandidates = (session: Session) => {
    for (const candidate of heroState.weiZhongXian.candidates) {
      if (candidate.settled) continue
      candidate.settled = true
      candidate.targetExitedBeforeNextRound ||= !order.includes(candidate.targetSeat)
      if (candidate.targetExitedBeforeNextRound) awardWeiZhongXianCandidate(session, candidate)
    }
  }
  const retroactivelyAwardWeiZhongXianCandidates = (session: Session, newlyDifferentSeats: readonly number[]): Array<{ phaseSerial: number; targetSeat: number }> => {
    const weiSeat = weiZhongXianSeat()
    if (order.indexOf(weiSeat) === -1) return []
    const awarded: Array<{ phaseSerial: number; targetSeat: number }> = []
    for (const candidate of heroState.weiZhongXian.candidates) {
      if (!candidate.phaseCompleted || !candidate.targetExitedBeforeNextRound || hasWeiZhongXianReward(candidate)
        || candidate.phaseSerial === heroState.weiZhongXian.phaseSerial && !candidate.settled
        || !newlyDifferentSeats.includes(candidate.targetSeat)) continue
      // The pre-activation relation was same-faction; only this activation's
      // newly changed relations can fill a missing reward on an old vote.
      candidate.blockedByFaction = true
      awardWeiZhongXianCandidate(session, candidate, 'slander')
      if (candidate.retroactiveAwarded) awarded.push({ phaseSerial: candidate.phaseSerial, targetSeat: candidate.targetSeat })
    }
    return awarded
  }
  // 名单变化后不再依靠局部加减 poll，而是以保留下来的原始选票重新演算票池及武将派生状态。
  // 这样既能只作废真正失效的票，也不会遗留林丹汗互投/避实、史可法队友票或皇太极目标。
  let currentBallotEffects: BallotEffect[] = []
  const captureCurrentVoteFacts = (closed: boolean) => {
    const { voterIds, ballots } = currentVoteData()
    const delegation = zhuYouXiaoVotes.current
    return captureVoteFacts({ voterIds, ballots, playerIds: player, seats: order, names: player_name,
      weights: vote_num, maoSeat: heros[HERO.MAO_WEN_LONG], closed, effects: currentBallotEffects,
      lockedSeats: new Set(order.filter(seat => lockedVoteSeats.has(votePhaseKey(seat)))),
      delegation: delegation?.serial === votePhaseSerial && delegation.ownerSeat !== null && delegation.successfulDelegateSeat !== null
        ? { owner: delegation.ownerSeat, decider: delegation.successfulDelegateSeat } : undefined,
    })
  }
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
      isSameFaction: weiSameFaction,
      zhuYouXiao: zhuYouXiaoVotes.current?.serial === votePhaseSerial
        && zhuYouXiaoVotes.current.ownerSeat !== null
        ? { ownerSeat: zhuYouXiaoVotes.current.ownerSeat, delegateSeat: zhuYouXiaoVotes.current.delegateSeat }
        : undefined,
    })
    currentBallotEffects = rebuilt.ballotEffects
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
  const delegationOwnBallotText = (seat: number, ownerSeat: number, revoked = false): string => {
    const effect = currentBallotEffects.find(ballot => ballot.voterSeat === seat && ballot.targetSeat === ownerSeat)
    if (!effect) return ''
    if (!revoked) return '\n你当前投给朱由校的自有票已记录，但将因本次放权关系失效。'
    return effect.invalidReasons.length
      ? '\n你投给朱由校的自有票仍保留，无需重投；不再受放权影响，但仍因其他技能失效。'
      : '\n你投给朱由校的自有票仍保留，无需重投，已恢复有效。'
  }
  const delegationPrompt = (delegateSeat: number, ownerSeat: number, reselected = false): string =>
    `${ownerSeat}号玩家${player_copy[ownerSeat - 1]}（朱由校）放权给你，请发送“代投+序号/代+序号”或“代弃”。`
      + (reselected ? '\n原代投票已作废，请重新代投。' : '')
      + '\n你的自有票与代投分别记录，自有票投给朱由校时会失效。'
      + (fa[ownerSeat - 1] > 0 ? `\n可用${fa[ownerSeat - 1]}个“伐”，发送“代伐N”使用。` : '')
      + delegationOwnBallotText(delegateSeat, ownerSeat)
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
      isSameFaction: weiSameFaction,
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
    for (const effect of currentBallotEffects) {
      if (!effect.invalidReasons.includes('zhu-you-xiao-delegation')) continue
      sumup += `${effect.voterSeat}号玩家${player_copy[effect.voterSeat - 1]}投给${effect.targetSeat}号玩家${player_copy[effect.targetSeat - 1]}的自有票因“放权”失效。\n`
      if (effect.voterSeat === heros[HERO.LI_ZI_CHENG]) liZiChengModule.recordBallotOutcome(heroState, {
        ballot: effect.targetSeat, invalidatedByLinDanHan: false, invalidatedByDelegation: true,
      })
    }
    // Only this phase's own ballot can earn 流兵; an overtime candidate has no
    // such ballot, even if their preceding ordinary ballot was an abstention.
    liZiChengModule.consumeRewardPending(heroState)
    liRewardSnapshot = undefined
    const liSeat = heros[HERO.LI_ZI_CHENG], liIndex = order.indexOf(liSeat)
    const current = currentVoteData()
    const voterIndex = liIndex < 0 ? -1 : current.voterIds.indexOf(player[liIndex])
    if (voterIndex >= 0 && vote_num[liSeat - 1] > 0 && liRewardedSerial !== votePhaseSerial) {
      const effect = currentBallotEffects.find(item => item.voterSeat === liSeat)
      const outcome = liZiChengModule.recordBallotOutcome(heroState, {
        ballot: current.ballots[voterIndex],
        invalidatedByLinDanHan: !!effect?.invalidReasons.includes('lin-dan-han-protection'),
        invalidatedByDelegation: !!effect?.invalidReasons.includes('zhu-you-xiao-delegation'),
      })
      if (outcome !== 'effective') liRewardSnapshot = { serial: votePhaseSerial, weight: vote_num[liSeat - 1], sequence: historyRecorder?.currentSequence() }
    }
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
          frozenVoteFacts = captureCurrentVoteFacts(true)
          voteFactStage = 'counting'
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
      isSameFaction: weiSameFaction,
      zhuYouXiao: zhuYouXiaoVotes.current?.ownerSeat == null ? undefined
        : { ownerSeat: zhuYouXiaoVotes.current.ownerSeat, ballotEffects: currentBallotEffects },
    })
  }
  let voteRosterRevision = 0
  const rebaseVoteRoster = (session: Session, snapshot: VoteRosterSnapshot) => {
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
    if (add_flag) {
      add_voter = voterIds
      add_vote[round - 1] = ballots
    }
    else {
      vote[round - 1] = ballots
    }
    for (const voterId of retained.autoWaivedVoterIds) {
      const index = voterIds.indexOf(voterId), ownerSeat = order[player.indexOf(voterId)]
      // Resolve an unfinished proxy against the *rebased* ballot, then
      // record the automatic waiver. The original arrays no longer align.
      ballots[index] = undefined
      const reporter = zhuYouXiaoAutoVoteReporter(ownerSeat, add_flag)
      ballots[index] = 0
      notifyPrivate(session, reporter.userId, "玩家变动后你已没有可投票的对象，已为你自动弃票。", "名单变化自动弃票通知")
    }
    rebuildPollFromBallots()

    flag = false
    return { key: currentVoteSettlementKey(), revision: ++voteRosterRevision, voterIds, ballots,
      invalidatedVoterIds: retained.invalidatedVoterIds }
  }
  const announceVoteRosterChange = async (session: Session, notice: string, change: ReturnType<typeof rebaseVoteRoster>) => {
    const isCurrent = () => change.key === currentVoteSettlementKey() && change.revision === voteRosterRevision && isReceivingRegularVotes()
    if (!isCurrent() || await finishVoteIfReady(session, notice) || !isCurrent()) return
    const { voterIds, ballots, invalidatedVoterIds } = change

    notifyGroup(session, notice + "，其余有效投票继续保留。尚未投票或原投票失效的玩家请继续投票。", "名单变化继续投票通知")
    for (let i = 0; i < voterIds.length; i++) {
      const playerIndex = player.indexOf(voterIds[i])
      const voterOrder = order[playerIndex]
      if (!isEmpty(ballots[i]) || vote_num[voterOrder - 1] === 0 || voterOrder === heros[HERO.MAO_WEN_LONG]) continue
      const targets = getVotableTargets(voterOrder)
      const canVote = targets.map(targetOrder => targetOrder + "号" + player_copy[targetOrder - 1]).join("，")
      const prefix = invalidatedVoterIds.has(voterIds[i]) ? "你原先投票的对象已不在有效候选中。" : "玩家名单刚刚发生变化。"
      const reporter = zhuYouXiaoVoteReporter(voterOrder, add_flag)
      notifyPrivate(session, reporter.userId, prefix + "当前可投票的玩家为：" + canVote + "。请继续投票。", "名单变化投票对象通知")
    }
  }
  const currentVoteSettlementKey = () => `${gameTimers.epoch}:${votePhaseSerial}`
  const isReceivingRegularVotes = () => !game_off && !vote_off && voteFactStage === 'open'
    && !voteSettlement.isRunning(currentVoteSettlementKey())
  const timeout_vote = async (session) => {
    const key = currentVoteSettlementKey()
    return voteSettlement.run(key, async () => {
      gameTimers.cancel(timer_hurry)
      gameTimers.cancel(timer_vote)
      clearVoteOpportunity()
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
    if (!isReceivingRegularVotes()) return
    const guildId = gameRoute.guildId
    const reporters = outstandingVoteReporters()
    const drag = reporters.length
    let novote = "目前，还有" + reporters.map(reporter => reporter.seat + '号玩家' + reporter.name).join('，')
      + "共" + drag + "位玩家未投票，"
    if (add_flag) {
      for (let i = 0; i < add_voter.length; i++) {
        let d = player.indexOf(add_voter[i])
        if (isEmpty(add_vote[round - 1][i]) && vote_num[order[d] - 1] !== 0 && order[d] !== heros[HERO.MAO_WEN_LONG]) {
          const reporter = zhuYouXiaoAutoVoteReporter(order[d], true)
          add_vote[round - 1][i] = -1
        }
      }
    }
    else {
      for (let i = 0; i < player.length; i++) {
        if (isEmpty(vote[round - 1][i]) && vote_num[order[i] - 1] !== 0 && order[i] !== heros[HERO.MAO_WEN_LONG]) {
          const reporter = zhuYouXiaoAutoVoteReporter(order[i], false)
          vote[round - 1][i] = -1
        }
      }
    }
    for (const reporter of reporters) notifyPrivate(session, reporter.userId,
      pendingSkillsFor(reporter.userId).length
        ? '投票阶段已经结束啦~\n你的待选技能仍按原期限处理，可发送“我的待处理”查看；本次投票不会重开。'
        : '你投票太慢啦，投票阶段已经结束啦~',
      '投票超时通知')
    novote += "不等他" + (drag === 1 ? "" : "们") + "投票了，本次投票阶段结束。"
    await timeout_vote(session)
    notifyGroup(session, novote, "投票超时群通知", guildId)
  }
  function outstandingVoteReporters() {
    const reports = new Map<string, ReturnType<typeof zhuYouXiaoVoteReporter>>()
    const ids = add_flag ? add_voter : player
    const ballots = add_flag ? add_vote[round - 1] : vote[round - 1]
    for (let index = 0; index < ids.length; index++) {
      const activeIndex = player.indexOf(ids[index])
      if (activeIndex < 0) continue
      const seat = order[activeIndex]
      if (!isEmpty(ballots?.[index]) || vote_num[seat - 1] === 0 || seat === heros[HERO.MAO_WEN_LONG]) continue
      const reporter = zhuYouXiaoVoteReporter(seat, add_flag)
      reports.set(reporter.userId, reporter)
    }
    return [...reports.values()]
  }
  function privateVoteObligations(userId: string): string[] {
    const ids = add_flag ? add_voter : player
    const ballots = add_flag ? add_vote[round - 1] : vote[round - 1]
    return ids.flatMap((id, index) => {
      const seat = order[player.indexOf(id)]
      if (isEmpty(seat) || seat === heros[HERO.MAO_WEN_LONG] || vote_num[seat - 1] === 0
        || !isEmpty(ballots?.[index]) || zhuYouXiaoVoteReporter(seat, add_flag).userId !== userId) return []
      return id === userId ? []
        : [`你代${seat}号玩家${player_copy[seat - 1]}进行的投票尚未完成，请发送“代投+序号”或“代弃”。`]
    })
  }
  const privateVoteReminderDetails = (userId: string): string[] => {
    const details = privateVoteObligations(userId)
    const actions = pendingSkillsFor(userId)
    if (actions.length) details.push('请先完成' + actions.map(action => '“' + pendingActionNames[action.kind] + '”').join('、')
      + '技能选择，再投票；可私聊发送“我的待处理”查看。')
    return details
  }
  const hurry_vote = async (session) => {
    if (!isReceivingRegularVotes()) return
    if (voteOpportunity && Date.now() >= voteOpportunity.hardDeadline) return
    // At the default shared deadline, close a held decisive vote before
    // sending a reminder that would no longer be actionable.
    if (voteOpportunity?.timer !== undefined && Date.now() >= voteOpportunity.expiresAt) {
      if (await finishVoteIfReady(session) || !isReceivingRegularVotes()) return
    }
    const reporters = outstandingVoteReporters()
    for (const reporter of reporters) if (notifications.voteHurryPrivate) notifyPrivate(session, reporter.userId,
      ['投票开始已经过去' + formatConfiguredDuration(config.hurryTimeout) + '了，赶快投票哦~',
        ...privateVoteReminderDetails(reporter.userId), ...optionalVoteReminder(reporter.userId)].join('\n'), '催票私聊')
    if (reporters.length && notifications.voteHurryGroup) notifyGroup(session,
      '目前，还有' + reporters.map(reporter => reporter.seat + '号玩家' + reporter.name).join('，')
        + '共' + reporters.length + '位玩家未投票' + (notifications.voteHurryPrivate ? '，已经催了~' : '。'), '催票群通知')
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
  const zhuYouXiaoCurrentOwner = (): number | null => {
    const current = zhuYouXiaoVotes.current
    if (!current || current.serial !== votePhaseSerial) return null
    if (current.ownerSeat === null || !order.includes(current.ownerSeat)) return null
    return current.ownerSeat
  }
  const zhuYouXiaoBallotLocation = (seat: number, overtime: boolean): { ballots: number[], index: number } | null => {
    const activeIndex = order.indexOf(seat)
    if (activeIndex === -1) return null
    const userId = player[activeIndex]
    const index = overtime ? add_voter.indexOf(userId) : activeIndex
    const ballots = overtime ? add_vote[round - 1] : vote[round - 1]
    if (!ballots || index < 0 || index >= ballots.length) return null
    return { ballots, index }
  }
  const zhuYouXiaoVoteReporter = (ownerSeat: number, overtime: boolean): { seat: number, userId: string, name: string } => {
    const ownerIndex = order.indexOf(ownerSeat)
    const current = zhuYouXiaoVotes.current
    const location = zhuYouXiaoBallotLocation(ownerSeat, overtime)
    if (ownerIndex !== -1 && current?.serial === votePhaseSerial
      && current.ownerSeat === ownerSeat && current.delegateSeat !== null
      && order.includes(current.delegateSeat) && location && isEmpty(location.ballots[location.index])) {
      const delegateIndex = order.indexOf(current.delegateSeat)
      return { seat: current.delegateSeat, userId: player[delegateIndex], name: player_name[delegateIndex] }
    }
    return { seat: ownerSeat, userId: player[ownerIndex], name: player_name[ownerIndex] }
  }
  const zhuYouXiaoAutoVoteReporter = (ownerSeat: number, overtime: boolean) => {
    // Resolve the hidden recipient while the owner's logical ballot is still
    // empty.  Once an automatic timeout/lock writes -1, the regular reporter
    // can no longer distinguish a delegated ballot from an ordinary one.
    const reporter = zhuYouXiaoVoteReporter(ownerSeat, overtime)
    const current = zhuYouXiaoVotes.current
    const location = zhuYouXiaoBallotLocation(ownerSeat, overtime)
    if (current?.serial === votePhaseSerial
      && current.ownerSeat === ownerSeat
      && current.delegateSeat !== null
      && location
      && isEmpty(location.ballots[location.index])) {
      recordZhuYouXiaoProxyVote(zhuYouXiaoVotes)
    }
    return reporter
  }
  const clearZhuYouXiaoBallot = (seat: number, overtime: boolean, refundFa = false, rebuild = true): void => {
    if (refundFa) {
      const spent = flag_fa[seat - 1] || 0
      fa[seat - 1] += spent
      vote_num[seat - 1] -= spent
      flag_fa[seat - 1] = 0
      if (spent > 0) recordSkill(HERO.ZHU_YOU_XIAO,
        `放弃旧有投票，退还本阶段已用的${spent}个“伐”标记，并撤销对应额外票权`)
    }
    const location = zhuYouXiaoBallotLocation(seat, overtime)
    if (!location) return
    location.ballots[location.index] = undefined as unknown as number
    lockedVoteSeats.delete(votePhaseKey(seat))
    // Replaying the raw ballots is the single source of truth for all derived
    // poll effects (避实、抵诽、定策、皇太极目标和弃票)。 Manual subtraction
    // can leave one of those coupled states behind after a delegated vote is
    // withdrawn or replaced.
    if (rebuild) rebuildPollFromBallots()
  }
  const zhuYouXiaoOwnerIsEligible = (overtime: boolean): number | null => {
    const owner = zhuYouXiaoCurrentOwner()
    if (owner === null) return null
    const index = order.indexOf(owner)
    if (index === -1 || vote_num[owner - 1] === 0) return null
    const voterIds = overtime ? add_voter : player
    if (!voterIds.includes(player[index])) return null
    return owner
  }
  const zhuYouXiaoRecordProxyBallot = async (
    session: Session,
    target: number | 0,
  ): Promise<string | void> => {
    const overtime = add_flag
    const owner = zhuYouXiaoOwnerIsEligible(overtime)
    const current = zhuYouXiaoVotes.current
    if (owner === null || !current || current.delegateSeat === null) return "当前没有需要你代投的朱由校投票。"
    const delegate = current.delegateSeat
    if (order.indexOf(delegate) === -1) return "放权对象已离场，本次代投已失效。"
    if (target !== 0 && !getVotableTargets(owner).includes(target)) {
      return "无效的投票对象，请按照朱由校的可投票范围重新发送“代投+序号”或“代+序号”，也可发送“代投弃权/代投弃/代弃”。"
    }
    const location = zhuYouXiaoBallotLocation(owner, overtime)
    if (!location) return "当前投票阶段已无法代投，请稍候查看结算结果。"
    if (voteSettlement.isRunning(currentVoteSettlementKey())) {
      return "投票正在结算，请稍候。"
    }
    if (location.ballots[location.index] === -1 && lockedVoteSeats.has(votePhaseKey(owner))) {
      return "本次票数已经锁定，不能再改票。"
    }
    const firstBallot = isEmpty(location.ballots[location.index])
    clearZhuYouXiaoBallot(owner, overtime)
    if (target === 0) {
      location.ballots[location.index] = 0
    }
    else {
      location.ballots[location.index] = target
    }
    // Rebuild every derived vote effect from the new raw ballot.  A proxy
    // vote can complete a Lin Dan Han mutual vote or replace an abstention,
    // so adjusting only poll/waiver would leave hero state stale.
    rebuildPollFromBallots()
    recordZhuYouXiaoProxyVote(zhuYouXiaoVotes)
    if (target > 0 && owner === weiZhongXianSeat()) warnWeiInquiryConflict(session, target)
    if (flag_notify) notifyPrivate(session, hostid,
      `${owner}号玩家${player_copy[owner - 1]}${firstBallot ? '' : '改票，'}${target === 0 ? '弃权' : `投给了${target}号玩家${player_copy[target - 1]}`}（由${delegate}号玩家${player_copy[delegate - 1]}代投）。`,
      '实时代投票况通知')
    if (firstBallot) notifySession(session, "代投已记录；在本轮结算开始前，你仍可改投。", "朱由校代投回执")
    else notifySession(session, "已改票。", "朱由校代投改票回执")
    await finishVoteIfReady(session)
  }

  // The same real skill availability feeds reminders and automatic closure.
  // The caller decides whether this seat has a regular ballot obligation.
  function voteSkillChoices(seat: number) {
    const yuan = !add_flag && seat === heros[HERO.YUAN_CHONG_HUAN]
      && yuanChongHuanModule.isVoteWindowOpen(heroState, votePhaseSerial)
    const previousGuardTarget = heroState.yuanChongHuan.previousGuardTarget
    const guard = yuan && order.some(target => target !== seat && target !== previousGuardTarget)
    const selfGuard = yuan && previousGuardTarget !== seat && yuanChongHuanModule.selfGuardUses(heroState, seat) > 0
    const dorgon = seat === heros[HERO.DUO_ER_GUN]
    const mark = heroState.duoErGun.strategyMark
    const regencyState = heroState.duoErGun.regencyState.kind
    const liveEstablishedMark = mark.kind === 'established' && order.includes(mark.seat)
    const strategy = dorgon && !add_flag && order.some(target => target !== seat) && regencyState !== 'spent'
      && !(liveEstablishedMark && regencyState !== 'locked')
    const regency = dorgon && regencyState === 'available' && liveEstablishedMark && order.length > 1
    return {
      zhang: seat === heros[HERO.ZHANG_XIAN_ZHONG], guard, selfGuard, strategy, regency,
      delegation: zhuYouXiaoVotes.current?.ownerSeat === seat && order.some(target => target !== seat),
      inquiry: seat === heros[HERO.WEI_ZHONG_XIAN] && isWeiInquiryWindowOpen(),
    }
  }

  function optionalVoteReminder(userId: string): string[] {
    const slot = regularVoteSlots().find(vote => vote.id === userId && isEmpty(vote.ballot))
    if (!slot || voteOpportunity?.decidedSeats.has(slot.seat) ||
      zhuYouXiaoVoteReporter(slot.seat, add_flag).userId !== userId) return []
    const choices = voteSkillChoices(slot.seat)
    if (choices.zhang && heroState.zhangXianZhong.level < 3 && getVotableTargets(slot.seat).includes(slot.seat)) {
      return ['想用“诈降”升级殒阵，可投自己。']
    }
    const commands = [(choices.guard || choices.selfGuard) && '守卫（“守＋序号”' + (choices.selfGuard ? '或“专镇”' : '') + '）',
      choices.delegation && '放权（“放＋序号”）', choices.inquiry && '缉访（“缉访1”或“缉访2＋序号”）',
      choices.strategy && '定策（“立＋序号”）', choices.regency && '摄政（“保A弃B”）'].filter(Boolean)
    return commands.length ? [`若想用${commands.join('／')}，请先发动再投票。`] : []
  }

  function clearVoteOpportunity(): void {
    gameTimers.cancel(voteOpportunity?.timer)
    voteOpportunity = undefined
  }

  async function decideVoteSkill(session: Session, seat: number): Promise<void> {
    if (!isReceivingRegularVotes()) return
    voteOpportunity?.decidedSeats.add(seat)
    await finishVoteIfReady(session)
  }

  function shouldKeepVoteOpen(session: Session): boolean {
    const window = voteOpportunity
    if (!window || Date.now() >= window.expiresAt || Date.now() >= window.hardDeadline) return false
    const waiting = regularVoteSlots().some(({ ballot, seat }) => isEmpty(ballot) && !window.decidedSeats.has(seat)
      && Object.values(voteSkillChoices(seat)).some(Boolean))
    if (!waiting) return false
    if (window.timer === undefined && window.expiresAt < window.hardDeadline) {
      window.timer = setGameTimeout(async () => {
        if (voteOpportunity !== window || window.epoch !== gameTimers.epoch || window.serial !== votePhaseSerial) return
        await finishVoteIfReady(session)
      }, Math.max(0, window.expiresAt - Date.now()))
    }
    return true
  }

  async function finishVoteIfReady(session: Session, rosterNotice?: string): Promise<boolean> {
    if (!isReceivingRegularVotes() || (voteOpportunity && Date.now() >= voteOpportunity.hardDeadline)) return false
    const status = voteResolutionStatus()
    if (status === 'pending' || (status === 'locked' && shouldKeepVoteOpen(session))) return false
    if (status === "locked") {
      const { ballots } = currentVoteData()
      for (const { seat, index, ballot } of regularVoteSlots()) {
        if (!isEmpty(ballot)) continue
        const reporter = zhuYouXiaoAutoVoteReporter(seat, add_flag)
        ballots[index] = -1
        lockedVoteSeats.add(votePhaseKey(seat))
        notifyPrivate(session, reporter.userId, rosterNotice ? '名单调整后票数已足以确定结果，无需你再进行投票。'
          : '票数已够，无需你再进行投票。', '提前锁票通知')
      }
    }
    if (rosterNotice) {
      flag = true
      const reason = status === 'complete' ? '所有必要投票均已完成' : '调整后的票数已经锁定结果'
      notifyGroup(session, rosterNotice + '，其余有效投票已保留；' + reason + '，立即结算。', '名单变化立即结算通知')
    }
    await timeout_vote(session)
    return true
  }
  const prepareVoteWindowAndNotifyPlayers = (session: Session, overtime: boolean) => {
    // Use a monotonic phase identity rather than round/overtime labels.  This
    // preserves replay status if a future skill deliberately creates another
    // overtime window in the same round.
    votePhaseSerial += 1
    clearVoteOpportunity()
    const startedAt = Date.now()
    voteOpportunity = { epoch: gameTimers.epoch, serial: votePhaseSerial, expiresAt: startedAt + timeout,
      hardDeadline: timeout_mode <= 4 ? startedAt + timeout_for_vote : Infinity, decidedSeats: new Set() }
    voteFactStage = 'open'
    frozenVoteFacts = []
    anonymousVoteContributions.clear()
    weiInquiryWindow = { epoch: gameTimers.epoch, serial: votePhaseSerial }
    weiZhongXianModule.beginPhase(heroState, votePhaseSerial)
    if (flag_white && isEmpty(uc) && (!overtime || add_indices.some(index => order[index] === white))) white_only = true
    const voterIds = overtime ? add_voter : player
    const zhuYouXiaoSeat = heros[HERO.ZHU_YOU_XIAO]
    const zhuYouXiaoIndex = order.indexOf(zhuYouXiaoSeat)
    const zhuYouXiaoCanVote = zhuYouXiaoIndex !== -1
      && voterIds.includes(player[zhuYouXiaoIndex])
      && vote_num[zhuYouXiaoSeat - 1] !== 0
      && getVotableTargets(zhuYouXiaoSeat).length > 0
    beginZhuYouXiaoVotePhase(zhuYouXiaoVotes, {
      serial: votePhaseSerial,
      kind: overtime ? "overtime" : "regular",
      ownerSeat: zhuYouXiaoCanVote ? zhuYouXiaoSeat : null,
    })
    const previousGuardTarget = !overtime && order.includes(heros[HERO.YUAN_CHONG_HUAN])
      ? yuanChongHuanModule.beginVoteWindow(heroState, votePhaseSerial)
      : null
    const dorgonStrategySeat = duoErGunModule.strategySeat(heroState)

    const reminderIds = new Set(voterIds)
    const weiIndex = order.indexOf(heros[HERO.WEI_ZHONG_XIAN])
    if (weiIndex !== -1) reminderIds.add(player[weiIndex])
    for (const voterId of reminderIds) {
      const activeIndex = player.indexOf(voterId)
      if (activeIndex === -1) continue
      const seat = order[activeIndex]
      const mustVote = voterIds.includes(voterId)
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
      const pendingNotice = skillFirstNotice(voterId)
      if (!notifications.voteStartPrivate && !pendingNotice) continue

      const lines = mustVote ? [
        `第${round}轮${overtime ? "加时" : ""}投票已开始，该投票了。`,
        ...(pendingNotice ? [pendingNotice] : []),
        "可投票对象：" + targets.map(target => `${target}号${player_copy[target - 1]}`).join("，") + "。",
        "请私聊发送目标座位号；发送“弃”或“弃权”可弃票，结算前可以改票。",
      ] : ['本次加时你不参与投票，仍可使用缉访选项2。']
      if (mustVote && fa[seat - 1] > 0) {
        lines.push(`你有${fa[seat - 1]}个“伐”，可先发送“伐+数字”（只发“伐”默认使用1个）增加本次票数。`)
      }
      const choices = voteSkillChoices(seat)
      if (mustVote && choices.zhang && heroState.zhangXianZhong.level < 3 && targets.includes(seat)) {
        lines.push(`殒阵现为${heroState.zhangXianZhong.level}级；若想用“诈降”升级，可投自己。`)
      }
      if (mustVote && (choices.guard || choices.selfGuard)) {
        const uses = yuanChongHuanModule.selfGuardUses(heroState, seat)
        const selfGuide = uses <= 0 ? '“专镇”已用尽，不能守卫自己'
          : previousGuardTarget === seat ? '本轮不能连续守卫自己'
          : `发送“专镇”守卫自己（剩余${uses}次）`
        lines.push("若想守卫，请先发送“守+座位号”再投票；" + selfGuide + "，发送“弃守”放弃"
          + (previousGuardTarget === null || !order.includes(previousGuardTarget)
            ? "。"
            : previousGuardTarget === seat ? '。' : `；本轮不能继续守卫${previousGuardTarget}号玩家${player_copy[previousGuardTarget - 1]}。`))
      }
      if (seat === heros[HERO.LIN_DAN_HAN] && linDanHanModule.isAwakened(heroState)) {
        lines.push("以上可投票对象已按“西迁”限制过滤。")
      }
      if (mustVote && choices.strategy) {
        lines.push(dorgonStrategySeat === null || !order.includes(dorgonStrategySeat)
          ? '若想使用“定策”，可先发送“立+座位号”再投票。'
          : `若想转移${dorgonStrategySeat}号玩家的“定策”，可先发送“立+座位号”再投票。`)
      }
      if (mustVote && choices.regency) {
        lines.push('若想使用“摄政”，可先发送“保A弃B”再投票。')
      }
      if (mustVote && choices.delegation) {
        lines.push('若想放权，先发“放权+座位号”；“弃放权”可收回。')
      }
      if (choices.inquiry) {
        lines.push((mustVote ? '若想缉访，可先发送“缉访1”查看所投玩家投给谁，或' : '可')
          + '发送“缉访2+座位号”查看该玩家的被投票情况；“弃缉访”放弃。')
      }
      notifyPrivate(session, voterId, lines.join("\n"), `投票开始${seat}号私聊提醒`)
    }
    linDanHanModule.beginVoteWindow(heroState)
  }
  const settleVoteWithoutOrdinaryObligations = (session: Session) => {
    if (voteResolutionStatus() !== 'complete') return
    const key = currentVoteSettlementKey()
    void finishVoteIfReady(session).catch(error => {
      if (game_off || key !== currentVoteSettlementKey()) return
      ctx.logger.warn('无须普通投票的阶段结算失败：%s', safeErrorSummary(error))
      notifyGroup(session, '系统异常，本局已终止。', '投票结算异常')
      end_game({ kind: 'aborted', reason: 'system-error' })
    })
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
        flag_just_vote = false
        return hurry_vote(session)
      }, timeout_for_hurry)
      if (timeout_mode <= 4) {
        timer_vote = setGameTimeout(() => {
          return timeout_vote_auto(session)
        }, timeout_for_vote);
        notifyGroup(session, "本次投票阶段限时：" + formatConfiguredDuration(config.voteTimeout), "投票限时通知")
      }
      settleVoteWithoutOrdinaryObligations(session)
    }
    return
  }
  const endOvertimeAnn = (session: Session) => {
    if (game_off || ann_off || zhangXianZhongModule.isAwaitingTarget(heroState)) return
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
        flag_just_vote = false
        return hurry_vote(session)
      }, timeout_for_hurry)
      if (timeout_mode <= 4) {
        timer_vote = setGameTimeout(() => {
          return timeout_vote_auto(session)
        }, timeout_for_vote);
        notifyGroup(session, "本次投票阶段限时：" + formatConfiguredDuration(config.voteTimeout), "加时投票限时通知")
      }
      settleVoteWithoutOrdinaryObligations(session)
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
    if (!isGameHost(session.userId)) return next()
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
    if (input.kind === 'answer' && currentTurn?.status === 'complete'
      && turtleAnswerOwners.has(currentTurn) && turtleAnswerOwners.get(currentTurn) !== session.userId) {
      return '该问题已由另一位主持人回答；如需更正，请发送“改' + input.seat + '是/否”等明确更正指令。'
    }
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
    if (result.kind !== 'rejected') turtleAnswerOwners.set(result.turn, session.userId)
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
    if (isZhangSelectionInput(session)) return next()
    if (isGameHost(session.userId)) return next()
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
    const deliveries = await Promise.all(gameHostIds().map(target => messages.state(
      `龟模式${parsed.seat}号主持回答提示`, async () => {
        const ids = await session.bot.sendPrivateMessage(target, prompt)
        promptIds.push(...(Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))
      },
    )))
    const delivered = deliveries.some(Boolean)
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
  ctx.guild().middleware(async (session, next) => {//鹿模式独立补发言，不占用投票输入
    if (game_off || modeInteraction.mode !== 'deer' || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (isZhangSelectionInput(session)) return next()
    const index = player.indexOf(session.userId), seat = order[index]
    const task = deerRevisions.makeup(seat)
    if (!task || task.userId !== session.userId) return next()
    const text = session.content.trimStart()
    if (!text.startsWith(String(seat)) || !text.slice(String(seat).length).trim()) return next()
    if (deerSeatNeedsSelection(seat)) return rejectUnapprovedDeerSpeech(session, '你需要先通过选词审核，才能补发言。')
    const version = modeInteraction.deerSelectionForSeat(seat)?.approvedVersion
    if (version !== task.version || !deerRevisions.complete(seat, session.userId, version)) return next()
    gameTimers.cancel(deerMakeupTimers.get(seat)); deerMakeupTimers.delete(seat)
    recordSpeech(session, seat, text, undefined, undefined, task.round)
    if (!ann_off && !add_flag) {
      if (round !== task.round) recordSpeech(session, seat, text)
      ann[index] = text
      cancelDeerSpeechClock(seat)
      end_ann(session)
    }
    return '已补入第' + task.round + '轮普通发言。'
  })
  ctx.guild().middleware(async (session: Session, next) => {//发言阶段
    if (game_off || ann_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (isZhangSelectionInput(session)) return next()
    if (modeInteraction.mode === "turtle") return next()
    const deerSpeakerIndex = player.indexOf(session.userId)
    if (deerSpeakerIndex !== -1 && deerSeatNeedsSelection(order[deerSpeakerIndex])) {
      const ownSeat = String(order[deerSpeakerIndex])
      if (session.content.trimStart().startsWith(ownSeat)) {
        return rejectUnapprovedDeerSpeech(session, '你需要先私聊提交选人并通过主持人审核，才能发言。')
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
          if (zhangSelection?.beforeDeparture) return '请等待“殒阵”结算后再自爆。'
          if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) return ("未到轮次，无法自爆。")
          if (boom_pending) return ("已有玩家自爆了哦，无法再次自爆。")
          boomname = resolvePlayerNickname(session)
          let outcomeText = ''
          recordSelfExplosion(n, str_ann)
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
                recordExplosionOutcome('white-win')
                outcomeText = '白板自爆成功，游戏结束，白板胜利'
                increment = config.scoreWhiteBoomWin
                queueScoreAward(boomname, increment, 'adjudicated-white-boom-win')
                ptsstr += boomname + "加" + increment + "分。"
              }
            }
            else {
              increment = config.scoreGoodBoomNoWin
              recordExplosionOutcome('no-winner')
              sumup += "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
              outcomeText = "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
              for (let i = 0; i < player_copy.length; i++) {
                if ((uc_copy.indexOf(i + 1) !== -1 || i + 1 === white_copy) && !isEmpty(player_copy[i])) {
                  queueScoreAward(player_copy[i], increment, 'adjudicated-good-boom-no-winner')
                  ptsstr += player_copy[i] + "，"
                }
              }
              ptsstr = ptsstr.slice(0, -1)
              ptsstr += "加" + increment + "分。"
            }
          }
          else {
            if (str_bald.indexOf(item1) === -1) {
              beginBoomAdjudication(session, 1)
            }
            else {
              outcomeText = '卧底自爆成功，卧底胜利'
              sumup += "卧底自爆成功，卧底胜利"
              recordExplosionOutcome('undercover-win')
              increment = config.scoreUndercoverWin
              for (let i = 0; i < player_copy.length; i++) {
                if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
                  queueScoreAward(player_copy[i], increment, 'adjudicated-undercover-boom-win')
                  ptsstr += player_copy[i] + "，"
                }
              }
              ptsstr = ptsstr.slice(0, -1)
              ptsstr += "加" + increment + "分。"
              queueScoreAward(boomname, config.scoreUndercoverBoomBonus, 'adjudicated-undercover-boom-bonus')
              ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
            }
          }
          if (boom_pending) {
            // add_flag = false
            notifySession(session, "有玩家自爆，但bot未能匹配到对应词条，请主持人在" + Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) / 60 + "分钟内判断自爆是否成功。（在群里发送“是”或“否”）")
          }
          else {
            await completeGame(session, { kind: 'completed', reason: n === white || uc.includes(n) ? 'self-explosion' : 'rule-no-winner', winner: n === white ? 'white' : uc.includes(n) ? 'undercover' : 'none' },
              { before: { text: outcomeText, label: '加时自爆结算' } })
          }
          return
        }
        add_ann[q] = str_ann
        recordSpeech(session, n, str_ann)
        cancelDeerSpeechClock(n)
        endOvertimeAnn(session)
        return
      }
      else if (!(boom_pending && isGameHost(session.userId))) {
        return next()
      }
    }
    let p = player.indexOf(session.userId)
    let n = order[p]
    if (n > 0 && p !== -1 && str_ann.indexOf(String(n)) === 0) {
      let str_bald = str_ann.replace(String(n), "").replace(regex, "").replace(/[《》·\s]/g, "")
      if (str_bald.indexOf("自爆") === 0) {
        if (!modeInteraction.module.allowsSelfExplosion) return ("本模式不能自爆。")
        if (zhangSelection?.beforeDeparture) return '请等待“殒阵”结算后再自爆。'
        if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) return ("未到轮次，无法自爆。")
        if (boom_pending) return ("已有玩家自爆了哦，无法再次自爆。")
        boomname = resolvePlayerNickname(session)
        let outcomeText = ''
        recordSelfExplosion(n, str_ann)
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
              recordExplosionOutcome('white-win')
              outcomeText = '白板自爆成功，游戏结束，白板胜利'
              increment = config.scoreWhiteBoomWin
              queueScoreAward(boomname, increment, 'direct-white-boom-win')
              ptsstr += boomname + "加" + increment + "分。"
            }
          }
          else {
            increment = config.scoreGoodBoomNoWin
            recordExplosionOutcome('no-winner')
            sumup += "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
            outcomeText = "游戏结束，好人自爆，无人胜利。非好人阵营均加" + increment + "分。"
            for (let i = 0; i < player_copy.length; i++) {
              if ((uc_copy.indexOf(i + 1) !== -1 || i + 1 === white_copy) && !isEmpty(player_copy[i])) {
                queueScoreAward(player_copy[i], increment, 'direct-good-boom-no-winner')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
          }
        }
        else {
          if (str_bald.indexOf(item1) === -1) {
            beginBoomAdjudication(session, 1)
          }
          else {
            sumup += "卧底自爆成功，游戏结束，卧底胜利"
            recordExplosionOutcome('undercover-win')
            outcomeText = '卧底自爆成功，游戏结束，卧底胜利'
            increment = config.scoreUndercoverWin
            for (let i = 0; i < player_copy.length; i++) {
              if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
                queueScoreAward(player_copy[i], increment, 'direct-undercover-boom-win')
                ptsstr += player_copy[i] + "，"
              }
            }
            ptsstr = ptsstr.slice(0, -1)
            ptsstr += "加" + increment + "分。"
            queueScoreAward(boomname, config.scoreUndercoverBoomBonus, 'direct-undercover-boom-bonus')
            ptsstr += boomname + "自爆获胜，额外加" + config.scoreUndercoverBoomBonus + "分。"
          }
        }
        if (boom_pending) {
          notifySession(session, "有玩家自爆，但bot未能匹配到对应词条，请主持人在" + Math.max(10, Number(config.boomAdjudicationTimeout ?? 300) || 300) / 60 + "分钟内判断自爆是否成功。（在群里发送“是”或“否”）")
        }
        else {
          await completeGame(session, { kind: 'completed', reason: n === white || uc.includes(n) ? 'self-explosion' : 'rule-no-winner', winner: n === white ? 'white' : uc.includes(n) ? 'undercover' : 'none' },
            { before: { text: outcomeText, label: '自爆结算' } })
        }
        return
      }
      ann[p] = str_ann
      recordSpeech(session, n, str_ann)
      cancelDeerSpeechClock(n)
      end_ann(session)
    }
    else if (boom_pending && isGameHost(session.userId)) return resolveBoomAdjudication(session, str_ann)
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
    if (deerSeatNeedsSelection(seat)) return rejectUnapprovedDeerSpeech(session, '你需要先私聊提交选词并通过主持人审核，才能补发言。')
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
    const explicitGuess = str_guess.startsWith('猜词')
    if (explicitGuess) str_guess = str_guess.slice(2).replace(/^[\p{P}\p{S}\s]+/u, '')
    else {
      const seat = order[player.indexOf(session.userId)]
      const input = normalizeHeroCommand(session.content)
      const nativeSkill = seat === heros[HERO.WEI_ZHONG_XIAN]
        && (weiZhongXianModule.classifySlander(input)
          || /^(?:(?:缉访|缉|访|查)(?:1|2[0-9]+)|弃(?:缉访|缉|访|查))$/u.test(input))
        || seat === heros[HERO.YUAN_CHONG_HUAN]
          && /^(?:守[0-9]+|弃守|专镇)$/u.test(input)
        || seat === heros[HERO.DUO_ER_GUN]
          && /^(?:立[0-9]+|保[0-9]+弃[0-9]+|弃[0-9]+保[0-9]+)$/u.test(input)
        || seat === heros[HERO.ZHU_YOU_XIAO]
          && /^(?:(?:放权|放|传弟|传|传弟选)[0-9]+|放弃放权|弃放权|弃放|弃传弟)$/u.test(input)
      const proxy = zhuYouXiaoVotes.current
      const delegatedSkill = !vote_off && proxy?.delegateSeat === seat
        && /^(?:代(?:投)?(?:[0-9]+|弃|弃权)|代伐[0-9]*)$/u.test(input)
      const ownMark = !vote_off && /^伐[0-9]*$/u.test(input)
      const pendingPrivate = pendingSkillsFor(session.userId).some(action => action.channel.scope === 'private')
      const zhangSelfVote = seat === heros[HERO.ZHANG_XIAN_ZHONG] && str_guess === String(seat)
        && isReceivingRegularVotes() && !add_flag && vote_num[seat - 1] > 0
      if (nativeSkill || delegatedSkill || ownMark || pendingPrivate || zhangSelfVote) return next()
    }
    if (str_guess === "是" || str_guess === "否") return next()
    if (str_guess === item1 || str_guess === item2) return zhangSelection?.beforeDeparture
      ? '请等待“殒阵”结算后再猜词。' : recruitWhite(session, str_guess)
    if (!explicitGuess && (str_guess === '弃' || str_guess === '弃权' || !isEmpty(Number(str_guess)))) return next()
    if (whiteGuessNotifications && str_guess) {
      const request: WhiteGuessRequest = { id: ++whiteGuessSequence, epoch: gameTimers.epoch, seat: white,
        userId: session.userId, text: str_guess, references: new Set() }
      whiteGuessRequests.set(request.id, request)
      const content = `${white}号玩家${player_name[order.indexOf(white)]}（白板）猜人：${str_guess}，未匹配好人或卧底词条。`
        + `\n若认可猜中，请引用本条回复“好人”或“卧底”；也可发送“白板判定${request.id}好人/卧底”。可发送“关闭白板通知”停止后续通知。`
      for (const host of gameHostIds()) await messages.state('白板猜词主持通知', async () => {
        const ids = await session.bot.sendPrivateMessage(host, content)
        for (const id of ids) request.references.add(host + ':' + id)
      })
    }
    return '未匹配好人或卧底词条，继续加油~'
  })
  async function recruitWhite(session: Session, str_guess: string, manualGuess?: string) {
    if (game_off || !flag_white || !order.includes(white)) return
    const whiteUserId = player[order.indexOf(white)]
    if (manualGuess) capture(r => r.outcome(`主持人认可白板${white}号玩家${player_name[order.indexOf(white)]}猜词“${manualGuess}”，加入${str_guess === item1 ? '好人' : '卧底'}阵营。`))
    whiteGuessRequests.clear()
    if (str_guess === item1) {
      capture(r => r.camp(white, 'good'))
      flag_white = false
      sumup += "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出好人词条" + item1 + "，加入好人阵营。\n"
      notifyPrivate(session, whiteUserId, "恭喜猜中，成功加入好人或卧底阵营。\n雷点：" + instr1, '白板加入阵营通知')
      notifyPrivate(session, hostid, "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出好人词条" + item1 + "，加入好人阵营。", "白板加入好人主持人通知")
      white = 0
      white_copy = 0
      if (isEmpty(uc) && !flag_white) {
        sumup += "游戏结束，好人胜利。"
        if (round > uc_copy.length + (white_copy === 0 ? 0 : 1) || player_copy.length - player.length - kickout.length > uc_copy.length + (white_copy === 0 ? 0 : 1)) { increment = config.scoreGoodWin }
        else { increment = config.scoreGoodWinSpeedrun }
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) === -1 && i + 1 !== white_copy && !isEmpty(player_copy[i])) {
            queueScoreAward(player_copy[i], increment, 'vote-good-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        await completeGame(session, { kind: 'completed', reason: 'recruitment', winner: 'good' },
          { after: { text: '游戏结束，好人胜利。', label: '白板招安后好人胜利通知' } })
      }
      return
    }
    else if (str_guess === item2) {
      capture(r => r.camp(white, 'undercover'))
      uc.push(white)
      uc_copy.push(white)
      flag_white = false
      sumup += "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出卧底词条" + item2 + "，加入卧底阵营。\n"
      notifyPrivate(session, whiteUserId, "恭喜猜中，成功加入好人或卧底阵营。\n雷点：" + instr2, '白板加入阵营通知')
      notifyPrivate(session, hostid, "白板" + white + "号玩家" + player_name[order.indexOf(white)] + "成功猜出卧底词条" + item2 + "，加入卧底阵营。", "白板加入卧底主持人通知")
      white = 0
      white_copy = 0
      if (player.length < 2 * uc.length || (player.length === 2 && uc.length === 1)) {
        sumup += "游戏结束，卧底胜利。"
        increment = config.scoreUndercoverWin
        for (let i = 0; i < player_copy.length; i++) {
          if (uc_copy.indexOf(i + 1) !== -1 && !isEmpty(player_copy[i])) {
            queueScoreAward(player_copy[i], increment, 'vote-undercover-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        await completeGame(session, { kind: 'completed', reason: 'recruitment', winner: 'undercover' },
          { after: { text: '游戏结束，卧底胜利。', label: '白板招安后卧底胜利通知' } })
      }
      return
    }
  }
  const grantLiZiChengReward = (session: Session) => {
    const earned = liRewardSnapshot
    if (!earned || earned.serial === liRewardedSerial || !liZiChengModule.hasRewardPending(heroState)) return
    const liSeat = heros[HERO.LI_ZI_CHENG]
    const reward = earned.weight
    const liIndex = order.indexOf(liSeat)
    fa[liSeat - 1] += reward
    liZiChengModule.consumeRewardPending(heroState)
    liRewardedSerial = earned.serial
    liRewardSnapshot = undefined
    notifyPrivate(session, player[liIndex], "闯王，本次投票您获得" + reward + "个伐标记。您现在共有" + fa[liSeat - 1] + "个伐标记。", "李自成伐标记通知")
    sumup += liSeat + "号玩家" + player_name[liIndex] + "获得" + reward + "个伐标记。"
    recordSkill(HERO.LI_ZI_CHENG, '获得' + reward + '个“伐”标记', [], undefined, { sequence: earned.sequence, timing: 'round-end' })
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
            queueScoreAward(player_copy[i], increment, 'overtime-undercover-win')
            ptsstr += player_copy[i] + "，"
          }
        }
        ptsstr = ptsstr.slice(0, -1)
        ptsstr += "加" + increment + "分。"
        stalemate.reset()
        await completeGame(session, { kind: 'completed', reason: 'stalemate', winner: 'undercover' },
          { after: { text: '连续两轮平安夜且满足僵局条件，游戏结束，卧底胜利。', label: '僵局卧底胜利通知' } })
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
      queueScoreAward(player_copy[white - 1], increment, 'vote-white-win')
      ptsstr += player_copy[white - 1] + "加" + increment + "分。"
      await completeGame(session, { kind: 'completed', reason: 'white-survival', winner: 'white' },
        { after: { text: '游戏结束，白板胜利。', label: '白板苟赢通知' } })
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
    ordered = false,
  ) => {
    const eliminatedIndex = elimination.activeSeats.indexOf(elimination.targetSeat)
    if (!add_flag) add_vote.push([])
    else add_flag = false
    stalemate.reset()
    const eliminationText = publicHeroEliminationText(
      elimination.targetSeat,
      "本轮" + elimination.targetSeat + "号玩家" + player_name[eliminatedIndex],
      "出局。",
    )
    if (!ordered) notifyGroup(session, eliminationText, "投票出局通知")
    sumup += "第" + round + "轮" + eliminationText.slice(2) + "\n"
    return eliminationText
  }

  interface VoteEliminationPipelineContext {
    session: Session
    elimination: EliminationContext
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
    resumedAfterZhang = false,
  ): Promise<VoteEliminationResolution> => {
    // The vote protection is already settled. Only the target's departure
    // can be deferred, so keep the protection visible even if the carry wins.
    if (!isEmpty(str_shield)) {
      notifyGroup(session, str_shield + '因武将技能，免于参与加时。', '投票保护通知')
      sumup += str_shield + '因武将技能，免于参与加时。\n'
    }
    if (!resumedAfterZhang && deferZhangDeparture(session, elimination, async current => {
      const result = await resolveVoteElimination(current, snapshotEliminationContext({ ...elimination, activeSeats: order }), '', true)
      if (result.control.kind !== 'game-end' && !game_off) completeVoteResolutionState(current)
    })) return { control: pauseResolution(ResolutionCursor.Eliminate), postEliminationControl: continueResolution() }
    const context: VoteEliminationPipelineContext = {
      session,
      elimination,
      postEliminationControl: continueResolution(),
    }
    const result = await runResolutionPipeline({
      context,
      order: VOTE_ELIMINATION_PIPELINE,
      trace: traceResolution("vote-elimination"),
      handlers: {
        [ResolutionCursor.Eliminate]: async (current) => {
          const notice = announceVoteElimination(
            current.session,
            current.elimination,
            resumedAfterZhang,
          )
          removeVoteEliminationTarget(current.elimination)
          if (resumedAfterZhang) notifyGroup(current.session, notice, '投票出局通知')
          return continueResolution()
        },
        [ResolutionCursor.CheckVictory]: (current) => {
          if (game_off || gameTimers.epoch !== elimination.gameEpoch) return endResolution()
          // Zhang can still take the white player with him. Only the white
          // survival result waits for that choice; other victory checks keep
          // their established order, including the fewer-than-three rule.
          return resolveEliminationVictory(current.session, whiteSurvivalSettlementPending
            && (resumedAfterZhang || postEliminationHero(current.elimination.targetSeat, heros, 'vote') !== 'zhang-xian-zhong'))
        },
        [ResolutionCursor.PostElimination]: async (current) => {
          if (!resumedAfterZhang) current.postEliminationControl = await resolveVotePostEliminationEffect(
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
    if (postEliminationHero(outplayer, heros, 'vote') === "zhu-you-xiao") {
      beginZhuYouXiaoHeirTarget(session, outplayer)
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
    pendingAction.clear("zhu-you-xiao-proxy-vote")
    recoverablePendingPrompts.delete("zhu-you-xiao-proxy-vote")
    // The phase has been fully recorded and no longer accepts delegation.
    // Keep the historical successful-delegate records, but drop the live
    // owner/delegate relation before the next speech or roster change.
    clearZhuYouXiaoPhase(zhuYouXiaoVotes)
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
    // Read the last accepted choice atomically, before publishing the poll.
    // This does not reopen ordinary ballots during Mao/Huang waits.
    weiInquiryWindow = null
    whiteSurvivalSettlementPending = flag_white && white_only
      && (!add_flag || add_indices.some(index => order[index] === white))
    const historyEntries = frozenVoteFacts
    const zhangSeat = heros[HERO.ZHANG_XIAN_ZHONG]
    if (order.includes(zhangSeat)) {
      const level = zhangXianZhongModule.settleVote(heroState, zhangSeat, votePhaseSerial, historyEntries)
      if (level !== undefined) {
        notifyPrivate(session, player[order.indexOf(zhangSeat)], `因“诈降”，你的“殒阵”升至${level}级。`, '殒阵升级通知')
        recordSkill(HERO.ZHANG_XIAN_ZHONG, `因“诈降”将“殒阵”升至${level}级`, [], undefined, { timing: 'resolution' })
      }
    }
    const delegatedEntry = historyEntries.find(entry => entry.deciderSeat !== undefined)
    const delegatedSeat = delegatedEntry ? { owner: delegatedEntry.voterSeat, decider: delegatedEntry.deciderSeat! } : null
    const weiSeat = weiZhongXianSeat()
    if (order.includes(weiSeat)) {
      const weiEntry = historyEntries.find(entry => entry.voterSeat === weiSeat)
      if (weiEntry?.targetSeat !== null && weiEntry?.targetSeat !== undefined) {
        weiZhongXianModule.recordVoteCandidate(heroState, votePhaseSerial, weiEntry.targetSeat)
      }
      for (const entry of historyEntries) {
        if (entry.targetSeat !== null && entry.targetSeat !== undefined) {
          weiZhongXianModule.recordAttack(heroState, entry.voterSeat, entry.targetSeat, weiSeat)
        }
      }
      resolveWeiInquiry(session, historyEntries)
    }
    if (delegatedSeat) {
      const { owner: ownerSeat, decider: successfulDelegateSeat } = delegatedSeat
      const ownerIndex = order.indexOf(ownerSeat)
      const delegateIndex = order.indexOf(successfulDelegateSeat)
      if (ownerIndex !== -1 && delegateIndex !== -1) {
        sumup += ownerSeat + "号玩家" + player_name[ownerIndex] + "将本次"
          + (add_flag ? "加时" : "") + "投票交给" + successfulDelegateSeat
          + "号玩家" + player_name[delegateIndex] + "代投。\n"
        recordSkill(HERO.ZHU_YOU_XIAO, "放权给" + successfulDelegateSeat + "号玩家代投", [successfulDelegateSeat])
      }
    }
    capture(r => r.vote(historyEntries, order.map((seat, i) => ({ seat, count: poll[i] })), true,
      [...anonymousVoteContributions].map(([seat, count]) => ({ seat, count }))))
    const linPrevented = historyEntries.filter(entry => entry.invalidReasons?.includes('lin-dan-han-protection'))
    const linMutual = historyEntries.some(entry => entry.invalidReasons?.includes('lin-dan-han-mutual'))
    if (linPrevented.length || linMutual) {
      const attackers = linPrevented.map(entry => entry.voterSeat)
      recordSkill(HERO.LIN_DAN_HAN,
        `避实抵消${linPrevented.reduce((sum, entry) => sum + entry.weight, 0)}票${linMutual ? '；本人投票失效' : ''}`,
        attackers)
    }
    gameTimers.cancel(timer_hurry)
    gameTimers.cancel(timer_vote)
    flag_just_vote = false
    weiZhongXianModule.completeVotePhase(heroState, votePhaseSerial)
    voteFactStage = 'published'
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
        queueScoreAward(player_copy[white - 1], increment, 'overtime-white-win')
        ptsstr += player_copy[white - 1] + "加" + increment + "分。"
        annstr = "本轮发言结果：\n"
        vstr = "本轮投票结果：\n"
        await completeGame(session, { kind: 'completed', reason: 'white-survival', winner: 'white' },
          { after: { text: '白板未参与加时，游戏结束，白板胜利。', label: '白板未参与加时胜利通知' } })
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
      if (eliminationResolution.control.kind !== "continue") {
        return eliminationResolution.control
      }
      postEliminationControl = eliminationResolution.postEliminationControl
    }
    completeVoteResolutionState(session)
    return postEliminationControl
  }
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//魏忠贤诬诽
    if (game_off || !matchesActiveSession(session)) return next()
    const weiSeat = weiZhongXianSeat()
    const weiIndex = order.indexOf(weiSeat)
    if (weiIndex === -1 || session.userId !== player[weiIndex]) return next()
    if (!weiZhongXianModule.classifySlander(session.content)) return next()
    if (!weiZhongXianModule.isSlanderAvailableForSeat(heroState, weiSeat, weiSeat)) {
      return "诬诽已经发动过了；当前没有可用的“诬诽”次数。"
    }
    const beforeFa = fa[weiSeat - 1]
    const previousRelations = new Set(heroState.weiZhongXian.slanderRelations)
    const affectedSeats = weiZhongXianModule.activateSlanderForSeat(heroState, weiSeat, weiSeat)
    if (affectedSeats === null) return "当前无法发动“诬诽”。"
    const changedSeats = affectedSeats.filter(seat => !weiActualDifferent(weiSeat, seat) && !previousRelations.has(seat))
    const retroactiveTargets = retroactivelyAwardWeiZhongXianCandidates(session, changedSeats)
    const gainedFa = fa[weiSeat - 1] - beforeFa
    const affectedText = affectedSeats.length
      ? affectedSeats.map(seat => `${seat}号玩家${player_copy[seat - 1] ?? ""}`).join("、")
      : "无"
    const changedText = changedSeats.length
      ? changedSeats.map(seat => `${seat}号玩家${player_copy[seat - 1] ?? ""}`).join("、")
      : "无"
    const retroactiveText = retroactiveTargets.length
      ? `追溯第${retroactiveTargets.map(target => `${target.phaseSerial}次投票所投的${target.targetSeat}号玩家${player_copy[target.targetSeat - 1]}出局`).join("、")}，补足${retroactiveTargets.length}次“伐异”。`
      : "没有追溯补足“伐异”。"
    recordSkill(HERO.WEI_ZHONG_XIAN, `发动“诬诽”，影响范围：${affectedText}；其中视为异阵营：${changedText}。${retroactiveText}本次新增${gainedFa}个“伐”标记`, affectedSeats,
      { kind: 'wei-slander', affectedSeats, changedSeats, retroactiveVotes: retroactiveTargets, gainedFa })
    sumup += `${weiSeat}号玩家${player_copy[weiSeat - 1]}（魏忠贤）发动“诬诽”，影响范围：${affectedText}；其中视为异阵营：${changedText}。${retroactiveText}\n`
    notifySession(
      session,
      weiZhongXianModule.formatSlanderNotice(
        affectedSeats.map(seat => ({ seat, name: player_copy[seat - 1] ?? "" })),
        gainedFa,
        fa[weiSeat - 1],
      ),
      "魏忠贤诬诽私聊通知",
    )
    return
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//魏忠贤缉访
    if (game_off || !matchesActiveSession(session)) return next()
    const inquiryInput = weiZhongXianModule.classifyInquiry(session.content)
    if (inquiryInput.kind === "ignore") return next()
    const weiSeat = weiZhongXianSeat()
    const weiIndex = order.indexOf(weiSeat)
    if (weiIndex === -1 || session.userId !== player[weiIndex]) return next()
    if (!isWeiInquiryWindowOpen()) return voteFactStage === 'published' && heroState.weiZhongXian.phaseSerial === votePhaseSerial
      ? "本次票数已公开，不能再使用“缉访”。" : "请在投票阶段使用“缉访”；票数公开前可修改或放弃。"
    if (inquiryInput.kind === "invalid-option") return "请发送“缉访1”或“缉访2+座位号”，也可使用“缉1/访1/查1”和对应的2号格式。"
    if (inquiryInput.kind === "invalid-target") return "缉访选项2需要附带一个有效的玩家序号。"
    if (inquiryInput.kind === "abandon") {
      weiZhongXianModule.clearInquiry(heroState.weiZhongXian)
      recordSkill(HERO.WEI_ZHONG_XIAN, '放弃本次缉访')
      await decideVoteSkill(session, weiSeat)
      return "已放弃本次缉访。"
    }
    if (heroState.weiZhongXian.phaseSerial !== votePhaseSerial) {
      return "当前投票阶段还未建立缉访窗口，请稍后重试。"
    }
    if (inquiryInput.kind === "vote-target" && !weiCanVoteCurrentPhase()) {
      return "你在本次投票阶段不能投票，无法使用缉访选项1；可以选择选项2。"
    }
    if (inquiryInput.kind === "voted-by") {
      const targetSeat = inquiryInput.targetSeat
      const targetIndex = order.indexOf(targetSeat)
      if (targetIndex === -1) return "缉访对象必须是在场玩家。"
      if (weiCurrentBallotTarget() === targetSeat) return "缉访选项2不能选择你本次投票的对象。"
      const voterIds = add_flag ? add_voter : player
      const targetIsVoter = voterIds.includes(player[targetIndex])
      const targetIsOvertimeCandidate = add_flag && add_indices.includes(targetIndex)
      if (!targetIsVoter && targetSeat !== weiSeat
        && !(targetIsOvertimeCandidate && weiCanVoteCurrentPhase())) {
        return "该玩家本次没有可查询的投票记录，请选择仍在本阶段投票名单中的玩家。"
      }
      if (add_flag && !weiCanVoteCurrentPhase() && targetIsOvertimeCandidate && targetSeat !== weiSeat) {
        return "魏忠贤本次加时不能投票时，不能查询同样未参与投票的候选玩家。"
      }
    }
    weiZhongXianModule.setInquiry(heroState, votePhaseSerial, inquiryInput)
    recordSkill(HERO.WEI_ZHONG_XIAN, inquiryInput.kind === 'vote-target'
      ? '选择缉访选项1，等待本次投票结算' : '选择缉访选项2，等待本次投票结算',
      inquiryInput.kind === 'voted-by' ? [inquiryInput.targetSeat] : [])
    await decideVoteSkill(session, weiSeat)
    if (inquiryInput.kind === "vote-target") return "已选择缉访选项1，投票结算时私聊告知结果。"
    return `已选择缉访选项2，目标为${inquiryInput.targetSeat}号玩家；投票结算时私聊告知结果。`
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//朱由校放权与代投
    if (game_off || !matchesActiveSession(session)) return next()
    const nativeOwnerSeat = heros[HERO.ZHU_YOU_XIAO]
    const nativeOwner = session.userId === player_id_copy[nativeOwnerSeat - 1]
    const explicitInput = normalizeHeroCommand(session.content)
    if (nativeOwner && /^(?:(?:传弟|传|传弟选)[0-9]+|弃传弟)$/u.test(explicitInput)
      && !pendingAction.matches('zhu-you-xiao-heir-target', { userId: session.userId, scope: 'private', gameEpoch: gameTimers.epoch })) {
      return order.includes(nativeOwnerSeat) ? '传弟需在你出局后发动。' : '当前没有等待选择的“传弟”。'
    }
    const current = zhuYouXiaoVotes.current
    if (nativeOwner && /^(?:(?:放权|放)[0-9]+|放弃放权|弃放权|弃放)$/u.test(explicitInput)
      && (vote_off || current?.ownerSeat == null)) {
      return vote_off ? ann_off && (voteFactStage === 'counting' || voteFactStage === 'published')
        ? '本次投票已结束，不能再修改放权。' : '请在投票阶段使用“放权”。'
        : '你在本次投票阶段无需投票，不能发动“放权”。'
    }
    if (vote_off) return next()
    if (!current || current.serial !== votePhaseSerial || current.ownerSeat === null) return next()
    const ownerSeat = current.ownerSeat
    const ownerIndex = order.indexOf(ownerSeat)
    const ownerUserId = ownerIndex === -1 ? undefined : player[ownerIndex]
    if (session.userId === ownerUserId) {
      const delegation = classifyDelegationInput({
        content: session.content,
        activeSeats: order,
        ownerSeat,
      })
      if (delegation.kind === "ignore") return next()
      if (voteSettlement.isRunning(currentVoteSettlementKey())) {
        return "投票正在结算，请稍候。"
      }
      if (delegation.kind === "invalid-target") return "放权对象必须是在场的其他玩家。"
      if (delegation.kind === "self-forbidden") return "朱由校不能将投票权交给自己。"
      if (lockedVoteSeats.has(votePhaseKey(ownerSeat))) {
        return "本次投票结果已经锁定，不能再修改放权或投票。"
      }
      const overtime = add_flag
      voteOpportunity?.decidedSeats.add(ownerSeat)
      if (delegation.kind === "abandon") {
        const previous = current.delegateSeat
        clearZhuYouXiaoBallot(ownerSeat, overtime, true, false)
        setZhuYouXiaoDelegate(zhuYouXiaoVotes, null)
        rebuildPollFromBallots()
        recordSkill(HERO.ZHU_YOU_XIAO, '放弃本次放权')
        pendingAction.clear("zhu-you-xiao-proxy-vote")
        if (previous !== null && order.includes(previous)) {
          notifyPrivate(session, player[order.indexOf(previous)], "本次代投已取消，之前的代投票已作废，无需再代投。"
            + delegationOwnBallotText(previous, ownerSeat, true), "朱由校放弃放权通知")
        }
        const closed = await finishVoteIfReady(session)
        return closed ? '已放弃放权；本次投票已进入结算。' : '已放弃放权，可自行投票。'
      }
      const previous = current.delegateSeat
      clearZhuYouXiaoBallot(ownerSeat, overtime, true, false)
      setZhuYouXiaoDelegate(zhuYouXiaoVotes, delegation.seat)
      rebuildPollFromBallots()
      recordSkill(HERO.ZHU_YOU_XIAO, '指定放权对象，等待代投', [delegation.seat])
      pendingAction.clear("zhu-you-xiao-proxy-vote")
      if (previous !== null && previous !== delegation.seat && order.includes(previous)) {
        notifyPrivate(session, player[order.indexOf(previous)], "本次代投已取消，之前的代投票已作废，无需再代投。"
          + delegationOwnBallotText(previous, ownerSeat, true), "朱由校更改放权通知")
      }
      const delegateIndex = order.indexOf(delegation.seat)
      const delegateUserId = player[delegateIndex]
      if (await finishVoteIfReady(session) || !isReceivingRegularVotes()) {
        return `已放权给${delegation.seat}号玩家${player_copy[delegation.seat - 1]}；本次投票已进入结算。`
      }
      const delegatePrompt = delegationPrompt(delegation.seat, ownerSeat, previous === delegation.seat)
      pendingAction.open({
        kind: "zhu-you-xiao-proxy-vote",
        ownerSeat: delegation.seat,
        ownerUserId: delegateUserId,
        channel: { scope: "private" },
        blocksRosterChanges: false,
        gameEpoch: gameTimers.epoch,
        timeoutMs: null,
        resumeAt: ResolutionCursor.FinalizeVote,
      })
      sendRecoverablePrivatePrompt(session, {
        kind: "zhu-you-xiao-proxy-vote",
        userId: delegateUserId,
        content: delegatePrompt,
      })
      return "已放权给" + delegation.seat + "号玩家" + player_name[delegateIndex] + "，等待对方代投；如需收回请发送“弃放权”或“弃放”。"
    }

    const proxyFaInput = normalizeHeroCommand(session.content)
    if (proxyFaInput.startsWith('代伐')) {
      if (current.delegateSeat === null || player[order.indexOf(current.delegateSeat)] !== session.userId) return '当前没有玩家将本阶段投票权交给你。'
      if (zhuYouXiaoOwnerIsEligible(add_flag) === null) return '朱由校本阶段无需投票，不能使用代伐。'
      if (voteSettlement.isRunning(currentVoteSettlementKey()) || lockedVoteSeats.has(votePhaseKey(ownerSeat))) return '本次投票正在结算或已锁定，不能再使用代伐。'
      const amount = parseHeroNumber(proxyFaInput.slice(2))
      if (!Number.isSafeInteger(amount) || amount <= 0) return '请发送“代伐+数字”指定使用数量。'
      if (amount > fa[ownerSeat - 1]) return `朱由校当前只有${fa[ownerSeat - 1]}个“伐”，无法使用更多。`
      fa[ownerSeat - 1] -= amount
      flag_fa[ownerSeat - 1] += amount
      vote_num[ownerSeat - 1] += amount
      rebuildPollFromBallots()
      notifySession(session, `本次朱由校的投票数将增加${flag_fa[ownerSeat - 1]}票，共投${vote_num[ownerSeat - 1]}票。\n剩余伐数：${fa[ownerSeat - 1]}`)
      sumup += `${ownerSeat}号玩家${player_copy[ownerSeat - 1]}由${current.delegateSeat}号玩家代用${amount}个伐。\n`
      recordSkill(HERO.ZHU_YOU_XIAO,
        `发动“放权”，由${current.delegateSeat}号玩家${player_copy[current.delegateSeat - 1]}代为使用${amount}个“伐”标记，本次投票数增加${amount}票`)
      await finishVoteIfReady(session)
      return
    }
    const proxy = classifyProxyVoteInput({
      content: session.content,
      activeSeats: order,
      ownerSeat,
    })
    if (proxy.kind === "ignore") return next()
    const delegateIndex = player.indexOf(session.userId)
    const delegateSeat = delegateIndex === -1
      ? null
      : order[delegateIndex]
    if (current.delegateSeat === null || delegateSeat !== current.delegateSeat) {
      return "当前没有玩家将本阶段投票权交给你。"
    }
    if (proxy.kind === "invalid-target") return "代投对象必须是在场且符合朱由校可投票范围的玩家。"
    if (proxy.kind === "self-forbidden") return "朱由校不能投给自己，请重新发送代投对象。"
    return await zhuYouXiaoRecordProxyBallot(session, proxy.kind === "abstain" ? 0 : proxy.seat)
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//投票阶段
    if (game_off || !matchesActiveSession(session)) return next()
    if (isGameHost(session.userId)) return next()
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
    let str_vote = session.content.replace(/\s/g, "")
    const heroVote = normalizeHeroCommand(session.content)
    if (session.userId === player[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])]
      && /^(?:守|弃守|专镇)/u.test(heroVote) && !quan_continue && !mao_continue) return next()
    if (!quan_continue && !mao_continue && voteSettlement.isRunning(currentVoteSettlementKey())) {
      return "投票正在结算，请稍候。"
    }
    const zhuYouXiaoOwner = zhuYouXiaoCurrentOwner()
    if (zhuYouXiaoOwner !== null
      && zhuYouXiaoVotes.current?.delegateSeat !== null
      && player[order.indexOf(zhuYouXiaoOwner)] === session.userId) {
      return "本次投票已放权给其他玩家，请等待对方发送“代投+序号”或“代+序号”；如需自行投票请先发送“弃放权”或“弃放”。"
    }
    if (session.userId === player[order.indexOf(heros[HERO.DUO_ER_GUN])] && (heroVote.startsWith("立") || /^(?:保|弃)/u.test(heroVote) && /保/u.test(heroVote) && /弃/u.test(heroVote)) && !quan_continue && !mao_continue) return next()
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
    if (player.indexOf(session.userId) !== -1 && /^伐[0-9]*$/u.test(heroVote) && (!add_flag || add_indices.indexOf(player.indexOf(session.userId)) === -1) && !quan_continue) {
      let o = order[player.indexOf(session.userId)]
      let n_fa = parseHeroNumber(heroVote.slice(1) || "1")
      if (!isEmpty(n_fa) && n_fa > 0) {
        if (lockedVoteSeats.has(votePhaseKey(o))) return ("本次投票结果已经锁定，不能再使用伐修改投票。")
        if (fa[o - 1] === 0) return ("你目前没有伐，无法使用伐。")
        if (n_fa > fa[o - 1]) return ("你目前只有" + fa[o - 1] + "个伐，无法使用更多的伐。")
        else {
          fa[o - 1] -= n_fa
          vote_num[o - 1] += n_fa
          flag_fa[o - 1] += n_fa
          if (!mao_continue) rebuildPollFromBallots()
          notifySession(session, "本次投票你的投票数将会增加" + flag_fa[o - 1] + "票。\n本次投票你投" + vote_num[o - 1] +"票。\n剩余伐数：" + fa[o - 1])
          sumup += o + "号玩家" + player_name[order.indexOf(o)] + "消耗" + n_fa + "个伐，使自己本次投票数增加" + n_fa + "。\n"
          queueHostSkillNotice(o, `使用${n_fa}个“伐”标记，本次投票数增加${n_fa}票`, [])
          if (!mao_continue) await finishVoteIfReady(session)
          return
        }
      }
    }
    if (!quan_continue && !mao_continue) {
      const overtime = add_flag
      const voterIds = overtime ? add_voter : player
      const ballots = overtime ? add_vote[round - 1] : vote[round - 1]
      const activeIndex = player.indexOf(session.userId)
      const ballotIndex = voterIds.indexOf(session.userId)
      if (activeIndex === -1 || ballotIndex === -1) return overtime
        ? "你未参加游戏，或已出局，或加时阶段与他人平票，无法投票。"
        : "你未参加游戏或已出局，无法投票。"
      const seat = order[activeIndex]
      if (seat === heros[HERO.MAO_WEN_LONG]) return "毛帅莫急，且待塘报至再做决断。"
      if (vote_num[seat - 1] === 0) return "因武将技能，你已跳过本次投票阶段。"
      const target = str_vote === "弃" || str_vote === "弃权" ? 0 : Number(str_vote)
      if (target === 0 && str_vote !== '弃' && str_vote !== '弃权') return "无效的投票语句，请重新输入。"
      if (target !== 0 && !getVotableTargets(seat).includes(target)) {
        if (seat === heros[HERO.LIN_DAN_HAN] && order.includes(target)
          && !linDanHanModule.votableTargets(heroState, [target]).includes(target)) {
          return "可汗，由于您之前西迁，不能再投票给" + target + "号玩家" + player_copy[target - 1] + "。"
        }
        return "无效的投票语句，请重新输入。"
      }
      if (!Number.isSafeInteger(target) || !str_vote) return "无效的投票语句，请重新输入。"
      const firstBallot = isEmpty(ballots[ballotIndex])
      ballots[ballotIndex] = target
      voteOpportunity?.decidedSeats.add(seat)
      rebuildPollFromBallots()
      const invalidNotice = currentBallotEffects.find(effect => effect.voterSeat === seat)
        ?.invalidReasons.includes('zhu-you-xiao-delegation')
        ? "你的自有票已记录；因本次放权关系，这张投给朱由校的票将失效。" : ''
      const receipt = firstBallot
        ? notifications.voteFirstSuccessReceipt ? "投票已记录；在本轮结算开始前，你仍可改票。" : ''
        : "已改票。"
      if (receipt || invalidNotice) notifySession(session, [receipt, invalidNotice].filter(Boolean).join("\n"))
      if (flag_notify) notifyPrivate(session, hostid,
        seat + "号玩家" + player_name[activeIndex] + (firstBallot ? '' : '改票，')
          + (target === 0 ? "弃权。" : "投给了" + target + "号玩家" + player_copy[target - 1] + "。"),
        "实时投票通知")
      if (target > 0) warnWeiInquiryConflict(session, target)
      if (!overtime && seat === heros[HERO.HUANG_TAI_JI] && target > 0) {
        notifySession(session, "谨遵陛下旨意，如果在第" + (round + 1) + "轮发言开始前，" + target
          + "号玩家" + player_copy[target - 1] + "出局，则陛下可以获得一个“权”标记。")
      }
      await finishVoteIfReady(session)
      return
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
        else recordSkill(HERO.HUANG_TAI_JI, '放弃本次减票')
        await resumeHuangTaiJiQuan(session, "input", choice.kind === "apply")
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
    }
    return
  })
  kickActivePlayer = async (session, outcast, cause) => {
    const out_index = order.indexOf(outcast)
    if (out_index === -1) return "missing"
    if (isRosterChangeBlocked()) return "blocked"
    const epoch = gameTimers.epoch
    const guildId = gameRoute.guildId
    const out_player = player[out_index]
    const out_name = player_name[out_index]
    const voteSnapshot = !vote_off ? captureVoteRoster() : null
    // `splice_player()` clears a live delegated ballot when its delegate leaves.
    // The roster snapshot is intentionally captured before that mutation so
    // ordinary ballots can be retained across the seat removal, but replaying
    // it must not resurrect the proxy ballot that was just invalidated. Keep
    // the owner identity while the fixed-seat roster still contains it and
    // remove only that owner's ballot from the snapshot before reconciliation.
    const delegatedOwnerUserId = (() => {
      const delegation = zhuYouXiaoVotes.current
      if (!delegation || delegation.delegateSeat !== outcast || delegation.ownerSeat === null) return null
      const ownerIndex = order.indexOf(delegation.ownerSeat)
      return ownerIndex === -1 ? null : player[ownerIndex]
    })()
    const reconciliationSnapshot = voteSnapshot && delegatedOwnerUserId !== null
      ? {
          voterIds: voteSnapshot.voterIds.slice(),
          ballots: voteSnapshot.ballots.map((ballot, index) =>
            voteSnapshot.voterIds[index] === delegatedOwnerUserId
              ? undefined as unknown as number
              : ballot),
        }
      : voteSnapshot
    kickout.push(outcast)
    const reason = cause === "host"
      ? "被主持人踢出"
      : cause === "selection-timeout"
        ? "选人超时，被自动踢出"
        : cause === 'makeup-timeout' ? '补发言超时，被自动踢出' : "主动退出游戏"
    sumup += outcast + "号玩家" + out_name + reason + "。\n"
    historyDepartureReasons.set(outcast, cause === 'host' ? 'kick' : cause === 'selection-timeout' || cause === 'makeup-timeout' ? 'timeout' : 'self-exit')
    const publicReason = cause === 'selection-timeout' && deerProgressPrivate() ? '被自动踢出' : reason
    const endsOvertimeVote = !!reconciliationSnapshot && add_flag && add_indices.includes(out_index)
    splice_player(outcast, true, true)
    boom_pending = false
    let voteChange: ReturnType<typeof rebaseVoteRoster> | undefined
    if (endsOvertimeVote) {
      // This vote is being cancelled, not settled with a shifted candidate list.
      vote_off = true
      voteFactStage = 'none'
      weiInquiryWindow = null
      clearVoteOpportunity()
    } else if (reconciliationSnapshot) {
      if (add_flag) add_indices = add_indices.map(index => index > out_index ? index - 1 : index)
      voteChange = rebaseVoteRoster(session, reconciliationSnapshot)
    }
    notifyGroup(session, outcast + "号玩家" + out_name + publicReason + "。", "玩家离场通知", guildId)
    const control = await resolveEliminationVictory(session, whiteSurvivalSettlementPending)
    if (control.kind === 'game-end' || game_off || epoch !== gameTimers.epoch) return "removed"
    if (modeInteraction.mode === "deer") syncDeerHostReviewClock(session, false)
    if (voteChange) {
      await announceVoteRosterChange(session, outcast + "号玩家已被踢出", voteChange)
      return "removed"
    }
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
    else if (endsOvertimeVote) {
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
    if (!gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_host = session.content.replace(/\s/g, "")
    if (terminalSettlement) {
      if (!(session.user.authority >= 2 || isGameHost(session.userId))
        || !['停止卧底', '中止卧底', '终止卧底', '结束卧底'].includes(str_host)) return next()
      if (Date.now() < terminalSettlement.deadline) return '本局已确定胜负，正在结算，不能改为中止。'
      terminalSettlement.finish()
      return '已释放本局结算占用，原胜负不变。'
    }
    if (game_off) return next()
    if (session.user.authority >= 2 && (str_host === "停止卧底" || str_host === "中止卧底" || str_host === "终止卧底" || str_host === "结束卧底")) {
      if (isGameHost(session.userId)) {
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
    if (!isGameHost(session.userId)) return next()
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
    if (isGameHost(session.userId) || personAlreadyRecorded(applicantName)) return next()
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
    if (isGameHost(session.userId) && hasPendingReplacement() && replacementCancelCommands.has(str_nos)) {
      const cancelledName = replacementRequest.applicant!.nickname
      resetReplacementRequest()
      return ("已取消" + cancelledName + "的补位申请。")
    }
    const pendingApplicant = replacementRequest.applicant
    if (!isGameHost(session.userId) && session.userId !== pendingApplicant?.userId) return next()

    if (replacementRequest.phase === "awaiting-host") {
      if (!isGameHost(session.userId)) return next()
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
      const replacementEpoch = gameTimers.epoch
      const replacementPhase = currentVoteSettlementKey()
      const replacementRound = round
      const replacementOvertime = add_flag
      const voteSnapshot = !vote_off ? captureVoteRoster() : null
      let j = 0
      while (order[j] < replacementSeat) {
        j += 1
      }
      player.splice(j, 0, applicant.userId)
      hostSupport.recordParticipant(applicant.userId); hostParticipantKeys.add(personKey(applicant.nickname))
      player_name.splice(j, 0, applicant.nickname)
      order.splice(j, 0, replacementSeat)
      if (add_flag) add_indices = add_indices.map(index => index >= j ? index + 1 : index)
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
      // Commit the roster and its matching ballot/announcement vectors before
      // any topic/card delivery. Other voters and timers can run meanwhile.
      const voteChange = voteSnapshot ? rebaseVoteRoster(session, voteSnapshot) : undefined
      if (!voteChange) {
        if (add_flag) {
          const voterIndex = j - add_indices.filter(index => index < j).length
          add_voter.splice(voterIndex, 0, applicant.userId)
          if (ann_off) add_vote[round - 1].splice(voterIndex, 0, -1)
          else add_vote[round - 1] = Array(add_voter.length)
        } else if (ann_off) {
          vote[round - 1].splice(j, 0, -1)
        } else {
          ann.splice(j, 0, '')
          vote[round - 1] = Array(player.length)
        }
        if (ann_off) poll.splice(j, 0, 0)
        else poll = Array(player.length).fill(0)
      }
      capture(r => {
        r.join(replacementSeat, historyIdentity(applicant.userId, applicant.nickname), historyCamp(replacementSeat),
          heros.includes(replacementSeat) ? heros.indexOf(replacementSeat) : null, Date.now())
        if (!add_flag) r.allowSpeakers([replacementSeat])
        if (modeInteraction.mode === 'deer') r.choice(replacementSeat, modeInteraction.deerApprovedCandidate(replacementSeat) ?? null)
      })
      resetReplacementRequest()
      const stillHere = () => !game_off && replacementEpoch === gameTimers.epoch
        && player[order.indexOf(replacementSeat)] === applicant.userId
      const needsBackfill = !add_flag && ann_off && !vote_off && !speechHistory.bySeat(replacementSeat)
        .some(record => record.round === round && !record.overtime)
      if (modeInteraction.mode === 'deer') {
        const selection = modeInteraction.deerSelectionForSeat(replacementSeat)
        if (selection && deerRevisions.restore(replacementSeat, selection.identityKey ?? selection.userId,
          selection.userId, selection.approvedVersion ?? selection.version, Date.now())) {
          const review = deerRevisions.review(replacementSeat)
          if (review) await armDeerSpeechReview(session, review)
          if (!stillHere()) return
          const makeup = deerRevisions.makeup(replacementSeat)
          if (makeup) {
            makeup.round = round
            if (!ann_off) deerRevisions.noteSpeechDeadline(deerSpeechPhaseSerial, deerPhaseDeadline)
            scheduleDeerMakeups(session)
            notifyPrivate(session, selection.userId, '你仍需补一次发言，请发送自己的序号加发言内容。', '鹿补发言恢复')
          }
        }
      }
      const replacementFailures: DealItem[] = []
      try {
        await sendTopicAssignment(session, applicant.userId, replacementSeat, modeInteraction.mode === "deer")
        if (!stillHere()) return
        if (modeInteraction.mode === 'deer' && modeInteraction.deerSelectionForSeat(replacementSeat)?.status === 'pending-host') {
          syncDeerHostReviewClock(session, false)
          await sendDeerSelectionRequest(session, replacementSeat)
        }
      }
      catch (error) {
        replacementFailures.push("题面")
        ctx.logger.warn("补位%d号玩家题面私聊发送失败：%s", replacementSeat, safeErrorSummary(error))
      }
      if (!stillHere()) return
      if (heros.indexOf(replacementSeat) !== -1) {
        try {
          const hero = heros.indexOf(replacementSeat)
          const image = await heroCards.image(hero)
          if (!stillHere()) return
          await sendPrivateWithDealTimeout(
            session,
            applicant.userId,
            "你本局抽到的武将为：" + hero_name[hero] + image,
          )
        }
        catch (error) {
          replacementFailures.push("武将牌")
          ctx.logger.warn("补位%d号玩家武将牌私聊发送失败：%s", replacementSeat, safeErrorSummary(error))
        }
      }
      if (!stillHere()) return
      if (replacementFailures.length > 0) {
        await sendPrivateNotice(
          session,
          hostid,
          replacementSeat + "号补位玩家的" + replacementFailures.join("、") + "私聊发送结果未能确认，请先确认是否收到；可让玩家私聊发送“重发信息”补取。",
          "补位发牌结果通知",
        )
      }
      if (!stillHere()) return
      if (voteChange) await announceVoteRosterChange(session, applicant.nickname + "成为第" + replacementSeat + "号玩家", voteChange)
      if (!stillHere() || replacementPhase !== currentVoteSettlementKey() || round !== replacementRound
        || add_flag !== replacementOvertime) return
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
      return
    }
    else return next()
  })
  ctx.guild().middleware(async (session: Session, next) => {//结束投票
    if (!isReceivingRegularVotes() || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    if (!isGameHost(session.userId)) return next()
    let str_nos = session.content.replace(/\s/g, "")
    if (str_nos !== "结束投票" && str_nos !== "跳过投票" && str_nos !== "终止投票" && str_nos !== "中止投票" && str_nos !== "停止投票") return next()
    const slots = regularVoteSlots()
    const missing = slots.filter(({ ballot }) => isEmpty(ballot))
    const reporters = outstandingVoteReporters()
    const novote = reporters.length ? "目前，还有" + reporters.map(reporter => reporter.seat + "号玩家" + reporter.name).join('，')
      + "共" + reporters.length + "位玩家未完成投票，" : '目前没有尚待完成的投票，'
    // Count ballot obligations, not distinct users receiving reminders.
    if (missing.length > (config.hostVoteEndMissingAllowance ?? 1)
      && missing.length * 100 >= slots.length * (config.hostVoteEndMissingPercent ?? 50)) {
      return novote + "还请" + resolvePlayerNickname(session) + "大人不要心急，等大家再投一会票吧！"
    }
    const { ballots } = currentVoteData()
    for (const { index, seat } of missing) {
      zhuYouXiaoAutoVoteReporter(seat, add_flag)
      ballots[index] = -1
    }
    for (const reporter of reporters) notifyPrivate(session, reporter.userId,
      "主持人已经结束了投票阶段。"
        + (pendingSkillsFor(reporter.userId).length ? '\n你的待选技能仍按原期限处理，可发送“我的待处理”查看；本次投票不会重开。' : ''),
      '主持结束投票通知')
    notifySession(session, novote + '本次投票阶段结束。')
    await timeout_vote(session)
  })
  ctx.guild().middleware((session, next) => {//谁没投
    if (vote_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    let str_sm = session.content.replace(/[《》·\s]/g, "").replace(regex, "")
    if (str_sm.indexOf("谁") !== -1 && (str_sm.indexOf("没投") !== -1 || str_sm.indexOf("没有投") !== -1)) {
      if (flag_just_vote) {
        return ("开始投票到现在还没到" + formatConfiguredDuration(config.hurryTimeout) + "呢，别着急嘛~")
      }
      const reporters = outstandingVoteReporters()
      if (!reporters.length) return "目前没有需要投票的玩家。"
      for (const reporter of reporters) {
        const details = privateVoteReminderDetails(reporter.userId)
        if (details.length) notifyPrivate(session, reporter.userId,
          [...details, ...optionalVoteReminder(reporter.userId)].join('\n'), '待办催票提醒')
      }
      return '目前，还有' + reporters.map(reporter => reporter.seat + '号玩家' + reporter.name + h('at', { id: reporter.userId })).join('，') + '未投票。'
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
  async function handleZhuYouXiaoHeirTarget(session: Session, next: () => any) {
    if (game_off || !matchesActiveSession(session)) return next()
    if (!pendingAction.matches("zhu-you-xiao-heir-target", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })) return next()
    const action = classifyHeirTargetInput({ content: session.content, activeSeats: order })
    if (action.kind === "invalid-target") return "请选择当前仍在场的玩家序号。"
    if (action.kind === "abandon") {
      pendingAction.complete("zhu-you-xiao-heir-target")
      recoverablePendingPrompts.delete("zhu-you-xiao-heir-target")
      zhuYouXiaoHeirOwnerSeat = null
      recordSkill(HERO.ZHU_YOU_XIAO, '放弃发动“传弟”')
      notifySession(session, "您已放弃发动“传弟”。")
      return
    }
    pendingAction.complete("zhu-you-xiao-heir-target")
    recoverablePendingPrompts.delete("zhu-you-xiao-heir-target")
    zhuYouXiaoHeirTargetSeat = action.seat
    recordSkill(HERO.ZHU_YOU_XIAO, '指定传弟对象，等待其选择', [action.seat])
    beginZhuYouXiaoHeirChoice(session, action.seat)
    return "已选择" + action.seat + "号玩家作为传弟对象，请等待其私聊选择。"
  }
  async function handleZhuYouXiaoHeirChoice(session: Session, next: () => any) {
    if (game_off || !matchesActiveSession(session)) return next()
    if (!pendingAction.matches("zhu-you-xiao-heir-choice", {
      userId: session.userId,
      scope: "private",
      gameEpoch: gameTimers.epoch,
    })) return next()
    if (zhuYouXiaoHeirTargetSeat === null || !order.includes(zhuYouXiaoHeirTargetSeat)) {
      pendingAction.clear("zhu-you-xiao-heir-choice")
      recoverablePendingPrompts.delete("zhu-you-xiao-heir-choice")
      gameTimers.cancel(timer_zhu_you_xiao_heir)
      return "传弟对象已离场，本次选择失效。"
    }
    const targetSeat = zhuYouXiaoHeirTargetSeat
    const targetHeroId = heros.indexOf(targetSeat)
    const options = zhuYouXiaoHeirOptions(targetHeroId === -1 ? null : targetHeroId)
    const choice = classifyHeirChoiceInput({ content: session.content, options })
    if (choice.kind === "invalid-option") return "请输入提示中的选项序号，或发送“弃”。"
    pendingAction.complete("zhu-you-xiao-heir-choice")
    recoverablePendingPrompts.delete("zhu-you-xiao-heir-choice")
    gameTimers.cancel(timer_zhu_you_xiao_heir)
    const targetIndex = order.indexOf(targetSeat)
    const targetName = player_name[targetIndex]
    let resultText = ""
    if (choice.kind === "abandon") {
      resultText = targetSeat + "号玩家" + targetName + "放弃接受朱由校的传弟。"
      sumup += resultText + "\n"
      recordSkill(HERO.ZHU_YOU_XIAO, "传弟被放弃", [targetSeat])
      notifySession(session, "您已放弃接受“传弟”。")
    }
    else if (choice.kind === "reset") {
      const previousGuard = targetHeroId === HERO.YUAN_CHONG_HUAN
        ? heroState.yuanChongHuan.guard
        : null
      resetNativeHeroState(heroState, targetHeroId === -1 ? null : targetHeroId, {
        activeSeats: order,
        heroSeat: targetSeat,
      })
      if (previousGuard?.kind === "guarding") shield[previousGuard.seat - 1] = false
      if (targetHeroId === HERO.WU_SAN_GUI && vote_num[targetSeat - 1] === 0) vote_num[targetSeat - 1] = 1
      if (!vote_off && (targetHeroId !== -1)) rebuildPollFromBallots()
      resultText = targetSeat + "号玩家" + targetName + "接受传弟，" + zhuYouXiaoResetDescription(targetHeroId)
      sumup += resultText + "\n"
      recordSkill(HERO.ZHU_YOU_XIAO, "传弟：" + targetName + "恢复原生技能", [targetSeat])
      notifySession(session, "您已接受传弟。" + zhuYouXiaoResetDescription(targetHeroId))
    }
    else if (choice.kind === "grant-execution") {
      zhuYouJianModule.grantExtraExecution(heroState, targetSeat)
      resultText = targetSeat + "号玩家" + targetName + "接受传弟，获得技能“处决”。"
      sumup += resultText + "\n"
      recordSkill(HERO.ZHU_YOU_XIAO, "传弟：获得处决", [targetSeat])
      notifySession(session, "您已获得技能“处决”，可在发言阶段按原规则使用。")
    }
    else {
      const skillName = nativeLimitedSkillName(targetHeroId)
      if (targetHeroId === HERO.WEI_ZHONG_XIAN) {
        weiZhongXianModule.grantExtraSlander(heroState, targetSeat)
      }
      else if (targetHeroId === HERO.YUAN_CHONG_HUAN) {
        yuanChongHuanModule.grantExtraSelfGuard(heroState, targetSeat)
      }
      else {
        zhuYouJianModule.grantExtraExecution(heroState, targetSeat)
      }
      resultText = targetSeat + "号玩家" + targetName + "接受传弟，增加一次“" + skillName + "”发动次数。"
      sumup += resultText + "\n"
      recordSkill(HERO.ZHU_YOU_XIAO, "传弟：" + skillName + "次数+1", [targetSeat])
      notifySession(session, "您已增加一次“" + skillName + "”发动次数。")
    }
    if (choice.kind !== "abandon") revealZhuYouXiaoDelegates(session)
    zhuYouXiaoHeirTargetSeat = null
    zhuYouXiaoHeirOwnerSeat = null
    return
  }
  //武将判定阶段
  ctx.guild().middleware(async (session: Session, next) => {//张献忠
    const selection = zhangSelection
    if (!selection || game_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
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
      ownerSeat: selection.action.ownerSeat!,
    })
    if (zhangAction.kind === 'invalid-target') return '请发送其他在场玩家的序号，或发送“弃”放弃发动殒阵。'
    if (!consumeZhangChoice(selection)) return
    const { action } = selection
    if (zhangAction.kind === "abandon") {
      notifySession(session, "张献忠大发慈悲，放弃了图图。")
      sumup += player_copy[heros[HERO.ZHANG_XIAN_ZHONG] - 1] + "（张献忠）放弃发动技能。\n"
      recordSkill(HERO.ZHANG_XIAN_ZHONG, '放弃发动技能')
      if (selection.beforeDeparture) return finishZhangBeforeDeparture(session, selection, null)
      resumeSpeechAfterZhang(session)
      if (action.resumeAt === ResolutionCursor.NextRound) {
        await resumeZhangXianZhongAtNextRound(session)
      }
      return
    }
    if (selection.beforeDeparture) return finishZhangBeforeDeparture(session, selection, zhangAction.seat)
    else {
      const n_zxz = zhangAction.seat
      const out_index = order.indexOf(n_zxz)
      const out_player = player[out_index]
      if (out_index !== -1) {
        const resumeAtNextRound = action.resumeAt === ResolutionCursor.NextRound
        const carry = prepareZhangCarry(session, n_zxz)
        notifySession(session, carry.notice)
        if (!carry.removesTarget) {
          if (resumeAtNextRound) {
            await resumeZhangXianZhongAtNextRound(session)
          }
          resumeSpeechAfterZhang(session)
          return
        }
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
  ctx.guild().middleware(async (session, next) => {//朱由检及传弟获得的处决
    if (ann_off || !gameRoute.matchesSession(session.platform, session.guildId, session.selfId)) return next()
    const nativeZhuSeat = heros[HERO.ZHU_YOU_JIAN]
    const actorIndex = player.indexOf(session.userId)
    if (actorIndex === -1) return next()
    const actorSeat = order[actorIndex]
    if (!zhuYouJianModule.isAvailableForSeat(heroState, actorSeat, nativeZhuSeat)) return next()
    const zhuAction = zhuYouJianModule.onSpeechAction({
      content: session.content,
      actorSeat,
      activeSeats: order,
      undercoverSeats: uc,
      whiteSeat: white,
      // Execution treats a white actor as good; slander only overlays that
      // skill-specific base rule, not the general three-camp comparison.
      isDifferentFaction: (actor, target) => weiFactionOverride(actor, target,
        uc.includes(actor) !== uc.includes(target)),
    })
    if (zhuAction.kind === "ignore") return next()
    if (zhangSelection?.beforeDeparture) return '请等待“殒阵”结算后再发动处决。'
    if (!isEligibleSpeechSeat({
       seat: actorSeat,
      activeSeats: order,
      overtime: add_flag,
      overtimeSeats: add_indices.map(index => order[index]),
    })) {
      return "你不属于本次加时的发言玩家，不能发动处决。"
    }
    if (modeInteraction.mode === "deer" && deerSeatNeedsSelection(actorSeat)) {
      return rejectUnapprovedDeerSpeech(session, '你需要先完成鹿模式选人并通过主持人审核，才能发动处决。')
    }
    // if (round <= uc_num && player_copy.length - player.length - kickout.length < uc_num) {
    //   return
    // }
    if(boom_pending){
       notifyPrivate(session, player[actorIndex], actorSeat === nativeZhuSeat ? "陛下，有玩家自爆了，恕臣无法将旨意送达。"
         : '正在处理自爆，暂不能发动处决。', "朱由检自爆期间处决拒绝通知")
      return
    }
    if (zhuAction.kind === "invalid-target") {
       notifyPrivate(session, player[actorIndex], actorSeat === nativeZhuSeat ? "陛下，您要处决的对象似乎查无此人。"
         : '处决对象不在场，请重新选择。', "朱由检无效处决目标通知")
      return
    }
    const kill = zhuAction.chosenSeat
    weiZhongXianModule.recordAttack(heroState, actorSeat, kill, weiZhongXianSeat())
    const firstReveal = heros.includes(actorSeat) && !publicHeroReveals.isRevealed(actorSeat)
    const zhuIdentity = publicHeroIdentity(actorSeat, true)
    const executionChoice = zhuIdentity + (firstReveal ? '，并' : '') + '选择处决' + kill + '号玩家' + player_name[order.indexOf(kill)]
    notifySession(session, executionChoice + '!')
    sumup += executionChoice + ';'
    recordActorSkill(actorSeat, HERO.ZHU_YOU_JIAN,
      '处决：' + ({ success: '命中异阵营', 'self-execution': '自裁', backlash: '同阵营反噬' }[zhuAction.verdict] ?? '同阵营反噬'), [kill])
    zhuYouJianModule.activateForSeat(heroState, actorSeat, nativeZhuSeat)
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
           notifySession(session, player_name[actorIndex] + "：任贼分裂朕尸，勿伤百姓一人😰")
          break
        case 3:
           notifySession(session, player_name[actorIndex] + "：皆诸臣误朕也😡")
          break
        default:
          notifySession(session, "出错了。")
      }
       sumup += zhuIdentity + "自裁，"
    }
    else {
      notifySession(session, "处决失败。")
      sumup += "处决失败，"
    }
    const linProtection = outcast === heros[HERO.LIN_DAN_HAN] && !shield[outcast - 1]
      ? linDanHanModule.protectFromSkill(heroState, actorSeat)
      : { protected: false, awakenedNow: false }
    if (shield[outcast - 1] || linProtection.protected) {
      if (linProtection.awakenedNow) announceLinDanHanAwakening(session)
      notifySession(session, outcast + "号玩家" + player_name[order.indexOf(outcast)] + "受武将技能保护，不出局，处决未能使其出局。")
      recordActorSkill(actorSeat, HERO.ZHU_YOU_JIAN, '处决被保护抵消', [outcast])
      sumup += (outcast + "号玩家" + player_name[order.indexOf(outcast)] + "受武将技能保护，不出局，处决未能使其出局。\n")
      return
    }
    const commitExecution = async (current: Session, carriedOvertimeCandidate = false, resumedAfterZhang = false) => {
      // A previous carry can change the roster positions, never the original target seat.
      const outIndex = order.indexOf(outcast)
      const outUserId = player[outIndex]
      const identity = '第' + outcast + '号玩家' + player_name[outIndex]
      const executionText = zhuAction.verdict === 'self-execution' ? identity + '自裁。'
        : publicHeroEliminationText(outcast, identity, '出局。')
      if (!resumedAfterZhang) notifySession(current, executionText)
      sumup += executionText + '\n'
      nv_out.push(outcast)
      await player_out_long(current, outcast, async (current: Session, departed: number) => {
        const post = postEliminationHero(departed, heros, 'skill')
        const announceCapability = () => {
          if (round <= uc_num && player_copy.length - player.length - kickout.length === uc_num) notifySession(current, roundCapabilityText('从现在起'))
        }
        if (add_flag) {
          const endOvertime = add_indices.includes(outIndex) || carriedOvertimeCandidate
          if (endOvertime) round += 1
          if (post === 'zhang-xian-zhong' && !resumedAfterZhang) {
            announceCapability()
            add_indices = add_indices.filter(index => index !== outIndex).map(index => index > outIndex ? index - 1 : index)
            vote_off = true
            beginZhangXianZhongTarget(current)
            return
          }
          if (post === 'shi-ke-fa') promptShiKeFaGift(current, departed)
          if (!endOvertime) {
            announceCapability()
            add_voter = add_voter.filter(id => id !== outUserId)
            add_indices = add_indices.map(index => index > outIndex ? index - 1 : index)
            add_vote[round - 1] = Array(add_voter.length)
            return
          }
          for (const timer of [timer_htj, timer_zxz, timer_mwl, timer_wsg, timer_hurry, timer_vote, timer_ann]) gameTimers.cancel(timer)
          flag_just_vote = false
          add_flag = false
          if (!await new_round(current)) return
          ann = Array(player.length)
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = '本轮发言结果：\n'
          vstr = '本轮投票结果：\n'
          notifyGroup(current, '正在进行加时的玩家出局，结束加时，不再另外出人，游戏继续，开始第' + round + '轮发言。', '朱由检加时出局后新轮通知')
          return
        }
        announceCapability()
        ann.splice(outIndex, 1)
        vote[round - 1].splice(outIndex, 1)
        if (post === 'zhang-xian-zhong' && !resumedAfterZhang) {
          vote_off = true
          beginZhangXianZhongTarget(current)
          return
        }
        if (post === 'shi-ke-fa') promptShiKeFaGift(current, departed)
        end_ann(current)
      }, false, true, resumedAfterZhang ? { text: executionText, label: '处决出局通知' } : undefined)
    }
    const elimination = snapshotEliminationContext({ gameEpoch: gameTimers.epoch, round, source: 'execution',
      targetSeat: outcast, activeSeats: order, chainDepth: 0, causedByHero: 'zhu-you-jian' })
    if (deferZhangDeparture(session, elimination, (current, carriedCandidate) => commitExecution(current, carriedCandidate, true))) return
    await commitExecution(session)
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
      weiZhongXianModule.recordAttack(heroState, heros[HERO.WU_SAN_GUI], outcast, weiZhongXianSeat())
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
      const commitAuthority = async (current: Session, resumedAfterZhang = false) => {
        const wuEliminationText = publicHeroEliminationText(outcast,
          '本轮' + outcast + '号玩家' + player_name[order.indexOf(outcast)], '被吴三桂指定出局。')
        if (!resumedAfterZhang) notifySession(current, wuEliminationText)
        sumup += '第' + round + '轮' + wuEliminationText.slice(2) + '\n'
        recordSkill(HERO.WU_SAN_GUI, '权计指定出局', [outcast])
        nv_out.push(outcast)
        await player_out_long(current, outcast, async (current: Session, departed: number) => {
          const post = postEliminationHero(departed, heros, 'skill')
          if (post === 'zhang-xian-zhong' && !resumedAfterZhang) {
            add_vote.push([])
            vote_off = true
            beginZhangXianZhongTarget(current)
            return
          }
          if (post === 'shi-ke-fa') promptShiKeFaGift(current, departed)
          round += 1
          add_flag = false
          if (!await new_round(current)) return
          notifySession(current, '游戏继续，开始第' + round + '轮发言。')
          vote_off = true
          ann_off = false
          ann = Array(player.length)
          add_vote.push([])
          vote.push(Array(player.length))
          poll = Array(player.length).fill(0)
          shield = Array(player_copy.length).fill(false)
          annstr = '本轮发言结果：\n'
          vstr = '本轮投票结果：\n'
        }, false, false, resumedAfterZhang ? { text: wuEliminationText, label: '权计出局通知' } : undefined)
      }
      const elimination = snapshotEliminationContext({ gameEpoch: gameTimers.epoch, round, source: 'hero',
        targetSeat: outcast, activeSeats: order, chainDepth: 0, causedByHero: 'wu-san-gui' })
      if (deferZhangDeparture(session, elimination, current => commitAuthority(current, true),
        () => recordSkill(HERO.WU_SAN_GUI, '选定权计目标', [outcast]))) return
      await commitAuthority(session)
    }
  })
  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//袁崇焕
    if (game_off || !matchesActiveSession(session)) return next()
    if (order.indexOf(heros[HERO.YUAN_CHONG_HUAN]) === -1) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])]) return next()
    const action = yuanChongHuanModule.classifyGuardInput(heroState, {
      content: session.content,
      activeSeats: order,
      heroSeat: heros[HERO.YUAN_CHONG_HUAN],
      whiteSeat: white,
    })
    if (action.kind === "ignore") return next()
    if (add_flag) return '守卫和专镇只能在普通投票阶段使用。'
    if (!yuanChongHuanModule.isVoteWindowOpen(heroState, votePhaseSerial)) return '请在普通投票阶段使用“守卫”或“专镇”；票数公开前可修改或放弃。'
    if (action.kind === "abandon") {
      const previous = yuanChongHuanModule.abandonGuard(heroState)
      if (previous === null) {
        await decideVoteSkill(session, heros[HERO.YUAN_CHONG_HUAN])
        return '已放弃本次守卫。'
      }
      shield[previous - 1] = false
      notifySession(session, "得令！已放弃对" + previous + "号玩家" + player_name[order.indexOf(previous)] + "的守卫。")
      sumup += "第" + heros[HERO.YUAN_CHONG_HUAN] + "号玩家" + player_name[order.indexOf(heros[HERO.YUAN_CHONG_HUAN])] + "（袁崇焕）放弃对" + previous + "号玩家" + player_name[order.indexOf(previous)] + "的守卫。\n"
      recordSkill(HERO.YUAN_CHONG_HUAN, "放弃守卫", [previous])
      await decideVoteSkill(session, heros[HERO.YUAN_CHONG_HUAN])
      return
    }
    if (action.kind === "invalid-target") return ("督师，恕卑职找不到您要守的对象，还请重新选择。")
    if (action.kind === "previous-target-forbidden") return ("督师，您上一轮便守卫了" + action.seat + "号玩家" + player_name[order.indexOf(action.seat)] + "，陛下有令，还请您另作选择！")
    if (action.kind === "self-forbidden") return "督师，守卫自己请发送“专镇”。"
    if (action.kind === "self-unavailable") return "督师，您已没有可用的“专镇”。"
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
    shield[guard - 1] = !heroState.yuanChongHuan.voteAttackerSeats.includes(guard)
    await decideVoteSkill(session, heros[HERO.YUAN_CHONG_HUAN])
  })

  ctx.exclude(ctx.guild()).middleware(async (session, next) => {//多尔衮
    if (game_off || !matchesActiveSession(session)) return next()
    if (order.indexOf(heros[HERO.DUO_ER_GUN]) === -1) return next()
    if (session.userId !== player[order.indexOf(heros[HERO.DUO_ER_GUN])]) return next()
    const action = duoErGunModule.classifyStrategyInput(heroState, {
      content: session.content,
      activeSeats: order,
      heroSeat: heros[HERO.DUO_ER_GUN],
    })
    if (action.kind === "ignore") return next()
    if (vote_off || add_flag) return '定策只能在普通投票阶段使用。'
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
    await decideVoteSkill(session, heros[HERO.DUO_ER_GUN])
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
    await decideVoteSkill(session, heros[HERO.DUO_ER_GUN])
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
      recordSkill(HERO.SHI_KE_FA, '放弃发动“落梅”')
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
