import { systemScheduler, type TimerHandle } from "@mistle/time";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

const TOP_LOADING_BAR_CONFIG = {
  initialProgressPercent: 6,
  maxInFlightProgressPercent: 92,
  progressTickMs: 120,
  progressEaseFactor: 0.12,
  minStepPercent: 1,
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
  const activeFetchCount = useIsFetching();
  const activeMutationCount = useIsMutating();
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasActiveWork =
    navigation.state !== "idle" || activeFetchCount > 0 || activeMutationCount > 0;
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (hasActiveWork) {
      setIsVisible(true);
      setProgress((current) =>
        current > TOP_LOADING_BAR_CONFIG.initialProgressPercent
          ? current
          : TOP_LOADING_BAR_CONFIG.initialProgressPercent,
      );
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
  }, [hasActiveWork]);

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
        className="bg-muted-foreground/55 h-full rounded-r-full transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ opacity: progress >= 100 ? 0 : 1, width: `${progress}%` }}
      />
    </div>
  );
}
