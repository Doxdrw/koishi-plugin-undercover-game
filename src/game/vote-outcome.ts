export interface ClassifyVoteOutcomeInput {
  readonly poll: readonly number[]
  readonly maximum: number
  readonly activeSeats: readonly number[]
  readonly playerNames: readonly string[]
  readonly shieldsBySeat: readonly boolean[]
  readonly overtime: boolean
}

export type VoteOutcomeKind = "safe-night" | "overtime" | "elimination"

export interface VoteOutcomeClassification {
  readonly kind: VoteOutcomeKind
  readonly candidateIndices: number[]
  readonly shieldedIndices: number[]
  readonly shieldedDescription: string
}

export function classifyVoteOutcome(input: ClassifyVoteOutcomeInput): VoteOutcomeClassification {
  const candidateIndices: number[] = []
  const shieldedIndices: number[] = []
  for (let index = 0; index < input.poll.length; index++) {
    if (input.poll[index] !== input.maximum) continue
    const seat = input.activeSeats[index]
    if (input.shieldsBySeat[seat - 1]) shieldedIndices.push(index)
    else candidateIndices.push(index)
  }
  const shieldedDescription = shieldedIndices
    .map(index => input.activeSeats[index] + "号玩家" + input.playerNames[index])
    .join("，")
  const kind: VoteOutcomeKind = candidateIndices.length === 1
    ? "elimination"
    : candidateIndices.length === 0
      || input.overtime
      || 2 * candidateIndices.length > input.activeSeats.length
      ? "safe-night"
      : "overtime"
  return { kind, candidateIndices, shieldedIndices, shieldedDescription }
}
