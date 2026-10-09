import type { Seat } from "./hero-state"
import type { ResolutionCursor } from "./resolution-pipeline"

export type PendingActionKind =
  | "mao-wen-long-late-vote"
  | "huang-tai-ji-quan"
  | "wu-san-gui-overtime-choice"
  | "zhang-xian-zhong-target"
  | "shi-ke-fa-gift"
  | "host-adjudication"

export type PendingActionChannel =
  | { scope: "private" }
  | { scope: "group"; guildId: string }

export interface PendingAction {
  readonly kind: PendingActionKind
  /** Optional project identity alias. When present, input is matched by nickname. */
  readonly ownerNickname?: string
  readonly ownerSeat: Seat | null
  readonly ownerUserId: string
  readonly channel: PendingActionChannel
  readonly blocksRosterChanges: boolean
  readonly gameEpoch: number
  readonly openedAt: number
  readonly expiresAt: number | null
  readonly resumeAt: ResolutionCursor
}

export interface OpenPendingAction
  extends Omit<PendingAction, "openedAt" | "expiresAt"> {
  readonly timeoutMs: number | null
}

export interface PendingActionInput {
  readonly nickname?: string
  readonly userId: string
  readonly scope: "private" | "group"
  readonly guildId?: string
  readonly gameEpoch: number
}

export class PendingActionCoordinator {
  private readonly actions = new Map<PendingActionKind, PendingAction>()

  get active(): PendingAction | null {
    return this.actions.values().next().value ?? null
  }

  get activeActions(): readonly PendingAction[] {
    return [...this.actions.values()]
  }

  open(action: OpenPendingAction, now = Date.now()): PendingAction {
    if (this.actions.has(action.kind)) {
      throw new Error(
        `Pending action "${action.kind}" is already active.`,
      )
    }
    const blockingAction = [...this.actions.values()]
      .find(current => current.blocksRosterChanges)
    if (action.blocksRosterChanges && blockingAction) {
      throw new Error(
        `Cannot open pending action "${action.kind}" while "${blockingAction.kind}" is active.`,
      )
    }
    if (action.timeoutMs !== null && action.timeoutMs < 0) {
      throw new Error("Pending action timeout cannot be negative.")
    }
    const opened: PendingAction = {
      kind: action.kind,
      ownerSeat: action.ownerSeat,
      ownerUserId: action.ownerUserId,
      ownerNickname: action.ownerNickname,
      channel: action.channel,
      blocksRosterChanges: action.blocksRosterChanges,
      gameEpoch: action.gameEpoch,
      resumeAt: action.resumeAt,
      openedAt: now,
      expiresAt: action.timeoutMs === null ? null : now + action.timeoutMs,
    }
    this.actions.set(opened.kind, opened)
    return opened
  }

  matches(kind: PendingActionKind, input: PendingActionInput): boolean {
    const action = this.actions.get(kind)
    if (!action) return false
    if (action.gameEpoch !== input.gameEpoch) return false
    if (action.ownerNickname !== undefined) {
      if (action.ownerNickname !== input.nickname) return false
    }
    else if (action.ownerUserId !== input.userId) {
      return false
    }
    if (action.channel.scope !== input.scope) return false
    if (action.channel.scope === "group") {
      return action.channel.guildId === input.guildId
    }
    return true
  }

  complete(kind: PendingActionKind): PendingAction {
    const action = this.require(kind)
    this.actions.delete(kind)
    return action
  }

  clear(kind?: PendingActionKind): PendingAction | null {
    if (kind) {
      const action = this.actions.get(kind) ?? null
      this.actions.delete(kind)
      return action
    }
    const action = this.active
    this.actions.clear()
    return action
  }

  clearStaleEpoch(gameEpoch: number): PendingAction | null {
    let firstCleared: PendingAction | null = null
    for (const [kind, action] of this.actions) {
      if (action.gameEpoch === gameEpoch) continue
      firstCleared ??= action
      this.actions.delete(kind)
    }
    return firstCleared
  }

  isRosterChangeBlocked(): boolean {
    return [...this.actions.values()].some(action => action.blocksRosterChanges)
  }

  remainingMs(now = Date.now(), kind?: PendingActionKind): number {
    const action = kind ? this.actions.get(kind) : this.active
    if (!action) return 0
    if (action.expiresAt === null) return Number.POSITIVE_INFINITY
    return Math.max(0, action.expiresAt - now)
  }

  private require(kind: PendingActionKind): PendingAction {
    const action = this.actions.get(kind)
    if (!action) {
      throw new Error(`Pending action "${kind}" is not active.`)
    }
    return action
  }
}
