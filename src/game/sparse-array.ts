export function removeArrayIndicesInPlace<T>(
  values: T[],
  indices: readonly number[],
): T[] {
  const uniqueDescending = [...new Set(indices)]
    .filter(index => Number.isInteger(index) && index >= 0 && index < values.length)
    .sort((left, right) => right - left)
  for (const index of uniqueDescending) values.splice(index, 1)
  return values
}
