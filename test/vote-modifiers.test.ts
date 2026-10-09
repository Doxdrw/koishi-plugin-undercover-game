import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  resolveDuoErGunProtection,
  resolveShiKeFaResistance,
} from "../src/game/vote-modifiers"
import type {
  ResolveDuoErGunProtectionInput,
  ResolveShiKeFaResistanceInput,
} from "../src/game/vote-modifiers"

function input(overrides: Partial<ResolveShiKeFaResistanceInput> = {}): ResolveShiKeFaResistanceInput {
  return {
    overtime: false,
    overtimeCandidateSeats: [],
    voterIds: ["a", "b", "c", "d"],
    ballots: [2, 3, 2, 2],
    playerIds: ["a", "b", "c", "d"],
    activeSeats: [1, 2, 3, 4],
    undercoverSeats: [3, 4],
    whiteSeat: 0,
    shiKeFaSeat: 3,
    mode: "resistance-available",
    teammateAttackers: [4],
    ...overrides,
  }
}

describe("Shi Kefa resistance vote window", () => {
  it("reduces one vote and one future gift when resistance remains available", () => {
    assert.deepEqual(resolveShiKeFaResistance(input()), {
      mode: "resistance-available",
      notice: "reduced",
      pollAdjustment: -1,
      giftBalanceAdjustment: -1,
    })
  })

  it("loses resistance before reduction when Shi Kefa votes for a teammate", () => {
    assert.deepEqual(resolveShiKeFaResistance(input({ ballots: [2, 3, 4, 2] })), {
      mode: "resistance-lost",
      notice: "unavailable",
      pollAdjustment: 0,
      giftBalanceAdjustment: 0,
    })
  })

  it("notifies a regular-vote Shi Kefa when no teammate attacked", () => {
    assert.equal(resolveShiKeFaResistance(input({ teammateAttackers: [] })).notice, "no-teammate")
  })

  it("suppresses the no-attacker notice when Shi Kefa is outside overtime", () => {
    assert.equal(resolveShiKeFaResistance(input({
      overtime: true,
      overtimeCandidateSeats: [1, 2],
      teammateAttackers: [],
    })).notice, "none")
  })
})

function dorgonInput(
  overrides: Partial<ResolveDuoErGunProtectionInput> = {},
): ResolveDuoErGunProtectionInput {
  return {
    activeSeats: [1, 2, 3, 4],
    poll: [0, 2, 1, 0],
    duoErGunSeat: 4,
    strategyMark: { kind: "new", seat: 2 },
    ...overrides,
  }
}

describe("Dorgon protection vote window", () => {
  it("reduces one positive vote from a newly protected active seat", () => {
    assert.deepEqual(resolveDuoErGunProtection(dorgonInput()), {
      protectedSeat: 2,
      pollAdjustment: -1,
    })
  })

  it("does not reduce a zero vote", () => {
    assert.deepEqual(resolveDuoErGunProtection(dorgonInput({ poll: [0, 0, 1, 0] })), {
      protectedSeat: null,
      pollAdjustment: 0,
    })
  })

  it("requires Dorgon and the protected seat to remain active", () => {
    assert.equal(resolveDuoErGunProtection(dorgonInput({ activeSeats: [1, 2, 3] })).protectedSeat, null)
    assert.equal(resolveDuoErGunProtection(dorgonInput({ activeSeats: [1, 3, 4] })).protectedSeat, null)
  })

  it("only applies during the new-mark round", () => {
    assert.equal(resolveDuoErGunProtection(dorgonInput({
      strategyMark: { kind: "established", seat: 2 },
    })).protectedSeat, null)
  })
})
