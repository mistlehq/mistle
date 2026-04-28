export function resolveDispatchCutoffMinute(input: {
  now: Date;
  cutoffSkewSeconds: number;
}): string {
  const cutoffMs = input.now.getTime() - input.cutoffSkewSeconds * 1_000;
  if (Number.isNaN(cutoffMs)) {
    throw new Error("Cannot resolve schedule dispatch cutoff minute from an invalid date.");
  }

  const cutoff = new Date(cutoffMs);
  cutoff.setUTCSeconds(0, 0);
  return formatIsoMinute(cutoff);
}

export function createScheduleDispatchIdempotencyKey(cutoffMinute: string): string {
  return `schedule-dispatch:${cutoffMinute}`;
}

function formatIsoMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}
