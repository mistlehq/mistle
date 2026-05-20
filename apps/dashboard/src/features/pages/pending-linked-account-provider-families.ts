export function incrementPendingLinkedAccountConfigCount(
  currentCounts: Readonly<Record<string, number>>,
  organizationProviderConfigId: string,
): Record<string, number> {
  return {
    ...currentCounts,
    [organizationProviderConfigId]: (currentCounts[organizationProviderConfigId] ?? 0) + 1,
  };
}

export function decrementPendingLinkedAccountConfigCount(
  currentCounts: Readonly<Record<string, number>>,
  organizationProviderConfigId: string,
): Record<string, number> {
  const nextCount = (currentCounts[organizationProviderConfigId] ?? 0) - 1;
  if (nextCount > 0) {
    return {
      ...currentCounts,
      [organizationProviderConfigId]: nextCount,
    };
  }

  const { [organizationProviderConfigId]: _removedConfigId, ...remainingCounts } = currentCounts;
  return remainingCounts;
}

export function resolvePendingLinkedAccountConfigIds(
  configCounts: Readonly<Record<string, number>>,
): string[] {
  return Object.entries(configCounts)
    .filter(([, count]) => count > 0)
    .map(([organizationProviderConfigId]) => organizationProviderConfigId);
}
