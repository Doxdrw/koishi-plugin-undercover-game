import type { Seat } from "./hero-state"

export interface ReplacementApplicant {
  readonly userId: string
  readonly nickname: string
}

export type ReplacementRequestPhase =
  | "idle"
  | "awaiting-host"
  | "awaiting-seat"
  | "ready"

export type ReplacementTickResult =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly nextDelayMs: number }
  | { readonly kind: "expired"; readonly applicant: ReplacementApplicant }

export class ReplacementRequestCoordinator {
  private currentPhase: ReplacementRequestPhase = "idle"
  private currentApplicant: ReplacementApplicant | null = null
  private currentSeat: Seat | null = null
  private remaining = 0
  private lastTick = 0
  private wasPaused = false

  get phase(): ReplacementRequestPhase {
    return this.currentPhase
  }

  get applicant(): ReplacementApplicant | null {
    return this.currentApplicant
  }

  get selectedSeat(): Seat | null {
    return this.currentSeat
  }

  get remainingMs(): number {
    return this.remaining
  }

  get hasPending(): boolean {
    return this.currentPhase !== "idle"
  }

  begin(
    applicant: ReplacementApplicant,
    timeoutMs: number,
    now: number,
    paused: boolean,
  ): void {
    if (this.hasPending) throw new Error("A replacement request is already pending.")
    this.currentApplicant = { ...applicant }
    this.currentPhase = "awaiting-host"
    this.currentSeat = null
    this.arm(timeoutMs, now, paused)
  }

  awaitSeatChoice(timeoutMs: number, now: number, paused: boolean): void {
    this.requirePhase("awaiting-host")
    this.currentPhase = "awaiting-seat"
    this.currentSeat = null
    this.arm(timeoutMs, now, paused)
  }

  selectSeat(seat: Seat): void {
    if (this.currentPhase !== "awaiting-host" && this.currentPhase !== "awaiting-seat") {
      throw new Error(`Cannot select a replacement seat while request is ${this.currentPhase}.`)
    }
    this.currentSeat = seat
    this.currentPhase = "ready"
  }

  tick(now: number, paused: boolean): ReplacementTickResult {
    if (!this.hasPending || !this.currentApplicant) return { kind: "idle" }
    if (!paused && !this.wasPaused) {
      this.remaining -= now - this.lastTick
    }
    this.lastTick = now
    this.wasPaused = paused
    if (this.remaining <= 0) {
      const applicant = this.currentApplicant
      this.reset()
      return { kind: "expired", applicant }
    }
    return {
      kind: "waiting",
      nextDelayMs: Math.min(1_000, Math.max(100, this.remaining)),
    }
  }

  reset(): void {
    this.currentPhase = "idle"
    this.currentApplicant = null
    this.currentSeat = null
    this.remaining = 0
    this.lastTick = 0
    this.wasPaused = false
  }

  private arm(timeoutMs: number, now: number, paused: boolean): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error("Replacement timeout must be a non-negative finite number.")
    }
    this.remaining = timeoutMs
    this.lastTick = now
    this.wasPaused = paused
  }

  private requirePhase(phase: ReplacementRequestPhase): void {
    if (this.currentPhase !== phase) {
      throw new Error(`Expected replacement phase ${phase}, got ${this.currentPhase}.`)
    }
  }
}
