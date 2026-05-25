import { verifySigningGrant } from "@mistle/sandbox-signing-auth";
import { describe, expect, it } from "vitest";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSigningGrant } from "./signing-grant.js";

const TestConfig: DataPlaneWorkerRuntimeConfig = {
  app: {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "development",
      runMigrations: false,
      concurrency: 1,
      databasePoolMax: 2,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5003",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-bootstrap-secret",
        tokenIssuer: "integration-data-plane-worker",
        tokenAudience: "integration-data-plane-gateway",
      },
      docker: {
        enabled: true,
        socketPath: "/var/run/docker.sock",
        networkName: "mistle-sandbox-dev",
      },
    },
    internalAuth: {
      serviceToken: "internal-service-token",
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  },
  sandbox: {
    internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    bootstrap: {
      tokenSecret: "integration-bootstrap-secret",
      tokenIssuer: "integration-data-plane-worker",
      tokenAudience: "integration-data-plane-gateway",
    },
    docker: {
      enabled: true,
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    },
  },
  telemetry: {
    enabled: false,
    debug: false,
  },
};

describe("createSigningGrant", () => {
  it("mints a signed startup signing grant from git signing config", async () => {
    const grant = await createSigningGrant({
      config: TestConfig,
      sandboxInstanceId: "sbi_123",
      gitIdentity: {
        name: "Mistle User",
        email: "mistle-user@example.com",
        signing: {
          format: "ssh",
          program: "/opt/mistle/bin/mistle-ssh-sign",
          keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
          organizationId: "org_123",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          actingUserId: "usr_123",
        },
      },
    });

    await expect(
      verifySigningGrant({
        config: {
          tokenSecret: "integration-bootstrap-secret",
          tokenIssuer: "integration-data-plane-worker",
          tokenAudience: "integration-data-plane-gateway",
        },
        token: grant ?? "",
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      jti: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
      organizationId: "org_123",
      actingUserId: "usr_123",
      providerFamily: "github",
      integrationConnectionId: "icn_github",
      format: "ssh",
      keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
    });
  });

  it("returns undefined when git signing config is absent", async () => {
    await expect(
      createSigningGrant({
        config: TestConfig,
        sandboxInstanceId: "sbi_123",
        gitIdentity: {
          name: "Mistle User",
          email: "mistle-user@example.com",
        },
      }),
    ).resolves.toBeUndefined();
  });
});
