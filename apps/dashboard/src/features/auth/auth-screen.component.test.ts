// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { AUTH_METHODS_QUERY_KEY } from "./auth-methods-query.js";
import {
  resolvePostLoginPath,
  resolveRequestedPostLoginPath,
  resolveSerializedPostLoginPath,
} from "./auth-redirect.js";
import { AuthScreen } from "./auth-screen.js";
import { resolveOAuthCallbackError } from "./messages.js";

function renderAuthScreen(input: { initialEntry: string; googleAuthEnabled?: boolean }) {
  const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
  queryClient.setQueryData(AUTH_METHODS_QUERY_KEY, {
    methods: {
      emailOtp: true,
      google: input.googleAuthEnabled ?? true,
    },
  });

  const router = createMemoryRouter(
    [
      {
        path: "/auth/login",
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

  it.each([
    ["from is missing", {}],
    ["pathname is empty", { from: { pathname: "" } }],
    ["path is protocol-relative", { from: { pathname: "//evil.example/path" } }],
    ["path is /auth/login", { from: { pathname: "/auth/login" } }],
    ["path is /auth/login/", { from: { pathname: "/auth/login/" } }],
    ["path is a case variant of /auth/login", { from: { pathname: "/AUTH/LOGIN" } }],
    ["path is /auth/login/callback", { from: { pathname: "/auth/login/callback" } }],
  ])("falls back to root when %s", (_description, input) => {
    expect(resolvePostLoginPath(input)).toBe("/");
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

  it.each([
    "/auth/login",
    "/auth/login/callback",
    "/auth/login?foo=1",
    "/auth/login/callback?redirectTo=%2Fsessions",
  ])("falls back to root for auth infrastructure redirect %s", (redirectTo) => {
    expect(resolveSerializedPostLoginPath(redirectTo)).toBe("/");
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

  it.each([
    ["error=access_denied", "Google sign-in was cancelled."],
    ["error=server_error&error_description=OAuth%20state%20mismatch", "OAuth state mismatch"],
    ["error=server_error", "Unable to continue with Google."],
  ])("resolves %s to %s", (search, expectedMessage) => {
    expect(resolveOAuthCallbackError(new URLSearchParams(search))).toBe(expectedMessage);
  });
});

describe("AuthScreen", () => {
  it.each([
    ["/auth/login?error=access_denied", "Google sign-in was cancelled."],
    [
      "/auth/login?error=server_error&error_description=OAuth%20state%20mismatch",
      "OAuth state mismatch",
    ],
  ])("shows the returned OAuth error for %s", async (initialEntry, expectedMessage) => {
    renderAuthScreen({ initialEntry });

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
  });

  it("shows Google sign-in when the control plane reports Google auth is enabled", async () => {
    renderAuthScreen({ initialEntry: "/auth/login", googleAuthEnabled: true });

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("hides Google sign-in when the control plane reports Google auth is disabled", async () => {
    renderAuthScreen({ initialEntry: "/auth/login", googleAuthEnabled: false });

    expect(await screen.findByRole("button", { name: "Continue with email" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });
});
