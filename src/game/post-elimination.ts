import { HERO } from "../heroes"
import type { Seat } from "./hero-state"

export type PostEliminationHero =
  | "zhang-xian-zhong"
  | "shi-ke-fa"
  | null

export type PostEliminationCause = 'vote' | 'skill' | 'kick' | 'self-exit' | 'timeout'

export function postEliminationHero(
  eliminatedSeat: Seat,
  heroSeats: readonly number[],
  cause: PostEliminationCause = 'vote',
): PostEliminationHero {
  // Zhang Xianzhong's post-elimination window belongs only to a game
  // resolution.  Roster maintenance and automatic departures must never
  // accidentally open a skill prompt merely because the departed seat owns
  // that hero.
  if (cause !== 'vote' && cause !== 'skill') return null
  if (eliminatedSeat === heroSeats[HERO.ZHANG_XIAN_ZHONG]) {
    return "zhang-xian-zhong"
  }
  if (eliminatedSeat === heroSeats[HERO.SHI_KE_FA]) {
    return "shi-ke-fa"
  }
  return null
}
