export function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function dateFromEpochMs(epochMs: number): Date {
  return new Date(epochMs);
}

export function dateFromEpochSeconds(epochSeconds: number): Date {
  return dateFromEpochMs(epochSeconds * 1000);
}

export function toIsoFromEpochSeconds(epochSeconds: number): string {
  return dateFromEpochSeconds(epochSeconds).toISOString();
}
