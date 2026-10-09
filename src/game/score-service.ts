export interface ScoreStorage {
  add(input: ScoreWriteInput): Promise<void | { journalId?: number }>
}

export interface ScoreReceipt {
  input: ScoreWriteInput
  status: 'written' | 'failed' | 'disabled' | 'zero'
  journalId?: number
}

export interface ScoreWriteInput {
  readonly enabled: boolean
  readonly nickname: string
  readonly amount: number
  readonly platform?: string
  readonly guildId?: string
  readonly profileId?: number
  readonly accountId?: string
  readonly reason: string
  readonly idempotencyKey: string
  readonly businessId?: string
}

export class ScoreService {
  private readonly receipts = new Map<string, ScoreReceipt>()
  private epoch = 0

  constructor(
    private readonly storage: ScoreStorage,
    private readonly onFailure: (nickname: string, error: unknown) => void,
  ) {}

  get failedNames(): readonly string[] {
    return [...new Set([...this.receipts.values()].filter(row => row.status === 'failed').map(row => row.input.nickname))]
  }

  /** Detached final result per business operation; never used to replay awards. */
  get results(): readonly ScoreReceipt[] { return structuredClone([...this.receipts.values()]) }

  async add(input: ScoreWriteInput): Promise<boolean> {
    const copy = { ...input }, epoch = this.epoch
    const record = (status: ScoreReceipt['status'], journalId?: number) => {
      if (epoch !== this.epoch) return
      // Once acknowledged, the original business operation stays written even
      // if a retry fails or scoring is subsequently disabled. Only enrich a
      // missing journal ID; never replace the original award/identity snapshot.
      const previous = this.receipts.get(copy.idempotencyKey)
      if (previous?.status === 'written') {
        if (status === 'written' && previous.journalId === undefined && journalId !== undefined) previous.journalId = journalId
        return
      }
      this.receipts.set(copy.idempotencyKey, { input: previous?.input ?? copy, status, ...(journalId === undefined ? {} : { journalId }) })
    }
    if (!copy.enabled || copy.amount === 0) { record(!copy.enabled ? 'disabled' : 'zero'); return true }
    try {
      const result = await this.storage.add(copy)
      record('written', result && Number.isSafeInteger(result.journalId) && result.journalId > 0 ? result.journalId : undefined)
      return true
    }
    catch (error) {
      record('failed')
      if (epoch === this.epoch && this.receipts.get(copy.idempotencyKey)?.status === 'failed') {
        this.onFailure(copy.nickname, error)
      }
      return false
    }
  }

  failureNotice(): string {
    const failedNames = this.failedNames
    if (failedNames.length === 0) return ""
    return "\n注意：" + failedNames.join("、")
      + "的积分未能写入数据库，游戏已正常结束，请管理员稍后补分。"
  }

  reset(): void {
    this.epoch++
    this.receipts.clear()
  }
}
