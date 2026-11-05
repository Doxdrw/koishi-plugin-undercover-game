export type WeiZhongXianInquiry =
  | { kind: "abandon" }
  | { kind: "vote-target" }
  | { kind: "voted-by"; targetSeat: number }

export interface WeiZhongXianCandidate {
  readonly phaseSerial: number
  readonly targetSeat: number
  /** The ballot phase has ended; separate from its round-end deadline. */
  phaseCompleted: boolean
  /** No later departure may satisfy this candidate after it is sealed. */
  settled: boolean
  targetExitedBeforeNextRound: boolean
  normalAwarded: boolean
  retroactiveAwarded: boolean
  /** The departure qualified, but its faction check did not. */
  blockedByFaction: boolean
}

export type WeiZhongXianRewardSource = "normal" | "slander"

export function hasWeiZhongXianReward(candidate: WeiZhongXianCandidate): boolean {
  return candidate.normalAwarded || candidate.retroactiveAwarded
}

/** Keep the reward sources distinct while claiming each vote record once. */
export function claimWeiZhongXianReward(
  candidate: WeiZhongXianCandidate,
  differentFaction: boolean,
  source: WeiZhongXianRewardSource,
): boolean {
  if (!candidate.targetExitedBeforeNextRound || hasWeiZhongXianReward(candidate)) return false
  if (!differentFaction) {
    candidate.blockedByFaction = true
    return false
  }
  if (source === "normal") candidate.normalAwarded = true
  else candidate.retroactiveAwarded = true
  return true
}

/** Runtime-only state for the fixed-seat Wei Zhongxian skill set. */
export interface WeiZhongXianState {
  phaseSerial: number | null
  inquiry: WeiZhongXianInquiry | null
  candidates: WeiZhongXianCandidate[]
  /** Confirmed attackers of Wei Zhongxian. */
  attackedBySeats: number[]
  /** Seats Wei Zhongxian has confirmedly attacked. */
  attackedSeats: number[]
  slanderUsed: boolean
  /** Snapshot captured when the current 诬诽 was activated. */
  slanderRelations: number[]
}

export function createWeiZhongXianState(): WeiZhongXianState {
  return {
    phaseSerial: null,
    inquiry: null,
    candidates: [],
    attackedBySeats: [],
    attackedSeats: [],
    slanderUsed: false,
    slanderRelations: [],
  }
}

export function addWeiZhongXianSeat(list: number[], seat: number): void {
  if (!list.includes(seat)) list.push(seat)
}

export function clearWeiZhongXianInquiry(state: WeiZhongXianState): void {
  state.inquiry = null
}

export function resetWeiZhongXianNativeState(state: WeiZhongXianState): void {
  // Only the current unresolved ballot is a live vote fact.  Past reward
  // records and attack snapshots are native skill state, not resource marks
  // or the separately stored recap, and must not be replayed after reset.
  state.candidates = state.candidates.filter(candidate =>
    candidate.phaseSerial === state.phaseSerial && !candidate.settled)
  state.attackedSeats = []
  state.attackedBySeats = []
  state.inquiry = null
  state.slanderUsed = false
  state.slanderRelations = []
}
