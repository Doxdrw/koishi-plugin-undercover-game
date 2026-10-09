export class PublicHeroRevealState {
  private readonly revealedSeats = new Set<number>()

  reveal(seat: number): boolean {
    const first = !this.revealedSeats.has(seat)
    this.revealedSeats.add(seat)
    return first
  }

  isRevealed(seat: number): boolean {
    return this.revealedSeats.has(seat)
  }

  seats(): number[] {
    return [...this.revealedSeats].sort((left, right) => left - right)
  }

  clear(): void {
    this.revealedSeats.clear()
  }
}
