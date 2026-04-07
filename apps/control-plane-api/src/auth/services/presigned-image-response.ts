const PRESIGNED_IMAGE_REFRESH_BUFFER_SECONDS = 5 * 60;

export function resolvePresignedImageRefreshAfterSeconds(input: {
  expiresInSeconds: number;
}): number {
  return Math.max(input.expiresInSeconds - PRESIGNED_IMAGE_REFRESH_BUFFER_SECONDS, 0);
}
