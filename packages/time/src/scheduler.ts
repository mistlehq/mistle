export type TimerHandle = ReturnType<typeof setTimeout>;

export type Scheduler = {
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
};

export const systemScheduler: Scheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};
