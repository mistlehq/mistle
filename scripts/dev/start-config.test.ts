import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalDevInfraPlan, readGatewayRelayConfig } from "./start-config.js";

function writeTemporaryConfig(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "mistle-dev-start-config-"));
  const configPath = join(directory, "config.toml");
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

function removeTemporaryConfig(configPath: string): void {
  rmSync(dirname(configPath), { recursive: true, force: true });
}

function withTemporaryConfig<T>(content: string, run: (configPath: string) => T): T {
  const configPath = writeTemporaryConfig(content);

  try {
    return run(configPath);
  } finally {
    removeTemporaryConfig(configPath);
  }
}

describe("dev start config", () => {
  it("keeps the single-process gateway relay when gateway_relay is absent", () => {
    withTemporaryConfig(
      `
        [sandbox.docker]
        enabled = false
      `,
      (configPath) => {
        const plan = createLocalDevInfraPlan(configPath, {});

        expect(plan.gatewayRelay).toEqual({ backend: "memory" });
        expect(plan.serviceNames).not.toContain("nats");
        expect(plan.serviceNames).not.toContain("data-plane-gateway-relay");
        expect(plan.serviceNames).not.toContain("registry");
      },
    );
  });

  it("starts NATS from config without requiring the Docker sandbox provider", () => {
    withTemporaryConfig(
      `
        [gateway_relay]
        backend = "nats"

        [gateway_relay.nats]
        url = "nats://127.0.0.1:4222"
        name_prefix = "mistle-dev"

        [sandbox.docker]
        enabled = false
      `,
      (configPath) => {
        const plan = createLocalDevInfraPlan(configPath, {});

        expect(plan.gatewayRelay).toEqual({
          backend: "nats",
          nats: {
            url: "nats://127.0.0.1:4222",
            namePrefix: "mistle-dev",
          },
        });
        expect(plan.serviceNames).toContain("nats");
        expect(plan.serviceNames).not.toContain("data-plane-gateway-relay");
        expect(plan.serviceNames).not.toContain("registry");
        expect(plan.summary).toContain("NATS gateway relay");
      },
    );
  });

  it("keeps the Docker sandbox bridge separate from NATS gateway relay", () => {
    withTemporaryConfig(
      `
        [gateway_relay]
        backend = "memory"

        [sandbox.docker]
        enabled = true
      `,
      (configPath) => {
        const plan = createLocalDevInfraPlan(configPath, {});

        expect(plan.serviceNames).toContain("registry");
        expect(plan.serviceNames).toContain("data-plane-gateway-relay");
        expect(plan.serviceNames).not.toContain("nats");
        expect(plan.summary).toContain("Docker gateway bridge");
        expect(plan.summary).not.toContain("NATS gateway relay");
      },
    );
  });

  it("uses gateway relay environment overrides the same way the app config loader does", () => {
    withTemporaryConfig(
      `
        [gateway_relay]
        backend = "memory"

        [gateway_relay.nats]
        url = "nats://127.0.0.1:4222"
        name_prefix = "mistle-dev"
      `,
      (configPath) => {
        expect(
          readGatewayRelayConfig(configPath, {
            MISTLE_GATEWAY_RELAY_BACKEND: "nats",
          }),
        ).toEqual({
          backend: "nats",
          nats: {
            url: "nats://127.0.0.1:4222",
            namePrefix: "mistle-dev",
          },
        });
      },
    );
  });

  it("rejects NATS gateway relay config without a NATS URL", () => {
    withTemporaryConfig(
      `
        [gateway_relay]
        backend = "nats"

        [gateway_relay.nats]
        name_prefix = "mistle-dev"
      `,
      (configPath) => {
        expect(() => readGatewayRelayConfig(configPath, {})).toThrow(
          "gateway_relay.nats.url is required when gateway_relay.backend is 'nats'.",
        );
      },
    );
  });

  it("rejects NATS gateway relay config without a name prefix", () => {
    withTemporaryConfig(
      `
        [gateway_relay]
        backend = "nats"

        [gateway_relay.nats]
        url = "nats://127.0.0.1:4222"
      `,
      (configPath) => {
        expect(() => readGatewayRelayConfig(configPath, {})).toThrow(
          "gateway_relay.nats.name_prefix is required when gateway_relay.backend is 'nats'.",
        );
      },
    );
  });
});
