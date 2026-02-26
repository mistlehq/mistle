import { describe, expect, it } from "vitest";

import { resolveSessionFromAuthPayload } from "./session-query-result.js";

describe("resolveSessionFromAuthPayload", () => {
  it("returns session data when response contains no error", () => {
    const session = resolveSessionFromAuthPayload({
      data: {
        session: {
          id: "session-id",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(),
          token: "token",
          userId: "user-id",
          activeOrganizationId: "org_123",
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
      },
      error: null,
    });

    expect(session?.session.activeOrganizationId).toBe("org_123");
  });

  it("returns null for unauthorized session response", () => {
    const session = resolveSessionFromAuthPayload({
      data: null,
      error: {
        status: 401,
        message: "Unauthorized",
      },
    });

    expect(session).toBeNull();
  });

  it("throws resolved error message for non-unauthorized failures", () => {
    expect(() =>
      resolveSessionFromAuthPayload({
        data: null,
        error: {
          status: 500,
          message: "Auth backend unavailable",
        },
      }),
    ).toThrowError("Auth backend unavailable");
  });
});
