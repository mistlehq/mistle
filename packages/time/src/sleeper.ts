export type Sleeper = {
  sleep: (durationMs: number) => Promise<void>;
};

export const systemSleeper: Sleeper = {
  sleep: (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    }),
};
