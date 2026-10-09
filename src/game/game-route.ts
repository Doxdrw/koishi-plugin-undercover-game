export interface GameRouteBinding<Bot> {
  readonly platform: string
  readonly guildId: string
  readonly bot: Bot
}

export class GameRouteCoordinator<Bot> {
  private binding: GameRouteBinding<Bot> | null = null

  get active(): boolean {
    return this.binding !== null
  }

  get platform(): string {
    return this.binding?.platform ?? ""
  }

  get guildId(): string {
    return this.binding?.guildId ?? ""
  }

  get bot(): Bot | undefined {
    return this.binding?.bot
  }

  bind(platform: string, guildId: string, bot: Bot): void {
    this.binding = { platform, guildId, bot }
  }

  matches(platform: string, guildId: string | undefined): boolean {
    return this.binding !== null
      && platform === this.binding.platform
      && guildId === this.binding.guildId
  }

  /**
   * A plugin instance can receive events from more than one bot connection.
   * A guild id alone is not an adequate route key because it may be reused by
   * another adapter or connection.  Keep this check separate from `matches`
   * because direct messages normally do not carry a guild id.
   */
  matchesBot(platform: string | undefined, selfId: string | undefined): boolean {
    return this.binding !== null
      && platform === this.binding.platform
      && selfId === (this.binding.bot as { selfId?: string } | undefined)?.selfId
  }

  matchesPrivate(
    platform: string | undefined,
    selfId: string | undefined,
    guildId?: string,
  ): boolean {
    return this.matchesBot(platform, selfId)
      && (guildId === undefined || guildId === this.binding?.guildId)
  }

  matchesSession(
    platform: string | undefined,
    guildId: string | undefined,
    selfId: string | undefined,
  ): boolean {
    return this.matches(platform ?? "", guildId) && this.matchesBot(platform, selfId)
  }

  matchesGuild(guildId: string | undefined): boolean {
    return this.binding !== null && guildId === this.binding.guildId
  }

  clear(): void {
    this.binding = null
  }
}
