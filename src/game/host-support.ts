export interface HostSupportRequest {
  key: string
  pending(): boolean
  resume(): void
  fallback(): void | Promise<void>
}

/** One shared recruitment window; each adjudication can recruit only once. */
export class HostSupportCoordinator {
  private assistants = new Set<string>()
  private participants = new Set<string>()
  private attempted = new Set<string>()
  private requests = new Map<string, HostSupportRequest>()
  private serial = 0
  private window?: number
  private claimant?: string
  reset() { this.assistants.clear(); this.participants.clear(); this.attempted.clear(); this.requests.clear(); this.window = undefined; this.claimant = undefined; this.serial++ }
  recordParticipant(userId: string) { this.participants.add(userId) }
  isParticipant(userId: string) { return this.participants.has(userId) }
  isAssistant(userId: string) { return this.assistants.has(userId) }
  assistantIds() { return [...this.assistants] }
  activeRequests() {
    for (const [key, request] of this.requests) if (!request.pending()) this.requests.delete(key)
    return [...this.requests.values()]
  }
  get activeWindow() { return this.window }
  request(request: HostSupportRequest): { kind: 'opened' | 'joined'; window: number } | { kind: 'fallback' } {
    if (!request.pending()) return { kind: 'fallback' }
    if (this.window !== undefined && this.requests.has(request.key)) return { kind: 'joined', window: this.window }
    if (this.attempted.has(request.key)) return { kind: 'fallback' }
    this.attempted.add(request.key); this.requests.set(request.key, request)
    if (this.window !== undefined) return { kind: 'joined', window: this.window }
    this.window = ++this.serial
    return { kind: 'opened', window: this.window }
  }
  claim(userId: string): number | undefined {
    if (this.window === undefined || this.claimant || this.isParticipant(userId) || !this.activeRequests().length) return
    this.claimant = userId
    return this.window
  }
  releaseClaim(userId: string, window: number) {
    if (this.window === window && this.claimant === userId) this.claimant = undefined
  }
  grant(userId: string, window: number): HostSupportRequest[] | undefined {
    if (this.window !== window || this.claimant !== userId) return
    const requests = this.activeRequests()
    if (!requests.length) { this.window = undefined; this.claimant = undefined; return }
    this.assistants.add(userId); this.window = undefined; this.claimant = undefined; this.requests.clear()
    return requests
  }
  expire(window: number): HostSupportRequest[] {
    if (this.window !== window) return []
    const requests = this.activeRequests()
    this.window = undefined; this.claimant = undefined; this.requests.clear()
    return requests
  }
}
