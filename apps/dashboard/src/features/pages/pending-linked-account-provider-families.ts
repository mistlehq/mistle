export function incrementPendingLinkedAccountProviderFamilyCount(
  currentCounts: Readonly<Record<string, number>>,
  providerFamily: string,
): Record<string, number> {
  return {
    ...currentCounts,
    [providerFamily]: (currentCounts[providerFamily] ?? 0) + 1,
  };
}

export function decrementPendingLinkedAccountProviderFamilyCount(
  currentCounts: Readonly<Record<string, number>>,
  providerFamily: string,
): Record<string, number> {
  const nextCount = (currentCounts[providerFamily] ?? 0) - 1;
  if (nextCount > 0) {
    return {
      ...currentCounts,
      [providerFamily]: nextCount,
    };
  }

  const { [providerFamily]: _removedProviderFamily, ...remainingCounts } = currentCounts;
  return remainingCounts;
}

export function resolvePendingLinkedAccountProviderFamilies(
  providerFamilyCounts: Readonly<Record<string, number>>,
): string[] {
  return Object.entries(providerFamilyCounts)
    .filter(([, count]) => count > 0)
    .map(([providerFamily]) => providerFamily);
}
