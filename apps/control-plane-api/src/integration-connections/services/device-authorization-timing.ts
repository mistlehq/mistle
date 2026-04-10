export function calculatePollAfterMs(input: {
  now: Date;
  pollAfterAt: string | null;
}): number | undefined {
  if (input.pollAfterAt === null) {
    return undefined;
  }

  const pollAfterMs = new Date(input.pollAfterAt).getTime() - input.now.getTime();

  return pollAfterMs > 0 ? pollAfterMs : 0;
}

export function createPollAfterTimestamp(input: {
  now?: Date;
  pollAfterMs: number | undefined;
}): string | null {
  if (input.pollAfterMs === undefined) {
    return null;
  }

  const now = input.now ?? new Date();
  return new Date(now.getTime() + input.pollAfterMs).toISOString();
}
