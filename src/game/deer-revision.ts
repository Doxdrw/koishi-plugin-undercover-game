import type { SpeechHistoryRecord } from './speech-history'

export interface DeerSpeechReview {
  seat: number
  userId: string
  version: number
  records: SpeechHistoryRecord[]
  deadlineAt?: number
}
export interface DeerMakeup {
  seat: number
  userId: string
  version: number
  round: number
  minimumDeadline: number
  referencePhase?: number
  referenceDeadline?: number
}

/** Independent of voting and the current history cursor. */
export class DeerRevisionCoordinator {
  private closed = false
  private reviews = new Map<number, DeerSpeechReview>()
  private makeups = new Map<number, DeerMakeup>()
  private suspended = new Map<string, { at: number; review?: DeerSpeechReview; makeup?: DeerMakeup }>()
  reset() { this.closed = false; this.reviews.clear(); this.makeups.clear(); this.suspended.clear() }
  suspend(seat: number, identity: string, now: number) {
    const review = this.reviews.get(seat), makeup = this.makeups.get(seat)
    if (review || makeup) this.suspended.set(JSON.stringify([seat, identity]), structuredClone({ at: now, review, makeup }))
    this.clearSeat(seat)
  }
  restore(seat: number, identity: string, userId: string, version: number, now: number) {
    const key = JSON.stringify([seat, identity])
    const saved = this.suspended.get(key)
    if (!saved) return false
    this.suspended.delete(key)
    const paused = Math.max(0, now - saved.at)
    if (saved.review) {
      const review = { ...saved.review, userId, version }
      if (review.deadlineAt !== undefined) review.deadlineAt += paused
      this.reviews.set(seat, review)
    }
    if (saved.makeup) {
      const makeup = { ...saved.makeup, userId, version, minimumDeadline: saved.makeup.minimumDeadline + paused }
      delete makeup.referencePhase; delete makeup.referenceDeadline
      this.makeups.set(seat, makeup)
    }
    return true
  }
  closeApplications() { this.closed = true }
  get applicationsClosed() { return this.closed }
  review(seat: number) { return this.reviews.get(seat) }
  pendingReviews() { return [...this.reviews.values()] }
  beginReview(input: DeerSpeechReview) {
    this.clearSeat(input.seat)
    this.reviews.set(input.seat, structuredClone(input))
  }
  finishReview(seat: number, userId: string, version: number) {
    const review = this.reviews.get(seat)
    if (!review || review.userId !== userId || review.version !== version) return
    this.reviews.delete(seat)
    return review
  }
  requestMakeup(input: Omit<DeerMakeup, 'minimumDeadline'> & { now: number; durationMs: number }) {
    const { now, durationMs, ...task } = input
    const makeup = { ...task, minimumDeadline: durationMs > 0 ? now + durationMs : Infinity }
    this.makeups.set(input.seat, makeup)
    return makeup
  }
  makeup(seat: number) { return this.makeups.get(seat) }
  pendingMakeups() { return [...this.makeups.values()] }
  complete(seat: number, userId: string, version: number) {
    const task = this.makeups.get(seat)
    if (!task || task.userId !== userId || task.version !== version) return
    this.makeups.delete(seat)
    return task
  }
  noteSpeechDeadline(phase: number, deadline: number) {
    for (const task of this.makeups.values()) {
      if (task.referencePhase !== undefined && task.referencePhase !== phase) continue
      task.referencePhase = phase
      task.referenceDeadline = Math.max(task.referenceDeadline ?? 0, deadline)
    }
  }
  deadline(task: DeerMakeup) {
    return task.referenceDeadline === undefined ? Infinity : Math.max(task.minimumDeadline, task.referenceDeadline)
  }
  clearSeat(seat: number) { this.reviews.delete(seat); this.makeups.delete(seat) }
}
