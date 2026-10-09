export interface CalculateVoteLeadersInput {
  readonly poll: readonly number[]
  readonly activeSeats: readonly number[]
  readonly playerNames: readonly string[]
}

export interface VoteLeaderResult {
  readonly maximum: number
  readonly runnerUp: number
  readonly leaderIndices: number[]
  readonly firstLeaderIndex: number
  readonly leaderDescription: string
  readonly requiredInfluence: number
}

export function calculateVoteLeaders(input: CalculateVoteLeadersInput): VoteLeaderResult {
  const maximum = input.poll.reduce((left, right) => Math.max(left, right), -Infinity)
  const firstLeaderIndex = input.poll.indexOf(maximum)
  const pollWithoutFirstLeader = input.poll
    .slice(0, firstLeaderIndex)
    .concat(input.poll.slice(firstLeaderIndex + 1))
  const runnerUp = pollWithoutFirstLeader.reduce((left, right) => Math.max(left, right), -Infinity)
  const leaderIndices: number[] = []
  let leaderDescription = ""
  let leaderIndex = firstLeaderIndex
  while (leaderIndex !== -1) {
    leaderIndices.push(leaderIndex)
    leaderDescription += input.activeSeats[leaderIndex] + "号玩家" + input.playerNames[leaderIndex] + "，"
    leaderIndex = input.poll.indexOf(maximum, leaderIndex + 1)
  }
  leaderDescription = leaderDescription.slice(0, -1)
  return {
    maximum,
    runnerUp,
    leaderIndices,
    firstLeaderIndex,
    leaderDescription,
    requiredInfluence: maximum - runnerUp,
  }
}

export interface MaoWenLongLateVoteInput {
  readonly activeSeats: readonly number[]
  readonly overtime: boolean
  readonly overtimeCandidateSeats: readonly number[]
  readonly maoWenLongSeat: number
  readonly requiredInfluence: number
  readonly votePower: number
  readonly fa: number
  readonly totalQuan: number
}

export type MaoWenLongLateVoteDecision = "not-eligible" | "cannot-affect" | "prompt"

export function decideMaoWenLongLateVote(
  input: MaoWenLongLateVoteInput,
): MaoWenLongLateVoteDecision {
  if (!input.activeSeats.includes(input.maoWenLongSeat)) return "not-eligible"
  if (input.overtime && input.overtimeCandidateSeats.includes(input.maoWenLongSeat)) {
    return "not-eligible"
  }
  const availableInfluence = input.votePower + input.fa + input.totalQuan
  return input.requiredInfluence <= availableInfluence ? "prompt" : "cannot-affect"
}
