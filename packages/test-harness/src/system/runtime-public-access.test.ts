import { describe, expect, it } from "vitest";

import {
  createRuntimePublicAccessProxyScript,
  createRuntimePublicAccessProxyPoolKey,
  createRuntimePublicAccessRouteHealthUrl,
  createRuntimePublicAccessRouteStatePath,
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

describe("createRuntimePublicAccessRouteStatePath", () => {
  it("creates a stable shared route state path for proxy replacements", () => {
    expect(
      createRuntimePublicAccessRouteStatePath({
        coordinatorDir: "/tmp/mistle-test-run",
        tunnelId: "tun/123",
      }),
    ).toBe("/tmp/mistle-test-run/runtime-public-access-routes/tun%2F123.json");
  });
});

describe("createRuntimePublicAccessProxyScript", () => {
  it("binds the proxy to the harness-reserved port and logs startup failures", () => {
    const script = createRuntimePublicAccessProxyScript();

    expect(script).toContain(
      'const proxyPort = Number(readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_PROXY_PORT"));',
    );
    expect(script).toContain('server.listen(proxyPort, "0.0.0.0"');
    expect(script).toContain('server.once("error", (error) => {');
    expect(script).toContain("runtime public access proxy startup failed:");
  });

  it("logs proxy shutdown and fatal error reasons for system-run diagnostics", () => {
    const script = createRuntimePublicAccessProxyScript();

    expect(script).toContain('process.on("uncaughtException", (error) => {');
    expect(script).toContain('process.on("unhandledRejection", (reason) => {');
    expect(script).toContain("runtime public access proxy shutdown reason=");
    expect(script).toContain("cloudflared container process exited code=");
    expect(script).toContain("shuttingDown=");
  });

  it("handles upgraded socket errors without crashing the shared proxy", () => {
    const script = createRuntimePublicAccessProxyScript();

    expect(script).toContain("function pipeUpgradeSockets(input)");
    expect(script).toContain('recordSocketError("client_socket_error", error);');
    expect(script).toContain('recordSocketError("target_socket_error", error);');
    expect(script).toContain("if (socket.destroyed) {");
  });

  it("persists environment routes so proxy replacement does not lose registered services", () => {
    const script = createRuntimePublicAccessProxyScript();

    expect(script).toContain(
      'const routeStatePath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_ROUTE_STATE_PATH");',
    );
    expect(script).toContain("async function loadRoutes()");
    expect(script).toContain("async function persistRoutes()");
    expect(script).toContain("async function withRouteStateLock(callback)");
    expect(script).toContain("await loadRoutes();");
    expect(script).toContain("await persistRoutes();");
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
  it("reads path-carried environment ids used by public service URLs", () => {
    expect(
      readRuntimePublicAccessEnvironmentIdFromPath(
        "/__test-environments/test_env_123/tunnel/sandbox/sbi_runtime_public_access_probe",
      ),
    ).toBe("test_env_123");
  });

  it("ignores requests without a complete test-environment path prefix", () => {
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/tunnel/sandbox")).toBeUndefined();
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/__test-environments")).toBeUndefined();
    expect(readRuntimePublicAccessEnvironmentIdFromPath("/__test-environments/")).toBeUndefined();
  });
});
