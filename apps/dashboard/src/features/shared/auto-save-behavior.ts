import type { Scheduler, TimerHandle } from "@mistle/time";

export type AutoSaveErrorState = {
  kind: "validation" | "save";
  message: string;
};

export type AutoSaveFieldTimeoutRefs = {
  fadeStartTimeoutRef: { current: TimerHandle | null };
  fadeEndTimeoutRef: { current: TimerHandle | null };
};

export function createAutoSaveFieldTimeoutRefs(input: {
  fieldKeys: ReadonlyArray<string>;
}): Record<string, AutoSaveFieldTimeoutRefs> {
  const timeoutRefs: Record<string, AutoSaveFieldTimeoutRefs> = {};

  for (const fieldKey of input.fieldKeys) {
    timeoutRefs[fieldKey] = {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    };
  }

  return timeoutRefs;
}

export function resolveAutoSaveFieldTimeoutRefs(input: {
  timeoutRefs: Record<string, AutoSaveFieldTimeoutRefs>;
  fieldKey: string;
}): AutoSaveFieldTimeoutRefs {
  const timeoutRefs = input.timeoutRefs[input.fieldKey];
  if (timeoutRefs === undefined) {
    throw new Error(`Auto-save timeout refs are missing for field '${input.fieldKey}'.`);
  }

  return timeoutRefs;
}

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
