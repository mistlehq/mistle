import { describe, expect, it } from "vitest";

import { createAuthenticatedSessionFixture } from "../../test-support/auth-session.js";
import { updateSessionUserImage } from "./session-user-image.js";

describe("updateSessionUserImage", () => {
  it("returns null when the session is unauthenticated", () => {
    expect(updateSessionUserImage(null, null)).toBeNull();
  });

  it("replaces the cached authenticated user image", () => {
    const session = createAuthenticatedSessionFixture({
      user: {
        image: "https://images.example.com/original.webp",
      },
    });

    expect(updateSessionUserImage(session, null)).toEqual({
      ...session,
      user: {
        ...session.user,
        image: null,
      },
    });
  });
});
