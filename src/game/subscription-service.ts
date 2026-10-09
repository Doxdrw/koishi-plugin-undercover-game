import { Bot, Context } from 'koishi'

export type UndercoverSubscriptionState = 'active' | 'inactive'

export interface UndercoverSubscription {
  platform: string
  guildId: string
  userId: string
  state: UndercoverSubscriptionState
  reason: string
  createdAt: Date
  updatedAt: Date | null
  inactiveAt: Date | null
}

export interface SubscriptionMemberStatus {
  userId: string
  inGuild: boolean
  manuallyPaused: boolean
  authorityZero: boolean
  callable: boolean
}

export interface SubscriptionScanResult {
  memberCount: number
  candidates: number
  callable: number
  absent: number
  manuallyPaused: number
  authorityZero: number
  statuses: SubscriptionMemberStatus[]
  executeRequested: boolean
}

export class SubscriptionMemberListError extends Error {}

export interface ProfileDeletionScopeLike {
  mode: 'identity' | 'profile'
  profileIds: number[]
  identities: Array<{ platform: string, userId: string, profileId: number }>
  targetIdentity?: { platform: string, userId: string }
}

export interface ProfileDataConsumerLike {
  name: string
  preview(
    database: Context['database'],
    scope: ProfileDeletionScopeLike,
  ): Promise<{ affectedRows: number, summary: string[], snapshot: unknown }>
  delete(database: Context['database'], scope: ProfileDeletionScopeLike): Promise<void>
}

declare module 'koishi' {
  interface Tables {
    undercover_subscription: UndercoverSubscription
  }
}

export function registerSubscriptionModel(ctx: Context): void {
  ctx.model.extend('undercover_subscription', {
    platform: 'string',
    guildId: 'string',
    userId: 'string',
    state: { type: 'string', initial: 'active' },
    reason: { type: 'string', initial: 'legacy' },
    createdAt: 'timestamp',
    updatedAt: { type: 'timestamp', nullable: true },
    inactiveAt: { type: 'timestamp', nullable: true },
  }, {
    primary: ['platform', 'guildId', 'userId'],
    indexes: [['platform', 'guildId'], ['platform', 'userId']],
  })
}

export class UndercoverSubscriptionService {
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly memberReads = new Map<string, Promise<ReadonlySet<string>>>()

  constructor(private readonly ctx: Context) {}

  async subscribe(platform: string, guildId: string, userId: string): Promise<'created' | 'reactivated' | 'existing' | 'paused'> {
    return this.serializeMutation(async () => {
      const key = { platform, guildId, userId }
      const current = (await this.ctx.database.get('undercover_subscription', key))[0]
      if (current?.reason === 'manual-inactive') return 'paused'
      if (current?.state === 'active') return 'existing'
      const now = new Date()
      if (current) {
        await this.ctx.database.set('undercover_subscription', key, {
          state: 'active',
          reason: 'subscribed',
          updatedAt: now,
          inactiveAt: null,
        })
        return 'reactivated'
      }
      await this.ctx.database.create('undercover_subscription', {
        ...key,
        state: 'active',
        reason: 'subscribed',
        createdAt: now,
        updatedAt: now,
        inactiveAt: null,
      })
      return 'created'
    })
  }

  async unsubscribe(platform: string, guildId: string, userId: string): Promise<boolean> {
    return this.serializeMutation(async () => {
      const key = { platform, guildId, userId }
      if (!(await this.ctx.database.get('undercover_subscription', key)).length) return false
      await this.ctx.database.remove('undercover_subscription', key)
      return true
    })
  }

  async get(platform: string, guildId: string, userId: string): Promise<UndercoverSubscription | null> {
    return (await this.ctx.database.get('undercover_subscription', { platform, guildId, userId }))[0] ?? null
  }

  async list(platform: string, guildId: string): Promise<UndercoverSubscription[]> {
    return this.ctx.database.get('undercover_subscription', { platform, guildId })
  }

  async markExisting(
    platform: string,
    guildId: string,
    userId: string,
    state: UndercoverSubscriptionState,
    reason: string,
  ): Promise<boolean> {
    return this.serializeMutation(async () => {
      const key = { platform, guildId, userId }
      const current = (await this.ctx.database.get('undercover_subscription', key))[0]
      if (!current) return false
      await this.setStateIn(this.ctx.database, current, state, reason, new Date())
      return true
    })
  }

  async remove(platform: string, guildId: string, userId: string): Promise<boolean> {
    return this.unsubscribe(platform, guildId, userId)
  }

  async getCallableUserIds(
    bot: Pick<Bot, 'getGuildMemberIter' | 'selfId'>,
    platform: string,
    guildId: string,
  ): Promise<string[]> {
    const memberIds = await this.readGuildMemberIds(bot, platform, guildId)
    const subscribed = (await this.list(platform, guildId))
      .filter(row => row.reason !== 'manual-inactive' && memberIds.has(row.userId))
    if (!subscribed.length) return []
    const authorityZero = await this.authorityZeroUserIds(platform, subscribed.map(row => row.userId))
    return subscribed.map(row => row.userId).filter(userId => !authorityZero.has(userId))
  }

  async getAuthorityZeroUserIds(platform: string, userIds: string[]): Promise<Set<string>> {
    return this.authorityZeroUserIds(platform, userIds)
  }

  async scanGuildMembers(
    bot: Pick<Bot, 'getGuildMemberIter' | 'selfId'>,
    platform: string,
    guildId: string,
    execute = false,
  ): Promise<SubscriptionScanResult> {
    const memberIds = await this.readGuildMemberIds(bot, platform, guildId)
    const subscriptions = (await this.list(platform, guildId))
      .sort((left, right) => left.userId.localeCompare(right.userId))
    const authorityZero = await this.authorityZeroUserIds(platform, subscriptions.map(row => row.userId))
    const statuses = subscriptions.map<SubscriptionMemberStatus>(subscription => {
      const inGuild = memberIds.has(subscription.userId)
      const manuallyPaused = subscription.reason === 'manual-inactive'
      const blocked = authorityZero.has(subscription.userId)
      return {
        userId: subscription.userId,
        inGuild,
        manuallyPaused,
        authorityZero: blocked,
        callable: inGuild && !manuallyPaused && !blocked,
      }
    })
    return {
      memberCount: memberIds.size,
      candidates: subscriptions.length,
      callable: statuses.filter(row => row.callable).length,
      absent: statuses.filter(row => !row.inGuild).length,
      manuallyPaused: statuses.filter(row => row.manuallyPaused).length,
      authorityZero: statuses.filter(row => row.authorityZero).length,
      statuses,
      executeRequested: execute,
    }
  }

  private async readGuildMemberIds(
    bot: Pick<Bot, 'getGuildMemberIter' | 'selfId'>,
    platform: string,
    guildId: string,
  ): Promise<ReadonlySet<string>> {
    const key = `${platform}\0${bot.selfId}\0${guildId}`
    const current = this.memberReads.get(key)
    if (current) return current
    const task = (async () => {
      const memberIds = new Set<string>()
      try {
        for await (const member of bot.getGuildMemberIter(guildId)) {
          if (member.user?.id) memberIds.add(member.user.id)
        }
      }
      catch (error) {
        throw new SubscriptionMemberListError('成员列表读取失败，未发送召唤且未修改任何订阅：' + errorMessage(error))
      }
      return memberIds as ReadonlySet<string>
    })()
    this.memberReads.set(key, task)
    try {
      return await task
    }
    finally {
      if (this.memberReads.get(key) === task) this.memberReads.delete(key)
    }
  }

  private async authorityZeroUserIds(platform: string, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set()
    const bindings = await this.ctx.database.get('binding', { platform, pid: [...new Set(userIds)] })
    if (!bindings.length) return new Set()
    const users = await this.ctx.database.get('user', { id: [...new Set(bindings.map(row => row.aid))] })
    const authorityByAid = new Map(users.map(user => [user.id, user.authority]))
    return new Set(bindings
      .filter(binding => authorityByAid.get(binding.aid) === 0)
      .map(binding => binding.pid))
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutationTail.then(operation)
    this.mutationTail = task.then(() => undefined, () => undefined)
    return task
  }

  private async setStateIn(
    database: Context['database'],
    current: UndercoverSubscription,
    state: UndercoverSubscriptionState,
    reason: string,
    now: Date,
  ): Promise<void> {
    await database.set('undercover_subscription', {
      platform: current.platform,
      guildId: current.guildId,
      userId: current.userId,
    }, {
      state,
      reason,
      updatedAt: now,
      inactiveAt: state === 'inactive' ? (current.inactiveAt ?? now) : null,
    })
  }
}

export function createSubscriptionDeletionConsumer(): ProfileDataConsumerLike {
  const rowsForScope = async (database: Context['database'], scope: ProfileDeletionScopeLike) => {
    const identities = scope.mode === 'identity' ? [scope.targetIdentity!] : scope.identities
    const keys = new Set(identities.map(identity => `${identity.platform}\0${identity.userId}`))
    return (await database.get('undercover_subscription', {}))
      .filter(row => keys.has(`${row.platform}\0${row.userId}`))
      .sort((left, right) => left.platform.localeCompare(right.platform)
        || left.guildId.localeCompare(right.guildId)
        || left.userId.localeCompare(right.userId))
  }
  return {
    name: 'undercover-game',
    async preview(database, scope) {
      const rows = await rowsForScope(database, scope)
      return {
        affectedRows: rows.length,
        summary: [`删除 ${rows.length} 条叫人订阅。`],
        snapshot: rows.map(row => ({
          platform: row.platform,
          guildId: row.guildId,
          userId: row.userId,
          state: row.state,
          reason: row.reason,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          inactiveAt: row.inactiveAt,
        })),
      }
    },
    async delete(database, scope) {
      for (const row of await rowsForScope(database, scope)) {
        await database.remove('undercover_subscription', {
          platform: row.platform,
          guildId: row.guildId,
          userId: row.userId,
        })
      }
    },
  }
}

function errorMessage(_error: unknown): string { return '请稍后重试。' }
