export const SIGNED_IMAGE_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function resolveSignedImageRefetchInterval(input: {
  expiresAt: string | null | undefined;
  nowMs?: number;
}): false | number {
  if (input.expiresAt === undefined || input.expiresAt === null) {
    return false;
  }

  const expiresAtTime = Date.parse(input.expiresAt);
  if (Number.isNaN(expiresAtTime)) {
    return false;
  }

  const refreshIntervalMs =
    expiresAtTime - (input.nowMs ?? Date.now()) - SIGNED_IMAGE_URL_REFRESH_BUFFER_MS;

  return refreshIntervalMs <= 0 ? false : refreshIntervalMs;
}
