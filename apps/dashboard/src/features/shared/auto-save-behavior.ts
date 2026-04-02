import type { Scheduler, TimerHandle } from "@mistle/time";

export type AutoSaveErrorState = {
  kind: "validation" | "save";
  message: string;
};

export function scheduleSavedStateReset(input: {
  successVisibleDurationMs: number;
  successFadeDurationMs: number;
  fadeStartTimeoutRef: { current: TimerHandle | null };
  fadeEndTimeoutRef: { current: TimerHandle | null };
  onFadeStart: () => void;
  onFadeEnd: () => void;
  scheduler: Scheduler;
}): void {
  const fadeStartDelayMs = Math.max(
    0,
    input.successVisibleDurationMs - input.successFadeDurationMs,
  );

  input.fadeStartTimeoutRef.current = input.scheduler.schedule(() => {
    input.onFadeStart();
  }, fadeStartDelayMs);

  input.fadeEndTimeoutRef.current = input.scheduler.schedule(() => {
    input.onFadeEnd();
  }, input.successVisibleDurationMs);
}

export function clearPendingStatusTimeouts(input: {
  fadeStartTimeoutRef: { current: TimerHandle | null };
  fadeEndTimeoutRef: { current: TimerHandle | null };
  scheduler: Scheduler;
}): void {
  if (input.fadeStartTimeoutRef.current !== null) {
    input.scheduler.cancel(input.fadeStartTimeoutRef.current);
    input.fadeStartTimeoutRef.current = null;
  }

  if (input.fadeEndTimeoutRef.current !== null) {
    input.scheduler.cancel(input.fadeEndTimeoutRef.current);
    input.fadeEndTimeoutRef.current = null;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not save changes.";
}
