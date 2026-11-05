import type { Seat } from "./hero-state"

export type ZhuYouXiaoVotePhase = "regular" | "overtime"

export interface ZhuYouXiaoDelegationRecord {
  readonly phaseSerial: number
  readonly seat: Seat
}

export interface ZhuYouXiaoVotePhaseState {
  readonly serial: number
  readonly kind: ZhuYouXiaoVotePhase
  readonly ownerSeat: Seat | null
  delegateSeat: Seat | null
  successfulDelegateSeat: Seat | null
}

export interface ZhuYouXiaoState {
  current: ZhuYouXiaoVotePhaseState | null
  records: ZhuYouXiaoDelegationRecord[]
}

export function createZhuYouXiaoState(): ZhuYouXiaoState {
  return { current: null, records: [] }
}

export function beginZhuYouXiaoVotePhase(
  state: ZhuYouXiaoState,
  input: { serial: number, kind: ZhuYouXiaoVotePhase, ownerSeat: Seat | null },
): ZhuYouXiaoVotePhaseState {
  const current: ZhuYouXiaoVotePhaseState = {
    serial: input.serial,
    kind: input.kind,
    ownerSeat: input.ownerSeat,
    delegateSeat: null,
    successfulDelegateSeat: null,
  }
  state.current = current
  return current
}

export function setZhuYouXiaoDelegate(
  state: ZhuYouXiaoState,
  delegateSeat: Seat | null,
): { previousSeat: Seat | null, changed: boolean } {
  const current = state.current
  if (!current) return { previousSeat: null, changed: false }
  const previousSeat = current.delegateSeat
  if (current.successfulDelegateSeat !== null) {
    state.records = state.records.filter(record => record.phaseSerial !== current.serial)
    current.successfulDelegateSeat = null
  }
  if (previousSeat === delegateSeat) return { previousSeat, changed: false }
  current.delegateSeat = delegateSeat
  return { previousSeat, changed: true }
}

export function recordZhuYouXiaoProxyVote(state: ZhuYouXiaoState): Seat | null {
  const current = state.current
  if (!current || current.delegateSeat === null) return null
  current.successfulDelegateSeat = current.delegateSeat
  if (!state.records.some(record => record.phaseSerial === current.serial)) {
    state.records.push({ phaseSerial: current.serial, seat: current.delegateSeat })
  }
  return current.delegateSeat
}

export function clearZhuYouXiaoPhase(state: ZhuYouXiaoState): void {
  state.current = null
}

/**
 * Detach the live delegation without necessarily discarding a proxy vote that
 * has already been accepted for this phase.  The latter is needed when the
 * Zhu Youxiao seat is eliminated by the vote after its delegated ballot has
 * already been recorded: the live relation is over, but the record still
 * belongs to 传弟's "all successful delegates" reveal.
 */
export function detachZhuYouXiaoCurrent(
  state: ZhuYouXiaoState,
  preserveSuccessfulRecord = false,
): void {
  const current = state.current
  if (!current) return
  if (!preserveSuccessfulRecord && current.successfulDelegateSeat !== null) {
    state.records = state.records.filter(record => record.phaseSerial !== current.serial)
    current.successfulDelegateSeat = null
  }
  current.delegateSeat = null
}

export function zhuYouXiaoSuccessfulDelegates(state: ZhuYouXiaoState): Seat[] {
  return [...new Set(state.records.map(record => record.seat))].sort((left, right) => left - right)
}

