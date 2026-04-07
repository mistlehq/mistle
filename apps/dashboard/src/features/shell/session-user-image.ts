import type { SessionData } from "../auth/types.js";

export function updateSessionUserImage(session: SessionData, imageUrl: string | null): SessionData {
  if (session === null) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      image: imageUrl,
    },
  };
}
