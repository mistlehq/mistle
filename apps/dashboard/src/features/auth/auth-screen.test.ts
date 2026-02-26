import { describe, expect, it } from "vitest";

import { resolvePostLoginPath } from "./auth-redirect.js";

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
});
