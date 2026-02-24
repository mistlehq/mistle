export type Clock = {
  nowMs: () => number;
  nowDate: () => Date;
};

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  nowDate: () => new Date(),
};
