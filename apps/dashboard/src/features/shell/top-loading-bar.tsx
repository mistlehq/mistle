import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

import {
  LoadingIndicators,
  resolveLoadingIndicator,
  shouldShowTopLoadingBarForQuery,
} from "../shared/loading-indicator-meta.js";

const TOP_LOADING_BAR_CONFIG = {
  initialProgressPercent: 8,
  maxInFlightProgressPercent: 92,
  progressTickMs: 200,
  progressEaseFactor: 0.12,
  minStepPercent: 1,
  showDelayMs: 150,
  hideDelayMs: 220,
} as const;

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setPrefersReducedMotion(false);
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => {
      mediaQuery.removeEventListener("change", updatePreference);
    };
  }, []);

  return prefersReducedMotion;
}

export function TopLoadingBar(): React.JSX.Element | null {
  const navigation = useNavigation();
  const activeFetchCount = useIsFetching({
    predicate: (query) =>
      shouldShowTopLoadingBarForQuery({
        dataUpdatedAt: query.state.dataUpdatedAt,
        meta: query.options.meta,
      }),
  });
  const activeMutationCount = useIsMutating({
    predicate: (mutation) =>
      resolveLoadingIndicator(mutation.options.meta) === LoadingIndicators.TOP_LOADING_BAR,
  });
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasActiveWork =
    navigation.state !== "idle" || activeFetchCount > 0 || activeMutationCount > 0;
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (hasActiveWork) {
      if (isVisible) {
        setProgress(resolveStartedProgress);
        return;
      }

      const showTimeout = systemScheduler.schedule(() => {
        setIsVisible(true);
        setProgress(resolveStartedProgress);
      }, TOP_LOADING_BAR_CONFIG.showDelayMs);

      return () => {
        systemScheduler.cancel(showTimeout);
      };
    }

    if (!isVisible) {
      setProgress(0);
      return;
    }

    setProgress(100);
    const hideTimeout = systemScheduler.schedule(() => {
      setIsVisible(false);
      setProgress(0);
    }, TOP_LOADING_BAR_CONFIG.hideDelayMs);

    return () => {
      systemScheduler.cancel(hideTimeout);
    };
  }, [hasActiveWork, isVisible]);

  useEffect(() => {
    if (!hasActiveWork || !isVisible) {
      return;
    }

    let progressTimer: TimerHandle | null = null;

    const scheduleTick = (): void => {
      progressTimer = systemScheduler.schedule(() => {
        setProgress((current) => {
          if (current >= TOP_LOADING_BAR_CONFIG.maxInFlightProgressPercent) {
            return TOP_LOADING_BAR_CONFIG.maxInFlightProgressPercent;
          }

          if (prefersReducedMotion) {
            return TOP_LOADING_BAR_CONFIG.maxInFlightProgressPercent;
          }

          const delta = Math.max(
            TOP_LOADING_BAR_CONFIG.minStepPercent,
            (100 - current) * TOP_LOADING_BAR_CONFIG.progressEaseFactor,
          );
          return Math.min(TOP_LOADING_BAR_CONFIG.maxInFlightProgressPercent, current + delta);
        });
        scheduleTick();
      }, TOP_LOADING_BAR_CONFIG.progressTickMs);
    };

    scheduleTick();

    return () => {
      if (progressTimer !== null) {
        systemScheduler.cancel(progressTimer);
      }
    };
  }, [hasActiveWork, isVisible, prefersReducedMotion]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      aria-label="Loading"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(progress)}
      aria-valuetext="Loading dashboard data"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
      role="progressbar"
    >
      <div
        className="bg-muted-foreground/55 h-full w-full origin-left rounded-r-full shadow-[0_0_8px_color-mix(in_oklab,var(--muted-foreground)_35%,transparent)] transition-[transform,opacity] duration-200 ease-out will-change-transform motion-reduce:transition-none"
        style={{
          opacity: progress >= 100 ? 0 : 1,
          transform: `translate3d(${progress - 100}%,0,0)`,
        }}
      />
    </div>
  );
}

function resolveStartedProgress(current: number): number {
  if (current > TOP_LOADING_BAR_CONFIG.initialProgressPercent) {
    return Math.min(current, TOP_LOADING_BAR_CONFIG.maxInFlightProgressPercent);
  }

  return TOP_LOADING_BAR_CONFIG.initialProgressPercent;
}
