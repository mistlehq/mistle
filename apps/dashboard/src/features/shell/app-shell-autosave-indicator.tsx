import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AppShellLoadingIndicators,
  resolveAppShellLoadingIndicator,
} from "./app-shell-loading-indicator-meta.js";

const AutosaveIndicatorShowDelayMs = 200;
const AutosaveIndicatorMinimumVisibleMs = 500;

export function AppShellAutosaveIndicator(): React.JSX.Element {
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

export function useAppShellAutosaveIndicator(input?: {
  minimumVisibleMs?: number;
  scheduler?: Scheduler;
  showDelayMs?: number;
}): React.ReactNode | null {
  const activeAutosaveMutationCount = useIsMutating({
    predicate: (mutation) =>
      resolveAppShellLoadingIndicator(mutation.options.meta) === AppShellLoadingIndicators.AUTOSAVE,
  });
  const showSavingIndicator = useDelayedMinimumVisibleFlag({
    active: activeAutosaveMutationCount > 0,
    clock: systemClock,
    minimumVisibleMs: input?.minimumVisibleMs ?? AutosaveIndicatorMinimumVisibleMs,
    scheduler: input?.scheduler ?? systemScheduler,
    showDelayMs: input?.showDelayMs ?? AutosaveIndicatorShowDelayMs,
  });

  return useMemo(
    () => (showSavingIndicator ? <AppShellAutosaveIndicator /> : null),
    [showSavingIndicator],
  );
}

function useDelayedMinimumVisibleFlag(input: {
  active: boolean;
  clock: Clock;
  minimumVisibleMs: number;
  scheduler: Scheduler;
  showDelayMs: number;
}): boolean {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef<number | null>(null);

  useEffect(() => {
    let timeoutId: TimerHandle | null = null;

    if (input.active && !visible) {
      timeoutId = input.scheduler.schedule(() => {
        visibleSinceRef.current = input.clock.nowMs();
        setVisible(true);
      }, input.showDelayMs);
    } else if (!input.active && visible) {
      const visibleSince = visibleSinceRef.current;
      const elapsedVisibleMs =
        visibleSince === null ? input.minimumVisibleMs : input.clock.nowMs() - visibleSince;
      const remainingVisibleMs = Math.max(input.minimumVisibleMs - elapsedVisibleMs, 0);

      timeoutId = input.scheduler.schedule(() => {
        visibleSinceRef.current = null;
        setVisible(false);
      }, remainingVisibleMs);
    } else if (!input.active && !visible) {
      visibleSinceRef.current = null;
    }

    return () => {
      if (timeoutId !== null) {
        input.scheduler.cancel(timeoutId);
      }
    };
  }, [
    input.active,
    input.clock,
    input.minimumVisibleMs,
    input.scheduler,
    input.showDelayMs,
    visible,
  ]);

  return visible;
}
