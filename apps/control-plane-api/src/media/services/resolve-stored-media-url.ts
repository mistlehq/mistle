export function resolveStoredMediaUrl(input: {
  mediaPublicBaseUrl: string;
  objectKey: string;
}): string {
  const mediaPublicBaseUrl = input.mediaPublicBaseUrl.replace(/\/+$/u, "");
  const objectKey = input.objectKey.replace(/^\/+/u, "");

  return `${mediaPublicBaseUrl}/${objectKey}`;
}
