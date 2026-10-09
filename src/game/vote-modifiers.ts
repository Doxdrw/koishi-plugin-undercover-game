export type ShiKeFaResistanceMode = "resistance-available" | "resistance-lost" | "awaiting-gift"

export interface ResolveShiKeFaResistanceInput {
  readonly overtime: boolean
  readonly overtimeCandidateSeats: readonly number[]
  readonly voterIds: readonly string[]
  readonly ballots: readonly number[]
  readonly playerIds: readonly string[]
  readonly activeSeats: readonly number[]
  readonly undercoverSeats: readonly number[]
  readonly whiteSeat: number
  readonly shiKeFaSeat: number
  readonly mode: ShiKeFaResistanceMode
  readonly teammateAttackers: readonly number[]
}

export type ShiKeFaResistanceNotice = "none" | "no-teammate" | "reduced" | "unavailable"

export interface ShiKeFaResistanceResult {
  readonly mode: ShiKeFaResistanceMode
  readonly notice: ShiKeFaResistanceNotice
  readonly pollAdjustment: number
  readonly giftBalanceAdjustment: number
}

function sameFaction(input: ResolveShiKeFaResistanceInput, first: number, second: number): boolean {
  return (input.undercoverSeats.indexOf(first) + 0.5)
    * (input.undercoverSeats.indexOf(second) + 0.5) > 0
}

export function resolveShiKeFaResistance(
  input: ResolveShiKeFaResistanceInput,
): ShiKeFaResistanceResult {
  const shiIndex = input.activeSeats.indexOf(input.shiKeFaSeat)
  if (shiIndex === -1) {
    return { mode: input.mode, notice: "none", pollAdjustment: 0, giftBalanceAdjustment: 0 }
  }

  let mode = input.mode
  if (mode === "resistance-available") {
    const voterIndex = input.voterIds.indexOf(input.playerIds[shiIndex])
    const targetSeat = voterIndex === -1 ? 0 : input.ballots[voterIndex]
    if (input.activeSeats.includes(targetSeat)
      && sameFaction(input, input.shiKeFaSeat, targetSeat)
      && targetSeat !== input.whiteSeat) {
      mode = "resistance-lost"
    }
  }

  if (input.teammateAttackers.length === 0) {
    const shouldNotify = !input.overtime || input.overtimeCandidateSeats.includes(input.shiKeFaSeat)
    return {
      mode,
      notice: shouldNotify ? "no-teammate" : "none",
      pollAdjustment: 0,
      giftBalanceAdjustment: 0,
    }
  }
  if (mode === "resistance-available") {
    return { mode, notice: "reduced", pollAdjustment: -1, giftBalanceAdjustment: -1 }
  }
  if (mode === "resistance-lost") {
    return { mode, notice: "unavailable", pollAdjustment: 0, giftBalanceAdjustment: 0 }
  }
  return { mode, notice: "none", pollAdjustment: 0, giftBalanceAdjustment: 0 }
}

export type DuoErGunStrategyMark =
  | { kind: "none" }
  | { kind: "new"; seat: number }
  | { kind: "established"; seat: number }

export interface ResolveDuoErGunProtectionInput {
  readonly activeSeats: readonly number[]
  readonly poll: readonly number[]
  readonly duoErGunSeat: number
  readonly strategyMark: DuoErGunStrategyMark
}

export interface DuoErGunProtectionResult {
  readonly protectedSeat: number | null
  readonly pollAdjustment: number
}

export function resolveDuoErGunProtection(
  input: ResolveDuoErGunProtectionInput,
): DuoErGunProtectionResult {
  if (!input.activeSeats.includes(input.duoErGunSeat) || input.strategyMark.kind !== "new") {
    return { protectedSeat: null, pollAdjustment: 0 }
  }
  const protectedIndex = input.activeSeats.indexOf(input.strategyMark.seat)
  if (protectedIndex === -1 || input.poll[protectedIndex] <= 0) {
    return { protectedSeat: null, pollAdjustment: 0 }
  }
  return { protectedSeat: input.strategyMark.seat, pollAdjustment: -1 }
}
