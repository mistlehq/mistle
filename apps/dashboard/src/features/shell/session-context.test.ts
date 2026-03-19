// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import {
  MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE,
  requireAuthenticatedSession,
  useCachedRequiredSession,
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

  it("reads the authenticated session from the query cache", () => {
    const queryClient = new QueryClient();
    seedAuthenticatedSession(queryClient);

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useCachedRequiredSession(), { wrapper });

    expect(result.current.user.email).toBe("mistle@example.com");
  });
});
