import { systemScheduler, type Scheduler } from "@mistle/time";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { useIsMutating } from "@tanstack/react-query";

import { LoadingIndicators, resolveLoadingIndicator } from "./loading-indicator-meta.js";
import { useDelayedMinimumVisibleFlag } from "./use-delayed-minimum-visible-flag.js";

const AutosaveIndicatorShowDelayMs = 200;
const AutosaveIndicatorMinimumVisibleMs = 500;

export function AutosaveIndicator(): React.JSX.Element {
  return (
    <div
      aria-live="polite"
      className="text-muted-foreground inline-flex h-6 items-center gap-1.5 text-xs"
      role="status"
    >
      <SpinnerGapIcon aria-hidden="true" className="size-3.5 animate-spin" />
      <span>Saving</span>
    </div>
  );
}

export function useAutosaveIndicator(input?: {
  minimumVisibleMs?: number;
  scheduler?: Scheduler;
  showDelayMs?: number;
}): React.ReactNode | null {
  const activeAutosaveMutationCount = useIsMutating({
    predicate: (mutation) =>
      resolveLoadingIndicator(mutation.options.meta) === LoadingIndicators.AUTOSAVE,
  });
  const minimumVisibleMs = input?.minimumVisibleMs ?? AutosaveIndicatorMinimumVisibleMs;
  const scheduler = input?.scheduler ?? systemScheduler;
  const showDelayMs = input?.showDelayMs ?? AutosaveIndicatorShowDelayMs;
  const showAutosaveIndicator = useDelayedMinimumVisibleFlag({
    active: activeAutosaveMutationCount > 0,
    minimumVisibleMs,
    scheduler,
    showDelayMs,
  });

  return showAutosaveIndicator ? <AutosaveIndicator /> : null;
}
