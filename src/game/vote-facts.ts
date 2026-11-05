import type { BallotEffect, BallotInvalidReason } from './vote-ballots'

export type VoteFactStatus = 'vote' | 'abstain' | 'timeout' | 'skip' | 'locked' | 'pending'
export interface VoteFact {
  voterSeat: number
  deciderSeat?: number
  targetSeat: number | null
  targetNickname?: string
  weight: number
  status: VoteFactStatus
  countedWeight?: number
  invalidReasons?: BallotInvalidReason[]
}

/** Capture facts at input closure, never reconstruct them from later hero state. */
export function captureVoteFacts(input: {
  voterIds: readonly string[]; ballots: readonly (number | null | undefined)[]
  playerIds: readonly string[]; seats: readonly number[]; names: readonly string[]
  weights: readonly number[]; maoSeat: number; closed: boolean
  effects: readonly BallotEffect[]; lockedSeats: ReadonlySet<number>
  delegation?: { owner: number, decider: number }
}): VoteFact[] {
  return input.voterIds.filter(id => input.playerIds.includes(id)).map(id => {
    const index = input.playerIds.indexOf(id)
    const voterSeat = input.seats[index]
    const raw = input.ballots[input.voterIds.indexOf(id)]
    const targetIndex = typeof raw === 'number' ? input.seats.indexOf(raw) : -1
    const targetSeat = targetIndex === -1 ? null : raw!
    const weight = input.weights[voterSeat - 1]
    const status: VoteFactStatus = targetSeat !== null ? 'vote'
      : weight === 0 || voterSeat === input.maoSeat && raw == null ? 'skip'
      : raw === 0 ? 'abstain'
      : raw === -1 ? input.lockedSeats.has(voterSeat) ? 'locked' : 'timeout'
      : input.closed ? 'timeout' : 'pending'
    const effect = input.effects.find(effect => effect.voterSeat === voterSeat)
    return { voterSeat, targetSeat, weight, status,
      ...(input.delegation?.owner === voterSeat ? { deciderSeat: input.delegation.decider } : {}),
      ...(targetIndex === -1 ? {} : { targetNickname: input.names[targetIndex] }),
      ...(effect ? { countedWeight: effect.countedWeight, invalidReasons: [...effect.invalidReasons] } : {}),
    }
  })
}
