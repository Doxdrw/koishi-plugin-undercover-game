export interface VoteRosterSnapshot {
  readonly voterIds: readonly string[]
  readonly ballots: readonly number[]
}

export interface RetainBallotsInput {
  readonly previous: VoteRosterSnapshot
  readonly voterIds: readonly string[]
  readonly playerIds: readonly string[]
  readonly playerOrder: readonly number[]
  readonly validTargetsBySeat: (seat: number) => readonly number[]
}

export interface RetainedBallots {
  readonly ballots: number[]
  readonly invalidatedVoterIds: ReadonlySet<string>
  readonly autoWaivedVoterIds: readonly string[]
}

export function retainBallotsAfterRosterChange(input: RetainBallotsInput): RetainedBallots {
  const previousBallots = new Map<string, number>()
  for (let index = 0; index < input.previous.voterIds.length; index++) {
    previousBallots.set(input.previous.voterIds[index], input.previous.ballots[index])
  }

  const ballots = Array<number>(input.voterIds.length)
  const invalidatedVoterIds = new Set<string>()
  const autoWaivedVoterIds: string[] = []
  for (let index = 0; index < input.voterIds.length; index++) {
    const voterId = input.voterIds[index]
    const playerIndex = input.playerIds.indexOf(voterId)
    if (playerIndex === -1) continue
    const voterSeat = input.playerOrder[playerIndex]
    const validTargets = input.validTargetsBySeat(voterSeat)
    const previousBallot = previousBallots.get(voterId)

    if (previousBallot === 0 || previousBallot === -1) {
      ballots[index] = previousBallot
    }
    else if (typeof previousBallot === "number" && previousBallot > 0) {
      if (validTargets.includes(previousBallot)) ballots[index] = previousBallot
      else invalidatedVoterIds.add(voterId)
    }

    if (ballots[index] === undefined && validTargets.length === 0) {
      ballots[index] = 0
      autoWaivedVoterIds.push(voterId)
    }
  }

  return {
    ballots,
    invalidatedVoterIds,
    autoWaivedVoterIds,
  }
}
