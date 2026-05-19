import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import { useEffect, useRef, useState } from "react";

export function useDelayedMinimumVisibleFlag(input: {
  active: boolean;
  clock?: Clock;
  minimumVisibleMs: number;
  scheduler?: Scheduler;
  showDelayMs: number;
}): boolean {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef<number | null>(null);
  const active = input.active;
  const clock = input.clock ?? systemClock;
  const minimumVisibleMs = input.minimumVisibleMs;
  const scheduler = input.scheduler ?? systemScheduler;
  const showDelayMs = input.showDelayMs;

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
