export interface RebuildVoteStateInput {
  readonly overtime: boolean
  readonly voterIds: readonly string[]
  readonly ballots: readonly number[]
  readonly playerIds: readonly string[]
  readonly playerOrder: readonly number[]
  readonly votePower: readonly number[]
  readonly undercoverSeats: readonly number[]
  readonly whiteSeat: number
  readonly heroes: {
    readonly linDanHanSeat: number
    readonly shiKeFaSeat: number
    readonly huangTaiJiSeat: number
  }
  readonly isSameFaction?: (firstSeat: number, secondSeat: number) => boolean
  readonly linDanHan: {
    readonly awakened: boolean
    readonly realityRecords: readonly number[]
  }
  readonly huangTaiJiRegularTarget: number
  readonly zhuYouXiao?: { readonly ownerSeat: number, readonly delegateSeat: number | null }
}

export type BallotInvalidReason = 'lin-dan-han-protection' | 'lin-dan-han-mutual' | 'zhu-you-xiao-delegation'
export interface BallotEffect {
  readonly voterSeat: number
  readonly targetSeat: number
  readonly weight: number
  readonly countedWeight: number
  readonly invalidReasons: BallotInvalidReason[]
}

export interface RebuiltVoteState {
  readonly poll: number[]
  readonly waiver: number
  readonly unvote: number
  readonly skip: number
  readonly linDanHanRealityRecords: number[]
  readonly linDanHanOwnVoteInvalidated: boolean
  readonly linDanHanPreventedVotePower: number
  readonly shiKeFaTeammateAttackers: number[]
  readonly huangTaiJiRegularTarget: number
  readonly ballotEffects: BallotEffect[]
}

export function rebuildVoteState(input: RebuildVoteStateInput): RebuiltVoteState {
  const poll = Array(input.playerIds.length).fill(0)
  const linRealityRecords = input.linDanHan.realityRecords.map(seat => Math.abs(seat))
  const shiTeammateAttackers: number[] = []
  const ballotEffects: BallotEffect[] = []
  let waiver = 0
  const linSeat = input.heroes.linDanHanSeat
  const linPlayerIndex = input.playerOrder.indexOf(linSeat)
  const linVoterIndex = linPlayerIndex === -1 ? -1 : input.voterIds.indexOf(input.playerIds[linPlayerIndex])
  const linTarget = linVoterIndex === -1 ? 0 : input.ballots[linVoterIndex]
  const linTargetIndex = input.playerOrder.indexOf(linTarget)
  const targetVoterIndex = linTargetIndex === -1 ? -1 : input.voterIds.indexOf(input.playerIds[linTargetIndex])
  const linOwnVoteInvalidated = input.linDanHan.awakened && linTargetIndex !== -1
    && targetVoterIndex !== -1 && input.ballots[targetVoterIndex] === linSeat

  for (let index = 0; index < input.voterIds.length; index++) {
    const playerIndex = input.playerIds.indexOf(input.voterIds[index])
    if (playerIndex === -1) continue
    const voterSeat = input.playerOrder[playerIndex]
    const targetSeat = input.ballots[index]
    if (targetSeat === 0) {
      waiver += 1
      continue
    }
    const targetIndex = input.playerOrder.indexOf(targetSeat)
    if (targetSeat <= 0 || targetIndex === -1) continue

    const linProtectedIndex = targetSeat === input.heroes.linDanHanSeat
      ? linRealityRecords.indexOf(voterSeat)
      : -1
    const invalidReasons: BallotInvalidReason[] = []
    if (linProtectedIndex !== -1) {
      linRealityRecords[linProtectedIndex] *= -1
      invalidReasons.push('lin-dan-han-protection')
    }
    if (linOwnVoteInvalidated && voterSeat === linSeat) invalidReasons.push('lin-dan-han-mutual')
    if (voterSeat === input.zhuYouXiao?.delegateSeat && targetSeat === input.zhuYouXiao.ownerSeat) {
      invalidReasons.push('zhu-you-xiao-delegation')
    }
    const weight = input.votePower[voterSeat - 1]
    const countedWeight = invalidReasons.length ? 0 : weight
    poll[targetIndex] += countedWeight
    ballotEffects.push({ voterSeat, targetSeat, weight, countedWeight, invalidReasons })

    const sameShiFaction = input.isSameFaction
      ? input.isSameFaction(input.heroes.shiKeFaSeat, voterSeat)
      : (input.undercoverSeats.indexOf(input.heroes.shiKeFaSeat) + 0.5)
        * (input.undercoverSeats.indexOf(voterSeat) + 0.5) > 0
    if (targetSeat === input.heroes.shiKeFaSeat
      && sameShiFaction
      && voterSeat !== input.whiteSeat && !(voterSeat === linSeat && linOwnVoteInvalidated)
      && !shiTeammateAttackers.includes(voterSeat)) {
      shiTeammateAttackers.push(voterSeat)
    }
  }

  let huangTarget = input.huangTaiJiRegularTarget
  if (!input.overtime) {
    const huangPlayerIndex = input.playerOrder.indexOf(input.heroes.huangTaiJiSeat)
    const huangVoterIndex = huangPlayerIndex === -1
      ? -1
      : input.voterIds.indexOf(input.playerIds[huangPlayerIndex])
    huangTarget = huangVoterIndex === -1 || input.ballots[huangVoterIndex] <= 0
      ? 0
      : input.ballots[huangVoterIndex]
  }
  else if (!input.playerOrder.includes(huangTarget)) {
    huangTarget = 0
  }

  return {
    poll,
    waiver,
    unvote: 0,
    skip: 0,
    linDanHanRealityRecords: linRealityRecords,
    linDanHanOwnVoteInvalidated: linOwnVoteInvalidated,
    linDanHanPreventedVotePower: 0,
    shiKeFaTeammateAttackers: shiTeammateAttackers,
    huangTaiJiRegularTarget: huangTarget,
    ballotEffects,
  }
}
