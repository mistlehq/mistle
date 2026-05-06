const LoadingIndicatorMeta = {
  INDICATOR: "mistle.loadingIndicator",
} as const;

export const LoadingIndicators = {
  AUTOSAVE: "autosave",
  NONE: "none",
  TOP_LOADING_BAR: "top-loading-bar",
} as const;

export type LoadingIndicator = (typeof LoadingIndicators)[keyof typeof LoadingIndicators];

type LoadingIndicatorMetaValue = {
  [LoadingIndicatorMeta.INDICATOR]: LoadingIndicator;
};

export function createLoadingIndicatorMeta(indicator: LoadingIndicator): LoadingIndicatorMetaValue {
  return {
    [LoadingIndicatorMeta.INDICATOR]: indicator,
  };
}

export const NoLoadingIndicatorMeta = createLoadingIndicatorMeta(LoadingIndicators.NONE);

export function resolveLoadingIndicator(
  meta: Record<string, unknown> | undefined,
): LoadingIndicator {
  const indicator = meta?.[LoadingIndicatorMeta.INDICATOR];
  if (
    indicator === LoadingIndicators.AUTOSAVE ||
    indicator === LoadingIndicators.NONE ||
    indicator === LoadingIndicators.TOP_LOADING_BAR
  ) {
    return indicator;
  }

  return LoadingIndicators.TOP_LOADING_BAR;
}

export function shouldShowTopLoadingBarForQuery(input: {
  dataUpdatedAt: number;
  meta: Record<string, unknown> | undefined;
}): boolean {
  return (
    resolveLoadingIndicator(input.meta) === LoadingIndicators.TOP_LOADING_BAR &&
    input.dataUpdatedAt === 0
  );
}
