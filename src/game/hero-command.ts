/** Normalize only hero commands/options, never player speeches or chosen words. */
export function normalizeHeroCommand(content: string): string {
  return content.replace(/[\s\p{P}\p{S}]/gu, "")
}

export function parseHeroNumber(value: string): number {
  if (!/^[0-9]+$/u.test(value)) return Number.NaN
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : Number.NaN
}
