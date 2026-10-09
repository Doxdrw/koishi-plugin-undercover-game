import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { GameRouteCoordinator } from "../src/game/game-route"

describe("single-game route coordinator", () => {
  it("binds one platform, guild, and bot and clears them together", () => {
    const route = new GameRouteCoordinator<{ id: string, selfId: string }>()
    const bot = { id: "koishi", selfId: "bot-1" }
    assert.equal(route.active, false)
    route.bind("onebot", "guild-1", bot)
    assert.equal(route.active, true)
    assert.equal(route.platform, "onebot")
    assert.equal(route.guildId, "guild-1")
    assert.equal(route.bot, bot)
    assert.equal(route.matches("onebot", "guild-1"), true)
    assert.equal(route.matches("sandbox", "guild-1"), false)
    assert.equal(route.matchesGuild("guild-1"), true)
    assert.equal(route.matchesBot("onebot", "bot-1"), true)
    assert.equal(route.matchesBot("onebot", "bot-2"), false)
    assert.equal(route.matchesPrivate("onebot", "bot-1"), true)
    assert.equal(route.matchesPrivate("onebot", "bot-1", "guild-1"), true)
    assert.equal(route.matchesPrivate("onebot", "bot-1", "guild-2"), false)

    route.clear()
    assert.equal(route.active, false)
    assert.equal(route.platform, "")
    assert.equal(route.guildId, "")
    assert.equal(route.bot, undefined)
  })

  it("rebinds atomically for a later game", () => {
    const route = new GameRouteCoordinator<number>()
    route.bind("sandbox:a", "guild-a", 1)
    route.bind("sandbox:b", "guild-b", 2)
    assert.deepEqual(
      [route.platform, route.guildId, route.bot],
      ["sandbox:b", "guild-b", 2],
    )
  })

  it("does not treat the same guild id on another bot as the active route", () => {
    const route = new GameRouteCoordinator<{ selfId: string }>()
    route.bind("onebot", "same-guild", { selfId: "bot-a" })
    assert.equal(route.matches("other-platform", "same-guild"), false)
    assert.equal(route.matchesBot("onebot", "bot-b"), false)
    assert.equal(route.matchesPrivate("onebot", "bot-b"), false)
  })
})
