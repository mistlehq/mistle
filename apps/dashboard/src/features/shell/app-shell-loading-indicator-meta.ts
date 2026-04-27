export const AppShellLoadingIndicatorMeta = {
  INDICATOR: "appShellLoadingIndicator",
} as const;

export const AppShellLoadingIndicators = {
  AUTOSAVE: "autosave",
  NONE: "none",
  TOP_LOADING_BAR: "top-loading-bar",
} as const;

export type AppShellLoadingIndicator =
  (typeof AppShellLoadingIndicators)[keyof typeof AppShellLoadingIndicators];

export function resolveAppShellLoadingIndicator(
  meta: Record<string, unknown> | undefined,
): AppShellLoadingIndicator {
  const indicator = meta?.[AppShellLoadingIndicatorMeta.INDICATOR];

  if (
    indicator === AppShellLoadingIndicators.AUTOSAVE ||
    indicator === AppShellLoadingIndicators.NONE ||
    indicator === AppShellLoadingIndicators.TOP_LOADING_BAR
  ) {
    return indicator;
  }

  return AppShellLoadingIndicators.TOP_LOADING_BAR;
}
