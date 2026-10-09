import type { HeroStateStore } from "./hero-state"

export const HeroWindow = {
  RoundStart: "round-start",
  SpeechAction: "speech-action",
  VoteBallot: "vote-ballot",
  VoteResolution: "vote-resolution",
  Elimination: "elimination",
  PostElimination: "post-elimination",
} as const

export type HeroWindow = typeof HeroWindow[keyof typeof HeroWindow]

export interface HeroMetadata {
  name: string
  ability: string
  cardImageBase?: string
}

export interface HeroSpeechActionContext {
  content: string
  actorSeat: number
  activeSeats: readonly number[]
  undercoverSeats: readonly number[]
  whiteSeat: number
}

export type HeroSpeechActionResult =
  | { kind: "ignore" }
  | { kind: "invalid-target"; chosenSeat: number }
  | {
    kind: "eliminate"
    source: "zhu-you-jian-execution"
    chosenSeat: number
    eliminatedSeat: number
    verdict: "success" | "self-execution" | "backlash"
  }

export interface HeroModule extends HeroMetadata {
  readonly id: number
  readonly key: string
  readonly windows: readonly HeroWindow[]
  initializeState(state: HeroStateStore): void
  isAvailable?(state: HeroStateStore): boolean
  activate?(state: HeroStateStore): void
  onSpeechAction?(context: HeroSpeechActionContext): HeroSpeechActionResult
}

export class HeroRegistry {
  private readonly modulesById = new Map<number, HeroModule>()
  private readonly modulesByKey = new Map<string, HeroModule>()
  private readonly modulesByName = new Map<string, HeroModule>()

  constructor(private readonly legacyHeroes: readonly HeroMetadata[]) {}

  register(module: HeroModule): this {
    if (!Number.isInteger(module.id) || module.id < 0) {
      throw new Error(`Hero ID must be a non-negative integer: ${module.id}`)
    }
    if (this.modulesById.has(module.id)) {
      throw new Error(`Duplicate hero ID: ${module.id}`)
    }
    if (this.modulesByKey.has(module.key)) {
      throw new Error(`Duplicate hero key: ${module.key}`)
    }
    if (this.modulesByName.has(module.name)) {
      throw new Error(`Duplicate hero name: ${module.name}`)
    }

    if (module.id < this.legacyHeroes.length) {
      const legacy = this.legacyHeroes[module.id]
      if (legacy.name !== module.name
        || legacy.ability !== module.ability
        || legacy.cardImageBase !== module.cardImageBase) {
        throw new Error(`Hero ${module.key} does not match legacy metadata at ID ${module.id}`)
      }
    }
    else {
      const appendedCount = [...this.modulesById.keys()]
        .filter(id => id >= this.legacyHeroes.length)
        .length
      const nextId = this.legacyHeroes.length + appendedCount
      if (module.id !== nextId) {
        throw new Error(`New hero IDs must be appended at ${nextId}; received ${module.id}`)
      }
    }

    this.modulesById.set(module.id, module)
    this.modulesByKey.set(module.key, module)
    this.modulesByName.set(module.name, module)
    return this
  }

  getById(id: number): HeroModule | undefined {
    return this.modulesById.get(id)
  }

  getByKey(key: string): HeroModule | undefined {
    return this.modulesByKey.get(key)
  }

  getByName(name: string): HeroModule | undefined {
    return this.modulesByName.get(name)
  }

  ordered(): readonly HeroModule[] {
    return [...this.modulesById.values()].sort((left, right) => left.id - right.id)
  }

  initializeState(state: HeroStateStore): void {
    for (const module of this.ordered()) module.initializeState(state)
  }
}
