export const ResolutionCursor = {
  RebuildBallots: "rebuild-ballots",
  ApplyShiKeFaResistance: "apply-shi-ke-fa-resistance",
  ApplyDuoErGunProtection: "apply-duo-er-gun-protection",
  DeriveVoteEffects: "derive-vote-effects",
  CalculateLeaders: "calculate-leaders",
  MaoWenLongLateVote: "mao-wen-long-late-vote",
  DuoErGunSwap: "duo-er-gun-swap",
  LinDanHanAwaken: "lin-dan-han-awaken",
  HuangTaiJiQuan: "huang-tai-ji-quan",
  DuoErGunSwapAfterHuangTaiJi: "duo-er-gun-swap-after-huang-tai-ji",
  FinalizeVote: "finalize-vote",
  WuSanGuiOvertimeChoice: "wu-san-gui-overtime-choice",
  Eliminate: "eliminate",
  PostElimination: "post-elimination",
  CheckVictory: "check-victory",
  NextRound: "next-round",
} as const

export type ResolutionCursor = typeof ResolutionCursor[keyof typeof ResolutionCursor]

export type ResolutionTraceSegment =
  | "vote-pre-mao"
  | "vote-tail"
  | "vote-elimination"
  | "vote-next-round"

export interface RuntimeResolutionTraceEvent {
  readonly segment: ResolutionTraceSegment
  readonly cursor: ResolutionCursor
  readonly gameEpoch: number
  readonly round: number
  readonly overtime: boolean
}

export type RuntimeResolutionTraceSink = (event: RuntimeResolutionTraceEvent) => void

export const VOTE_ELIMINATION_PIPELINE: readonly ResolutionCursor[] = [
  ResolutionCursor.Eliminate,
  ResolutionCursor.CheckVictory,
  ResolutionCursor.PostElimination,
  ResolutionCursor.NextRound,
]

export const VOTE_ELIMINATION_ORDER = VOTE_ELIMINATION_PIPELINE

export const RESOLUTION_ORDER: readonly ResolutionCursor[] = [
  ResolutionCursor.RebuildBallots,
  ResolutionCursor.ApplyShiKeFaResistance,
  ResolutionCursor.ApplyDuoErGunProtection,
  ResolutionCursor.DeriveVoteEffects,
  ResolutionCursor.CalculateLeaders,
  ResolutionCursor.MaoWenLongLateVote,
  ResolutionCursor.DuoErGunSwap,
  ResolutionCursor.LinDanHanAwaken,
  ResolutionCursor.HuangTaiJiQuan,
  ResolutionCursor.FinalizeVote,
  ResolutionCursor.WuSanGuiOvertimeChoice,
  ...VOTE_ELIMINATION_ORDER,
]

export const VOTE_RESOLUTION_TAIL: readonly ResolutionCursor[] = [
  ResolutionCursor.DuoErGunSwap,
  ResolutionCursor.LinDanHanAwaken,
  ResolutionCursor.HuangTaiJiQuan,
  ResolutionCursor.FinalizeVote,
]

/**
 * Tail resumed after Huang Taiji actually changes the poll.
 *
 * The first Lin Dan Han check is intentionally retained here because the
 * existing Huang Taiji resume path rechecks it before finalizing.  Dorgon is
 * then checked against the post-Quan poll exactly once before the final vote.
 */
export const VOTE_RESOLUTION_TAIL_AFTER_HUANG_TAI_JI: readonly ResolutionCursor[] = [
  ResolutionCursor.LinDanHanAwaken,
  ResolutionCursor.DuoErGunSwapAfterHuangTaiJi,
  ResolutionCursor.FinalizeVote,
]

export type ResolutionControl<Outcome = unknown> =
  | { kind: "continue" }
  | { kind: "pause"; resumeAt: ResolutionCursor }
  | { kind: "replace-outcome"; outcome: Outcome }
  | { kind: "game-end" }

export type ResolutionHandler<Context, Outcome = unknown> =
  (context: Context) => ResolutionControl<Outcome> | Promise<ResolutionControl<Outcome>>

export type ResolutionHandlers<Context, Outcome = unknown> =
  Partial<Record<ResolutionCursor, ResolutionHandler<Context, Outcome>>>

export interface ResolutionPipelineOptions<Context, Outcome = unknown> {
  context: Context
  handlers: ResolutionHandlers<Context, Outcome>
  startAt?: ResolutionCursor
  order?: readonly ResolutionCursor[]
  trace?: (cursor: ResolutionCursor) => void
}

export interface ResolutionPipelineResult<Outcome = unknown> {
  control: ResolutionControl<Outcome>
  lastCursor: ResolutionCursor | null
}

export const continueResolution = (): ResolutionControl => ({ kind: "continue" })

export const pauseResolution = (resumeAt: ResolutionCursor): ResolutionControl => ({
  kind: "pause",
  resumeAt,
})

export const endResolution = (): ResolutionControl => ({ kind: "game-end" })

export function replaceResolutionOutcome<Outcome>(outcome: Outcome): ResolutionControl<Outcome> {
  return { kind: "replace-outcome", outcome }
}

export async function runResolutionPipeline<Context, Outcome = unknown>(
  options: ResolutionPipelineOptions<Context, Outcome>,
): Promise<ResolutionPipelineResult<Outcome>> {
  const order = options.order ?? RESOLUTION_ORDER
  const startAt = options.startAt ?? order[0]
  const startIndex = order.indexOf(startAt)
  if (startIndex === -1) {
    throw new Error(`Resolution cursor "${startAt}" is not present in the selected order.`)
  }

  let lastCursor: ResolutionCursor | null = null
  for (let index = startIndex; index < order.length; index++) {
    const cursor = order[index]
    const handler = options.handlers[cursor]
    if (!handler) continue
    lastCursor = cursor
    options.trace?.(cursor)
    const control = await handler(options.context)
    if (control.kind !== "continue") return { control, lastCursor }
  }

  return {
    control: continueResolution() as ResolutionControl<Outcome>,
    lastCursor,
  }
}
