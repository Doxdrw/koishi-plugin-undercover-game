export type EliminationVictory = "good" | "white" | "undercover"

export interface EliminationVictoryInput {
  readonly activePlayerCount: number
  readonly activeUndercoverCount: number
  readonly whiteActive: boolean
  readonly whiteOnly: boolean
  /** Absence of undercover players is a fact, not a settlement trigger. */
  readonly whiteSurvivalSettled?: boolean
}

export function classifyEliminationVictory(
  input: EliminationVictoryInput,
): EliminationVictory | null {
  if (input.activeUndercoverCount === 0 && !input.whiteActive) return "good"
  if (input.activeUndercoverCount === 0
    && input.whiteActive
    && (input.activePlayerCount < 3 || input.whiteOnly && input.whiteSurvivalSettled)) {
    return "white"
  }
  if (input.activePlayerCount < 2 * input.activeUndercoverCount
    || (input.activePlayerCount === 2 && input.activeUndercoverCount === 1)) {
    return "undercover"
  }
  return null
}
