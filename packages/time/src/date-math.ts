import { dateFromEpochMs } from "./epoch.js";

export function addMilliseconds(date: Date, durationMs: number): Date {
  return dateFromEpochMs(date.getTime() + durationMs);
}
