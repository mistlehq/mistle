import { describe, expect, it } from "vitest";

import {
  MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE,
  requireAuthenticatedSession,
} from "./session-context.js";

describe("requireAuthenticatedSession", () => {
  it("throws a clear error when session is missing", () => {
    expect(() => requireAuthenticatedSession(null)).toThrow(
      MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE,
    );
  });

  it("returns session when present", () => {
    const session = requireAuthenticatedSession({
      session: {
        id: "session-id",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
        token: "token",
        userId: "user-id",
        activeOrganizationId: null,
      },
      user: {
        id: "user-id",
        name: "Mistle User",
        email: "mistle@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
      },
    });

    expect(session.user.email).toBe("mistle@example.com");
  });
});
