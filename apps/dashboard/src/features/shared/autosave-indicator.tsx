import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { LoadingIndicators, resolveLoadingIndicator } from "./loading-indicator-meta.js";

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
    clock: systemClock,
    minimumVisibleMs,
    scheduler,
    showDelayMs,
  });

  return showAutosaveIndicator ? <AutosaveIndicator /> : null;
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
  const { active, clock, minimumVisibleMs, scheduler, showDelayMs } = input;

  useEffect(() => {
    let timeoutId: TimerHandle | null = null;

    if (active && !visible) {
      timeoutId = scheduler.schedule(() => {
        visibleSinceRef.current = clock.nowMs();
        setVisible(true);
      }, showDelayMs);
    } else if (!active && visible) {
      const visibleSince = visibleSinceRef.current;
      const elapsedVisibleMs =
        visibleSince === null ? minimumVisibleMs : clock.nowMs() - visibleSince;
      const remainingVisibleMs = Math.max(minimumVisibleMs - elapsedVisibleMs, 0);

      timeoutId = scheduler.schedule(() => {
        visibleSinceRef.current = null;
        setVisible(false);
      }, remainingVisibleMs);
    }

    return () => {
      if (timeoutId !== null) {
        scheduler.cancel(timeoutId);
      }
    };
  }, [active, clock, minimumVisibleMs, scheduler, showDelayMs, visible]);

  return visible;
}
