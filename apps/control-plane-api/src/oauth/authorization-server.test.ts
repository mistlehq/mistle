import { describe, expect, it } from "vitest";

import { isOidcProviderRequestPath } from "./authorization-server.js";

describe("isOidcProviderRequestPath", () => {
  it("matches OAuth and OIDC provider paths", () => {
    expect(isOidcProviderRequestPath("/.well-known/openid-configuration")).toBe(true);
    expect(isOidcProviderRequestPath("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isOidcProviderRequestPath("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isOidcProviderRequestPath("/oauth/authorize?client_id=mistle-cli")).toBe(true);
    expect(isOidcProviderRequestPath("/oauth/token")).toBe(true);
  });

  it("does not match unrelated control plane paths", () => {
    expect(isOidcProviderRequestPath(undefined)).toBe(false);
    expect(isOidcProviderRequestPath("/mcp")).toBe(false);
    expect(isOidcProviderRequestPath("/v1/me")).toBe(false);
    expect(isOidcProviderRequestPath("/api/auth/session")).toBe(false);
  });
});
