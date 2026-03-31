import { describe, expect, it } from "vitest";

import {
  resolvePostLoginPath,
  resolveRequestedPostLoginPath,
  resolveSerializedPostLoginPath,
} from "./auth-redirect.js";

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
