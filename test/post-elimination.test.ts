import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO_NUM, HERO } from "../src/heroes"
import { postEliminationHero } from "../src/game/post-elimination"

function heroSeats(zhangSeat: number, shiSeat: number): number[] {
  const seats = Array(HERO_NUM).fill(0)
  seats[HERO.ZHANG_XIAN_ZHONG] = zhangSeat
  seats[HERO.SHI_KE_FA] = shiSeat
  return seats
}

describe("post-elimination hero selection", () => {
  it("selects Zhang Xianzhong for his eliminated seat", () => {
    assert.equal(postEliminationHero(3, heroSeats(3, 7)), "zhang-xian-zhong")
  })

  it("selects Shi Kefa for his eliminated seat", () => {
    assert.equal(postEliminationHero(7, heroSeats(3, 7)), "shi-ke-fa")
  })

  it("does nothing for an ordinary eliminated seat", () => {
    assert.equal(postEliminationHero(5, heroSeats(3, 7)), null)
  })

  it("preserves Zhang Xianzhong priority for an invalid seat collision", () => {
    assert.equal(postEliminationHero(3, heroSeats(3, 3)), "zhang-xian-zhong")
  })

  it("does not open a hero window for roster departures", () => {
    assert.equal(postEliminationHero(3, heroSeats(3, 7), "kick"), null)
    assert.equal(postEliminationHero(3, heroSeats(3, 7), "self-exit"), null)
    assert.equal(postEliminationHero(3, heroSeats(3, 7), "timeout"), null)
    assert.equal(postEliminationHero(3, heroSeats(3, 7), "skill"), "zhang-xian-zhong")
  })
})
