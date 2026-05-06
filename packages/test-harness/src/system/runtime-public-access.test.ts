import { describe, expect, it } from "vitest";

import {
  createRuntimePublicAccessProxyPoolKey,
  createRuntimePublicAccessRouteHealthUrl,
  normalizeRuntimePublicAccessHostnames,
} from "./runtime-public-access.js";

describe("createRuntimePublicAccessProxyPoolKey", () => {
  it("pools all public-access services through one Cloudflare tunnel proxy per tunnel id", () => {
    expect(createRuntimePublicAccessProxyPoolKey({ tunnelId: "tun_123" })).toBe(
      "runtime-public-access:tun_123",
    );
  });
});

describe("normalizeRuntimePublicAccessHostnames", () => {
  it("creates a stable complete hostname set for the shared Cloudflare ingress config", () => {
    expect(
      normalizeRuntimePublicAccessHostnames([
        "tokenizer.example.com",
        "control.example.com",
        "tokenizer.example.com",
        "gateway.example.com",
      ]),
    ).toEqual(["control.example.com", "gateway.example.com", "tokenizer.example.com"]);
  });

  it("fails fast when no public hostnames are configured", () => {
    expect(() => normalizeRuntimePublicAccessHostnames([])).toThrow(
      "Runtime public access proxy requires at least one public hostname.",
    );
  });
});

describe("createRuntimePublicAccessRouteHealthUrl", () => {
  it("targets the environment-scoped service route instead of only the shared proxy", () => {
    expect(
      createRuntimePublicAccessRouteHealthUrl({
        environmentId: "test_env_123",
        publicHostname: "gateway.example.com",
      }).toString(),
    ).toBe("https://gateway.example.com/__healthz?x-mistle-test-environment-id=test_env_123");
  });
});
