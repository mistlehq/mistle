export const SIGNED_IMAGE_URL_TTL_MS = 60 * 60 * 1000;
export const SIGNED_IMAGE_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
export const SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS =
  SIGNED_IMAGE_URL_TTL_MS - SIGNED_IMAGE_URL_REFRESH_BUFFER_MS;

export function resolveSignedImageRefetchInterval(input: {
  imageUrl: string | null | undefined;
}): false | number {
  return input.imageUrl === undefined || input.imageUrl === null
    ? false
    : SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS;
}
