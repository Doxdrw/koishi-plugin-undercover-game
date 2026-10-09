import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, mock } from "node:test"
import type { Config } from "../src/index"
import { HERO, HERO_NUM, HERO_NAMES } from "../src/heroes"
import { ResolutionCursor } from "../src/game/resolution-pipeline"
import { UndercoverGameHarness } from "./game-harness"
import { png as createPng } from "./image-fixtures"

const PLAYER_IDS = ["alice", "bob", "carol", "dave", "eve", "frank"] as const
const PLAYER_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"] as const
const DEFAULT_NOTIFICATIONS: Config["notifications"] = {
  voteStartPrivate: true,
  voteFirstSuccessReceipt: false,
  voteHurryPrivate: true,
  voteHurryGroup: true,
  turtleAnswerPrivate: false,
  turtleHostHalfReminder: true,
}

const groupTranscript = (game: UndercoverGameHarness) => game.transcript
  .filter(entry => entry.direction === "out" && entry.scope === "group")
  .map(entry => entry.content)
  .join("\n")
const latestGroupOutput = (game: UndercoverGameHarness) => game.transcript
  .filter(entry => entry.direction === "out" && entry.scope === "group")
  .at(-1)?.content ?? ""

const privateTranscript = (game: UndercoverGameHarness, userId: string) => game.transcript
  .filter(entry =>
    entry.direction === "out"
    && entry.scope === "private"
    && entry.channelId === `@${userId}`,
  )
  .map(entry => entry.content)
  .join("\n")
const latestPrivateOutput = (game: UndercoverGameHarness, userId: string) => game.transcript
  .filter(entry => entry.direction === "out" && entry.scope === "private" && entry.channelId === `@${userId}`)
  .at(-1)?.content ?? ""

async function advanceUntilSettled(promise: Promise<void>, maximumTicks = 20): Promise<void> {
  let settled = false
  let failure: unknown
  void promise.then(
    () => { settled = true },
    error => {
      settled = true
      failure = error
    },
  )

  for (let index = 0; index < maximumTicks && !settled; index++) {
    await new Promise<void>(resolve => setImmediate(resolve))
    mock.timers.tick(1000)
  }
  await new Promise<void>(resolve => setImmediate(resolve))
  if (failure) throw failure
  assert.ok(settled, "\u865a\u62df\u8ba1\u65f6\u5668\u672a\u80fd\u63a8\u8fdb\u5230\u53d1\u9898\u5b8c\u6210")
  await promise
}

async function withGame(
  run: (game: UndercoverGameHarness) => Promise<void>,
  config: Partial<Config> = {},
  options: Parameters<typeof UndercoverGameHarness.create>[1] = {},
): Promise<void> {
  const game = await UndercoverGameHarness.create({
    ...(process.env.UNDERCOVER_TEST_HISTORY === '1' ? { history: { enabled: true, sandbox: true, retentionDays: 0 } } : {}),
    ...(process.env.UNDERCOVER_TEST_DEBUG === '1' ? { debug: { enabled: true, privateBodies: false, guilds: ['diagnostic-no-disk-filter'] } } : {}),
    ...config,
  }, options)
  mock.timers.enable({ apis: ["Date", "setTimeout"] })
  try {
    await run(game)
  }
  finally {
    await game.stop()
    mock.timers.reset()
    if (process.env.UNDERCOVER_TEST_HISTORY === '1') assert.doesNotMatch(groupTranscript(game), /本局历史采集不完整|对局历史保存失败/)
  }
}

async function startSixPlayerGame(
  game: UndercoverGameHarness,
  timeoutMode = "5",
  expectSandbox = true,
): Promise<void> {
  await game.addUser("host", "\u4e3b\u6301\u4eba", 4)
  for (let index = 0; index < PLAYER_IDS.length; index++) {
    await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
  }

  await game.sendGroup("host", "\u5367\u5e95")
  for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
  await game.sendGroup("host", "\u5f00\u59cb")
  await game.sendGroup("host", "\u666e\u901a\u5c40")

  await game.sendPrivate("host", "\u82f9\u679c")
  await game.sendPrivate("host", "\u65e0")
  await game.sendPrivate("host", "\u68a8")
  await game.sendPrivate("host", "\u65e0")
  await advanceUntilSettled(game.sendPrivate("host", timeoutMode))

  const transcript = groupTranscript(game)
  if (expectSandbox) {
    assert.match(transcript, /\u5f00\u59cb\u51d1\u4eba\uff0c\u8bf7\u62631\uff08\u6c99\u76d2\u6d4b\u8bd5\u6a21\u5f0f\uff1a\u672c\u5c40\u4e0d\u4f1a\u5199\u5165\u79ef\u5206\uff09/)
  } else {
    assert.doesNotMatch(transcript, /沙盒测试模式/)
  }
  assert.match(transcript, /\u53d1\u9898\u5b8c\u6bd5\uff0c\u5f00\u59cb\u7b2c1\u8f6e/)
}

async function startCustomSixPlayerGame(
  game: UndercoverGameHarness,
  heroSeats: Partial<Record<number, number>>,
  addUsers = true,
  timeoutMode = "5",
  useVirtualTimers = true,
  whiteSeat = 0,
): Promise<void> {
  if (addUsers) {
    await game.addUser("host", "主持人", 4)
    for (let index = 0; index < PLAYER_IDS.length; index++) {
      await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
    }
  }

  await game.sendGroup("host", "卧底")
  for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
  await game.sendGroup("host", "开始")
  await game.sendGroup("host", "自定义")

  await game.sendPrivate("host", "2")
  await game.sendPrivate("host", whiteSeat ? "是" : "否")
  await game.sendPrivate("host", "5")
  await game.sendPrivate("host", "6")
  if (whiteSeat) await game.sendPrivate("host", String(whiteSeat))
  await game.sendPrivate("host", "是")
  for (let hero = 0; hero < HERO_NUM; hero++) {
    await game.sendPrivate("host", String(heroSeats[hero] ?? 0))
  }

  await game.sendPrivate("host", "苹果")
  await game.sendPrivate("host", "无")
  await game.sendPrivate("host", "梨")
  await game.sendPrivate("host", "无")
  if (whiteSeat) await game.sendPrivate("host", "白板提示")
  const finalSetup = game.sendPrivate("host", timeoutMode)
  if (useVirtualTimers) await advanceUntilSettled(finalSetup)
  else await finalSetup

  assert.match(groupTranscript(game), /发题完毕，开始第1轮/)
}

async function finishSpeech(game: UndercoverGameHarness, activeSeats: readonly number[]): Promise<void> {
  for (const seat of activeSeats) {
    await game.sendGroup(PLAYER_IDS[seat - 1], seat + "\u53f7\u6d4b\u8bd5\u53d1\u8a00")
  }
  assert.match(groupTranscript(game), /\u73b0\u5728\u5f00\u59cb\u6295\u7968/)
}

function undercoverSeats(game: UndercoverGameHarness): number[] {
  const briefing = game.transcript.find(entry =>
    entry.direction === "out"
    && entry.scope === "private"
    && entry.channelId === "@host"
    && entry.content.includes("\u968f\u673a\u751f\u6210\u672c\u5c40\u6e38\u620f")
    && entry.content.includes("\u4e3a\u5367\u5e95"),
  )
  assert.ok(briefing, "\u4e3b\u6301\u4eba\u5e94\u6536\u5230\u5367\u5e95\u5ea7\u4f4d\u901a\u77e5")
  const seats = [...briefing.content.matchAll(/(\d+)\u53f7\u73a9\u5bb6/g)].map(match => Number(match[1]))
  assert.equal(seats.length, 2)
  return seats
}

async function voteOut(game: UndercoverGameHarness, targetSeat: number, activeSeats: readonly number[]): Promise<void> {
  const alternative = activeSeats.find(seat => seat !== targetSeat)
  assert.ok(alternative)
  await game.sendPrivate(PLAYER_IDS[targetSeat - 1], String(alternative))
  for (const seat of activeSeats) {
    if (seat === targetSeat) continue
    await game.sendPrivate(PLAYER_IDS[seat - 1], String(targetSeat))
  }
}

describe('A13 white survival boundaries', () => {
  it('keeps speech-stage departures and Zhu backlash from ending a four-player white window early', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      await game.sendGroup('alice', '处决2')
      assert.match(groupTranscript(game), /处决失败/)
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      await finishSpeech(game, [2, 3, 4])
      for (const id of ['bob', 'carol', 'dave']) await game.sendPrivate(id, '弃')
      assert.match(groupTranscript(game), /游戏结束，白板胜利/)
    })
  })

  it('requires another vote when the final undercover is eliminated by the current vote', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await voteOut(game, 6, [1, 2, 3, 4, 6])
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      assert.match(groupTranscript(game), /开始第3轮/)
      await finishSpeech(game, [1, 2, 3, 4])
      await voteOut(game, 1, [1, 2, 3, 4])
      assert.match(groupTranscript(game), /游戏结束，白板胜利/)
    })
  })

  it('accepts final-undercover departure during regular voting without declaring victory inside the departure', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await game.sendPrivate('alice', '2')
      await game.sendGroup('host', '踢出6')
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      await game.sendPrivate('bob', '1')
      await game.sendPrivate('carol', '1')
      await game.sendPrivate('dave', '2')
      assert.match(groupTranscript(game), /白板未参与加时，游戏结束，白板胜利/)
    })
  })

  for (const candidate of [true, false]) it(`does not activate an excluded white overtime when final undercover leaves (${candidate ? 'candidate' : 'non-candidate'})`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await finishSpeech(game, [1, 2, 3, 4, 6])
      const ballots = candidate ? [2, 6, 6, 2, 3] : [2, 1, 1, 2, 3]
      for (const [index, seat] of [1, 2, 3, 4, 6].entries()) await game.sendPrivate(PLAYER_IDS[seat - 1], String(ballots[index]))
      assert.match(groupTranscript(game), /进入第1轮加时/)
      await game.sendGroup('host', '踢出6')
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      if (!candidate) {
        assert.doesNotMatch(groupTranscript(game), /开始第2轮/)
        await game.sendGroup('alice', '1加时发言')
        await game.sendGroup('bob', '2加时发言')
        await game.sendPrivate('carol', '1')
        await game.sendPrivate('dave', '2')
      }
      assert.match(groupTranscript(game), /开始第2轮/)
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
    })
  })

  for (const whiteOut of [false, true]) it(`settles a participating white overtime only after its vote (${whiteOut ? 'white eliminated' : 'white survives'})`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await finishSpeech(game, [1, 2, 3, 4, 6])
      for (const [index, seat] of [1, 2, 3, 4, 6].entries()) await game.sendPrivate(PLAYER_IDS[seat - 1], String([4, 1, 4, 1, 2][index]))
      await game.sendGroup('host', '踢出6')
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      await game.sendGroup('alice', '1加时发言')
      await game.sendGroup('dave', '4加时发言')
      await game.sendPrivate('bob', whiteOut ? '4' : '1')
      await game.sendPrivate('carol', whiteOut ? '4' : '1')
      assert.match(groupTranscript(game), whiteOut ? /游戏结束，好人胜利/ : /游戏结束，白板胜利/)
    })
  })

  it('preserves the independent fewer-than-three white victory', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      for (const seat of [5, 6, 1]) await game.sendGroup('host', '踢出' + seat)
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      await game.sendGroup('host', '踢出2')
      assert.match(groupTranscript(game), /游戏结束，白板胜利/)
      assert.doesNotMatch(groupTranscript(game), /游戏结束，好人胜利/)
    })
  })

  for (const choice of ['4', '弃', 'timeout']) it(`waits for a post-vote Zhang choice before white survival (${choice})`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 3 }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      await finishSpeech(game, [1, 2, 3, 4])
      await voteOut(game, 3, [1, 2, 3, 4])
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      if (choice === 'timeout') await tickGameClock(121_000)
      else await game.sendGroup('carol', choice)
      assert.match(groupTranscript(game), choice === '4' ? /游戏结束，好人胜利/ : /游戏结束，白板胜利/)
      assert.doesNotMatch(groupTranscript(game), /开始第2轮/)
    })
  })

  it('does not award a white Yuan Chonghuan who will leave in pending retaliation', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 4 }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      await finishSpeech(game, [1, 2, 3, 4])
      await game.sendPrivate('dave', '守1')
      await game.sendPrivate('alice', '4')
      await game.sendPrivate('bob', '3')
      await game.sendPrivate('carol', '弃')
      await game.sendPrivate('dave', '3')
      assert.match(groupTranscript(game), /被其所守卫的1号玩家Alice带走/)
      assert.match(groupTranscript(game), /游戏结束，好人胜利/)
      assert.doesNotMatch(groupTranscript(game), /游戏结束，白板胜利/)
    })
  })
})

describe('A13 pre-deal mode switches', () => {
  async function gather(game: UndercoverGameHarness) {
    await game.addUser('host', '主持人', 4)
    for (const [index, id] of PLAYER_IDS.entries()) await game.addUser(id, PLAYER_NAMES[index])
    await game.sendGroup('host', '卧底')
    for (const id of PLAYER_IDS) await game.sendGroup(id, '1')
    await game.sendGroup('host', '普通局')
    await game.sendGroup('host', '开始')
  }

  it('resets classic, deer and turtle setup before dealing while preserving the roster and hero choice', async () => {
    await withGame(async game => {
      await gather(game)
      await game.sendGroup('host', '是')
      await game.sendPrivate('host', '旧经典词条')
      await game.sendGroup('host', '鹿模式')
      assert.match(latestGroupOutput(game), /已切换为鹿模式/)
      await game.sendGroup('host', '否')
      await game.sendPrivate('host', '旧鹿规则甲')
      await game.sendPrivate('host', '旧鹿规则乙')
      await game.sendPrivate('host', '旧易混')
      await game.sendGroup('host', '龟模式')
      assert.match(latestPrivateOutput(game, 'host'), /请输入龟模式汤面/)
      await tickGameClock(60_000)
      assert.doesNotMatch(groupTranscript(game), /发题完毕|超时，已自动选择/)
      await game.sendPrivate('host', '发题状态')
      assert.match(latestPrivateOutput(game, 'host'), /当前模式：龟模式/)
      assert.doesNotMatch(latestPrivateOutput(game, 'host'), /旧经典词条|旧鹿规则|旧易混/)
      await game.sendPrivate('host', '新汤面')
      await game.sendPrivate('host', '新好人词条')
      await game.sendPrivate('host', '新卧底词条')
      await advanceUntilSettled(game.sendPrivate('host', '5'))
      for (const id of PLAYER_IDS) assert.match(privateTranscript(game, id), /龟模式汤面：新汤面/)
      assert.doesNotMatch(privateTranscript(game, 'alice'), /你是白板|抽到的武将/)
      const count = game.transcript.filter(entry => entry.direction === 'out').length
      await game.sendGroup('host', '经典模式')
      assert.equal(game.transcript.filter(entry => entry.direction === 'out').length, count)
    }, { whiteMinPlayers: 6 })
  })

  it('discards custom roles, white and hero input when switching back to classic', async () => {
    await withGame(async game => {
      await gather(game)
      await game.sendGroup('host', '自定义')
      await game.sendPrivate('host', '1')
      await game.sendPrivate('host', '是')
      await game.sendPrivate('host', '1')
      await game.sendPrivate('host', '2')
      await game.sendPrivate('host', '是')
      await game.sendPrivate('host', '3')
      await game.sendGroup('host', '龟模式')
      await game.sendGroup('host', '经典模式')
      assert.match(latestGroupOutput(game), /已切换为经典模式/)
      await game.sendGroup('host', '否')
      await game.sendPrivate('host', '新苹果')
      assert.match(latestPrivateOutput(game, 'host'), /好人词条新苹果雷点/)
      await game.sendPrivate('host', '无')
      await game.sendPrivate('host', '新梨')
      await game.sendPrivate('host', '无')
      await advanceUntilSettled(game.sendPrivate('host', '5'))
      assert.doesNotMatch(privateTranscript(game, 'carol'), /抽到的武将/)
      assert.match(groupTranscript(game), /发题完毕，开始第1轮/)
    }, { whiteMinPlayers: 6 })
  })

  it('leaves non-host, foreign-route and disabled-mode requests outside a valid switch', async () => {
    await withGame(async game => {
      await gather(game)
      await game.sendPrivate('host', '保留词条')
      await game.sendGroup('alice', '龟模式')
      await game.sendGroupTo('other-guild', 'host', '龟模式')
      await game.sendGroup('host', '鹿模式')
      assert.match(latestGroupOutput(game), /本实例未启用鹿模式/)
      await game.sendPrivate('host', '发题状态')
      assert.match(latestPrivateOutput(game, 'host'), /保留词条/)
      assert.match(latestPrivateOutput(game, 'host'), /当前模式：经典模式/)
    }, { enabledSpecialModes: ['turtle'] })
  })
})

describe('A13 face history', () => {
  it('keeps face nodes in current overview and persisted replay, with a safe placeholder for missing IDs', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendGroup('alice', '1发言<face id="14" name="微笑" platform="onebot"><img src="https://cdn.example/face.png"/></face>')
      await game.sendGroup('bob', '2<face id="66"/>')
      await game.sendGroup('carol', '3<face name="未知" payload="private-token"/>')
      await game.sendGroup('dave', '4混合<face id="14"/><face id="66"/><img src="https://cdn.example/speech.png"/>')
      await game.sendGroup('eve', '5发言')
      await game.sendGroup('frank', '6发言')
      await game.sendGroup('host', '发言总览')
      const overview = latestGroupOutput(game)
      assert.match(overview, /<face id="14"/)
      assert.match(overview, /<face id="66"/)
      assert.doesNotMatch(overview, /&lt;face|private-token/)
      await game.sendGroup('host', '结束卧底')
      await game.sendGroup('host', '历史对局 --aborted')
      const rows = await game.app.database.get('undercover_history_phase', {})
      const speeches = JSON.parse(rows[0].payload).speeches
      assert.deepEqual(speeches[1].segments, [{ kind: 'text', text: '2' }, { kind: 'face', id: '66', platform: 'onebot' }])
      assert.equal(speeches[2].text, '3[表情]')
      assert.doesNotMatch(rows[0].payload, /<face|private-token|face\.png/)
      const beforeReplay = groupTranscript(game).length
      await game.sendGroup('host', '复盘 1')
      assert.match(groupTranscript(game).slice(beforeReplay), /<face id="14"/)
      assert.doesNotMatch(groupTranscript(game).slice(beforeReplay), /&lt;face/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } }, { platform: 'onebot' })
  })
})

describe('A13 white consolation awards', () => {
  const scoring = (calls: Array<{ accountId: string, amount: number, reason: string, key: string }>, fail = false) => ({
    ensureManagedIdentity: async (_platform: string, userId: string, suggested?: string) => ({
      profileId: userId === 'host' ? 1 : PLAYER_IDS.indexOf(userId) + 2,
      accountId: 'account-' + userId, nickname: suggested ?? userId, automatic: false,
    }),
    registerScoreConsumer: () => ({ systemKey: 'undercover', dispose() {},
      addAccount: async (target: { accountId: string }, amount: number, context: { reason: string, idempotencyKey?: string }) => {
        calls.push({ accountId: target.accountId, amount, reason: context.reason, key: context.idempotencyKey! })
        if (fail && context.reason === 'white-survival-consolation') throw new Error('injected consolation failure')
        return { after: amount }
      },
    }),
  })
  async function reachExplosion(game: UndercoverGameHarness) {
    await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
    await finishSpeech(game, [1, 2, 3, 4, 5, 6])
    await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
    await finishSpeech(game, [1, 2, 3, 4, 6])
    await voteOut(game, 3, [1, 2, 3, 4, 6])
  }
  for (const decision of ['direct', '是', '否']) it(`awards the surviving white once for an undercover explosion (${decision})`, async () => {
    const calls: Array<{ accountId: string, amount: number, reason: string, key: string }> = []
    await withGame(async game => {
      await reachExplosion(game)
      await game.sendGroup('frank', decision === 'direct' ? '6自爆苹果' : '6自爆未匹配')
      if (decision !== 'direct') await game.sendGroup('host', decision)
      await game.sendGroup('host', '是')
      const consolation = calls.filter(c => c.reason === 'white-survival-consolation')
      assert.equal(consolation.length, 1)
      assert.equal(consolation[0].accountId, 'account-dave')
      assert.equal(consolation[0].amount, 1)
      assert.match(consolation[0].key, /^[0-9a-f-]{36}:white-survival-consolation:account-dave$/)
      assert.match(groupTranscript(game), /Dave仍在场，获得1分安慰积分/)
      await game.sendGroup('host', '历史对局')
      const history = await game.app.database.get('undercover_history_game', {})
      const awards = JSON.parse(history[0].payload).awards.filter(a => a.reason === 'white-survival-consolation')
      assert.equal(awards.length, 1)
      assert.equal(awards[0].status, 'written')
    }, {}, { platform: 'onebot', xpPoints: scoring(calls) })
  })

  it('keeps the existing one-point white award for no-winner good explosion without an extra consolation', async () => {
    const calls: Array<{ accountId: string, amount: number, reason: string, key: string }> = []
    await withGame(async game => {
      await reachExplosion(game)
      await game.sendGroup('bob', '2自爆')
      assert.match(groupTranscript(game), /好人自爆，无人胜利/)
      assert.deepEqual(calls.filter(c => c.accountId === 'account-dave').map(c => [c.amount, c.reason]), [[1, 'direct-good-boom-no-winner']])
      assert.doesNotMatch(groupTranscript(game), /安慰积分/)
    }, {}, { platform: 'onebot', xpPoints: scoring(calls) })
  })

  it('does not reward a failed white self-explosion or an aborted game', async () => {
    const calls: Array<{ accountId: string, amount: number, reason: string, key: string }> = []
    await withGame(async game => {
      await reachExplosion(game)
      await game.sendGroup('host', '踢出6')
      await game.sendGroup('dave', '4自爆未匹配')
      await game.sendGroup('host', '否')
      assert.match(groupTranscript(game), /白板自爆失败.*好人胜利/)
      assert.equal(calls.filter(c => c.accountId === 'account-dave').length, 0)
      await startCustomSixPlayerGame(game, {}, false, '5', true, 4)
      await game.sendGroup('host', '结束卧底')
      assert.equal(calls.filter(c => c.reason === 'white-survival-consolation').length, 0)
    }, {}, { platform: 'onebot', xpPoints: scoring(calls) })
  })

  for (const fail of [false, true]) it(`includes a parity-loss consolation and its final receipt (${fail ? 'failed write' : 'success'})`, async () => {
    const calls: Array<{ accountId: string, amount: number, reason: string, key: string }> = []
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, '5', true, 4)
      for (const seat of [5, 1, 2, 3]) await game.sendGroup('host', '踢出' + seat)
      assert.match(groupTranscript(game), /游戏结束，卧底胜利/)
      assert.equal(calls.filter(c => c.reason === 'white-survival-consolation').length, 1)
      if (fail) assert.match(groupTranscript(game), /Dave的积分未能写入数据库/)
      await game.sendGroup('host', '历史对局')
      const row = (await game.app.database.get('undercover_history_game', {}))[0]
      const award = JSON.parse(row.payload).awards.find(a => a.reason === 'white-survival-consolation')
      assert.equal(award.status, fail ? 'failed' : 'written')
      await game.sendGroup('host', '卧底')
      assert.match(latestGroupOutput(game), /开始凑人/)
    }, {}, { platform: 'onebot', xpPoints: scoring(calls, fail) })
  })
})

async function reachWuSanGuiChoice(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.WU_SAN_GUI]: 1 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  const ballots = [5, 5, 6, 6, 4, 3]
  for (let index = 0; index < ballots.length; index++) {
    await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
  }
  assert.match(groupTranscript(game), /亮出武将牌：吴三桂，请Alice选择/)
}

async function reachMaoWenLongChoice(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.MAO_WEN_LONG]: 1 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  const ballots = [5, 5, 6, 6, 3]
  for (let index = 0; index < ballots.length; index++) {
    await game.sendPrivate(PLAYER_IDS[index + 1], String(ballots[index]))
  }
  assert.match(groupTranscript(game), /其他人投票结束，等待毛文龙投票/)
}

async function reachHuangTaiJiChoice(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.HUANG_TAI_JI]: 1 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  const firstRoundBallots = [5, 5, 5, 5, 2, 5]
  for (let index = 0; index < firstRoundBallots.length; index++) {
    await game.sendPrivate(PLAYER_IDS[index], String(firstRoundBallots[index]))
  }
  assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)

  await finishSpeech(game, [1, 2, 3, 4, 6])
  const secondRoundBallots = new Map([
    [1, 3],
    [2, 3],
    [3, 4],
    [4, 2],
    [6, 4],
  ])
  for (const [seat, target] of secondRoundBallots) {
    await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
  }
  assert.match(groupTranscript(game), /投票结束，等待皇太极发动技能/)
}

async function reachZhangXianZhongTarget(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 5 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
  assert.match(groupTranscript(game), /技能触发，请Eve.*选择带出局的玩家/)
}

async function reachShiKeFaGift(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.SHI_KE_FA]: 5 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
  assert.match(groupTranscript(game), /技能触发，请Eve在私聊中选择一名玩家获得一定数量的“伐”标记/)
  assert.match(privateTranscript(game, "eve"), /阁部，您可以将2个“伐”标记赠予/)
}

async function settleVoteWithSeatFourLeader(
  game: UndercoverGameHarness,
  aliceVote?: string,
): Promise<void> {
  if (aliceVote !== undefined) await game.sendPrivate("alice", aliceVote)
  await game.sendPrivate("bob", "4")
  await game.sendPrivate("carol", "4")
  await game.sendPrivate("dave", "3")
  await game.sendPrivate("eve", "4")
  await game.sendPrivate("frank", "4")
}

async function reachDuoErGunRegency(game: UndercoverGameHarness): Promise<void> {
  await startCustomSixPlayerGame(game, { [HERO.DUO_ER_GUN]: 1 })
  await finishSpeech(game, [1, 2, 3, 4, 5, 6])
  await game.sendPrivate("alice", "立2")

  const firstRoundBallots = [4, 3, 4, 3, 4, 3]
  for (let index = 0; index < firstRoundBallots.length; index++) {
    await game.sendPrivate(PLAYER_IDS[index], String(firstRoundBallots[index]))
  }
  assert.match(groupTranscript(game), /进入第1轮加时/)
  await finishSpeech(game, [3, 4])

  const firstOvertimeBallots = new Map([
    [1, 4],
    [2, 4],
    [5, 4],
    [6, 3],
  ])
  for (const [seat, target] of firstOvertimeBallots) {
    await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
  }
  assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)

  await finishSpeech(game, [1, 2, 3, 5, 6])
  await game.sendPrivate("alice", "立3")
  const secondRoundBallots = new Map([
    [1, 2],
    [2, 5],
    [3, 2],
    [5, 6],
    [6, 5],
  ])
  for (const [seat, target] of secondRoundBallots) {
    await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
  }
  assert.match(groupTranscript(game), /进入第2轮加时/)
  await finishSpeech(game, [2, 5])

  await game.sendPrivate("alice", "2")
  await game.sendPrivate("carol", "5")
  await game.sendPrivate("frank", "弃")

  assert.match(groupTranscript(game), /多尔衮.*入关，获得技能“摄政”/)
  assert.match(privateTranscript(game, "alice"), /获得摄政大权/)
}

async function startCustomDeerGame(
  game: UndercoverGameHarness,
  timeoutMode = "5",
  heroSeats: Partial<Record<number, number>> = {},
): Promise<void> {
  await game.addUser("host", "主持人", 4)
  for (let index = 0; index < PLAYER_IDS.length; index++) {
    await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
  }
  await game.sendGroup("host", "卧底")
  for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
  await game.sendGroup("host", "鹿模式")
  await game.sendGroup("host", "开始")
  await game.sendGroup("host", "自定义")
  await game.sendPrivate("host", "2")
  await game.sendPrivate("host", "否")
  await game.sendPrivate("host", "5")
  await game.sendPrivate("host", "6")
  if (Object.keys(heroSeats).length > 0) {
    await game.sendPrivate("host", "是")
    for (let hero = 0; hero < HERO_NUM; hero++) {
      await game.sendPrivate("host", String(heroSeats[hero] ?? 0))
    }
  }
  else await game.sendPrivate("host", "否")
  await game.sendPrivate("host", "选择三国人物")
  await game.sendPrivate("host", "选择明朝人物")
  await game.sendPrivate("host", "诸葛亮")
  await advanceUntilSettled(game.sendPrivate("host", timeoutMode))
}

async function startCustomTurtleGame(
  game: UndercoverGameHarness,
  timeoutMode = "5",
  heroSeats: Partial<Record<number, number>> = {},
): Promise<void> {
  await game.addUser("host", "主持人", 4)
  for (let index = 0; index < PLAYER_IDS.length; index++) {
    await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
  }
  await game.sendGroup("host", "卧底")
  for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
  await game.sendGroup("host", "龟模式")
  await game.sendGroup("host", "开始")
  await game.sendGroup("host", "自定义")
  await game.sendPrivate("host", "2")
  await game.sendPrivate("host", "5")
  await game.sendPrivate("host", "6")
  if (Object.keys(heroSeats).length > 0) {
    await game.sendPrivate("host", "是")
    for (let hero = 0; hero < HERO_NUM; hero++) {
      await game.sendPrivate("host", String(heroSeats[hero] ?? 0))
    }
  }
  else await game.sendPrivate("host", "否")
  await game.sendPrivate("host", "众人参加一场宴会")
  await game.sendPrivate("host", "曹操")
  await game.sendPrivate("host", "孙权")
  await advanceUntilSettled(game.sendPrivate("host", timeoutMode))
}

async function submitAndApproveDeerSeat(
  game: UndercoverGameHarness,
  seat: number,
  candidate: string,
): Promise<void> {
  await game.sendPrivate(PLAYER_IDS[seat - 1], candidate)
  await game.sendPrivate("host", seat + "是")
}

async function tickGameClock(milliseconds: number): Promise<void> {
  let remaining = milliseconds
  while (remaining > 0) {
    const step = Math.min(1_000, remaining)
    mock.timers.tick(step)
    await new Promise<void>(resolve => setImmediate(resolve))
    remaining -= step
  }
}

describe("isolated multi-user game scenarios", { concurrency: false }, () => {
  it('archives a completed turtle game with corrected final answers and repeated overtime windows', async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      const speak = async (seats: number[]) => {
        for (const seat of seats) await game.sendGroup(PLAYER_IDS[seat - 1], seat + '他在宴会吗')
        for (const seat of seats) {
          await game.sendGroup('host', seat + '是')
          if (seat === seats[0] && seats.length > 1) await game.sendGroup('host', seat + '否')
        }
      }
      await speak([1, 2, 3, 4, 5, 6])
      for (let i = 0; i < 6; i++) await game.sendPrivate(PLAYER_IDS[i], String([2, 1, 2, 1, 2, 1][i]))
      await speak([1, 2])
      for (const [seat, target] of [[3, 1], [4, 2], [5, 1], [6, 2]]) await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      // A safe night may advance to the next normal round; either way every
      // later distinct speech window must have a unique archive sequence.
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      await game.sendGroup('alice', '历史对局')
      const rows = await game.app.database.get('undercover_history_game', {})
      assert.equal(rows.length, 1, groupTranscript(game))
      const phases = (await game.app.database.get('undercover_history_phase', { gameId: rows[0].gameId }, { sort: { sequence: 'asc' } })).map(p => JSON.parse(p.payload))
      assert.ok(phases.length >= 2)
      assert.equal(phases[0].speeches.find(s => s.question).answer, '否')
      assert.equal(new Set(phases.map(p => p.sequence)).size, phases.length)
      assert.equal(phases[1].kind, 'overtime')
      assert.doesNotMatch(groupTranscript(game), /历史采集不完整/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })
  it('persists stopped deer choices with replacement authors and keeps them hidden from ordinary recap/search', async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      await submitAndApproveDeerSeat(game, 1, '独有旧选人')
      await game.sendGroup('alice', '1前任发言')
      await game.sendGroup('host', '踢出1')
      await game.addUser('replacement', '后来者')
      await game.sendGroup('replacement', '1')
      await game.sendGroup('host', '是')
      await game.sendPrivate('replacement', '独有新选人')
      await game.sendPrivate('host', '1是')
      await game.sendGroup('replacement', '1后任发言')
      await game.sendGroup('host', '停止卧底')
      await game.sendGroup('host', '选人记录')
      const rows = await game.app.database.get('undercover_history_game', {})
      assert.equal(rows.length, 1, groupTranscript(game))
      assert.equal(rows[0].disposition, 'deer-aborted')
      await game.sendGroup('replacement', '公布选人')
      assert.match(latestGroupOutput(game), /后来者.*独有新选人/)
      assert.doesNotMatch(latestGroupOutput(game), /独有旧选人/)
      await game.sendGroup('alice', '隐藏选人')
      await game.sendGroup('host', '公布选人')
      assert.doesNotMatch(latestGroupOutput(game), /独有旧选人|Alice/)
      await game.sendGroup('host', '历史对局 -k 独有')
      assert.match(latestGroupOutput(game), /共0局/)
      await game.sendGroup('host', '卧底')
      await game.sendGroup('alice', '公布选人 ' + rows[0].id)
      assert.match(latestGroupOutput(game), /独有旧选人/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })
  it('persists an actual completed six-player game with phases, votes, departures and disabled sandbox award receipts', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await voteOut(game, 6, [1, 2, 3, 4, 6])
      let rows = []
      for (let i = 0; i < 100; i++) {
        rows = await game.app.database.get('undercover_history_game', {})
        if (rows.length) break
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      assert.equal(rows.length, 1, groupTranscript(game))
      const header = JSON.parse(rows[0].payload)
      assert.equal(header.ending.winner, 'good')
      assert.equal(header.participants.length, 6)
      assert.equal(header.awards.length, 4)
      assert.ok(header.awards.every(a => a.status === 'disabled'))
      const phases = await game.app.database.get('undercover_history_phase', { gameId: rows[0].gameId })
      assert.equal(phases.length, 2)
      assert.deepEqual(phases.sort((a,b) => a.sequence-b.sequence).map(p => JSON.parse(p.payload).speeches.length), [6, 5])
      assert.equal(JSON.parse(phases[0].payload).events.filter(e => e.kind === 'departure')[0].reason, 'vote')
      await game.sendGroup('alice', '历史对局')
      assert.match(latestGroupOutput(game), /共1局/)
      await game.sendGroup('alice', '复盘')
      assert.match(latestGroupOutput(game), /好人胜利.*投票结果/s)
      await game.sendGroupTo('foreign', 'host', '复盘 ' + rows[0].id)
      assert.match(game.transcript.filter(e => e.direction === 'out' && e.channelId === 'foreign').at(-1)!.content, /没有可访问/)
      await game.sendPrivate('alice', '复盘 ' + rows[0].id)
      assert.match(latestPrivateOutput(game, 'alice'), /好人胜利/)
      await game.addUser('stranger', '无关用户')
      await game.sendPrivate('stranger', '复盘 ' + rows[0].id)
      assert.match(latestPrivateOutput(game, 'stranger'), /没有可访问/)
      await game.sendGroup('host', '卧底')
      assert.equal((await game.app.database.get('undercover_history_game', {})).length, 1)
      await game.sendGroup('alice', '复盘')
      assert.match(latestGroupOutput(game), /好人胜利/)
      await game.sendGroup('alice', '回放 ' + rows[0].id)
      assert.ok(game.transcript.some(e => e.direction === 'out' && /<message\s+forward(?:[ >]|=)/.test(e.content)), latestGroupOutput(game))
      await game.sendGroup('host', '历史清理 ' + rows[0].id)
      assert.doesNotMatch(latestGroupOutput(game), /UCHIST-/)
      await game.addUser('owner', '管理员', 5)
      await game.sendGroup('owner', '历史清理 ' + rows[0].id)
      const token = latestGroupOutput(game).match(/UCHIST-[a-f0-9]{36}/)?.[0]
      assert.ok(token)
      await game.sendGroup('alice', token)
      assert.match(latestGroupOutput(game), /原管理员/)
      await game.sendGroup('owner', token)
      assert.match(latestGroupOutput(game), /清理完成/)
      assert.equal((await game.app.database.get('undercover_history_game', {})).length, 0)
      assert.equal((await game.app.database.get('undercover_history_erasure', {})).length, 1)
      assert.doesNotMatch(groupTranscript(game), /历史采集不完整|历史保存失败/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it('finishes, archives, and clears a game when all final group notices fail', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])

      game.failNextGroupMessages(20)
      await voteOut(game, 6, [1, 2, 3, 4, 6])
      let rows = []
      for (let index = 0; index < 100; index++) {
        rows = await game.app.database.get('undercover_history_game', {})
        if (rows.length) break
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      assert.equal(rows.length, 1)
      assert.equal(JSON.parse(rows[0].payload).ending.winner, 'good')

      await new Promise<void>(resolve => setImmediate(resolve))
      game.bot.groupMessageFailures.clear()
      await game.sendGroup('host', '卧底')
      assert.match(latestGroupOutput(game), /开始凑人，请扣1/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })
  it('never exposes stopped sandbox or in-progress internal recaps through persistent recap commands', async () => {
    await withGame(async game => {
      await startSixPlayerGame(game)
      await game.sendGroup('host', '停止卧底')
      await game.sendGroupTo('other-group', 'host', '复盘')
      const foreign = game.transcript.filter(e => e.direction === 'out' && e.channelId === 'other-group').at(-1)!.content
      assert.match(foreign, /没有可访问/)
      assert.doesNotMatch(foreign, /苹果|梨|好人词条|卧底词条/)
      await game.sendGroup('host', '复盘')
      assert.doesNotMatch(latestGroupOutput(game), /苹果|梨/)
      await game.sendGroup('host', '卧底')
      await game.sendGroup('host', '复盘')
      assert.doesNotMatch(latestGroupOutput(game), /好人词条|卧底词条/)
    })
  })
  it("keeps player IDs and managed nicknames aligned during concurrent gathering", async () => {
    let releaseAlice!: () => void
    const aliceDelay = new Promise<void>(resolve => { releaseAlice = resolve })
    const xpPoints = {
      ensureManagedIdentity: async (_platform: string, userId: string) => {
        if (userId === "alice") await aliceDelay
        return {
          profileId: userId === "alice" ? 1 : userId === 'bob' ? 2 : 3,
          nickname: userId === "alice" ? "Alice-managed" : userId === 'bob' ? "Bob-managed" : 'Host-managed',
          automatic: true,
        }
      },
    }
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.sendGroup("host", "卧底")
      const aliceJoin = game.sendGroup("alice", "1")
      await new Promise<void>(resolve => setImmediate(resolve))
      const bobJoin = game.sendGroup("bob", "1")
      await new Promise<void>(resolve => setImmediate(resolve))
      releaseAlice()
      await Promise.all([aliceJoin, bobJoin])
      await game.sendGroup("alice", "凑人进度")

      assert.match(latestGroupOutput(game), /当前已加入2人/)
      await game.sendPrivate("alice", "退出游戏")
      assert.match(groupTranscript(game), /Alice-managed已退出游戏/)
      assert.doesNotMatch(groupTranscript(game), /Bob-managed已退出游戏/)
    }, {}, { xpPoints })
  })

  it("waits for an in-flight join before reporting gathering progress", async () => {
    let releaseAlice!: () => void
    const aliceDelay = new Promise<void>(resolve => { releaseAlice = resolve })
    const xpPoints = {
      ensureManagedIdentity: async (_platform: string, userId: string) => {
        if (userId === "alice") await aliceDelay
        return {
          profileId: userId === "alice" ? 1 : userId === "bob" ? 2 : 3,
          nickname: userId === "alice" ? "Alice-managed" : userId === "bob" ? "Bob-managed" : "Host-managed",
          automatic: true,
        }
      },
    }
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.sendGroup("host", "卧底")
      const aliceJoin = game.sendGroup("alice", "1")
      await new Promise<void>(resolve => setImmediate(resolve))
      const progress = game.sendGroup("bob", "凑人进度")
      await new Promise<void>(resolve => setImmediate(resolve))
      releaseAlice()
      await Promise.all([aliceJoin, progress])

      assert.match(latestGroupOutput(game), /当前已加入1人/)
    }, {}, { xpPoints })
  })

  for (const startInput of ["开始", "开始龟模式"]) {
  it(`does not let a slow downstream model response block six joins, progress, or game start (${startInput})`, async () => {
    let releaseModel!: () => void
    let enteredModel!: () => void
    let releaseAlice!: () => void
    const modelDelay = new Promise<void>(resolve => { releaseModel = resolve })
    const modelEntered = new Promise<void>(resolve => { enteredModel = resolve })
    const aliceDelay = new Promise<void>(resolve => { releaseAlice = resolve })
    const xpPoints = {
      ensureManagedIdentity: async (_platform: string, userId: string) => {
        if (userId === "alice") await aliceDelay
        const seat = PLAYER_IDS.indexOf(userId as typeof PLAYER_IDS[number])
        return { profileId: seat + 2, nickname: seat < 0 ? "主持人" : PLAYER_NAMES[seat], automatic: true }
      },
    }
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      // ChatLuna/Character defer model work with next(callback).  Registering
      // before the game must not make that deferred work part of its queue.
      await game.sendGroup("host", "卧底")
      const unrelated = game.sendGroup("host", "等待模型的闲聊")
      await modelEntered
      const joins = PLAYER_IDS.map(id => game.sendGroup(id, "1"))
      const progress = game.sendGroup("host", "凑人进度")
      const start = game.sendGroup("host", startInput)
      const gameInputs = Promise.all([...joins, progress, start])
      let completed = false
      void gameInputs.then(() => { completed = true })
      let completedBeforeModel: boolean
      try {
        await new Promise<void>(resolve => setImmediate(resolve))
        releaseAlice()
        for (let turn = 0; turn < 100 && !completed; turn++) await new Promise<void>(resolve => setImmediate(resolve))
        completedBeforeModel = completed
      }
      finally {
        releaseAlice()
        releaseModel()
        await Promise.all([unrelated, gameInputs])
      }
      assert.ok(completedBeforeModel!, "game inputs waited for unrelated model completion")
      assert.match(groupTranscript(game), /当前已加入6人，已经达到开局人数/)
      assert.match(groupTranscript(game), /本局为6人局/)
      if (startInput === "开始龟模式") assert.match(groupTranscript(game), /本局为龟模式，发题前仍可切换模式/)
      for (let index = 0; index < PLAYER_NAMES.length; index++) {
        assert.match(groupTranscript(game), new RegExp(`${index + 1}号玩家：${PLAYER_NAMES[index]}`))
      }
    }, {}, {
      xpPoints,
      configureApp: app => app.middleware((session, next) => {
        if (session.content !== "等待模型的闲聊") return next()
        return next(async () => { enteredModel(); await modelDelay; return "模型回复" })
      }),
    })
  })
  }

  it("does not let an unrelated guild exit request occupy the game input queue", async () => {
    let releaseModel!: () => void
    let enteredModel!: () => void
    const modelDelay = new Promise<void>(resolve => { releaseModel = resolve })
    const modelEntered = new Promise<void>(resolve => { enteredModel = resolve })
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.sendGroup("host", "卧底")
      const unrelated = game.sendGroupTo("other-guild", "alice", "退出游戏")
      await modelEntered
      const join = game.sendGroup("alice", "1")
      const progress = game.sendGroup("host", "凑人进度")
      const gameInputs = Promise.all([join, progress])
      let completed = false
      void gameInputs.then(() => { completed = true })
      let completedBeforeModel: boolean
      try {
        for (let turn = 0; turn < 100 && !completed; turn++) await new Promise<void>(resolve => setImmediate(resolve))
        completedBeforeModel = completed
      }
      finally { releaseModel(); await Promise.all([unrelated, gameInputs]) }
      assert.ok(completedBeforeModel!, "foreign-route next() held the game queue")
      assert.match(groupTranscript(game), /当前已加入1人/)
    }, {}, { configureApp: app => app.middleware((session, next) => {
      if (session.guildId !== "other-guild") return next()
      return next(async () => { enteredModel(); await modelDelay })
    }) })
  })

  it("stops a handled join before downstream ChatLuna-style middleware", async () => {
    let downstreamCalls = 0
    await withGame(async game => {
      game.app.middleware((session, next) => {
        if (session.content !== "1") return next()
        downstreamCalls++
        return next(async () => "不应为已处理的入局触发模型")
      })
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("alice", "1")
      assert.equal(downstreamCalls, 0)
      await game.sendGroup("host", "凑人进度")
      assert.match(latestGroupOutput(game), /当前已加入1人/)
    })
  })

  it("reports failed join initialization and keeps subsequent joins usable", async () => {
    for (const failure of ['identity', 'lease'] as const) {
      let failAlice = true
      const identity = (userId: string) => ({ profileId: userId === 'host' ? 1 : userId === 'alice' ? 2 : 3,
        accountId: userId, nickname: userId, automatic: true })
      const xpPoints = {
        ensureManagedIdentity: async (_platform: string, userId: string) => {
          if (failure === 'identity' && failAlice && userId === 'alice') throw new Error('identity unavailable')
          return identity(userId)
        },
        registerAccountConsumer: () => ({
          acquire: async (targets: readonly { userId: string }[]) => {
            if (failure === 'lease' && failAlice && targets[0].userId === 'alice') throw new Error('lease unavailable')
            return { accounts: targets.map(target => identity(target.userId)), release() {} }
          },
          dispose() {},
        }),
      }
      await withGame(async game => {
        await game.addUser('host', '主持人', 4)
        await game.addUser('alice', 'Alice')
        await game.addUser('bob', 'Bob')
        await game.sendGroup('host', '卧底')
        await game.sendGroup('alice', '1')
        assert.match(latestGroupOutput(game), /本次加入未成功.*重新发送半角数字 1/)
        await game.sendGroup('host', '凑人进度')
        assert.match(latestGroupOutput(game), /当前已加入0人/)
        await game.sendGroup('bob', '1')
        failAlice = false
        await game.sendGroup('alice', '1')
        await game.sendGroup('host', '凑人进度')
        assert.match(latestGroupOutput(game), /当前已加入2人/)
      }, {}, { xpPoints })
    }
  })

  it("does not insert a delayed old-game join into a restarted gathering", async () => {
    let releaseAlice!: () => void
    let enteredIdentity!: () => void
    const aliceDelay = new Promise<void>(resolve => { releaseAlice = resolve })
    const aliceEntered = new Promise<void>(resolve => { enteredIdentity = resolve })
    const xpPoints = { ensureManagedIdentity: async (_platform: string, userId: string) => {
      if (userId === 'alice') { enteredIdentity(); await aliceDelay }
      return { profileId: userId === 'host' ? 1 : 2, nickname: userId, automatic: true }
    } }
    await withGame(async game => {
      await game.addUser('host', '主持人', 4)
      await game.addUser('alice', 'Alice')
      await game.sendGroup('host', '卧底')
      const oldJoin = game.sendGroup('alice', '1')
      await aliceEntered
      try {
        await game.sendGroup('host', '停止卧底')
        await game.sendGroup('host', '卧底')
      }
      finally { releaseAlice(); await oldJoin }
      await game.sendGroup('host', '凑人进度')
      assert.match(latestGroupOutput(game), /当前已加入0人/)
      await game.sendGroup('alice', '1')
      await game.sendGroup('host', '凑人进度')
      assert.match(latestGroupOutput(game), /当前已加入1人/)
    }, {}, { xpPoints })
  })

  it("lets a gathered player leave privately without affecting other participants", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("alice", "1")
      await game.sendGroup("bob", "1")
      await game.sendPrivate("alice", "退出游戏")

      assert.match(groupTranscript(game), /Alice已退出游戏。当前已加入1人，还差5人可以开始/)
      assert.match(privateTranscript(game, "host"), /Alice通过私聊主动退出了本局游戏/)
      assert.match(privateTranscript(game, "alice"), /你已退出本局游戏/)
    })
  })

  it("restarts locked setup after a private player exit", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "卧底")
      for (const playerId of [...PLAYER_IDS, "grace"]) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      await game.sendPrivate("alice", "退出卧底")

      const transcript = groupTranscript(game)
      assert.match(transcript, /1号玩家Alice主动退出，开局配置已重置/)
      assert.match(transcript, /本局为6人局/)
      assert.match(transcript, /1号玩家：Bob/)
      assert.match(privateTranscript(game, "host"), /Bob.*为卧底|Carol.*为卧底|Dave.*为卧底|Eve.*为卧底|Frank.*为卧底|Grace.*为卧底/s)
    })
  })

  it("reuses active roster removal when a player exits during speech", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendPrivate("bob", "退出游戏")
      assert.match(groupTranscript(game), /2号玩家Bob主动退出游戏/)
      assert.match(privateTranscript(game, "host"), /Bob通过私聊主动退出了本局游戏/)
      for (const seat of [1, 3, 4, 5, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "继续发言")
      }
      assert.match(groupTranscript(game), /现在开始投票/)
    })
  })

  it("completes an active self-exit when both group and host notices fail", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      game.failNextGroupMessages()
      game.failNextPrivateMessages("host")

      await game.sendPrivate("bob", "退出游戏")
      assert.match(latestPrivateOutput(game, "bob"), /你已退出本局游戏/)
      for (const seat of [1, 3, 4, 5, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "通知失败后继续发言")
      }
      assert.match(groupTranscript(game), /现在开始投票/)
    })
  })

  it("keeps roster-reset setup recoverable when every immediate group notice fails", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "卧底")
      for (const playerId of [...PLAYER_IDS, "grace"]) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")

      game.failNextGroupMessages(5)
      await game.sendPrivate("alice", "退出游戏")
      await game.sendGroup("host", "否")
      await game.sendPrivate("host", "发题状态")

      assert.match(latestPrivateOutput(game, "host"), /当前步骤：请输入好人词条/)
      assert.match(latestPrivateOutput(game, "host"), /好人词条：（未填写）/)
    })
  })

  it("lets the host inspect, rewind, repeat, and reset topic setup", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.sendGroup("host", "卧底")
      for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("host", "普通局")

      await game.sendPrivate("host", "错误苹果")
      await game.sendPrivate("host", "发题状态")
      assert.match(latestPrivateOutput(game, "host"), /当前步骤：请输入好人词条错误苹果雷点/)
      assert.match(latestPrivateOutput(game, "host"), /好人词条：错误苹果/)

      await game.sendPrivate("host", "发题上一步")
      assert.match(latestPrivateOutput(game, "host"), /已返回上一步/)
      assert.match(latestPrivateOutput(game, "host"), /请输入好人词条/)
      await game.sendPrivate("host", "重发发题提示")
      assert.match(latestPrivateOutput(game, "host"), /请输入好人词条/)

      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "重新发题")
      assert.match(latestPrivateOutput(game, "host"), /已清空本次题面输入并重新开始/)
      await game.sendPrivate("host", "发题状态")
      assert.match(latestPrivateOutput(game, "host"), /好人词条：（未填写）/)
      assert.match(latestPrivateOutput(game, "host"), /卧底词条：（未填写）/)

      await game.sendPrivate("host", "桃")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "李")
      await game.sendPrivate("host", "无")
      await advanceUntilSettled(game.sendPrivate("host", "5"))
      assert.match(groupTranscript(game), /发题完毕，开始第1轮/)
    })
  })

  it("defaults to speech timeout mode 1 when the host leaves the choice idle", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.sendGroup("host", "卧底")
      for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("host", "普通局")
      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "无")

      await tickGameClock(60_001)

      const transcript = groupTranscript(game)
      assert.match(transcript, /超过60秒未选择发言限时，已自动选择限时模式1/)
      assert.match(transcript, /发题完毕，开始第1轮/)
    })
  })

  it("uses timeout mode 1 when the overall setup deadline arrives during timeout selection", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let i = 0; i < PLAYER_IDS.length; i++) await game.addUser(PLAYER_IDS[i], PLAYER_NAMES[i])
      await game.sendGroup("host", "卧底")
      for (const id of PLAYER_IDS) await game.sendGroup(id, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("host", "普通局")
      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "无")
      await tickGameClock(30_001)
      assert.match(groupTranscript(game), /发题完毕，开始第1轮/)
      assert.doesNotMatch(groupTranscript(game), /主持人配置超时，本局卧底已自动终止/)
    }, { setupTimeout: 30 })
  })

  it("preserves the host hero choice through gathering and roster-reset setup", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let i = 0; i < PLAYER_IDS.length; i++) await game.addUser(PLAYER_IDS[i], PLAYER_NAMES[i])
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("host", "普通局")
      for (const id of PLAYER_IDS) await game.sendGroup(id, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("host", "开启加人")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "否")
      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "无")
      await advanceUntilSettled(game.sendPrivate("host", "5"))
      assert.match(privateTranscript(game, "host"), /本局没有设置武将/)
      for (const id of [...PLAYER_IDS, "grace"]) assert.doesNotMatch(privateTranscript(game, id), /你本局抽到的武将/)
    })
  })

  it("lets the host enable heroes during gathering when the new-game default is off", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let i = 0; i < PLAYER_IDS.length; i++) await game.addUser(PLAYER_IDS[i], PLAYER_NAMES[i])
      await game.sendGroup("host", "卧底")
      await game.sendGroup("host", "武将局")
      for (const id of PLAYER_IDS) await game.sendGroup(id, "1")
      await game.sendGroup("host", "开始")
      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "无")
      await advanceUntilSettled(game.sendPrivate("host", "5"))
      assert.match(privateTranscript(game, "host"), /本局武将设置/)
    }, { heroesByDefault: false, enabledHeroes: [...HERO_NAMES] })
  })

  it("records one optional classic replacement speech during voting without restarting voting", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.addUser("grace", "Grace")
      for (const seat of [2, 3, 4, 5, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "原发言")
      await game.sendGroup("host", "踢出1")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      assert.match(groupTranscript(game), /1号补位玩家可以补发上一轮发言/)
      const voteStarts = (groupTranscript(game).match(/现在开始投票/g) ?? []).length
      await game.sendGroup("grace", "1补位发言")
      assert.match(latestGroupOutput(game), /已记录第1号补位发言/)
      await game.sendGroup("grace", "1不应覆盖")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /Grace：1补位发言/)
      assert.doesNotMatch(latestGroupOutput(game), /不应覆盖/)
      assert.equal((groupTranscript(game).match(/现在开始投票/g) ?? []).length, voteStarts)
      for (const id of ["grace", "bob", "carol", "dave", "eve", "frank"]) await game.sendPrivate(id, id === "eve" ? "2" : "5")
      assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)
    })
  })

  it("offers the same optional backfill after a speech-timeout replacement", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, "1")
      for (const seat of [2, 3, 4, 5, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "原发言")
      await tickGameClock(2_001)
      assert.match(groupTranscript(game), /1号玩家Alice发言超时，被自动踢出/)
      assert.match(groupTranscript(game), /现在开始投票/)
      await game.addUser("grace", "Grace")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      assert.match(groupTranscript(game), /1号补位玩家可以补发上一轮发言/)
      await game.sendGroup("grace", "1超时后的补位发言")
      assert.match(latestGroupOutput(game), /已记录第1号补位发言/)
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /Grace：1超时后的补位发言/)
    }, { speakTimeoutMode1: 2 })
  })

  it("requires a Deer replacement's approved choice before optional vote-stage backfill", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      await game.addUser("grace", "Grace")
      for (const seat of [2, 3, 4, 5, 6]) {
        await submitAndApproveDeerSeat(game, seat, "词条" + seat)
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "普通发言")
      }
      await game.sendGroup("host", "踢出1")
      assert.match(latestGroupOutput(game), /现在开始投票/)
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      await game.sendGroup("grace", "1尚未审核")
      assert.match(latestGroupOutput(game), /先私聊提交选词并通过主持人审核/)
      await game.sendPrivate("grace", "刘备")
      await game.sendPrivate("host", "1是")
      await game.sendGroup("grace", "1审核后的补发言")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /Grace：1审核后的补发言/)
    })
  })

  it("preserves media in speech overview, recap and replay, then removes only media at the next bot game", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      const image = '<img src="https://cdn.example/photo.png?signature=needed"/>'
      await game.sendGroup("alice", "1图文发言" + image)
      for (const seat of [2, 3, 4, 5, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "普通发言")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /<img src="https:\/\/cdn.example\/photo.png\?signature=needed"/)
      assert.doesNotMatch(latestGroupOutput(game), /&lt;img/)
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await voteOut(game, 6, [1, 2, 3, 4, 6])
      const beforeRecap = groupTranscript(game).length
      await game.sendGroup("host", "总结")
      assert.match(groupTranscript(game).slice(beforeRecap), /<img src="https:\/\/cdn.example\/photo.png\?signature=needed"/)
      await game.sendGroup("host", "回放")
      assert.match(latestGroupOutput(game), /<img src="https:\/\/cdn.example\/photo.png\?signature=needed"/)
      assert.doesNotMatch(latestGroupOutput(game), /&lt;img/)
      await game.sendGroup("host", "卧底")
      const phases = await game.app.database.get("undercover_history_phase", {})
      assert.doesNotMatch(JSON.stringify(phases), /cdn\.example/)
      assert.match(JSON.stringify(phases), /图文发言/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0, mediaRetention: 'next-game', mediaRetentionDays: 30 } })
  })

  it("continues dealing after one private failure and lets that player retrieve information", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.sendGroup("host", "卧底")
      for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("host", "普通局")
      await game.sendPrivate("host", "苹果")
      await game.sendPrivate("host", "无")
      await game.sendPrivate("host", "梨")
      await game.sendPrivate("host", "无")
      game.failNextPrivateMessages("bob")
      await advanceUntilSettled(game.sendPrivate("host", "5"))

      assert.match(groupTranscript(game), /以下私聊发送失败：2号题面/)
      assert.match(groupTranscript(game), /发题完毕，开始第1轮/)
      assert.match(privateTranscript(game, "frank"), /你是6号玩家/)
      assert.doesNotMatch(privateTranscript(game, "bob"), /你是2号玩家/)

      await game.sendGroup("bob", "我的题面")
      assert.match(privateTranscript(game, "bob"), /你是2号玩家/)
      assert.match(latestGroupOutput(game), /已将所需信息重新私聊发送给你/)
      await game.sendPrivate("bob", "我的武将")
      assert.match(privateTranscript(game, "bob"), /你的座位本局没有武将牌/)
    })
  })

  it("reports gathering progress without adding join-message noise", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      for (const [userId, nickname] of [["carol", "Carol"], ["dave", "Dave"], ["eve", "Eve"], ["frank", "Frank"]] as const) {
        await game.addUser(userId, nickname)
      }
      await game.sendGroup("host", "卧底")
      await game.sendGroup("alice", "1")
      await game.sendGroup("bob", "1")
      await game.sendGroup("alice", "凑人进度")
      assert.match(latestGroupOutput(game), /当前已加入2人，还差4人可以开始/)
      await game.sendGroup("bob", "几个人了")
      assert.match(latestGroupOutput(game), /当前已加入2人，还差4人可以开始/)
      await game.sendGroup("alice", "凑人状态")
      assert.match(latestGroupOutput(game), /当前已加入2人，还差4人可以开始/)
      await game.sendGroup("bob", "到底还有几人没来")
      assert.match(latestGroupOutput(game), /当前已加入2人，还差4人可以开始/)

      await game.sendGroup("alice", "１")
      assert.match(latestGroupOutput(game), /全角“１”不会加入游戏；如要参与请发送半角数字 1/)
      await game.sendGroup("alice", "凑人进程")
      assert.match(latestGroupOutput(game), /当前已加入2人，还差4人可以开始/)

      const otherGuildOutputs = game.transcript.filter(entry => entry.direction === "out").length
      await game.sendGroupTo("unrelated-guild", "alice", "现在几人")
      assert.equal(game.transcript.filter(entry => entry.direction === "out").length, otherGuildOutputs)

      for (const playerId of ["carol", "dave", "eve", "frank"]) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      const configuredOutputs = game.transcript.filter(entry => entry.direction === "out").length
      await game.sendGroup("alice", "现在几人")
      assert.equal(game.transcript.filter(entry => entry.direction === "out").length, configuredOutputs)
    })
  })

  it("keeps fixed-seat speech history for overview and unlocked player review", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /本局目前还没有已记录的发言/)
      await game.sendGroup("alice", "1第一轮发言")
      await game.sendGroup("host", "发言总览")
      assert.match(groupTranscript(game), /第1轮/)
      assert.match(groupTranscript(game), /1号玩家Alice：1第一轮发言/)
      await game.sendGroup("alice", "盘1")
      assert.match(latestGroupOutput(game), /当前尚未解锁盘发言/)
      for (const seat of [2, 3, 4, 5, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "第一轮发言")
      for (const playerId of PLAYER_IDS) await game.sendPrivate(playerId, "弃")
      assert.match(groupTranscript(game), /开始第2轮/)
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "第二轮发言")
      for (const playerId of PLAYER_IDS) await game.sendPrivate(playerId, "弃")
      assert.match(groupTranscript(game), /开始第3轮/)
      await game.sendGroup("alice", "盘1")
      assert.match(latestGroupOutput(game), /第1轮｜1第一轮发言/)
      assert.match(latestGroupOutput(game), /第2轮｜1第二轮发言/)
    })
  })

  it("records the live vote and elimination semantic cursor order", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      game.resolutionTrace.length = 0

      await voteOut(game, 1, [1, 2, 3, 4, 5, 6])

      assert.deepEqual(
        game.resolutionTrace.map(event => [event.segment, event.cursor]),
        [
          ["vote-pre-mao", ResolutionCursor.RebuildBallots],
          ["vote-pre-mao", ResolutionCursor.ApplyShiKeFaResistance],
          ["vote-pre-mao", ResolutionCursor.ApplyDuoErGunProtection],
          ["vote-pre-mao", ResolutionCursor.DeriveVoteEffects],
          ["vote-pre-mao", ResolutionCursor.CalculateLeaders],
          ["vote-pre-mao", ResolutionCursor.MaoWenLongLateVote],
          ["vote-tail", ResolutionCursor.DuoErGunSwap],
          ["vote-tail", ResolutionCursor.LinDanHanAwaken],
          ["vote-tail", ResolutionCursor.HuangTaiJiQuan],
          ["vote-tail", ResolutionCursor.FinalizeVote],
          ["vote-elimination", ResolutionCursor.Eliminate],
          ["vote-elimination", ResolutionCursor.CheckVictory],
          ["vote-elimination", ResolutionCursor.PostElimination],
          ["vote-elimination", ResolutionCursor.NextRound],
        ],
      )
      assert.ok(game.resolutionTrace.every(event =>
        event.gameEpoch > 0 && event.round === 1 && event.overtime === false,
      ))
    })
  })

  it("settles concurrent final ballots through one vote pipeline", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const openingBallots = [5, 5, 6, 6]
      for (let seat = 1; seat <= 4; seat++) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(openingBallots[seat - 1]))
      }
      game.resolutionTrace.length = 0

      await Promise.all([
        game.sendPrivate("eve", "6"),
        game.sendPrivate("frank", "5"),
      ])

      assert.equal(
        game.resolutionTrace.filter(event =>
          event.segment === "vote-pre-mao"
          && event.cursor === ResolutionCursor.RebuildBallots,
        ).length,
        1,
      )
      assert.equal((groupTranscript(game).match(/本轮投票结果：/g) ?? []).length, 1)
    })
  })

  it("sends one merged private vote-start reminder and keeps first votes silent by default", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      const beforeVote = game.transcript.length
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const reminders = game.transcript.slice(beforeVote).filter(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@alice",
      )
      assert.equal(reminders.length, 1)
      assert.match(reminders[0].content, /第1轮投票已开始，该投票了/)
      assert.match(reminders[0].content, /可投票对象：2号Bob/)
      const beforeFirstVote = game.transcript.length
      await game.sendPrivate("alice", "2")
      assert.equal(game.transcript.slice(beforeFirstVote).filter(entry =>
        entry.direction === "out" && entry.channelId === "@alice",
      ).length, 0)
    })
  })

  it("opens and settles voting when its group announcement and one reminder fail", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      for (const seat of [1, 2, 3, 4, 5]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "号测试发言")
      }
      game.failNextGroupMessages()
      game.failNextPrivateMessages("alice")
      await game.sendGroup("frank", "6号测试发言")

      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)
    })
  })

  it("can opt into a first-vote receipt without changing later vote behavior", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("alice", "2")
      assert.match(latestPrivateOutput(game, "alice"), /投票已记录/)
      await game.sendPrivate("alice", "3")
      assert.match(latestPrivateOutput(game, "alice"), /已改票/)
    }, {
      notifications: { ...DEFAULT_NOTIFICATIONS, voteFirstSuccessReceipt: true },
    })
  })

  it("automatically completes a six-player ordinary game through real middleware", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game)
      const targets = undercoverSeats(game)
      let activeSeats = [1, 2, 3, 4, 5, 6]

      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[0], activeSeats)
      activeSeats = activeSeats.filter(seat => seat !== targets[0])

      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[1], activeSeats)

      assert.match(groupTranscript(game), /\u6e38\u620f\u7ed3\u675f\uff0c\u597d\u4eba\u80dc\u5229/)
    })
  })

  it("uses managed nicknames and aggregates dedicated score failures", async () => {
    const calls: Array<{ nickname: string, platform: string, guildId: string, amount: number }> = []
    const idempotencyKeys: string[] = []
    let registeredSystem = ''
    const managedNames = new Map(PLAYER_IDS.map((id, index) => [id, "档案-" + PLAYER_NAMES[index]] as const))
    const xpPoints = {
      resolveNickname: (_platform: string, userId: string, fallback?: string) =>
        managedNames.get(userId) ?? fallback,
      ensureManagedIdentity: async (_platform: string, userId: string, suggestedNickname?: string) => ({
        profileId: PLAYER_IDS.indexOf(userId) + 2,
        accountId: 'account-' + userId,
        nickname: managedNames.get(userId) ?? suggestedNickname ?? userId,
        automatic: false,
      }),
      registerScoreConsumer: (registration: { systemKey: string }) => {
        registeredSystem = registration.systemKey
        return ({
          systemKey: 'undercover',
          addAccount: async (target: { accountId: string }, amount: number, context: {
            platform?: string, guildId?: string, idempotencyKey?: string
          }) => {
            const userIndex = PLAYER_IDS.indexOf(target.accountId.replace('account-', ''))
            idempotencyKeys.push(context.idempotencyKey!)
            calls.push({
              nickname: managedNames.get(PLAYER_IDS[userIndex])!,
              platform: context.platform!,
              guildId: context.guildId!,
              amount,
            })
            throw new Error("dedicated database offline")
          },
          dispose() {},
        })
      },
    }

    await withGame(async game => {
      await startSixPlayerGame(game, "5", false)
      const targets = undercoverSeats(game)
      let activeSeats = [1, 2, 3, 4, 5, 6]

      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[0], activeSeats)
      activeSeats = activeSeats.filter(seat => seat !== targets[0])
      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[1], activeSeats)

      assert.ok(calls.length > 0)
      assert.equal(registeredSystem, 'undercover')
      assert.equal(new Set(idempotencyKeys).size, idempotencyKeys.length)
      assert.ok(idempotencyKeys.every(key => /^[0-9a-f-]{36}:[^:]+:account-/.test(key)))
      assert.ok(calls.every(call => call.platform === "onebot" && call.guildId === game.guildId))
      assert.match(groupTranscript(game), /积分未能写入数据库/)
      await game.sendGroup('host', '历史对局')
      const saved = await game.app.database.get('undercover_history_game', {})
      assert.equal(saved.length, 1)
      assert.ok(JSON.parse(saved[0].payload).awards.every(a => a.status === 'failed'))
    }, {}, { platform: "onebot", xpPoints })
  })

  it("prefers the platform nickname over a group card when creating a managed player", async () => {
    const suggestions = new Map<string, string | undefined>()
    const xpPoints = {
      ensureManagedIdentity: async (_platform: string, userId: string, suggested?: string) => {
        suggestions.set(userId, suggested)
        return { profileId: userId === 'host' ? 1 : 2, nickname: suggested ?? userId, automatic: true }
      },
    }
    await withGame(async game => {
      await game.addUser("host", "Platform Host")
      await game.addUser("alice", "Platform Alice")
      game.setGroupCard("alice", "Meme Group Card")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("alice", "1")
      assert.equal(suggestions.get("alice"), "Platform Alice")
    }, {}, { platform: "onebot", xpPoints })
  })

  it("runs without xp-points and never registers legacy user fields", async () => {
    await withGame(async game => {
      const userFields = Object.keys((game.app.model as any).tables.user.fields)
      assert.equal(userFields.includes("nickname"), false)
      assert.equal(userFields.includes("exp"), false)
      assert.equal(userFields.includes("exp_keju"), false)

      await startSixPlayerGame(game, "5", false)
      const targets = undercoverSeats(game)
      let activeSeats = [1, 2, 3, 4, 5, 6]

      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[0], activeSeats)
      activeSeats = activeSeats.filter(seat => seat !== targets[0])
      await finishSpeech(game, activeSeats)
      await voteOut(game, targets[1], activeSeats)

      assert.match(groupTranscript(game), /积分未能写入数据库/)
      assert.deepEqual(Object.keys((game.app.model as any).tables.user.fields), userFields)
    }, {}, { platform: "onebot" })
  })

  it("stores call-up subscriptions in a dedicated table without extending channel", async () => {
    await withGame(async game => {
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.addUser("admin", "Admin", 2)

      const channelFields = Object.keys((game.app.model as any).tables.channel.fields)
      assert.equal(channelFields.includes("subs"), false)

      await game.sendGroup("alice", "订阅")
      await game.sendGroup("bob", "叫我")
      await game.sendGroup("alice", "订阅")
      assert.equal((await game.app.database.get("undercover_subscription", {})).length, 2)
      assert.match(groupTranscript(game), /Alice.*已经订阅/)

      await game.sendGroup("bob", "取订")
      assert.deepEqual(
        (await game.app.database.get("undercover_subscription", {})).map(row => row.userId),
        ["alice"],
      )
      await game.sendGroup("alice", "叫人")
      assert.match(groupTranscript(game), /Alice.*不是bot管理员/)
      await game.sendGroup("admin", "叫人")
      assert.match(groupTranscript(game), /<at id="alice"\/?>.*Admin在召唤大家/)
      assert.deepEqual(Object.keys((game.app.model as any).tables.channel.fields), channelFields)
    }, {}, { platform: "onebot" })
  })

  it("keeps subscriptions across missed leave/join events and filters live members", async () => {
    await withGame(async game => {
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.addUser("admin", "Admin", 5)
      await game.sendGroup("alice", "订阅")
      await game.sendGroup("bob", "订阅")

      game.setGuildMembers(["bob", "admin"])
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" }))[0].state, "active")
      await game.sendGroup("admin", "叫人")
      let latest = game.transcript.filter(entry => entry.direction === "out" && entry.scope === "group").at(-1)?.content ?? ""
      assert.doesNotMatch(latest, /id="alice"/)
      assert.match(latest, /id="bob"/)

      game.setGuildMembers(["alice", "bob", "admin"])
      const restored = (await game.app.database.get("undercover_subscription", { userId: "alice" }))[0]
      assert.equal(restored.state, "active")
      assert.equal(restored.inactiveAt, null)
      await game.sendGroup("admin", "叫人")
      latest = game.transcript.filter(entry => entry.direction === "out" && entry.scope === "group").at(-1)?.content ?? ""
      assert.match(latest, /id="alice"/)

      await game.app.database.setUser(game.bot.platform, "alice", { authority: 0 })
      await game.sendGroup("admin", "叫人")
      latest = game.transcript.filter(entry => entry.direction === "out" && entry.scope === "group").at(-1)?.content ?? ""
      assert.doesNotMatch(latest, /id="alice"/)
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" }))[0].state, "active")
      await game.app.database.setUser(game.bot.platform, "alice", { authority: 1 })
      await game.app.database.set("undercover_subscription", { userId: "alice" }, {
        state: "inactive",
        reason: "member-removed",
      })
      await game.sendGroup("admin", "叫人")
      latest = game.transcript.filter(entry => entry.direction === "out" && entry.scope === "group").at(-1)?.content ?? ""
      assert.match(latest, /id="alice"/)

      game.failGuildMemberList(new Error("adapter offline"))
      await game.sendGroup("admin", "叫人")
      latest = game.transcript.filter(entry => entry.direction === "out" && entry.scope === "group").at(-1)?.content ?? ""
      assert.doesNotMatch(latest, /<at /)
      assert.match(latest, /无法完整读取本群成员名单.*没有召唤任何订阅者/)
    }, {}, { platform: "onebot" })
  })

  it("keeps authority-5 subscription member scans read-only", async () => {
    await withGame(async game => {
      await game.addUser("alice", "Alice")
      await game.addUser("bob", "Bob")
      await game.addUser("operator", "Operator", 4)
      await game.addUser("owner", "Owner", 5)
      await game.sendGroup("alice", "订阅")
      await game.sendGroup("bob", "订阅")
      game.setGuildMembers(["alice", "operator", "owner"])

      await game.sendGroup("operator", "订阅管理.扫描成员")
      assert.match(groupTranscript(game), /权限不足|权限过低|权限/)
      await game.sendGroup("owner", "订阅管理.扫描成员")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "bob" }))[0].state, "active")
      assert.match(groupTranscript(game), /订阅成员实时检查（只读）[\s\S]*不在群 1/)

      await game.sendGroup("owner", "订阅管理.扫描成员 执行")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "bob" }))[0].state, "active")
      assert.match(groupTranscript(game), /“执行”参数已兼容接受；成员存在性没有写入订阅记录/)
    }, {}, { platform: "onebot" })
  })

  it("requires authority 5 and previews permanent subscription deletion", async () => {
    await withGame(async game => {
      await game.addUser("alice", "Alice")
      await game.addUser("operator", "Operator", 4)
      await game.addUser("owner", "Owner", 5)
      await game.sendGroup("alice", "订阅")

      await game.sendGroup("operator", "订阅管理.停用 @alice")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" }))[0].state, "active")
      assert.match(groupTranscript(game), /权限不足|权限过低|权限/)
      await game.sendGroup("owner", "订阅管理.停用 @alice")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" }))[0].state, "inactive")
      await game.sendGroup("alice", "订阅")
      let paused = (await game.app.database.get("undercover_subscription", { userId: "alice" }))[0]
      assert.equal(paused.reason, "manual-inactive")
      assert.match(latestGroupOutput(game), /订阅仍然保留.*管理员暂停/)
      await game.emitGuildMemberRemoved("alice")
      await game.emitGuildMemberAdded("alice")
      paused = (await game.app.database.get("undercover_subscription", { userId: "alice" }))[0]
      assert.equal(paused.reason, "manual-inactive")
      await game.sendGroup("owner", "订阅管理.恢复 @alice")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" }))[0].state, "active")

      await game.sendGroup("owner", "订阅管理.删除 @alice")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" })).length, 1)
      assert.match(groupTranscript(game), /将永久删除[\s\S]*确认后发送/)
      await game.sendGroup("owner", "订阅管理.删除 @alice 确认")
      assert.equal((await game.app.database.get("undercover_subscription", { userId: "alice" })).length, 0)
    }, {}, { platform: "onebot" })
  })

  it("returns guidance for incomplete subscription administration commands", async () => {
    await withGame(async game => {
      await game.addUser("owner", "Owner", 5)
      await game.sendGroup("owner", "订阅管理")
      assert.match(groupTranscript(game), /订阅管理（authority 5）/)

      for (const command of [
        "订阅管理.停用",
        "订阅管理.恢复",
        "订阅管理.删除",
      ]) {
        await game.sendGroup("owner", command)
        assert.match(latestGroupOutput(game), /请指定当前平台的目标用户/)
      }

      await game.sendGroup("owner", "订阅管理.扫描成员 错误参数")
      assert.match(latestGroupOutput(game), /用法：订阅管理\.扫描成员/)
      game.failGuildMemberList(new Error("adapter failed"))
      await game.sendGroup("owner", "订阅管理.扫描成员")
      assert.match(latestGroupOutput(game), /无法完整读取本群成员名单；本次检查未修改任何订阅/)
      assert.equal((await game.app.database.get("undercover_subscription", {})).length, 0)
    }, {}, { platform: "onebot" })
  })

  it("treats authority 2 as bot administrator while authority 1 cannot stop another host's game", async () => {
    await withGame(async game => {
      await game.addUser("host", "Host")
      await game.addUser("ordinary", "Ordinary", 1)
      await game.addUser("admin", "Admin", 2)
      await game.sendGroup("host", "卧底")
      await game.sendGroup("ordinary", "停止卧底")
      assert.doesNotMatch(groupTranscript(game), /卧底被bot管理员终止/)
      await game.sendGroup("admin", "停止卧底")
      assert.match(groupTranscript(game), /卧底被bot管理员终止/)
      await game.sendGroup("host", "卧底")
      assert.equal((groupTranscript(game).match(/开始凑人，请扣1/g) ?? []).length, 2)
    })
  })

  it("announces an eliminated player and reveals their hero before removal", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])

      const transcript = groupTranscript(game)
      assert.match(transcript, /本轮5号玩家Eve出局，亮出武将牌：朱由检。/)
    })
  })

  it("lets Zhu Youjian execute a player from the opposing camp during speech", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决5")

      const transcript = groupTranscript(game)
      assert.match(transcript, /第1号玩家Alice亮出武将牌：朱由检，并选择处决5号玩家Eve/)
      assert.match(transcript, /处决成功/)
      assert.match(transcript, /第5号玩家Eve出局/)
    })
  })

  it("tracks one public hero reveal and uses the named identity on later exposure", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("host", "亮将情况")
      assert.match(latestGroupOutput(game), /当前尚无玩家公开武将牌/)
      await game.sendGroup("alice", "处决5")
      await game.sendGroup("host", "亮将情况")
      assert.match(latestGroupOutput(game), /1号玩家Alice（朱由检）/)

      await finishSpeech(game, [1, 2, 3, 4, 6])
      await voteOut(game, 1, [1, 2, 3, 4, 6])
      const transcript = groupTranscript(game)
      assert.equal((transcript.match(/Alice亮出武将牌：朱由检/g) ?? []).length, 1)
      assert.match(transcript, /本轮1号玩家Alice（朱由检）出局。/)
    })
  })

  it("lets a replacement inherit the fixed seat's public hero state", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决5")
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "踢出1")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      await game.sendGroup("host", "亮将情况")
      assert.match(latestGroupOutput(game), /1号玩家Grace（朱由检）/)
      assert.doesNotMatch(latestGroupOutput(game), /Alice/)
    })
  })

  it("lets Zhu Youjian execute after submitting his own speech while the round remains open", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "1号测试发言")
      await game.sendGroup("alice", "处决5")

      const transcript = groupTranscript(game)
      assert.match(transcript, /第1号玩家Alice亮出武将牌：朱由检，并选择处决5号玩家Eve/)
      assert.match(transcript, /处决成功/)
    })
  })

  it("allows only an overtime-candidate Zhu Youjian to execute", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      for (const [index, target] of [5, 5, 6, 6, 3, 4].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)

      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /你不属于本次加时的发言玩家，不能发动处决/)
      assert.doesNotMatch(groupTranscript(game), /亮出武将牌：朱由检，并选择处决5号玩家/)

      await finishSpeech(game, [5, 6])
      for (const [seat, target] of new Map([[1, 5], [2, 5], [3, 6], [4, 6]])) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }
      assert.match(groupTranscript(game), /游戏继续，开始第2轮发言/)
      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /第1号玩家Alice亮出武将牌：朱由检，并选择处决5号玩家Eve/)
    })

    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      for (const [index, target] of [5, 5, 6, 6, 3, 4].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)
      await game.sendGroup("eve", "5号加时发言")
      await game.sendGroup("eve", "处决1")
      assert.match(groupTranscript(game), /第5号玩家Eve亮出武将牌：朱由检，并选择处决1号玩家Alice/)
    })
  })

  it("makes Zhu Youjian die when he executes a player from his own camp", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决2")

      const transcript = groupTranscript(game)
      assert.match(transcript, /处决失败/)
       assert.match(transcript, /第1号玩家Alice（朱由检）出局/)
       assert.doesNotMatch(transcript, /第1号玩家Alice（朱由检）自裁/)
    })
  })

  it("shows Zhu Youjian's self-target as self-execution for good, undercover, and white identities", async () => {
    for (const scenario of [
      { seat: 1, userId: "alice", whiteSeat: 0 },
      { seat: 5, userId: "eve", whiteSeat: 0 },
      { seat: 4, userId: "dave", whiteSeat: 4 },
    ]) {
      await withGame(async game => {
        await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: scenario.seat }, true, "5", true, scenario.whiteSeat)
        await game.sendGroup(scenario.userId, "处决" + scenario.seat)
        assert.match(groupTranscript(game), new RegExp(scenario.seat + "号玩家" + (scenario.userId === "alice" ? "Alice" : scenario.userId === "eve" ? "Eve" : "Dave") + "自裁。"))
      })
    }
  })

  it("does not consume Zhu Youjian's execution on an invalid target", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决9")
      assert.match(privateTranscript(game, "alice"), /您要处决的对象似乎查无此人/)

      await game.sendGroup("alice", "处决5")
      const transcript = groupTranscript(game)
      assert.match(transcript, /处决成功/)
      assert.match(transcript, /第5号玩家Eve出局/)
    })
  })

  it("consumes Zhu Youjian's execution when Lin Dan Han protects the target", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {
        [HERO.ZHU_YOU_JIAN]: 1,
        [HERO.LIN_DAN_HAN]: 5,
      })
      await game.sendGroup("alice", "处决5")
      await game.sendGroup("alice", "处决6")

      const transcript = groupTranscript(game)
      assert.match(transcript, /5号玩家Eve受武将技能保护，不出局，朱由检技能发动失效/)
      assert.equal((transcript.match(/亮出武将牌：朱由检，并选择处决/g) ?? []).length, 1)
    })
  })

  it("resets Zhu Youjian's limited execution after ending and restarting the game", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决5")
      await game.sendGroup("host", "结束卧底")

      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1 }, false)
      await game.sendGroup("alice", "处决5")

      const transcript = groupTranscript(game)
      assert.equal((transcript.match(/亮出武将牌：朱由检，并选择处决5号玩家Eve/g) ?? []).length, 2)
      assert.equal((transcript.match(/处决成功/g) ?? []).length, 2)
    })
  })

  it("does not reward Li Zicheng after an effective vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await settleVoteWithSeatFourLeader(game, "2")

      assert.doesNotMatch(privateTranscript(game, "alice"), /闯王，本次投票您获得/)
    })
  })

  it("rewards Li Zicheng after abandoning his vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await settleVoteWithSeatFourLeader(game, "弃")

      assert.match(privateTranscript(game, "alice"), /闯王，本次投票您获得1个伐标记。您现在共有1个伐标记/)
    })
  })

  it("rewards Li Zicheng when an early lock skips his missing vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await settleVoteWithSeatFourLeader(game)

      const transcript = privateTranscript(game, "alice")
      assert.match(transcript, /票数已够，无需你再进行投票/)
      assert.match(transcript, /闯王，本次投票您获得1个伐标记。您现在共有1个伐标记/)
    })
  })

  it("rewards Li Zicheng when the vote timer expires before he votes", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 }, true, "1")
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("bob", "1")
      await game.sendPrivate("carol", "2")
      await game.sendPrivate("dave", "3")
      await game.sendPrivate("eve", "6")
      await game.sendPrivate("frank", "5")
      await tickGameClock(1_000)

      const transcript = privateTranscript(game, "alice")
      assert.match(transcript, /你投票太慢啦，投票阶段已经结束啦/)
      assert.match(transcript, /闯王，本次投票您获得1个伐标记。您现在共有1个伐标记/)
    }, { voteTimeout: 1 })
  })

  it("rewards Li Zicheng when Lin Dan Han invalidates his vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {
        [HERO.LI_ZI_CHENG]: 1,
        [HERO.LIN_DAN_HAN]: 5,
      })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await settleVoteWithSeatFourLeader(game, "5")

      assert.match(privateTranscript(game, "alice"), /闯王，本次投票您获得1个伐标记。您现在共有1个伐标记/)
    })
  })

  it("clears Li Zicheng's fa after ending and restarting the game", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await settleVoteWithSeatFourLeader(game, "弃")
      await game.sendGroup("host", "结束卧底")

      await startCustomSixPlayerGame(game, { [HERO.LI_ZI_CHENG]: 1 }, false)
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("alice", "伐")

      assert.match(privateTranscript(game, "alice"), /你目前没有伐，无法使用伐/)
    })
  })

  it("lets Yuan Chonghuan select and replace a valid guard target", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendPrivate("alice", "守9")
      await game.sendPrivate("alice", "守1")
      await game.sendPrivate("alice", "守2")
      await game.sendPrivate("alice", "守3")

      const transcript = privateTranscript(game, "alice")
      assert.match(transcript, /找不到您要守的对象/)
      assert.match(transcript, /您不是白板，无法守卫自己/)
      assert.match(transcript, /本轮2号玩家Bob会得到守卫/)
      assert.match(transcript, /已放弃对2号玩家Bob的守卫；3号玩家Carol会得到守卫/)
    })
  })

  it("protects Yuan Chonghuan's target and rejects the same target next round", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("alice", "守2")

      const ballots = [2, 3, 2, 2, 2, 2]
      for (let index = 0; index < ballots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
      }
      assert.match(groupTranscript(game), /2号玩家Bob.*因武将技能，免于出局/)
      assert.match(groupTranscript(game), /本轮无人出局，平安夜/)

      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      assert.match(latestPrivateOutput(game, "alice"), /本轮不能继续守卫2号玩家Bob/)
      await game.sendPrivate("alice", "守2")
      assert.match(privateTranscript(game, "alice"), /上一轮便守卫了2号玩家Bob/)
    })
  })

  it("removes Yuan Chonghuan's shield and kills him next round when his target votes for him", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("alice", "守2")

      const ballots = [2, 1, 2, 2, 2, 2]
      for (let index = 0; index < ballots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /本轮2号玩家Bob出局/)
      assert.match(transcript, /1号玩家Alice被其所守卫的2号玩家Bob带走，亮出武将牌：袁崇焕。/)
    })
  })

  it("keeps a white player's failed self-explosion and hero reveal in one sentence", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 4 }, true, "5", true, 4)
      // White self-explosion is only available after enough eliminations for
      // the current round.  Remove one undercover and one good player first,
      // while leaving another undercover in play so the adjudication remains
      // the failed-explosion path.
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await voteOut(game, 1, [1, 2, 3, 4, 6])
      await game.sendGroup("dave", "4自爆，苹果")
      assert.match(groupTranscript(game), /请主持人在.*内判断自爆是否成功/)
      await game.sendGroup("host", "否")
      const transcript = groupTranscript(game)
      assert.match(transcript, /白板自爆失败，场上仍有卧底在场，白板4号玩家Dave出局，游戏继续，亮出武将牌：袁崇焕。/)
      assert.equal((transcript.match(/亮出武将牌：袁崇焕/g) ?? []).length, 1)
    })
  })

  it("settles Yuan Chonghuan before Huang Taiji's round-start reward and the next-round notice", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {
        [HERO.YUAN_CHONG_HUAN]: 5,
        [HERO.HUANG_TAI_JI]: 6,
      })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("eve", "守2")
      // Submit Huang Taiji's prediction before the other ballots can lock the
      // result; otherwise the engine correctly closes his still-empty ballot.
      await game.sendPrivate("frank", "2")
      assert.match(privateTranscript(game, "frank"), /谨遵陛下旨意/)
      for (const [seat, target] of [[1, 2], [2, 5], [3, 2], [4, 2], [5, 2]] as const) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }

      const entries = game.transcript
      const retaliation = entries.findIndex(entry => entry.scope === "group" && entry.content.includes("被其所守卫的2号玩家Bob带走"))
      const reward = entries.findIndex(entry => entry.scope === "private" && entry.channelId === "@frank" && entry.content.includes("果然大破2号玩家Bob") && entry.content.includes("获得一个“权”标记"))
      const nextRound = entries.findIndex(entry => entry.scope === "group" && entry.content.includes("开始第2轮发言"))
      assert.ok(retaliation >= 0, groupTranscript(game))
      assert.ok(reward > retaliation, privateTranscript(game, "frank"))
      assert.ok(nextRound > reward, groupTranscript(game))
    })
  })

  it("cancels Yuan Chonghuan retaliation when the preceding vote already decides the game", { timeout: 10_000 }, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      // The custom setup assigns 5 and 6 to the undercover side.  Remove the
      // first one normally, then guard the last one so its vote for Yuan
      // creates the retaliation pending state on the terminal vote.
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      await finishSpeech(game, [1, 2, 3, 4, 6])
      await game.sendPrivate("alice", "守6")
      await voteOut(game, 6, [1, 2, 3, 4, 6])

      const entries = game.transcript
      const victory = entries.findIndex(entry => entry.scope === "group" && entry.content.includes("游戏结束，好人胜利"))
      assert.ok(victory >= 0, groupTranscript(game))
      assert.doesNotMatch(groupTranscript(game), /Alice被其所守卫的6号玩家Frank带走/)
      assert.match(groupTranscript(game), /加9分/)
      assert.doesNotMatch(groupTranscript(game), /开始第3轮发言/)
      let rows = []
      for (let attempt = 0; attempt < 100; attempt++) {
        rows = await game.app.database.get('undercover_history_game', {})
        if (rows.length) break
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      assert.equal(rows.length, 1)
      const phases = await game.app.database.get('undercover_history_phase', { gameId: rows[0].gameId })
      assert.ok(phases.every(p => !JSON.parse(p.payload).events.some(e => e.kind === 'skill' && e.heroId === HERO.YUAN_CHONG_HUAN && e.effect === '守卫连带出局')))
    }, { scoreGoodWin: 2, scoreGoodWinSpeedrun: 9, history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it('settles white Yuan retaliation before survival after a safe-night overtime', { timeout: 10_000 }, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 4 }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      await finishSpeech(game, [1, 2, 3, 4])
      await game.sendPrivate('dave', '守1')
      for (const [user, ballot] of [['alice', '4'], ['bob', '4'], ['carol', '1'], ['dave', '1']]) await game.sendPrivate(user, ballot)
      await game.sendGroup('alice', '1加时发言')
      await game.sendGroup('dave', '4加时发言')
      await game.sendPrivate('bob', '弃')
      await game.sendPrivate('carol', '弃')
      assert.match(groupTranscript(game), /Dave被其所守卫的1号玩家Alice带走/)
      assert.match(groupTranscript(game), /游戏结束，好人胜利/)
      assert.doesNotMatch(groupTranscript(game), /游戏结束，白板胜利|开始第2轮/)
    })
  })

  it('keeps a white Yuan alive and awards consolation when parity ends before retaliation', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 4 }, true, '5', true, 4)
      for (const [target, seats] of [[1, [1, 2, 3, 4, 5, 6]], [2, [2, 3, 4, 5, 6]]] as const) {
        await finishSpeech(game, seats)
        await voteOut(game, target, seats)
      }
      await finishSpeech(game, [3, 4, 5, 6])
      await game.sendPrivate('dave', '守3')
      await voteOut(game, 3, [3, 4, 5, 6])
      assert.match(groupTranscript(game), /游戏结束，卧底胜利/)
      assert.doesNotMatch(groupTranscript(game), /Dave被其所守卫的3号玩家Carol带走|开始第4轮/)
      assert.match(groupTranscript(game), /Dave仍在场，获得1分安慰积分/)
    })
  })

  for (const yuanSeat of [1, 4]) it(`stops retaliation after white victory (${yuanSeat === 4 ? 'fewer than three' : 'ordinary survival'})`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: yuanSeat }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      if (yuanSeat === 4) await game.sendGroup('host', '踢出3')
      const seats = yuanSeat === 4 ? [1, 2, 4] : [1, 2, 3, 4]
      await finishSpeech(game, seats)
      await game.sendPrivate(PLAYER_IDS[yuanSeat - 1], yuanSeat === 4 ? '守1' : '守2')
      if (yuanSeat === 4) {
        await game.sendPrivate('alice', '4')
        await game.sendPrivate('bob', '1')
        await game.sendPrivate('dave', '1')
      } else {
        await game.sendPrivate('bob', '1')
        await game.sendPrivate('alice', '3')
        await game.sendPrivate('carol', '弃')
        await game.sendPrivate('dave', '3')
      }
      assert.match(groupTranscript(game), /游戏结束，白板胜利/)
      assert.doesNotMatch(groupTranscript(game), /被其所守卫的.*带走|开始第2轮/)
    })
  })

  for (const choice of ['弃', 'timeout']) it(`checks a newly settled white victory before Yuan after Zhang (${choice})`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.YUAN_CHONG_HUAN]: 1, [HERO.ZHANG_XIAN_ZHONG]: 3 }, true, '5', true, 4)
      await game.sendGroup('host', '踢出5')
      await game.sendGroup('host', '踢出6')
      await finishSpeech(game, [1, 2, 3, 4])
      await game.sendPrivate('alice', '守2')
      await game.sendPrivate('bob', '1')
      await game.sendPrivate('alice', '3')
      await game.sendPrivate('carol', '弃')
      await game.sendPrivate('dave', '3')
      assert.doesNotMatch(groupTranscript(game), /游戏结束/)
      if (choice === 'timeout') await tickGameClock(121_000)
      else await game.sendGroup('carol', choice)
      assert.match(groupTranscript(game), /游戏结束，白板胜利/)
      assert.doesNotMatch(groupTranscript(game), /Alice被其所守卫的.*带走|开始第2轮/)
    })
  })

  it("reduces Shi Kefa's vote total and future gift after a teammate attacks him", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.SHI_KE_FA]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const firstRoundBallots = [4, 4, 5, 3, 4, 5]
      await game.sendPrivate("frank", String(firstRoundBallots[5]))
      for (let index = 0; index < firstRoundBallots.length - 1; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(firstRoundBallots[index]))
      }

      assert.match(privateTranscript(game, "eve"), /受到了队友的攻讦，已为您减去一票/)
      assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)

      await finishSpeech(game, [1, 2, 3, 5, 6])
      await voteOut(game, 5, [1, 2, 3, 5, 6])
      assert.match(privateTranscript(game, "eve"), /阁部，您可以将1个“伐”标记赠予/)
    })
  })

  it("permanently removes Shi Kefa's resistance after he votes for a teammate", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.SHI_KE_FA]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const firstRoundBallots = [4, 4, 4, 3, 6, 5]
      await game.sendPrivate("frank", String(firstRoundBallots[5]))
      await game.sendPrivate("eve", String(firstRoundBallots[4]))
      for (let index = 0; index < firstRoundBallots.length - 2; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(firstRoundBallots[index]))
      }
      assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)

      await finishSpeech(game, [1, 2, 3, 5, 6])
      const secondRoundBallots = new Map([
        [6, 5],
        [1, 3],
        [2, 3],
        [3, 1],
        [5, 3],
      ])
      for (const [seat, target] of secondRoundBallots) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }

      const unavailableNotices = game.transcript.filter(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@eve"
        && entry.content.includes("已失去抵诽技能"),
      )
      assert.equal(unavailableNotices.length, 2)
    })
  })

  it("removes a Shi Kefa teammate attacker when that player changes their vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.SHI_KE_FA]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendPrivate("frank", "5")
      await game.sendPrivate("frank", "4")
      const remainingBallots = [4, 4, 5, 3, 4]
      for (let index = 0; index < remainingBallots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(remainingBallots[index]))
      }

      assert.match(privateTranscript(game, "eve"), /本次投票没有队友投您/)
      assert.doesNotMatch(privateTranscript(game, "eve"), /已为您减去一票/)
      assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)
    })
  })

  it("does not repeat Shi Kefa's no-attacker notice when he is outside overtime", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.SHI_KE_FA]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const regularBallots = [3, 3, 4, 3, 4, 4]
      for (let index = 0; index < regularBallots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(regularBallots[index]))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)

      await finishSpeech(game, [3, 4])
      const overtimeBallots = new Map([
        [1, 3],
        [2, 3],
        [5, 4],
        [6, 4],
      ])
      for (const [seat, target] of overtimeBallots) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }

      const noAttackerNotices = game.transcript.filter(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@eve"
        && entry.content.includes("本次投票没有队友投您"),
      )
      assert.equal(noAttackerNotices.length, 1)
      assert.match(groupTranscript(game), /本轮无人出局，平安夜/)
    })
  })

  it("transfers Dorgon strategy in one vote window without consuming an extra use and protects the final target", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.DUO_ER_GUN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendPrivate("alice", "立2")
      await game.sendPrivate("alice", "立3")
      const ballots = [4, 3, 4, 3, 4, 3]
      for (let index = 0; index < ballots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
      }

      const dorgonTranscript = privateTranscript(game, "alice")
      assert.match(dorgonTranscript, /2号玩家Bob得到“定策”标记/)
      assert.match(dorgonTranscript, /已将“定策”标记从2号玩家Bob转移到3号玩家Carol/)
      assert.match(privateTranscript(game, "carol"), /由于多尔衮保护，已为您减去一票/)
      assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)
    })
  })

  it("rejects Dorgon regency before his public awakening", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.DUO_ER_GUN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("alice", "立2")
      await voteOut(game, 6, [1, 2, 3, 4, 5, 6])
      assert.match(groupTranscript(game), /游戏继续，开始第2轮发言/)
      assert.doesNotMatch(groupTranscript(game), /多尔衮.*入关/)

      await game.sendPrivate("alice", "保2弃3")
      assert.match(privateTranscript(game, "alice"), /尚未“入关”，不能发动“摄政”/)
      assert.doesNotMatch(privateTranscript(game, "alice"), /成功发动摄政/)
    })
  })

  it("awakens Dorgon after two strategy uses, swaps regency votes, and permanently spends both skills", async () => {
    await withGame(async (game) => {
      await reachDuoErGunRegency(game)

      await game.sendPrivate("alice", "保3弃5")
      assert.match(privateTranscript(game, "alice"), /成功发动摄政，下一次3号玩家Carol成为唯一得票最多/)

      await finishSpeech(game, [1, 2, 3, 5, 6])
      const ballots = new Map([
        [1, 3],
        [2, 3],
        [3, 2],
        [5, 3],
        [6, 2],
      ])
      for (const [seat, target] of ballots) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /多尔衮.*使3号玩家Carol和5号玩家Eve的得票数互换/)
      assert.match(transcript, /本轮5号玩家Eve出局/)

      await game.sendPrivate("alice", "保3弃6")
      assert.match(privateTranscript(game, "alice"), /已发动过“摄政”，无法再发动/)
    })
  })

  it("rejects invalid Dorgon regency pairs and prevents reconfiguration while the marked player remains active", async () => {
    await withGame(async (game) => {
      await reachDuoErGunRegency(game)

      await game.sendPrivate("alice", "保3弃3")
      await game.sendPrivate("alice", "保2弃5")
      await game.sendPrivate("alice", "保3弃5")
      await game.sendPrivate("alice", "保3弃6")

      const transcript = privateTranscript(game, "alice")
      assert.match(transcript, /王爷，您所保和所弃的对象不能是同一人！/)
      assert.match(transcript, /选择的二人之一必须是拥有“定策”标记的玩家（3号玩家Carol）/)
      assert.match(transcript, /成功发动摄政/)
      assert.match(transcript, /您已经发动过技能了，除非3号玩家Carol在技能生效前出局/)
    })
  })

  it("awakens Lin Dan Han from prevented lethal votes, restricts his targets, and consumes attacker records", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.LIN_DAN_HAN]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      const firstRoundBallots = [5, 1, 1, 1, 6, 5]
      for (let index = 0; index < firstRoundBallots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(firstRoundBallots[index]))
      }

      assert.match(privateTranscript(game, "alice"), /由于您防下了一次致命伤害，您从现在获得“西迁”/)
      assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)
      assert.match(privateTranscript(game, "alice"), /2号玩家Bob，3号玩家Carol，4号玩家Dave已经攻击过您；还有6号玩家Frank尚未攻击过您/)

      await finishSpeech(game, [1, 2, 3, 4, 6])
      await game.sendPrivate("alice", "2")
      assert.match(privateTranscript(game, "alice"), /由于您之前西迁，不能再投票给2号玩家Bob/)

      await game.sendPrivate("alice", "6")
      await game.sendPrivate("bob", "1")
      await game.sendPrivate("carol", "1")
      await game.sendPrivate("dave", "1")
      await game.sendPrivate("frank", "1")

      const transcript = groupTranscript(game)
      assert.match(transcript, /本轮1号玩家Alice出局/)
    })
  })

  it("awakens Lin Dan Han from a blocked skill and invalidates his mutual vote", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {
        [HERO.ZHU_YOU_JIAN]: 1,
        [HERO.LIN_DAN_HAN]: 5,
      })
      await game.sendGroup("alice", "处决5")
      assert.match(privateTranscript(game, "eve"), /由于您防下了一次致命伤害，您从现在获得“西迁”/)

      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await game.sendPrivate("bob", "5")
      await game.sendPrivate("eve", "2")
      await game.sendPrivate("alice", "4")
      await game.sendPrivate("carol", "4")
      await game.sendPrivate("dave", "3")
      await game.sendPrivate("frank", "4")

      const transcript = groupTranscript(game)
      assert.match(privateTranscript(game, "eve"), /虽然我们成功转进，但是可汗本次投票失效/)
      assert.match(transcript, /本轮4号玩家Dave出局/)
    })
  })

  it("lets Zhang Xianzhong choose a target after elimination and blocks roster changes", async () => {
    await withGame(async (game) => {
      await reachZhangXianZhongTarget(game)

      await game.sendGroup("host", "踢出2")
      assert.match(groupTranscript(game), /正在等待武将技能或主持人判定，请稍候再踢人/)

      await game.sendGroup("eve", "1")
      const transcript = groupTranscript(game)
      assert.match(transcript, /1号玩家Alice被张献忠带走/)
      assert.match(transcript, /游戏继续，开始第2轮发言/)
    })
  })

  it("does not open Zhang Xianzhong's window after a host kick", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 5 })
      await game.sendGroup("host", "踢出5")

      const transcript = groupTranscript(game)
      assert.match(transcript, /5号玩家Eve被主持人踢出/)
      assert.doesNotMatch(transcript, /技能触发，请Eve.*选择带出局的玩家/)
    })
  })

  it("does not open Zhang Xianzhong's window after a player's self-exit", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 5 })
      await game.sendPrivate("eve", "退出游戏")

      const transcript = groupTranscript(game)
      assert.match(transcript, /5号玩家Eve主动退出游戏/)
      assert.doesNotMatch(transcript, /技能触发，请Eve.*选择带出局的玩家/)
    })
  })

  it("does not open Zhang Xianzhong's window after a speech timeout", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 5 }, true, "1", false)
      for (const seat of [1, 2, 3, 4, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "号按时发言")
      }
      await tickGameClock(1_001)

      const transcript = groupTranscript(game)
      assert.match(transcript, /5号玩家Eve发言超时，被自动踢出/)
      assert.doesNotMatch(transcript, /技能触发，请Eve.*选择带出局的玩家/)
    }, { speakTimeoutMode1: 1 })
  })

  it("continues to the next round when Zhang Xianzhong abandons", async () => {
    await withGame(async (game) => {
      await reachZhangXianZhongTarget(game)
      await game.sendGroup("eve", "弃")

      const transcript = groupTranscript(game)
      assert.match(transcript, /张献忠大发慈悲，放弃了图图/)
      assert.match(transcript, /游戏继续，开始第2轮发言/)
    })
  })

  it("continues to the next round when Zhang Xianzhong times out", async () => {
    await withGame(async (game) => {
      await reachZhangXianZhongTarget(game)
      await tickGameClock(1_000)

      const transcript = groupTranscript(game)
      assert.match(transcript, /张献忠输入超时，已取消发动技能/)
      assert.match(transcript, /游戏继续，开始第2轮发言/)
    }, { skillTimeout: 1 })
  })

  it("does not open Zhang Xianzhong's window after a Deer selection timeout", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game, "5", { [HERO.ZHANG_XIAN_ZHONG]: 5 })
      for (const [seat, candidate] of [[1, "关羽"], [2, "张飞"], [3, "赵云"], [4, "孙权"], [6, "朱棣"]] as const) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], candidate)
      }
      await tickGameClock(30_001)

      const transcript = groupTranscript(game)
      assert.match(transcript, /5号玩家Eve选人超时，被自动踢出/)
      assert.doesNotMatch(transcript, /技能触发，请Eve.*选择带出局的玩家/)
    }, { deerSelectionTimeout: 30, deerProgressDelay: 0 })
  })

  it("abandons Zhang Xianzhong cleanly after a speech-phase execution", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {
        [HERO.ZHU_YOU_JIAN]: 1,
        [HERO.ZHANG_XIAN_ZHONG]: 5,
      })

      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /技能触发，请Eve.*选择带出局的玩家/)

      await game.sendGroup("eve", "弃")
      const transcript = groupTranscript(game)
      assert.match(transcript, /张献忠大发慈悲，放弃了图图/)
      assert.doesNotMatch(transcript, /不识别的语句，请张献忠发送目前还在场的玩家序号/)
    })
  })

  it("accepts all other speeches but waits for Zhang Xianzhong before opening voting", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1, [HERO.ZHANG_XIAN_ZHONG]: 5 })
      await game.sendGroup("alice", "处决5")
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "窗口内发言")
      assert.doesNotMatch(groupTranscript(game), /等大西王发话|现在开始投票/)
      await game.sendGroup("eve", "弃")
      assert.match(groupTranscript(game), /窗口内发言[\s\S]*现在开始投票/)
    })
  })

  it("opens voting after Zhang's speech-phase window times out with all speeches recorded", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1, [HERO.ZHANG_XIAN_ZHONG]: 5 })
      await game.sendGroup("alice", "处决5")
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "窗口内发言")
      assert.doesNotMatch(groupTranscript(game), /现在开始投票/)
      await tickGameClock(10_001)
      assert.match(groupTranscript(game), /张献忠输入超时/)
      assert.equal((groupTranscript(game).match(/现在开始投票/g) ?? []).length, 1)
    }, { skillTimeout: 10 })
  })

  it("extends an expiring classic speech deadline until 60 seconds after Zhang completes", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 1, [HERO.ZHANG_XIAN_ZHONG]: 5 }, true, "1")
      await game.sendGroup("alice", "处决5")
      await tickGameClock(25_000)
      assert.doesNotMatch(groupTranscript(game), /发言超时/)
      await game.sendGroup("eve", "弃")
      await tickGameClock(59_000)
      assert.doesNotMatch(groupTranscript(game), /发言超时/)
      await tickGameClock(1_001)
      assert.match(groupTranscript(game), /发言超时/)
    }, { speakTimeoutMode1: 20, skillTimeout: 90 })
  })

  for (const mode of ['deer', 'turtle'] as const) it(`extends ${mode} individual speech clocks past Zhang's choice window`, async () => {
    await withGame(async game => {
      const heroes = { [HERO.ZHU_YOU_JIAN]: 1, [HERO.ZHANG_XIAN_ZHONG]: 5 }
      if (mode === 'deer') {
        await startCustomDeerGame(game, '1', heroes)
        for (const seat of [1, 2, 3, 4, 6]) await submitAndApproveDeerSeat(game, seat, '词条' + seat)
      }
      else await startCustomTurtleGame(game, '1', heroes)
      await game.sendGroup('alice', '处决5')
      await tickGameClock(25_000)
      assert.doesNotMatch(groupTranscript(game), /发言超时/)
      // Other players can still submit even after their old clock deadline.
      await game.sendGroup('bob', '2窗口内发言')
      if (mode === 'turtle') await game.sendGroup('host', '2是')
      await game.sendGroup('eve', '弃')
      await tickGameClock(59_000)
      assert.doesNotMatch(groupTranscript(game), /发言超时/)
      await tickGameClock(1_001)
      assert.match(groupTranscript(game), /发言超时/)
    }, { speakTimeoutMode1: 20, skillTimeout: 90 })
  })

  it("ends before Zhang Xianzhong can trigger when he is the last undercover", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHANG_XIAN_ZHONG]: 5 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      await voteOut(game, 6, [1, 2, 3, 4, 5, 6])

      await finishSpeech(game, [1, 2, 3, 4, 5])
      await voteOut(game, 5, [1, 2, 3, 4, 5])

      const transcript = groupTranscript(game)
      assert.match(transcript, /游戏结束，好人胜利/)
      assert.doesNotMatch(transcript, /技能触发，请Eve.*选择带出局的玩家/)
    })
  })

  it("ends with an undercover victory as soon as the remaining roster reaches parity", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      let activeSeats = [1, 2, 3, 4, 5, 6]

      for (const targetSeat of [1, 2, 3]) {
        await finishSpeech(game, activeSeats)
        await voteOut(game, targetSeat, activeSeats)
        activeSeats = activeSeats.filter(seat => seat !== targetSeat)
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /游戏结束，卧底胜利/)
      assert.doesNotMatch(transcript, /游戏继续，开始第4轮发言/)
    })
  })

  it("lets eliminated Shi Kefa gift fa from private chat without blocking the next round", async () => {
    await withGame(async (game) => {
      await reachShiKeFaGift(game)
      assert.match(groupTranscript(game), /游戏继续，开始第2轮发言/)

      await game.sendPrivate("eve", "1")
      assert.match(privateTranscript(game, "eve"), /遵令，已将2个伐赠予1号玩家Alice/)
      assert.match(privateTranscript(game, "alice"), /史阁部赠予您2个“伐”标记/)
    })
  })

  it("lets eliminated Shi Kefa abandon the private gift", async () => {
    await withGame(async (game) => {
      await reachShiKeFaGift(game)
      await game.sendPrivate("eve", "弃")

      assert.match(privateTranscript(game, "eve"), /您已放弃发动技能/)
    })
  })

  it("keeps Shi Kefa's gift pending after an invalid private target", async () => {
    await withGame(async (game) => {
      await reachShiKeFaGift(game)
      await game.sendPrivate("eve", "9")
      assert.match(privateTranscript(game, "eve"), /不识别的语句，请阁部发送在场的玩家序号/)

      await game.sendPrivate("eve", "1")
      assert.match(privateTranscript(game, "eve"), /遵令，已将2个伐赠予1号玩家Alice/)
      assert.match(privateTranscript(game, "alice"), /史阁部赠予您2个“伐”标记/)
    })
  })

  it("opens Shi Kefa's non-blocking gift after a speech-phase execution", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {
        [HERO.ZHU_YOU_JIAN]: 1,
        [HERO.SHI_KE_FA]: 5,
      })
      await game.sendGroup("alice", "处决5")

      assert.match(groupTranscript(game), /技能触发，请Eve在私聊中选择一名玩家获得一定数量的“伐”标记/)
      assert.match(privateTranscript(game, "eve"), /阁部，您可以将2个“伐”标记赠予/)
      await game.sendPrivate("eve", "2")
      assert.match(privateTranscript(game, "bob"), /史阁部赠予您2个“伐”标记/)
    })
  })

  it("retains ballots when a kicked seat is filled during voting", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game)
      await game.addUser("grace", "Grace")
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendPrivate("alice", "2")
      await game.sendPrivate("carol", "2")
      await game.sendGroup("host", "\u8e22\u51fa4")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "\u662f")

      assert.match(groupTranscript(game), /Grace\u6210\u4e3a\u7b2c4\u53f7\u73a9\u5bb6/)
      assert.match(groupTranscript(game), /\u5176\u4f59\u6709\u6548\u6295\u7968\u7ee7\u7eed\u4fdd\u7559/)

      await game.sendPrivate("bob", "1")
      await game.sendPrivate("eve", "2")
      await game.sendPrivate("frank", "2")
      await game.sendPrivate("grace", "2")

      assert.match(groupTranscript(game), /2\u53f7\u73a9\u5bb6Bob\uff1a4\u7968/)
    })
  })

  it("settles immediately when kicking an unvoted player locks the result", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game)
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendPrivate("alice", "2")
      await game.sendPrivate("carol", "2")
      await game.sendPrivate("dave", "2")
      await game.sendPrivate("bob", "1")
      await game.sendGroup("host", "\u8e22\u51fa6")

      const transcript = groupTranscript(game)
      assert.match(transcript, /6\u53f7\u73a9\u5bb6\u5df2\u88ab\u8e22\u51fa\uff0c\u5176\u4f59\u6709\u6548\u6295\u7968\u5df2\u4fdd\u7559\uff1b\u8c03\u6574\u540e\u7684\u7968\u6570\u5df2\u7ecf\u9501\u5b9a\u7ed3\u679c\uff0c\u7acb\u5373\u7ed3\u7b97/)
      assert.match(transcript, /2\u53f7\u73a9\u5bb6Bob\uff1a3\u7968/)
    })
  })

  it("routes Wu Sangui's choice immediately and blocks roster changes while waiting", async () => {
    await withGame(async (game) => {
      await reachWuSanGuiChoice(game)

      await game.sendGroup("host", "踢出2")
      assert.match(groupTranscript(game), /正在等待武将技能或主持人判定，请稍候再踢人/)

      await game.sendGroup("alice", "5")
      assert.match(groupTranscript(game), /本轮5号玩家Eve被吴三桂指定出局/)
    })
  })

  it("awakens Wu Sangui after more distinct attackers than authority uses", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.WU_SAN_GUI]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const ballots = [5, 1, 1, 6, 6, 5]
      for (let index = 0; index < ballots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
      }
      assert.match(groupTranscript(game), /亮出武将牌：吴三桂，请Alice选择/)
      await game.sendGroup("alice", "5")

      assert.match(groupTranscript(game), /吴三桂.*自立/)
      assert.match(privateTranscript(game, "alice"), /获得2个伐标记/)
    })
  })

  it("enters overtime when Wu Sangui abandons the choice", async () => {
    await withGame(async (game) => {
      await reachWuSanGuiChoice(game)
      await game.sendGroup("alice", "弃")
      assert.match(groupTranscript(game), /进入第1轮加时/)
    })
  })

  it("enters overtime when Wu Sangui's choice times out", async () => {
    await withGame(async (game) => {
      await reachWuSanGuiChoice(game)
      mock.timers.tick(120_000)
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.match(groupTranscript(game), /吴三桂输入超时，进入第1轮加时/)
    })
  })

  for (const whiteSeat of [0, 1]) it(`ends a Lin Dan Han stalemate with white seat ${whiteSeat}`, async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, { [HERO.LIN_DAN_HAN]: 1 }, true, '5', true, whiteSeat)
      await game.sendGroup('host', '踢出4')
      await finishSpeech(game, [1, 2, 3, 5, 6])
      // All attackers are consumed while Lin abstains, leaving no elimination.
      for (const seat of [1, 2, 3, 5, 6]) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], seat === 1 ? '弃' : '1')
      }
      assert.match(privateTranscript(game, 'alice'), /获得“西迁”/)
      assert.match(groupTranscript(game), /开始第2轮发言/)
      assert.doesNotMatch(groupTranscript(game), /满足僵局条件/)
      await finishSpeech(game, [1, 2, 3, 5, 6])
      for (const seat of [1, 2, 3, 5, 6]) await game.sendPrivate(PLAYER_IDS[seat - 1], '弃')
      assert.match(groupTranscript(game), /连续两轮平安夜且满足僵局条件.*卧底胜利/)
      await game.sendGroup('host', '卧底')
      assert.match(latestGroupOutput(game), /开始凑人/)
    })
  })

  it('counts overtime only at its final safe night and does not reset for rejected removal', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendGroup('host', '踢出3')
      await game.sendGroup('host', '踢出4')
      await finishSpeech(game, [1, 2, 5, 6])
      for (const [seat, target] of [[1, 5], [2, 6], [5, 6], [6, 5]]) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)
      assert.doesNotMatch(groupTranscript(game), /平安夜/)
      await finishSpeech(game, [5, 6])
      await game.sendPrivate('alice', '5')
      await game.sendPrivate('bob', '6')
      assert.match(groupTranscript(game), /开始第2轮发言/)
      await game.sendGroup('host', '踢出9')
      await finishSpeech(game, [1, 2, 5, 6])
      for (const seat of [1, 2, 5, 6]) await game.sendPrivate(PLAYER_IDS[seat - 1], '弃')
      assert.match(groupTranscript(game), /满足僵局条件.*卧底胜利/)
    })
  })

  it("resets parity safe nights after a successful kick and original-seat replacement", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendGroup('host', '踢出3')
      await game.sendGroup('host', '踢出4')
      const safeNight = async () => {
        await finishSpeech(game, [1, 2, 5, 6])
        for (const seat of [1, 2, 5, 6]) await game.sendPrivate(PLAYER_IDS[seat - 1], '弃')
      }
      await safeNight()
      // Removing an undercover avoids an immediate majority victory.
      await game.sendGroup('frank', '退出游戏')
      await game.sendGroup('frank', '1')
      await advanceUntilSettled(game.sendGroup('host', '是'))
      await safeNight()
      assert.doesNotMatch(groupTranscript(game), /满足僵局条件/)
      await safeNight()
      assert.match(groupTranscript(game), /满足僵局条件.*卧底胜利/)
    })
  })

  it("advances after a regular majority-tie safe night", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      const ballots = ["2", "3", "4", "5", "\u5f03", "\u5f03"]
      for (let index = 0; index < ballots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], ballots[index])
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /\u672c\u8f6e\u65e0\u4eba\u51fa\u5c40\uff0c\u5e73\u5b89\u591c\u3002/)
      assert.match(transcript, /\u6e38\u620f\u7ee7\u7eed\uff0c\u5f00\u59cb\u7b2c2\u8f6e\u53d1\u8a00\u3002/)
    })
  })

  it("initializes ordinary overtime and resolves its restricted ballot", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      const regularBallots = [5, 5, 6, 6, 6, 5]
      for (let index = 0; index < regularBallots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(regularBallots[index]))
      }
      assert.match(groupTranscript(game), /\u8fdb\u5165\u7b2c1\u8f6e\u52a0\u65f6\uff0c\u8bf7.*5\u53f7\u73a9\u5bb6Eve.*6\u53f7\u73a9\u5bb6Frank.*\u53d1\u8a00\u3002/)

      await finishSpeech(game, [5, 6])
      const overtimeBallots = [5, 5, 5, 6]
      for (let index = 0; index < overtimeBallots.length; index++) {
        await game.sendPrivate(PLAYER_IDS[index], String(overtimeBallots[index]))
      }

      assert.match(groupTranscript(game), /\u672c\u8f6e5\u53f7\u73a9\u5bb6Eve\u51fa\u5c40/)
    })
  })

  it("advances after an overtime tie safe night", async () => {
    await withGame(async (game) => {
      await reachWuSanGuiChoice(game)
      await game.sendGroup("alice", "\u5f03")
      await finishSpeech(game, [5, 6])

      const overtimeBallots = new Map([
        [1, 5],
        [2, 5],
        [3, 6],
        [4, 6],
      ])
      for (const [seat, target] of overtimeBallots) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], String(target))
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /\u672c\u8f6e\u65e0\u4eba\u51fa\u5c40\uff0c\u5e73\u5b89\u591c\u3002/)
      assert.match(transcript, /\u6e38\u620f\u7ee7\u7eed\uff0c\u5f00\u59cb\u7b2c2\u8f6e\u53d1\u8a00\u3002/)
    })
  })

  it("returns a kicked nickname directly to its original seat during speech", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await game.addUser("dave-alt", "Dave")

      await game.sendGroup("host", "踢出3")
      await game.sendGroup("host", "踢出4")
      await game.sendGroup("dave-alt", "1")
      await game.sendGroup("host", "是")

      const transcript = groupTranscript(game)
      assert.match(transcript, /Dave成为第4号玩家/)
      assert.doesNotMatch(transcript, /请Dave在以上序号中选择替代/)
    })
  })

  it("sends a replacement the same hero card as the original seat owner", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 4 })
      await game.addUser("grace", "Grace")
      const originalCard = game.transcript.find(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@dave"
        && entry.content.includes("你本局抽到的武将为：朱由检"),
      )
      assert.ok(originalCard)

      await game.sendGroup("host", "踢出4")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")

      const replacementCard = game.transcript.find(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@grace"
        && entry.content.includes("你本局抽到的武将为：朱由检"),
      )
      assert.ok(replacementCard)
      assert.equal(replacementCard.content, originalCard.content)
      assert.match(replacementCard.content, /<img src="file:\/\/\/.*uc-pics\/%E6%9C%B1%E7%94%B1%E6%A3%80%E5%8D%A1%E9%9D%A2\.png"\/>/)
      assert.doesNotMatch(privateTranscript(game, "grace"), /技能：/)
    })
  })

  it("uses one custom hero card for queries, initial dealing, and replacements", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "undercover-custom-card-game-"))
    const game = await UndercoverGameHarness.create({}, { baseDir })
    try {
      const png = createPng(1)
      const image = `<img src="data:image/png;base64,${png.toString("base64")}"/>`
      await game.addUser("card-admin", "Card Admin", 5)
      await game.sendGroup("card-admin", `替换卡面 朱由检 ${image}`)
      await game.sendGroup("card-admin", "查询武将 朱由检")
      await startCustomSixPlayerGame(game, { [HERO.ZHU_YOU_JIAN]: 4 }, true, "5", false)
      await game.addUser("grace", "Grace")

      const queryCard = game.transcript.find(entry =>
        entry.direction === "out"
        && entry.scope === "group"
        && entry.content.includes("朱由检武将技能："),
      )
      const originalCard = game.transcript.find(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@dave"
        && entry.content.includes("你本局抽到的武将为：朱由检"),
      )
      assert.ok(queryCard)
      assert.ok(originalCard)

      await game.sendGroup("host", "踢出4")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      const replacementCard = game.transcript.find(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@grace"
        && entry.content.includes("你本局抽到的武将为：朱由检"),
      )
      assert.ok(replacementCard)

      const customSource = /<img src="(file:\/\/\/[^\"]*data[^\"]*hero-cards[^\"]*)"\/>/
      assert.match(queryCard.content, customSource)
      assert.match(originalCard.content, customSource)
      assert.match(replacementCard.content, customSource)
      assert.equal(
        queryCard.content.match(customSource)?.[1],
        originalCard.content.match(customSource)?.[1],
      )
      assert.equal(
        replacementCard.content.match(customSource)?.[1],
        originalCard.content.match(customSource)?.[1],
      )
    }
    finally {
      await game.stop()
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("rejects a kicked nickname when its original seat is occupied", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, {})
      await game.addUser("grace", "Grace")
      await game.addUser("dave-alt", "Dave")

      await game.sendGroup("host", "踢出3")
      await game.sendGroup("host", "踢出4")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      await game.sendGroup("grace", "4")
      await game.sendGroup("dave-alt", "1")

      const transcript = groupTranscript(game)
      assert.match(transcript, /Grace成为第4号玩家/)
      assert.match(transcript, /你之前的4号座位已被其他玩家接替，不能改补其他空位/)
    })
  })

  it("cancels and expires replacement requests during speech", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game)
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "踢出4")

      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "取消补位")
      assert.match(groupTranscript(game), /已取消Grace的补位申请/)

      await game.sendGroup("grace", "1")
      await tickGameClock(10_000)
      assert.match(groupTranscript(game), /Grace的补位申请已超时，申请自动取消/)
    }, { replacementTimeout: 10 })
  })

  it("pauses a replacement timeout while Mao Wenlong is choosing and resumes it afterward", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.MAO_WEN_LONG]: 1 })
      await game.addUser("grace", "Grace")
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])

      await game.sendGroup("host", "踢出4")
      await game.sendGroup("grace", "1")
      await tickGameClock(8_000)

      await game.sendPrivate("bob", "5")
      await game.sendPrivate("carol", "5")
      await game.sendPrivate("eve", "6")
      await game.sendPrivate("frank", "3")
      assert.match(groupTranscript(game), /其他人投票结束，等待毛文龙投票/)

      await tickGameClock(10_000)
      assert.doesNotMatch(groupTranscript(game), /Grace的补位申请已超时/)

      await game.sendPrivate("alice", "弃")
      await tickGameClock(5_000)
      assert.match(groupTranscript(game), /Grace的补位申请已超时，申请自动取消/)
    }, { replacementTimeout: 10 })
  })

  it("resumes the post-Mao pipeline after choosing a target", async () => {
    await withGame(async (game) => {
      await reachMaoWenLongChoice(game)
      await game.sendPrivate("alice", "5")
      assert.match(groupTranscript(game), /5号玩家Eve：3票/)
      assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)
      assert.doesNotMatch(groupTranscript(game), /毛文龙技能发动超时/)
    })
  })

  it("archives Mao Wenlong's regular ballot as a skipped vote", async () => {
    await withGame(async (game) => {
      await reachMaoWenLongChoice(game)
      await game.sendPrivate("alice", "5")
      await game.sendGroup("host", "停止卧底")
      const rows = await game.app.database.get("undercover_history_game", {})
      assert.equal(rows.length, 1, groupTranscript(game))
      const header = JSON.parse(rows[0].payload)
      const mao = header.participants.find((participant: { seat: number }) => participant.seat === 1)
      assert.ok(mao)
      const phases = await game.app.database.get("undercover_history_phase", {
        gameId: rows[0].gameId,
      })
      const first = JSON.parse(phases.sort((a, b) => a.sequence - b.sequence)[0].payload)
      const ballot = first.ballots.find((entry: { voterTenureId: string }) => entry.voterTenureId === mao.tenureId)
      assert.equal(ballot.status, "skip")
      await game.sendGroup("host", "复盘 " + rows[0].id)
      assert.match(latestGroupOutput(game), /1号玩家Alice跳过投票阶段。/)
      assert.doesNotMatch(latestGroupOutput(game), /1号玩家Alice(?:未及时|未来得及)投票/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it("keeps a blocking skill pending when its private prompt fails and lets the player retrieve it", async () => {
    await withGame(async (game) => {
      await startCustomSixPlayerGame(game, { [HERO.MAO_WEN_LONG]: 1 })
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const ballots = [5, 5, 6, 6, 3]
      for (let index = 0; index < ballots.length - 1; index++) {
        await game.sendPrivate(PLAYER_IDS[index + 1], String(ballots[index]))
      }
      game.failNextPrivateMessages("alice")
      await game.sendPrivate("frank", String(ballots.at(-1)))
      await new Promise<void>(resolve => setImmediate(resolve))

      assert.match(groupTranscript(game), /1号玩家的私聊操作提示发送失败；流程仍在等待/)
      await game.sendPrivate("alice", "我的待处理")
      assert.match(latestPrivateOutput(game, "alice"), /毛帅，请在参阅本次投票结果后投票/)
      await game.sendPrivate("host", "待处理操作")
      assert.match(latestPrivateOutput(game, "host"), /正在等待1号玩家处理mao-wen-long-late-vote/)
      await game.sendPrivate("alice", "弃")
      assert.doesNotMatch(latestGroupOutput(game), /本局已自动终止/)
    })
  })

  it("resumes the same post-Mao pipeline when the choice times out", async () => {
    await withGame(async (game) => {
      await reachMaoWenLongChoice(game)
      await tickGameClock(1_000)
      assert.match(groupTranscript(game), /毛文龙技能发动超时，自动取消/)
      assert.match(groupTranscript(game), /进入第1轮加时/)
    }, { skillTimeout: 1 })
  })

  it("resumes at Lin Dan Han after Huang Taiji chooses a tied leader", async () => {
    await withGame(async (game) => {
      await reachHuangTaiJiChoice(game)
      await game.sendPrivate("alice", "3")
      assert.match(groupTranscript(game), /3号玩家Carol：1票/)
      assert.match(groupTranscript(game), /本轮4号玩家Dave出局/)
    })
  })

  it("resumes at the same cursor when Huang Taiji abandons", async () => {
    await withGame(async (game) => {
      await reachHuangTaiJiChoice(game)
      await game.sendPrivate("alice", "弃")
      assert.match(groupTranscript(game), /进入第2轮加时/)
    })
  })

  it("resumes at the same cursor when Huang Taiji times out", async () => {
    await withGame(async (game) => {
      await reachHuangTaiJiChoice(game)
      await tickGameClock(1_000)
      assert.match(groupTranscript(game), /皇太极技能发动超时，自动取消/)
      assert.match(groupTranscript(game), /进入第2轮加时/)
    }, { skillTimeout: 1 })
  })

  it("invalidates old speech timers before starting a fresh game", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game, "1")
      await game.sendGroup("host", "结束卧底")
      await game.sendGroup("host", "卧底")

      const transcriptBeforeTick = groupTranscript(game)
      assert.equal((transcriptBeforeTick.match(/开始凑人/g) ?? []).length, 2)
      await tickGameClock(10_000)
      const newOutput = groupTranscript(game).slice(transcriptBeforeTick.length)
      assert.doesNotMatch(newOutput, /发言超时|开始投票/)
    }, { speakTimeoutMode1: 10 })
  })

  it("ignores gameplay input from another guild while one global game is active", async () => {
    await withGame(async (game) => {
      await startSixPlayerGame(game)
      const otherGuild = "undercover-other-guild"

      await game.sendGroupTo(otherGuild, "alice", "跨群发言不应生效")
      for (const seat of [2, 3, 4, 5, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "号测试发言")
      }
      assert.doesNotMatch(groupTranscript(game), /现在开始投票/)

      await game.sendGroup("alice", "1号测试发言")
      assert.match(groupTranscript(game), /现在开始投票/)
      assert.equal(game.transcript.some(entry =>
        entry.direction === "out" && entry.channelId === otherGuild,
      ), false)
    })
  })

  it("cancels a pending hero timeout before a fresh game starts", async () => {
    await withGame(async (game) => {
      await reachMaoWenLongChoice(game)
      await game.sendGroup("host", "结束卧底")
      await game.sendGroup("host", "卧底")

      const transcriptBeforeTick = groupTranscript(game)
      await tickGameClock(2_000)
      const newOutput = groupTranscript(game).slice(transcriptBeforeTick.length)
      assert.doesNotMatch(newOutput, /毛文龙技能发动超时|投票结束|进入第.*轮加时/)
    }, { skillTimeout: 1 })
  })

  it("runs concurrent deer selection, review, speech, progress, self-explosion restriction, and reveal", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      const beforeApproval = groupTranscript(game)
      assert.match(beforeApproval, /本局为鹿模式，发题前仍可切换模式/)
      assert.match(beforeApproval, /鹿模式易混：诸葛亮/)
      assert.match(beforeApproval, /鹿模式第1轮发言已开放/)
      assert.match(privateTranscript(game, "alice"), /选择三国人物/)
      assert.match(privateTranscript(game, "eve"), /选择明朝人物/)
      assert.doesNotMatch(privateTranscript(game, "alice"), /选择明朝人物/)
      assert.doesNotMatch(privateTranscript(game, "eve"), /选择三国人物/)

      await game.sendPrivate("alice", "《诸 葛亮》")
      assert.match(privateTranscript(game, "alice"), /不能选择易混本身/)
      await game.sendPrivate("alice", "刘备")
      const request = [...game.transcript].reverse().find(entry =>
        entry.direction === "out"
        && entry.scope === "private"
        && entry.channelId === "@host"
        && entry.content.includes("1号玩家Alice提交选人"),
      )
      assert.ok(request)
      assert.match(request.content, /该座位身份：好人/)
      assert.match(request.content, /对应规则：选择三国人物/)
      assert.match(request.content, /本局易混：诸葛亮/)
      await game.sendGroup("host", "谁没选人")
      const pendingProgress = groupTranscript(game)
      assert.match(pendingProgress, /待主持审核：1号玩家Alice/)
      assert.match(pendingProgress, /<at id="host"/)
      assert.doesNotMatch(pendingProgress, /刘备|选择三国人物/)
      await game.sendPrivateReply("host", "否 不符合规则", {
        rawMessage: "[CQ:reply,id=" + request.messageId + "]否 不符合规则",
        omitSessionQuote: true,
      })
      assert.match(privateTranscript(game, "alice"), /主持人驳回了你的选人.*不符合规则/)
      await game.sendPrivate("alice", "关羽")
      await game.sendPrivate("host", "1是")
      assert.doesNotMatch(groupTranscript(game), /1号玩家选人通过|已通过1号玩家的选人/)
      await game.sendGroup("alice", "1已经选好，可以先发言")
      assert.doesNotMatch(groupTranscript(game), /现在开始投票/)
      await game.sendGroup("host", "谁没选人")
      assert.match(groupTranscript(game), /尚未提交：2号玩家Bob.*3号玩家Carol/)
      for (const [seat, candidate] of [[2, "张飞"], [3, "赵云"], [4, "孙权"], [5, "朱元璋"], [6, "朱棣"]] as const) {
        await submitAndApproveDeerSeat(game, seat, candidate)
      }
      await game.sendGroup("host", "谁没选人")
      assert.match(groupTranscript(game), /所有在场非白板玩家均已通过选人审核/)
      await game.sendGroup("alice", "1自爆，好人刘备")
      assert.match(groupTranscript(game), /本模式不能自爆/)

      await game.sendGroup("host", "停止卧底")
      await game.sendGroup("alice", "隐藏选人")
      await game.sendGroup("host", "公布选人")
      await game.sendGroup("host", "公布选人")
      let transcript = groupTranscript(game)
      assert.equal((transcript.match(/鹿模式选人公布（易混：诸葛亮）/g) ?? []).length, 2)
      assert.doesNotMatch(transcript, /1号 Alice｜好人｜规则：选择三国人物｜选人：关羽/)
      await game.sendGroup("alice", "公布选人")
      assert.match(groupTranscript(game), /1号 Alice｜好人｜规则：选择三国人物｜选人：关羽/)
      await game.sendGroup("host", "公布选人")
      transcript = groupTranscript(game)
      assert.equal((transcript.match(/鹿模式选人公布（易混：诸葛亮）/g) ?? []).length, 4)
      await game.sendGroup("host", "复盘")
      const afterSummary = groupTranscript(game)
      assert.equal((afterSummary.match(/鹿模式选人公布（易混：诸葛亮）/g) ?? []).length, 4)
    }, { deerProgressDelay: 0 })
  })

  it("delays deer progress disclosure, deduplicates replayed queries, and ignores ordinary chat", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      const opening = groupTranscript(game)
      assert.doesNotMatch(opening, /白板可直接发言/)

      const beforeChat = groupTranscript(game).length
      await game.sendGroup("alice", "大家先正常聊一聊")
      assert.equal(groupTranscript(game).length, beforeChat)
      await game.sendGroup("alice", "1这是我的正式发言")
      assert.match(groupTranscript(game), /你需要先私聊提交选人并通过主持人审核/)

      const beforeReplay = (groupTranscript(game).match(/尚未达到催促时间/g) ?? []).length
      await game.sendGroupEvent("host", "谁没选人", "same-progress-message")
      await game.sendGroupEvent("host", "谁没选人", "same-progress-message")
      assert.equal((groupTranscript(game).match(/尚未达到催促时间/g) ?? []).length, beforeReplay + 1)
      assert.doesNotMatch(groupTranscript(game), /尚未提交：1号玩家Alice/)

      await tickGameClock(300_000)
      await game.sendGroup("host", "谁没选人")
      assert.match(groupTranscript(game), /尚未提交：1号玩家Alice/)
    })
  })

  it("lets an approved Deer Zhu Youjian execute before other seats finish selection", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game, "5", { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /先完成鹿模式选人并通过主持人审核/)
      await game.sendPrivate("alice", "关羽")
      await game.sendPrivate("host", "1是")
      await game.sendGroup("alice", "处决5")
      const transcript = groupTranscript(game)
      assert.match(transcript, /亮出武将牌：朱由检，并选择处决5号玩家/)
      assert.match(transcript, /处决成功/)
      assert.doesNotMatch(transcript, /2号玩家选人通过|3号玩家选人通过/)
    })
  })

  it("rejects a Deer Zhu Youjian who is outside the overtime speaking seats", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game, "5", { [HERO.ZHU_YOU_JIAN]: 1 })
      for (let seat = 1; seat <= 6; seat++) {
        await game.sendPrivate(PLAYER_IDS[seat - 1], `候选${seat}`)
        await game.sendPrivate("host", `${seat}是`)
        await game.sendGroup(PLAYER_IDS[seat - 1], `${seat}号鹿模式发言`)
      }
      for (const [index, target] of [5, 5, 6, 6, 3, 4].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)

      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /你不属于本次加时的发言玩家，不能发动处决/)
      assert.doesNotMatch(groupTranscript(game), /亮出武将牌：朱由检，并选择处决5号玩家/)
    })
  })

  it("lets an xp-points alternate account control the same last-Deer reveal row", async () => {
    const xpPoints = {
      resolveNickname: (_platform: string, userId: string, fallback?: string) =>
        userId === "alice" || userId === "alice-alt" ? "ExamplePlayer" : fallback,
      ensureManagedIdentity: async (_platform: string, userId: string, suggested?: string) => ({
        profileId: userId === "alice" || userId === "alice-alt" ? 1 : PLAYER_IDS.indexOf(userId) + 10,
        nickname: userId === "alice" || userId === "alice-alt" ? "ExamplePlayer" : suggested ?? userId,
        automatic: false,
      }),
    }
    await withGame(async game => {
      await startCustomDeerGame(game)
      await game.sendGroup("host", "停止卧底")
      await game.addUser("alice-alt", "Alice Alt")
      await game.sendGroup("alice-alt", "隐藏选人")
      await game.sendGroup("host", "公布选人")
      assert.doesNotMatch(groupTranscript(game), /1号 ExamplePlayer｜好人/)
      await game.sendGroup("alice-alt", "公布选人")
      assert.match(groupTranscript(game), /1号 ExamplePlayer｜好人｜规则：选择三国人物/)
    }, {}, { xpPoints })
  })

  it("authorizes last-Deer choices by canonical person ID after rename, never by a borrowed nickname", async () => {
    const identity = (userId: string, suggested = userId) => ({
      profileId: userId === 'alice' ? 1 : userId === 'alt' ? 101 : userId === 'outsider' ? 999 : PLAYER_IDS.indexOf(userId) + 10,
      accountId: 'account-' + userId,
      nickname: userId === 'alt' ? 'RenamedPerson' : userId === 'alice' || userId === 'outsider' ? 'OriginalPerson' : suggested,
      automatic: false,
    })
    const xpPoints = {
      ensureManagedIdentity: async (_platform: string, userId: string, suggested?: string) => identity(userId, suggested),
      getManagedIdentity: async (_platform: string, userId: string) => identity(userId),
      resolveCanonicalProfileId: async (id: number) => id === 1 ? 101 : id,
    }
    await withGame(async game => {
      await startCustomDeerGame(game)
      await game.sendGroup('host', '停止卧底')
      await game.addUser('alt', 'Alternate')
      await game.addUser('outsider', 'OriginalPerson')
      await game.sendGroup('outsider', '公布选人')
      assert.match(latestGroupOutput(game), /只有上一把鹿模式/)
      await game.sendGroup('alt', '隐藏选人')
      assert.match(latestGroupOutput(game), /隐藏/)
      await game.sendGroup('alt', '公布选人')
      assert.match(latestGroupOutput(game), /1号 OriginalPerson｜好人/)
    }, {}, { xpPoints })
  })

  it("shows Deer selection onboarding only in the first round", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      for (const [seat, candidate] of [[1, "关羽"], [2, "张飞"], [3, "赵云"], [4, "孙权"], [5, "朱元璋"], [6, "朱棣"]] as const) {
        await submitAndApproveDeerSeat(game, seat, candidate)
      }
      for (let seat = 1; seat <= 6; seat++) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "本轮发言")
      }
      for (const playerId of PLAYER_IDS) await game.sendPrivate(playerId, "弃")
      const transcript = groupTranscript(game)
      assert.match(transcript, /鹿模式第2轮发言开始/)
      assert.equal((transcript.match(/已获得发言资格的玩家可以发言/g) ?? []).length, 1)
      assert.doesNotMatch(transcript, /白板可直接发言/)
    }, { deerProgressDelay: 0 })
  })

  it("kicks only a deer player whose independent selection clock expires", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      for (const [seat, candidate] of [[2, "张飞"], [3, "赵云"], [4, "孙权"], [5, "朱元璋"], [6, "朱棣"]] as const) {
        await submitAndApproveDeerSeat(game, seat, candidate)
      }
      await tickGameClock(15_000)
      assert.match(groupTranscript(game), /尚未提交：1号玩家Alice/)
      await tickGameClock(15_001)
      const transcript = groupTranscript(game)
      assert.match(transcript, /1号玩家Alice选人超时，被自动踢出/)
      assert.doesNotMatch(transcript, /本局已自动终止且不计分/)
      await game.sendGroup("bob", "2其他玩家仍可继续发言")
      for (const seat of [3, 4, 5, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "号发言")
      }
      assert.match(groupTranscript(game), /2其他玩家仍可继续发言/)
      assert.match(groupTranscript(game), /现在开始投票/)
    }, { deerSelectionTimeout: 30, deerProgressDelay: 0 })
  })

  it("gives the host a full idle review clock and refreshes it after each review", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      await game.sendPrivate("alice", "关羽")
      await game.sendPrivate("bob", "张飞")
      await tickGameClock(20_000)
      await game.sendPrivate("host", "1是")
      await tickGameClock(20_000)
      assert.doesNotMatch(groupTranscript(game), /主持人长时间未处理待审核选人/)
      assert.match(privateTranscript(game, "host"), /仍有待审核选人/)
      await tickGameClock(10_001)
      assert.match(groupTranscript(game), /主持人长时间未处理待审核选人，本局已自动终止且不计分/)
      await game.sendGroup("host", "卧底")
      const before = groupTranscript(game)
      await tickGameClock(30_000)
      assert.doesNotMatch(groupTranscript(game).slice(before.length), /主持人长时间未处理待审核选人/)
    }, { deerHostReviewTimeout: 30 })
  })

  it("restarts a deer player's clock after rejection and only resets an unspoken first-round seat", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      for (const [seat, candidate] of [[2, "张飞"], [3, "赵云"], [4, "孙权"], [5, "朱元璋"], [6, "朱棣"]] as const) {
        await submitAndApproveDeerSeat(game, seat, candidate)
      }
      await game.sendPrivate("alice", "刘备")
      await game.sendPrivate("host", "1否 不符合规则")
      await tickGameClock(29_000)
      assert.doesNotMatch(groupTranscript(game), /1号玩家Alice选人超时/)
      await game.sendPrivate("alice", "关羽")
      await game.sendPrivate("host", "1是")
      await game.sendGroup("host", "重置选人1")
      assert.match(groupTranscript(game), /已重置1号玩家的选人/)
      await tickGameClock(29_000)
      assert.doesNotMatch(groupTranscript(game), /1号玩家Alice选人超时/)
      await game.sendPrivate("alice", "赵云")
      await game.sendPrivate("host", "1是")
      await game.sendGroup("alice", "1赵云发言")
      await game.sendGroup("host", "重置选人1")
      assert.match(groupTranscript(game), /已经完成第一轮发言，不能再重置选人/)
    }, { deerSelectionTimeout: 30 })
  })

  it("keeps deer review pending when the host prompt fails and exposes a private recovery view", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game)
      game.failNextPrivateMessages("host")
      await game.sendPrivate("alice", "刘备")
      assert.match(groupTranscript(game), /鹿模式1号玩家的主持审核私聊发送失败.*待处理操作/)

      await game.sendGroup("host", "待处理操作")
      assert.match(latestGroupOutput(game), /鹿模式待主持审核座位：1/)
      assert.doesNotMatch(latestGroupOutput(game), /刘备|选择三国人物|卧底|好人/)

      await game.sendPrivate("host", "待处理操作")
      assert.match(latestPrivateOutput(game, "host"), /1号玩家Alice提交选人：“刘备”/)
      assert.match(latestPrivateOutput(game, "host"), /对应规则：选择三国人物/)

      game.failNextPrivateMessages("alice")
      await game.sendPrivate("host", "1是")
      await new Promise<void>(resolve => setImmediate(resolve))
      await game.sendGroup("alice", "1我的第一轮发言")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /1号玩家Alice：1我的第一轮发言/)
    })
  })

  it("requires a deer replacement to choose again before speaking", async () => {
    await withGame(async game => {
      await startCustomDeerGame(game, "3")
      for (const [seat, candidate] of [[1, "关羽"], [2, "张飞"], [3, "赵云"], [4, "孙权"], [5, "朱元璋"], [6, "朱棣"]] as const) {
        await submitAndApproveDeerSeat(game, seat, candidate)
      }
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "踢出1")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      assert.match(privateTranscript(game, "grace"), /你不能继承原玩家的选人/)
      assert.match(privateTranscript(game, "grace"), /选择三国人物/)
      await game.sendGroup("grace", "1我先发言")
      assert.match(groupTranscript(game), /你需要先私聊提交选人并通过主持人审核/)
      await game.sendGroup("bob", "2补位选人期间照常发言")
      await game.sendPrivate("grace", "周瑜")
      await game.sendPrivate("host", "1是")
      assert.doesNotMatch(groupTranscript(game), /1号玩家选人通过|已通过1号玩家的选人/)
      await game.sendGroup("grace", "1周瑜")
      for (const seat of [3, 4, 5, 6]) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "号发言")
      }
      assert.match(groupTranscript(game), /2补位选人期间照常发言/)
      assert.match(groupTranscript(game), /现在开始投票/)
    })
  })
  it("runs concurrent turtle questions, rejection, correction, five answers, and immediate voting", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      assert.match(groupTranscript(game), /龟模式汤面：众人参加一场宴会/)
      assert.match(privateTranscript(game, "alice"), /龟模式汤面：众人参加一场宴会/)
      assert.doesNotMatch(privateTranscript(game, "alice"), /曹操|孙权/)
      assert.doesNotMatch(privateTranscript(game, "eve"), /曹操|孙权/)

      await game.sendGroup("alice", "1自爆")
      assert.match(groupTranscript(game), /本模式不能自爆/)
      await game.sendGroup("alice", "1他是否统一北方")
      const firstAliceQuestion = [...game.transcript].reverse().find(entry =>
        entry.direction === "in"
        && entry.scope === "group"
        && entry.userId === "alice"
        && entry.content === "1他是否统一北方",
      )
      assert.ok(firstAliceQuestion)
      await game.sendGroup("bob", "2他是否善于用兵")
      assert.match(privateTranscript(game, "host"), /1号玩家Alice提问：他是否统一北方/)
      assert.match(privateTranscript(game, "host"), /对应实际词条：曹操/)
      assert.match(privateTranscript(game, "host"), /再次发送同座位答案即可覆盖/)
      await game.sendGroup("host", "龟进度")
      assert.match(groupTranscript(game), /待主持回答 1、2/)
      await game.sendGroupReply("host", "驳回 太宽泛", {
        messageId: firstAliceQuestion.messageId,
        content: firstAliceQuestion.content,
      })
      assert.match(privateTranscript(game, "alice"), /太宽泛/)
      await game.sendGroup("alice", "1他是否担任过丞相")
      const secondAliceQuestion = [...game.transcript].reverse().find(entry =>
        entry.direction === "in"
        && entry.scope === "group"
        && entry.userId === "alice"
        && entry.content === "1他是否担任过丞相",
      )
      assert.ok(secondAliceQuestion)
      await game.sendGroupReply("host", "是", {
        id: firstAliceQuestion.messageId,
        content: firstAliceQuestion.content,
      })
      assert.match(groupTranscript(game), /引用的消息不属于本轮仍有效的问题/)
      await game.sendGroupReply("host", "是", {
        rawMessage: [{ type: "reply", data: { id: secondAliceQuestion.messageId } }],
        omitSessionQuote: true,
      })
      const beforeCorrection = groupTranscript(game)
      await game.sendGroup("host", "1否")
      assert.equal(groupTranscript(game), beforeCorrection)

      const questions = new Map([[3, "他是否出身名门"], [4, "他是否善于文学"], [5, "他是否占据江东"], [6, "他是否称帝"]])
      const answers = new Map([[2, "否"], [3, "是也不是"], [4, "无关"], [5, "不确定"], [6, "是"]])
      for (const [seat, question] of questions) await game.sendGroup(PLAYER_IDS[seat - 1], String(seat) + question)
      for (const [seat, answer] of answers) await game.sendGroup("host", String(seat) + answer)
      const transcript = groupTranscript(game)
      assert.match(transcript, /问题：1他是否担任过丞相；主持回答：1否/)
      assert.match(transcript, /问题：3他是否出身名门；主持回答：3是也不是/)
      assert.match(transcript, /问题：4他是否善于文学；主持回答：4无关/)
      assert.match(transcript, /问题：5他是否占据江东；主持回答：5不确定/)
      assert.match(transcript, /现在开始投票/)
      assert.doesNotMatch(transcript, /已记录\d+号玩家的(?:问题|回答)|已将\d+号玩家的答案/)
      assert.doesNotMatch(transcript, /好人实际词条：曹操|卧底实际词条：孙权/)
      assert.doesNotMatch(privateTranscript(game, "frank"), /曹操|孙权/)
    })
  })

  it("keeps turtle host waiting state and references when its private prompt fails", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      game.failNextPrivateMessages("host")
      await game.sendGroup("alice", "1他是否统一过北方")
      assert.match(latestGroupOutput(game), /问题已记录，但主持人私聊提示发送失败.*待处理操作/)

      await game.sendGroup("host", "待处理操作")
      assert.match(latestGroupOutput(game), /龟模式待主持回答座位：1/)
      assert.doesNotMatch(latestGroupOutput(game), /曹操|孙权|统一过北方/)
      await game.sendPrivate("host", "待处理操作")
      assert.match(latestPrivateOutput(game, "host"), /1号玩家Alice提问：他是否统一过北方/)
      assert.match(latestPrivateOutput(game, "host"), /对应实际词条：/)

      await game.sendGroup("host", "1是")
      await game.sendGroup("host", "龟进度")
      assert.match(latestGroupOutput(game), /已完成 1/)
    })
  })

  it("enters voting even when the final turtle answer notification fails", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      for (let seat = 1; seat <= 6; seat++) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      }
      for (let seat = 1; seat <= 5; seat++) await game.sendGroup("host", seat + "是")
      game.failNextPrivateMessages("frank")
      await game.sendGroup("host", "6否")
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.match(groupTranscript(game), /现在开始投票/)
    }, { notifications: { ...DEFAULT_NOTIFICATIONS, turtleAnswerPrivate: true } })
  })

  it("blocks roster changes for a pending turtle answer and safely expires the host wait", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      await game.addUser("grace", "Grace")
      await game.sendGroup("alice", "1他是否担任过丞相")
      await game.sendGroup("host", "踢出2")
      await game.sendGroup("grace", "1")
      assert.match(groupTranscript(game), /正在等待武将技能或主持人判定，请稍候再踢人/)
      assert.match(groupTranscript(game), /正在等待武将技能或主持人判定，暂时无法申请补位/)
      await tickGameClock(5_000)
      assert.match(privateTranscript(game, "host"), /问题等待回答时间已过半/)
      await tickGameClock(5_001)
      assert.match(groupTranscript(game), /主持人未在限时内回答1号玩家的问题，本局已自动终止且不计分/)
      await game.sendGroup("host", "卧底")
      const before = groupTranscript(game)
      await tickGameClock(10_000)
      assert.doesNotMatch(groupTranscript(game).slice(before.length), /龟模式主持人未在限时内回答/)
    }, { turtleAnswerTimeout: 10 })
  })

  it("gives a turtle replacement only the surface and a fresh question turn", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "踢出1")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      const gracePrivate = privateTranscript(game, "grace")
      assert.match(gracePrivate, /龟模式汤面：众人参加一场宴会/, groupTranscript(game))
      assert.doesNotMatch(gracePrivate, /曹操|孙权/)
      assert.match(groupTranscript(game), /1号补位玩家须完成本轮龟模式问答/)
      await game.sendGroup("grace", "1他是否担任过丞相")
      assert.match(privateTranscript(game, "host"), /1号玩家Grace提问：他是否担任过丞相/)
      await game.sendGroup("host", "1是")
      assert.doesNotMatch(privateTranscript(game, "grace"), /主持人已回答你的问题|本轮问答已完成/)
    })
  })

  it("limits turtle overtime questions to tied candidates and still forbids self-explosion", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup("host", seat + "是")
      const ballots = [5, 5, 6, 6, 3, 4]
      for (let index = 0; index < ballots.length; index++) await game.sendPrivate(PLAYER_IDS[index], String(ballots[index]))
      assert.match(groupTranscript(game), /进入第1轮加时/)
      assert.match(groupTranscript(game), /龟模式加时问答开始/)
      await game.sendGroup("host", "龟进度")
      assert.match(groupTranscript(game), /未提问 5、6/)
      const beforeUnrelated = groupTranscript(game)
      await game.sendGroup("alice", "1他是否参与加时")
      assert.equal(groupTranscript(game), beforeUnrelated)
      await game.sendGroup("alice", "5这只是普通聊天")
      assert.equal(groupTranscript(game), beforeUnrelated)
      await game.sendGroup("eve", "5自爆")
      assert.match(groupTranscript(game), /本模式不能自爆/)
      await game.sendGroup("eve", "5他是否占据江东")
      await game.sendGroup("frank", "6他是否称帝")
      await game.sendGroup("host", "5否")
      await game.sendGroup("host", "6是")
      const transcript = groupTranscript(game)
      assert.match(transcript, /第1轮加时/)
      assert.match(transcript, /问题：5他是否占据江东；主持回答：5否/)
      assert.match(transcript, /现在开始投票/)
    })
  })

  it("restores every active turtle seat after overtime ends in a safe night", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      for (let seat = 1; seat <= 6; seat++) {
        await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
        await game.sendGroup("host", seat + "是")
      }
      for (const [index, target] of [5, 5, 6, 6, 3, 4].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }
      assert.match(groupTranscript(game), /龟模式加时问答开始/)

      await game.sendGroup("eve", "5他是否占据江东")
      await game.sendGroup("frank", "6他是否称帝")
      await game.sendGroup("host", "5否")
      await game.sendGroup("host", "6是")
      for (const [index, target] of [5, 6, 5, 6].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }

      const transcript = groupTranscript(game)
      assert.match(transcript, /第2轮发言/)
      const starts = transcript.match(/龟模式问答开始/g) ?? []
      assert.equal(starts.length, 2)
      await game.sendGroup("host", "龟进度")
      assert.match(groupTranscript(game), /未提问 1、2、3、4、5、6/)
      await game.sendGroup("alice", "1他是否担任过丞相")
      assert.match(privateTranscript(game, "host"), /1号玩家Alice提问：他是否担任过丞相/)
    })
  })

  it("rejects a Turtle Zhu Youjian who is outside the overtime speaking seats", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game, "5", { [HERO.ZHU_YOU_JIAN]: 1 })
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup("host", seat + "是")
      for (const [index, target] of [5, 5, 6, 6, 3, 4].entries()) {
        await game.sendPrivate(PLAYER_IDS[index], String(target))
      }
      assert.match(groupTranscript(game), /进入第1轮加时/)

      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /你不属于本次加时的发言玩家，不能发动处决/)
      assert.doesNotMatch(groupTranscript(game), /亮出武将牌：朱由检，并选择处决5号玩家/)
    })
  })

  it("pauses only the turtle player who has submitted a question", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game, "3")
      await game.sendGroup("alice", "1他是否担任过丞相")
      await tickGameClock(1_001)
      const transcript = groupTranscript(game)
      assert.match(transcript, /2号玩家Bob.*6号玩家Frank.*发言超时，被自动踢出/s)
      assert.doesNotMatch(transcript, /1号玩家Alice.*发言超时/)
      assert.match(privateTranscript(game, "host"), /1号玩家Alice提问/)
    }, { speakTimeoutMode3PerPlayer: 2, turtleAnswerTimeout: 10 })
  })

  it("preserves completed turtle answers when other sparse seats time out", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game, "3")

      await game.sendGroup("alice", "1他是否担任过丞相")
      await game.sendGroup("bob", "2他是否善于用兵")
      await game.sendGroup("dave", "4他是否善于文学")
      const fourthQuestion = [...game.transcript].reverse().find(entry =>
        entry.direction === "in"
        && entry.scope === "group"
        && entry.userId === "dave"
        && entry.content === "4他是否善于文学",
      )
      assert.ok(fourthQuestion)
      await game.sendGroup("eve", "5他是否占据江东")
      await game.sendGroup("host", "4无关")
      await game.sendGroup("host", "5不确定")

      await tickGameClock(2_001)
      await game.sendGroup("host", "龟进度")
      const afterRemoval = groupTranscript(game)
      assert.match(afterRemoval, /3号玩家Carol.*6号玩家Frank.*发言超时，被自动踢出/s)
      assert.match(afterRemoval, /待主持回答 1、2；已完成 4、5/)

      await game.sendGroupReply("host", "否", {
        onebotMessage: [{ type: "reply", data: { id: fourthQuestion.messageId } }],
        omitSessionQuote: true,
      })
      assert.doesNotMatch(privateTranscript(game, "dave"), /主持人已回答你的问题/)

      await game.sendGroup("host", "1是")
      await game.sendGroup("host", "2否")
      const transcript = groupTranscript(game)
      assert.match(transcript, /问题：4他是否善于文学；主持回答：4否/)
      assert.match(transcript, /问题：5他是否占据江东；主持回答：5不确定/)
      assert.match(transcript, /现在开始投票/)
    }, { speakTimeoutMode3PerPlayer: 2, turtleAnswerTimeout: 30 })
  })

  it("keeps group hero commands working and removes eliminated turtle turns", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game, "5", { [HERO.ZHU_YOU_JIAN]: 1 })
      await game.sendGroup("alice", "处决5")
      assert.match(groupTranscript(game), /第1号玩家Alice亮出武将牌：朱由检，并选择处决5号玩家Eve/)
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup("host", seat + "是")
      assert.match(groupTranscript(game), /现在开始投票/)
    })
  })

  it("keeps private vote-stage hero commands working in turtle mode", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game, "5", { [HERO.YUAN_CHONG_HUAN]: 1 })
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      for (let seat = 1; seat <= 6; seat++) await game.sendGroup("host", seat + "是")
      await game.sendPrivate("alice", "守2")
      assert.match(privateTranscript(game, "alice"), /本轮2号玩家Bob会得到守卫/)
    })
  })

  it("allows vote-stage turtle replacement and includes it in the next round", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      for (let seat = 2; seat <= 6; seat++) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他是否与宴会有关")
      for (let seat = 2; seat <= 6; seat++) await game.sendGroup("host", seat + "是")
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "踢出1")
      await game.sendGroup("grace", "1")
      await game.sendGroup("host", "是")
      assert.match(privateTranscript(game, "grace"), /龟模式汤面：众人参加一场宴会/)
      assert.doesNotMatch(privateTranscript(game, "grace"), /曹操|孙权/)
      assert.doesNotMatch(groupTranscript(game), /1号补位玩家须完成本轮龟模式问答/)
      await game.sendGroup("grace", "1补位玩家的补问")
      await tickGameClock(301_000)
      assert.doesNotMatch(groupTranscript(game), /主持人未在限时内回答.*本局已自动终止/)
      await game.sendGroup("host", "1是")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /1号玩家Grace：问题：1补位玩家的补问；主持回答：1是/)
      await game.sendPrivate("grace", "5")
      await game.sendPrivate("bob", "5")
      await game.sendPrivate("carol", "5")
      await game.sendPrivate("dave", "5")
      await game.sendPrivate("eve", "2")
      await game.sendPrivate("frank", "5")
      assert.match(groupTranscript(game), /本轮5号玩家Eve出局/)
      assert.match(groupTranscript(game), /龟模式问答开始/)
      await game.sendGroup("host", "龟进度")
      assert.match(groupTranscript(game), /未提问 1、2、3、4、6/)
      await game.sendGroup("grace", "1他是否担任过丞相")
      assert.match(privateTranscript(game, "host"), /1号玩家Grace提问/)
    })
  })

  it("preserves question media through Turtle host answers, overview, recap and replay", async () => {
    await withGame(async game => {
      await startCustomTurtleGame(game)
      await game.sendGroup("alice", '1他与图中人物有关吗<img src="https://cdn.example/question.png?signature=needed"/>')
      for (const seat of [2, 3, 4, 5, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他在宴会吗")
      for (const seat of [1, 2, 3, 4, 5, 6]) await game.sendGroup("host", seat + "是")
      await game.sendGroup("host", "发言总览")
      assert.match(latestGroupOutput(game), /<img src="https:\/\/cdn.example\/question.png\?signature=needed"/)
      await voteOut(game, 5, [1, 2, 3, 4, 5, 6])
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup(PLAYER_IDS[seat - 1], seat + "他在宴会吗")
      for (const seat of [1, 2, 3, 4, 6]) await game.sendGroup("host", seat + "是")
      await voteOut(game, 6, [1, 2, 3, 4, 6])
      const before = groupTranscript(game).length
      await game.sendGroup("host", "总结")
      assert.match(groupTranscript(game).slice(before), /<img src="https:\/\/cdn.example\/question.png\?signature=needed"/)
      await game.sendGroup("host", "回放")
      assert.match(latestGroupOutput(game), /<img src="https:\/\/cdn.example\/question.png\?signature=needed"/)
      const stored = await game.app.database.get("undercover_history_phase", {})
      const speech = JSON.parse(stored[0].payload).speeches[0]
      assert.doesNotMatch(speech.question, /src=|signature=/)
      assert.match(speech.question, /\[图片\]/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it('archives and explicitly replays a host-stopped game after the first speech phase', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {}, true, "5")
      await game.sendGroup("alice", "1第一轮发言")
      await game.sendGroup("host", "停止卧底")
      const rows = await game.app.database.get('undercover_history_game', {})
      assert.equal(rows.length, 1, groupTranscript(game))
      assert.equal(rows[0].disposition, 'aborted')

      await game.sendGroup("alice", "历史对局")
      assert.match(latestGroupOutput(game), /共0局/)
      await game.sendGroup("alice", "历史对局 --aborted")
      assert.match(latestGroupOutput(game), /共1局/)
      assert.match(latestGroupOutput(game), /中止局/)
      await game.sendGroup("alice", "复盘 " + rows[0].id)
      assert.match(latestGroupOutput(game), /中止局.*卧底被主持人终止/s)
      assert.match(latestGroupOutput(game), /Alice：1第一轮发言/)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it('records the bot administrator as the actor of a first-phase termination', async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      await game.sendGroup("alice", "1第一轮发言")
      await game.addUser("admin", "管理员", 2)
      await game.sendGroup("admin", "结束卧底")
      const rows = await game.app.database.get('undercover_history_game', {})
      assert.equal(rows.length, 1, groupTranscript(game))
      await game.sendGroup("alice", "复盘 " + rows[0].id)
      assert.match(latestGroupOutput(game), /中止局.*卧底被bot管理员终止/s)
    }, { history: { enabled: true, sandbox: true, retentionDays: 0 } })
  })

  it("starts random turtle mode without any white-player prompt", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      await game.sendGroup("host", "卧底")
      for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始龟模式")
      assert.match(groupTranscript(game), /本局为龟模式，发题前仍可切换模式/)
      assert.doesNotMatch(groupTranscript(game), /是否加入白板/)
      await game.sendPrivate("host", "所有人来到同一处现场")
      await game.sendPrivate("host", "曹操")
      await game.sendPrivate("host", "孙权")
      await advanceUntilSettled(game.sendPrivate("host", "5"))
      assert.match(groupTranscript(game), /龟模式汤面：所有人来到同一处现场/)
      for (const userId of PLAYER_IDS) assert.doesNotMatch(privateTranscript(game, userId), /曹操|孙权/)
    })
  })

  it("uses independent host vote-notification commands without blocking private routes", async () => {
    await withGame(async game => {
      await startCustomSixPlayerGame(game, {})
      const setupPrivate = privateTranscript(game, "host")
      assert.doesNotMatch(setupPrivate, /是否要接收实时投票通知/)
      assert.match(setupPrivate, /发题配置已完成/)
      await game.sendPrivate("host", "投票通知状态")
      assert.match(privateTranscript(game, "host"), /实时投票通知当前已关闭/)
      await game.sendPrivate("host", "开启投票通知")
      assert.match(privateTranscript(game, "host"), /已开启实时投票通知/)
      await finishSpeech(game, [1, 2, 3, 4, 5, 6])
      const beforeAliceVote = privateTranscript(game, "host").length
      await game.sendPrivate("alice", "2")
      assert.match(privateTranscript(game, "host").slice(beforeAliceVote), /1号玩家Alice投给了2号玩家Bob/)
      await game.sendGroup("host", "关闭投票通知")
      assert.match(groupTranscript(game), /已关闭实时投票通知/)
      const beforeBobVote = privateTranscript(game, "host").length
      await game.sendPrivate("bob", "3")
      assert.doesNotMatch(privateTranscript(game, "host").slice(beforeBobVote), /2号玩家Bob投给/)
      const beforeUnknown = privateTranscript(game, "host").length
      await game.sendPrivate("host", "这是普通私信")
      assert.equal(privateTranscript(game, "host").length, beforeUnknown)
      assert.doesNotMatch(privateTranscript(game, "host"), /暂时不需要主持人给bot私信/)
    })
  })
  it("advertises and accepts game mode entry during gathering", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.sendGroup("host", "卧底")
      const gathering = groupTranscript(game)
      assert.match(gathering, /发送“鹿模式”或“龟模式”/)
      assert.match(gathering, /开始鹿模式.*开始龟模式/s)
      await game.sendGroup("host", "鹿模式")
      assert.match(groupTranscript(game), /已选择鹿模式/)
      await game.sendGroup("host", "龟模式")
      assert.match(groupTranscript(game), /已选择龟模式/)
    })
  })

  it("honors configurable special modes and per-game defaults", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      for (let index = 0; index < PLAYER_IDS.length; index++) {
        await game.addUser(PLAYER_IDS[index], PLAYER_NAMES[index])
      }
      await game.addUser("grace", "Grace")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("host", "鹿模式")
      assert.match(latestGroupOutput(game), /本实例未启用鹿模式/)
      for (const playerId of PLAYER_IDS) await game.sendGroup(playerId, "1")
      await game.sendGroup("host", "开始")
      await game.sendGroup("grace", "1")
      assert.match(latestGroupOutput(game), /主持人已经关闭了加人/)
      await game.sendGroup("host", "投票通知状态")
      assert.match(latestGroupOutput(game), /当前已开启/)
    }, {
      enabledSpecialModes: ['turtle'],
      allowLateJoinByDefault: false,
      realtimeVoteNoticeDefault: true,
    })
  })

  it("does not register an xp score consumer when persistent scoring is disabled", async () => {
    let registrations = 0
    await withGame(async () => undefined, { enablePersistentScoring: false }, {
      xpPoints: {
        registerScoreConsumer: () => {
          registrations += 1
          return {
            systemKey: 'undercover',
            addAccount: async () => ({ after: 0 }),
            dispose: () => undefined,
          }
        },
      },
    })
    assert.equal(registrations, 0)
  })

  it("documents all public game-mode routes in the concise help", async () => {
    await withGame(async game => {
      await game.addUser("host", "主持人", 4)
      await game.sendGroup("host", "卧底帮助")
      const transcript = groupTranscript(game)
      assert.match(transcript, /经典模式、鹿模式或龟模式/)
      assert.match(transcript, /3驳回 原因/)
      assert.match(transcript, /公布选人/)
    })
  })
})
