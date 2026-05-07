import { describe, expect, it } from "vitest";

import {
  createRuntimePublicAccessProxyPoolKey,
  createRuntimePublicAccessRouteHealthUrl,
  createRuntimePublicAccessRouteUpgradeProbeUrl,
  isRuntimePublicAccessUpgradeProbeReadyStatus,
  normalizeRuntimePublicAccessHostnames,
  readRuntimePublicAccessEnvironmentIdFromPath,
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

describe("createRuntimePublicAccessRouteUpgradeProbeUrl", () => {
  it("targets the environment-scoped websocket route used by E2B bootstrap tunnels", () => {
    expect(
      createRuntimePublicAccessRouteUpgradeProbeUrl({
        environmentId: "test_env_123",
        publicHostname: "gateway.example.com",
        upgradeProbePath: "/tunnel/sandbox/sbi_runtime_public_access_probe",
      }).toString(),
    ).toBe(
      "wss://gateway.example.com/tunnel/sandbox/sbi_runtime_public_access_probe?x-mistle-test-environment-id=test_env_123",
    );
  });
});

describe("isRuntimePublicAccessUpgradeProbeReadyStatus", () => {
  it("treats gateway application responses as ready while routing failures keep polling", () => {
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(101)).toBe(true);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(400)).toBe(true);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(401)).toBe(true);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(403)).toBe(true);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(404)).toBe(false);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(502)).toBe(false);
    expect(isRuntimePublicAccessUpgradeProbeReadyStatus(503)).toBe(false);
  });
});

describe("readRuntimePublicAccessEnvironmentIdFromPath", () => {
  it("reads path-carried environment ids used by public tokenizer egress URLs", () => {
    expect(
      readRuntimePublicAccessEnvironmentIdFromPath(
        "/__test-environments/test_env_123/tokenizer-proxy/egress/mistlehq/repo.git",
      ),
    ).toBe("test_env_123");
  });

  it("ignores requests without a complete test-environment path prefix", () => {
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/tokenizer-proxy/egress")).toBeUndefined();
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/__test-environments")).toBeUndefined();
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/__test-environments/")).toBeUndefined();
  });
});
