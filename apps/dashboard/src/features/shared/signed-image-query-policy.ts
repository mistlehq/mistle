export function resolveSignedImageRefetchInterval(input: {
  refreshAfterSeconds: number | null | undefined;
}): false | number {
  if (input.refreshAfterSeconds === undefined || input.refreshAfterSeconds === null) {
    return false;
  }

  if (!Number.isFinite(input.refreshAfterSeconds) || input.refreshAfterSeconds <= 0) {
    return false;
  }

  return input.refreshAfterSeconds * 1000;
}
