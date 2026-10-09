import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"

const metadata = HEROES[HERO.ZHU_YOU_JIAN]

export const zhuYouJianModule = {
  id: HERO.ZHU_YOU_JIAN,
  key: "zhu-you-jian",
  ...metadata,
  windows: [
    HeroWindow.SpeechAction,
    HeroWindow.Elimination,
  ],
  initializeState(state) {
    state.zhuYouJian.executionUsed = false
  },
  isAvailable(state) {
    return !state.zhuYouJian.executionUsed
  },
  activate(state) {
    state.zhuYouJian.executionUsed = true
  },
  onSpeechAction(context) {
    const content = context.content.replace(/\s/g, "")
    if (!content.startsWith("处决")) return { kind: "ignore" } as const

    const chosenSeat = Number(content.replace("处决", ""))
    if (!context.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }

    // Self-targeting is always reported as self-execution, regardless of the
    // actor's camp or whether the actor is the white player.  Keep this test
    // before camp/white handling so the public wording and history stay stable.
    if (chosenSeat === context.actorSeat) {
      return {
        kind: "eliminate",
        source: "zhu-you-jian-execution",
        chosenSeat,
        eliminatedSeat: context.actorSeat,
        verdict: "self-execution",
      } as const
    }

    const actorIsUndercover = context.undercoverSeats.includes(context.actorSeat)
    const targetIsUndercover = context.undercoverSeats.includes(chosenSeat)
    if (actorIsUndercover !== targetIsUndercover || chosenSeat === context.whiteSeat) {
      return {
        kind: "eliminate",
        source: "zhu-you-jian-execution",
        chosenSeat,
        eliminatedSeat: chosenSeat,
        verdict: "success",
      } as const
    }
    return {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat,
      eliminatedSeat: context.actorSeat,
      verdict: "backlash",
    } as const
  },
} satisfies HeroModule
