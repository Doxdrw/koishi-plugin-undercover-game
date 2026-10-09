import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  RESOLUTION_ORDER,
  VOTE_ELIMINATION_PIPELINE,
  VOTE_ELIMINATION_ORDER,
  VOTE_RESOLUTION_TAIL,
  ResolutionCursor,
  continueResolution,
  endResolution,
  pauseResolution,
  replaceResolutionOutcome,
  runResolutionPipeline,
} from "../src/game/resolution-pipeline"

function continuingHandlers(trace: string[]) {
  return Object.fromEntries(RESOLUTION_ORDER.map(cursor => [
    cursor,
    () => {
      trace.push(cursor)
      return continueResolution()
    },
  ]))
}

describe("runtime resolution pipeline", () => {
  it("executes the complete semantic order", async () => {
    const effects: string[] = []
    const trace: string[] = []
    const result = await runResolutionPipeline({
      context: {},
      handlers: continuingHandlers(effects),
      trace: cursor => trace.push(cursor),
    })
    assert.equal(result.control.kind, "continue")
    assert.deepEqual(effects, RESOLUTION_ORDER)
    assert.deepEqual(trace, RESOLUTION_ORDER)
    assert.equal(result.lastCursor, ResolutionCursor.NextRound)
  })

  it("pauses at Mao Wenlong and records the exact resume cursor", async () => {
    const trace: string[] = []
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.MaoWenLongLateVote] = () =>
      pauseResolution(ResolutionCursor.DuoErGunSwap)

    const result = await runResolutionPipeline({
      context: {},
      handlers,
      trace: cursor => trace.push(cursor),
    })
    assert.deepEqual(trace, RESOLUTION_ORDER.slice(
      0,
      RESOLUTION_ORDER.indexOf(ResolutionCursor.MaoWenLongLateVote) + 1,
    ))
    assert.deepEqual(result.control, {
      kind: "pause",
      resumeAt: ResolutionCursor.DuoErGunSwap,
    })
  })

  it("resumes from Dorgon without replaying earlier modifiers", async () => {
    const trace: string[] = []
    const result = await runResolutionPipeline({
      context: {},
      handlers: continuingHandlers([]),
      startAt: ResolutionCursor.DuoErGunSwap,
      order: VOTE_RESOLUTION_TAIL,
      trace: cursor => trace.push(cursor),
    })
    assert.equal(result.control.kind, "continue")
    assert.deepEqual(trace, VOTE_RESOLUTION_TAIL)
  })

  it("pauses Huang Taiji at the Lin Dan Han recheck cursor", async () => {
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.HuangTaiJiQuan] = () =>
      pauseResolution(ResolutionCursor.LinDanHanAwaken)
    const result = await runResolutionPipeline({
      context: {},
      handlers,
      startAt: ResolutionCursor.DuoErGunSwap,
    })
    assert.deepEqual(result.control, {
      kind: "pause",
      resumeAt: ResolutionCursor.LinDanHanAwaken,
    })
  })

  it("stops immediately on game end", async () => {
    const trace: string[] = []
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.CheckVictory] = endResolution
    const result = await runResolutionPipeline({
      context: {},
      handlers,
      trace: cursor => trace.push(cursor),
    })
    assert.equal(result.control.kind, "game-end")
    assert.equal(trace.at(-1), ResolutionCursor.CheckVictory)
    assert.equal(trace.includes(ResolutionCursor.PostElimination), false)
  })

  it("records the legacy victory check before post-elimination skills", async () => {
    const trace: string[] = []
    const result = await runResolutionPipeline({
      context: {},
      handlers: continuingHandlers([]),
      order: VOTE_ELIMINATION_ORDER,
      trace: cursor => trace.push(cursor),
    })
    assert.equal(result.control.kind, "continue")
    assert.deepEqual(trace, [
      ResolutionCursor.Eliminate,
      ResolutionCursor.CheckVictory,
      ResolutionCursor.PostElimination,
      ResolutionCursor.NextRound,
    ])
  })

  it("runs the complete live vote-elimination pipeline", async () => {
    const trace: string[] = []
    const result = await runResolutionPipeline({
      context: {},
      handlers: continuingHandlers([]),
      order: VOTE_ELIMINATION_PIPELINE,
      trace: cursor => trace.push(cursor),
    })
    assert.equal(result.control.kind, "continue")
    assert.deepEqual(trace, [
      ResolutionCursor.Eliminate,
      ResolutionCursor.CheckVictory,
      ResolutionCursor.PostElimination,
      ResolutionCursor.NextRound,
    ])
  })

  it("returns replacement outcomes without entering later windows", async () => {
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.FinalizeVote] = () =>
      replaceResolutionOutcome({ safeNight: true })
    const result = await runResolutionPipeline({
      context: {},
      handlers,
    })
    assert.deepEqual(result.control, {
      kind: "replace-outcome",
      outcome: { safeNight: true },
    })
    assert.equal(result.lastCursor, ResolutionCursor.FinalizeVote)
  })

  it("records a Wu Sangui pause returned by final vote resolution", async () => {
    const trace: string[] = []
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.FinalizeVote] = () =>
      pauseResolution(ResolutionCursor.WuSanGuiOvertimeChoice)

    const result = await runResolutionPipeline({
      context: {},
      handlers,
      order: VOTE_RESOLUTION_TAIL,
      trace: cursor => trace.push(cursor),
    })

    assert.deepEqual(trace, VOTE_RESOLUTION_TAIL)
    assert.deepEqual(result.control, {
      kind: "pause",
      resumeAt: ResolutionCursor.WuSanGuiOvertimeChoice,
    })
    assert.equal(result.lastCursor, ResolutionCursor.FinalizeVote)
  })

  it("records a Zhang Xianzhong pause returned by final vote resolution", async () => {
    const trace: string[] = []
    const handlers = continuingHandlers([])
    handlers[ResolutionCursor.FinalizeVote] = () =>
      pauseResolution(ResolutionCursor.PostElimination)

    const result = await runResolutionPipeline({
      context: {},
      handlers,
      order: VOTE_RESOLUTION_TAIL,
      trace: cursor => trace.push(cursor),
    })

    assert.deepEqual(trace, VOTE_RESOLUTION_TAIL)
    assert.deepEqual(result.control, {
      kind: "pause",
      resumeAt: ResolutionCursor.PostElimination,
    })
    assert.equal(result.lastCursor, ResolutionCursor.FinalizeVote)
  })

  it("rejects resume cursors outside the selected order", async () => {
    await assert.rejects(() => runResolutionPipeline({
      context: {},
      handlers: {},
      startAt: ResolutionCursor.NextRound,
      order: [ResolutionCursor.FinalizeVote],
    }), /not present/)
  })
})
