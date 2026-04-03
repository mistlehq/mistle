import { customSession } from "better-auth/plugins";

import { resolveStoredMediaUrl } from "../../media/services/resolve-stored-media-url.js";

export function createMediaSessionPlugin(input: { mediaPublicBaseUrl: string }) {
  return customSession(async ({ session, user }) => ({
    session,
    user: {
      ...user,
      image: resolveUserAvatarUrl({
        mediaPublicBaseUrl: input.mediaPublicBaseUrl,
        user,
      }),
    },
  }));
}

function resolveUserAvatarUrl(input: {
  mediaPublicBaseUrl: string;
  user: {
    image?: string | null | undefined;
  };
}): string | null {
  const imageObjectKey = readString(input.user, "imageObjectKey");
  if (imageObjectKey === null) {
    return null;
  }

  return resolveStoredMediaUrl({
    mediaPublicBaseUrl: input.mediaPublicBaseUrl,
    objectKey: imageObjectKey,
  });
}

function readString(record: object, key: string): string | null {
  const value = Object.fromEntries(Object.entries(record))[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
