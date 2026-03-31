// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import {
  resolvePostLoginPath,
  resolveRequestedPostLoginPath,
  resolveSerializedPostLoginPath,
} from "./auth-redirect.js";
import { AuthScreen } from "./auth-screen.js";
import { resolveOAuthCallbackError } from "./messages.js";

function renderAuthScreen(input: { initialEntry: string }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);

  const router = createMemoryRouter(
    [
      {
        path: "/auth/login",
        loader: () => ({
          methods: {
            emailOtp: true,
            google: true,
          },
        }),
        element: createElement(AuthScreen),
      },
    ],
    {
      initialEntries: [input.initialEntry],
    },
  );

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RouterProvider, { router }),
    ),
  );
}

describe("resolvePostLoginPath", () => {
  it("returns the requested protected path when present", () => {
    const path = resolvePostLoginPath({
      from: {
        pathname: "/agents",
        search: "?tab=active",
        hash: "#section",
      },
    });

    expect(path).toBe("/agents?tab=active#section");
  });

  it("falls back to root when state is missing", () => {
    expect(resolvePostLoginPath(undefined)).toBe("/");
  });

  it("falls back to root when from is missing", () => {
    expect(resolvePostLoginPath({})).toBe("/");
  });

  it("falls back to root when pathname is empty", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "",
        },
      }),
    ).toBe("/");
  });

  it("falls back to root for protocol-relative paths", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "//evil.example/path",
        },
      }),
    ).toBe("/");
  });

  it("falls back to root for auth login path", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "/auth/login",
        },
      }),
    ).toBe("/");
  });

  it("falls back to root for auth login path with trailing slash", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "/auth/login/",
        },
      }),
    ).toBe("/");
  });

  it("falls back to root for case-variant auth login paths", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "/AUTH/LOGIN",
        },
      }),
    ).toBe("/");
  });

  it("ignores non-string search and hash values", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "/agents",
          search: 42,
          hash: { part: "ignored" },
        },
      }),
    ).toBe("/agents");
  });

  it("falls back to root for auth login callback paths", () => {
    expect(
      resolvePostLoginPath({
        from: {
          pathname: "/auth/login/callback",
        },
      }),
    ).toBe("/");
  });
});

describe("resolveSerializedPostLoginPath", () => {
  it("returns a safe serialized application path", () => {
    expect(resolveSerializedPostLoginPath("/agents?tab=active#section")).toBe(
      "/agents?tab=active#section",
    );
  });

  it("falls back to root for missing redirectTo", () => {
    expect(resolveSerializedPostLoginPath(null)).toBe("/");
  });

  it("falls back to root for auth infrastructure paths", () => {
    expect(resolveSerializedPostLoginPath("/auth/login")).toBe("/");
    expect(resolveSerializedPostLoginPath("/auth/login/callback")).toBe("/");
  });

  it("falls back to root for auth infrastructure paths with query params", () => {
    expect(resolveSerializedPostLoginPath("/auth/login?foo=1")).toBe("/");
    expect(resolveSerializedPostLoginPath("/auth/login/callback?redirectTo=%2Fsessions")).toBe("/");
  });
});

describe("resolveRequestedPostLoginPath", () => {
  it("prefers serialized redirectTo when present", () => {
    expect(
      resolveRequestedPostLoginPath({
        state: {
          from: {
            pathname: "/sessions",
          },
        },
        redirectTo: "/agents",
      }),
    ).toBe("/agents");
  });

  it("falls back to router state when redirectTo is absent", () => {
    expect(
      resolveRequestedPostLoginPath({
        state: {
          from: {
            pathname: "/sessions",
          },
        },
        redirectTo: null,
      }),
    ).toBe("/sessions");
  });
});

describe("resolveOAuthCallbackError", () => {
  it("returns null when there is no OAuth error", () => {
    expect(resolveOAuthCallbackError(new URLSearchParams())).toBeNull();
  });

  it("maps access_denied to a user-facing cancellation message", () => {
    expect(resolveOAuthCallbackError(new URLSearchParams("error=access_denied"))).toBe(
      "Google sign-in was cancelled.",
    );
  });

  it("prefers an explicit error description when present", () => {
    expect(
      resolveOAuthCallbackError(
        new URLSearchParams("error=server_error&error_description=OAuth%20state%20mismatch"),
      ),
    ).toBe("OAuth state mismatch");
  });

  it("falls back to a generic Google sign-in error message", () => {
    expect(resolveOAuthCallbackError(new URLSearchParams("error=server_error"))).toBe(
      "Unable to continue with Google.",
    );
  });
});

describe("AuthScreen", () => {
  it("shows the returned OAuth cancellation message from the login URL", async () => {
    renderAuthScreen({
      initialEntry: "/auth/login?error=access_denied",
    });

    expect(await screen.findByText("Google sign-in was cancelled.")).toBeTruthy();
  });

  it("shows the returned OAuth error description from the login URL", async () => {
    renderAuthScreen({
      initialEntry: "/auth/login?error=server_error&error_description=OAuth%20state%20mismatch",
    });

    expect(await screen.findByText("OAuth state mismatch")).toBeTruthy();
  });
});
