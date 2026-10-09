import type { DuoErGunStrategyMark, ShiKeFaMode } from "./hero-state"

export type VoteResolutionStatus = "complete" | "locked" | "pending"

export interface VoteResolutionStatusInput {
  voterIds: readonly string[]
  ballots: readonly (number | null | undefined)[]
  playerIds: readonly string[]
  playerOrder: readonly number[]
  votePower: readonly number[]
  poll: readonly number[]
  fa: readonly number[]
  quan: readonly number[]
  maoWenLongSeat: number
  shiKeFa: {
    seat: number
    mode: ShiKeFaMode
    teammateAttackers: readonly number[]
    undercoverSeats: readonly number[]
    whiteSeat: number
  }
  duoErGunStrategyMark: DuoErGunStrategyMark
}

function isPendingBallot(ballot: number | null | undefined): boolean {
  return ballot == null || Number.isNaN(ballot)
}

/**
 * Determine whether the preserved ballots are sufficient to settle the vote.
 *
 * This is the pure calculation extracted from the legacy voteResolutionStatus:
 * - complete: every voter except Mao Wenlong has finished;
 * - locked: even all remaining influence cannot change the unique leader;
 * - pending: more valid ballots are still required.
 *
 * Shi Kefa and Dorgon modify the poll before the leader is determined, so the
 * lock calculation must simulate both reductions without mutating game state.
 */
export function getVoteResolutionStatus(input: VoteResolutionStatusInput): VoteResolutionStatus {
  let pendingPower = 0
  let maoPower = 0
  let availableFa = 0
  let availableQuan = 0

  for (let i = 0; i < input.voterIds.length; i++) {
    const playerIndex = input.playerIds.indexOf(input.voterIds[i])
    if (playerIndex === -1) continue
    const voterOrder = input.playerOrder[playerIndex]
    const power = input.votePower[voterOrder - 1]
    if (isPendingBallot(input.ballots[i]) && power !== 0) {
      if (voterOrder === input.maoWenLongSeat) maoPower += power
      else pendingPower += power
    }
    if (power !== 0) availableFa += input.fa[voterOrder - 1]
  }
  for (const playerOrder of input.playerOrder) availableQuan += input.quan[playerOrder - 1]

  // Mao Wenlong acts separately after the regular voters have finished.
  if (pendingPower === 0) return "complete"

  const adjustedPoll = input.poll.slice()
  const shiKeFaPlayerIndex = input.playerOrder.indexOf(input.shiKeFa.seat)
  if (shiKeFaPlayerIndex !== -1
    && input.shiKeFa.mode === "resistance-available"
    && input.shiKeFa.teammateAttackers.length > 0) {
    const shiKeFaVoterIndex = input.voterIds.indexOf(input.playerIds[shiKeFaPlayerIndex])
    const shiKeFaTarget = shiKeFaVoterIndex === -1 ? 0 : input.ballots[shiKeFaVoterIndex]
    const votedForTeammate = typeof shiKeFaTarget === "number"
      && input.playerOrder.indexOf(shiKeFaTarget) !== -1
      && (input.shiKeFa.undercoverSeats.indexOf(input.shiKeFa.seat) + 0.5)
        * (input.shiKeFa.undercoverSeats.indexOf(shiKeFaTarget) + 0.5) > 0
      && shiKeFaTarget !== input.shiKeFa.whiteSeat
    if (!votedForTeammate) adjustedPoll[shiKeFaPlayerIndex] -= 1
  }

  const duoErGunTarget = input.duoErGunStrategyMark.kind === "new"
    ? input.duoErGunStrategyMark.seat
    : null
  const duoErGunTargetIndex = duoErGunTarget === null
    ? -1
    : input.playerOrder.indexOf(duoErGunTarget)
  if (input.duoErGunStrategyMark.kind === "new"
    && duoErGunTargetIndex !== -1
    && adjustedPoll[duoErGunTargetIndex] > 0) {
    adjustedPoll[duoErGunTargetIndex] -= 1
  }

  const max = adjustedPoll.reduce((a, b) => Math.max(a, b), -Infinity)
  const maxIndex = adjustedPoll.indexOf(max)
  if (maxIndex === -1 || adjustedPoll.indexOf(max, maxIndex + 1) !== -1) return "pending"
  const runnerUp = adjustedPoll.reduce(
    (value, current, index) => index === maxIndex ? value : Math.max(value, current),
    -Infinity,
  )
  return runnerUp + pendingPower + maoPower + availableFa + availableQuan < max
    ? "locked"
    : "pending"
}
