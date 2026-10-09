export interface MutableRosterState {
  readonly activeUserIds: string[]
  readonly activeNames: string[]
  readonly fixedNames: string[]
  readonly fixedUserIds: string[]
  readonly activeSeats: number[]
  readonly activeUndercoverSeats: number[]
  readonly whiteSeat: number
  readonly whiteActive: boolean
  readonly whiteOnly: boolean
}

export interface RemoveRosterSeatInput {
  readonly seat: number
  readonly kicked: boolean
  readonly checkWhiteOnly: boolean
}

export interface RemoveRosterSeatResult {
  readonly activeIndex: number
  readonly departingName: string
  readonly departingUserId: string
  readonly whiteSeat: number
  readonly whiteActive: boolean
  readonly whiteOnly: boolean
}

/**
 * Applies the legacy fixed-seat removal transaction to every roster array.
 * Callers must supply an active seat; keeping that precondition explicit avoids
 * silently removing the last array element through Array.splice(-1, 1).
 */
export function removeRosterSeat(
  state: MutableRosterState,
  input: RemoveRosterSeatInput,
): RemoveRosterSeatResult {
  const activeIndex = state.activeSeats.indexOf(input.seat)
  if (activeIndex < 0) throw new RangeError(`Seat ${input.seat} is not active`)

  const departingName = state.activeNames[activeIndex] ?? state.fixedNames[input.seat - 1] ?? ""
  const departingUserId = state.activeUserIds[activeIndex] ?? state.fixedUserIds[input.seat - 1] ?? ""
  const undercoverIndex = state.activeUndercoverSeats.indexOf(input.seat)
  if (undercoverIndex !== -1) state.activeUndercoverSeats.splice(undercoverIndex, 1)

  const whiteRemoved = input.seat === state.whiteSeat
  state.activeUserIds.splice(activeIndex, 1)
  state.activeNames.splice(activeIndex, 1)
  state.activeSeats.splice(activeIndex, 1)
  if (input.kicked) {
    state.fixedNames[input.seat - 1] = ""
    state.fixedUserIds[input.seat - 1] = ""
  }

  const whiteSeat = whiteRemoved ? 0 : state.whiteSeat
  const whiteActive = whiteRemoved ? false : state.whiteActive
  const whiteOnly = !whiteActive ? false : input.checkWhiteOnly && state.activeUndercoverSeats.length === 0
    ? true
    : state.whiteOnly

  return {
    activeIndex,
    departingName,
    departingUserId,
    whiteSeat,
    whiteActive,
    whiteOnly,
  }
}
