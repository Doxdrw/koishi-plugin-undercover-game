import { Session, h } from "koishi"
import { safeErrorSummary } from './errors'
import { HEROES } from "../heroes"
import { HeroCardService, HeroCardValidationError } from "./hero-card-service"

export type HeroCardInteractionKind = "query-select" | "status-select" | "replace-select" | "replace-upload"

export interface HeroCardInteractionSnapshot {
  kind: HeroCardInteractionKind
  heroId?: number
  expiresAt: number
}

interface HeroCardInteraction extends HeroCardInteractionSnapshot {
  token: number
  timer: ReturnType<typeof setTimeout>
}

export interface HeroCardInteractionResult {
  handled: boolean
  response?: h.Fragment
}

export interface HeroCardInteractionOptions {
  timeoutMs: number
  isGameActive: () => boolean
}

export class HeroCardInteractionCoordinator {
  private readonly interactions = new Map<string, HeroCardInteraction>()
  private token = 0

  constructor(
    private readonly cards: HeroCardService,
    private readonly options: HeroCardInteractionOptions,
  ) {}

  startQuery(session: Session): string {
    this.open(session, "query-select")
    return this.selectionPrompt("请选择要查询的武将")
  }

  startReplacement(session: Session, heroId?: number): string {
    if (heroId === undefined) {
      this.open(session, "replace-select")
      return this.selectionPrompt("请选择要替换卡面的武将")
    }
    this.open(session, "replace-upload", heroId)
    return `请在 ${this.seconds()} 秒内上传 ${HEROES[heroId].name} 的新卡面。发送“取消”可退出。`
  }

  startStatus(session: Session): string {
    this.open(session, "status-select")
    return this.selectionPrompt("请选择要查看卡面状态的武将")
  }

  cancel(session: Session): boolean {
    const key = this.key(session)
    const interaction = this.interactions.get(key)
    if (!interaction) return false
    clearTimeout(interaction.timer)
    this.interactions.delete(key)
    return true
  }

  snapshot(session: Session): HeroCardInteractionSnapshot | undefined {
    const interaction = this.interactions.get(this.key(session))
    if (!interaction) return
    return {
      kind: interaction.kind,
      heroId: interaction.heroId,
      expiresAt: interaction.expiresAt,
    }
  }

  async handle(session: Session): Promise<HeroCardInteractionResult> {
    const key = this.key(session)
    const interaction = this.interactions.get(key)
    if (!interaction) return { handled: false }
    if (interaction.expiresAt <= Date.now()) {
      this.cancel(session)
      return { handled: false }
    }

    const input = session.content.trim()
    if (input === "取消") {
      this.cancel(session)
      return { handled: true, response: "已取消武将卡面交互。" }
    }

    if (["query-select", "status-select", "replace-select"].includes(interaction.kind)) {
      const heroId = parseHeroChoice(input, !this.options.isGameActive())
      if (heroId === undefined) return { handled: false }
      if (interaction.kind === "query-select") {
        this.cancel(session)
        return { handled: true, response: await renderHero(this.cards, heroId) }
      }
      if (interaction.kind === "status-select") {
        this.cancel(session)
        return { handled: true, response: await renderHeroCardStatus(this.cards, heroId) }
      }
      this.open(session, "replace-upload", heroId)
      return {
        handled: true,
        response: `已选择${HEROES[heroId].name}。请在 ${this.seconds()} 秒内上传一张图片，发送“取消”可退出。`,
      }
    }

    const images = extractImageSources(session)
    if (images.length === 0) return { handled: false }
    if (images.length !== 1) {
      return { handled: true, response: "一次只能上传一张卡面图片，请重新发送。" }
    }
    try {
      const status = await this.cards.replaceFromSource(interaction.heroId!, images[0], {
        platform: session.platform,
        userId: session.userId,
      })
      this.cancel(session)
      return {
        handled: true,
        response: `已替换${status.heroName}的卡面。` + await this.cards.image(status.heroId),
      }
    }
    catch (error) {
      if (error instanceof HeroCardValidationError) {
        return { handled: true, response: `${error.message} 请重新上传，或发送“取消”。` }
      }
      session.app.logger("undercover-game").error("武将卡面替换失败：%s", safeErrorSummary(error))
      return { handled: true, response: "卡面保存失败，当前卡面没有改变。请稍后重试或发送“取消”。" }
    }
  }

  dispose(): void {
    for (const interaction of this.interactions.values()) clearTimeout(interaction.timer)
    this.interactions.clear()
  }

  private open(session: Session, kind: HeroCardInteractionKind, heroId?: number): void {
    this.cancel(session)
    const key = this.key(session)
    const token = ++this.token
    const expiresAt = Date.now() + this.options.timeoutMs
    const timer = setTimeout(() => {
      const current = this.interactions.get(key)
      if (current?.token === token) this.interactions.delete(key)
    }, this.options.timeoutMs)
    this.interactions.set(key, { kind, heroId, expiresAt, token, timer })
  }

  private key(session: Session): string {
    return [session.platform, session.selfId, session.channelId, session.userId].join("\u0000")
  }

  private selectionPrompt(title: string): string {
    const menu = HEROES.map((hero, index) => `${index + 1}. ${hero.name}`).join("\n")
    return `${title}：\n${menu}\n请发送武将名或“选择武将 序号”；当前没有游戏时也可直接发送序号。发送“取消”可退出。`
  }

  private seconds(): number {
    return Math.ceil(this.options.timeoutMs / 1000)
  }
}

export function parseHeroChoice(input: string, allowBareNumber: boolean): number | undefined {
  const exact = HEROES.findIndex(hero => hero.name === input)
  if (exact !== -1) return exact
  const explicit = /^选择武将\s*(\d+)$/.exec(input)
  const bare = allowBareNumber ? /^(\d+)$/.exec(input) : undefined
  const value = Number((explicit ?? bare)?.[1])
  if (!Number.isInteger(value) || value < 1 || value > HEROES.length) return
  return value - 1
}

export function findHeroId(name: string | undefined): number | undefined {
  if (!name) return
  const heroId = HEROES.findIndex(hero => hero.name === name.trim())
  return heroId === -1 ? undefined : heroId
}

export function extractImageSources(session: Session): string[] {
  return session.elements
    .filter(element => element.type === "img")
    .map(element => element.attrs.src)
    .filter((source): source is string => typeof source === "string" && source.length > 0)
}

export async function renderHero(cards: HeroCardService, heroId: number): Promise<h.Fragment> {
  const hero = HEROES[heroId]
  return hero.name + "武将技能：" + hero.ability + await cards.image(heroId)
}

export async function renderHeroCardStatus(cards: HeroCardService, heroId: number): Promise<h.Fragment> {
  const status = await cards.resolve(heroId)
  const source = status.source === "custom" ? "管理员自定义" : "包内默认"
  return `${status.heroName}当前卡面来源：${source}。` + await cards.image(heroId)
}
