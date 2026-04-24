import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { verifySigningGrant } from "@mistle/sandbox-signing-auth";
import { describe, expect, it } from "vitest";

import { createSigningGrant } from "./signing-grant.js";

const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

const TestConfig = {
  app: {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "development",
      runMigrations: false,
      concurrency: 1,
    },
    tunnel: {
      bootstrapTokenTtlSeconds: 120,
      exchangeTokenTtlSeconds: 3600,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5003",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      docker: {
        socketPath: "/var/run/docker.sock",
        networkName: "mistle-sandbox-dev",
      },
    },
  },
  sandbox: {
    provider: "docker",
    defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
    gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    publish: {
      baseDomain: "mistle.example.test",
      access: {
        tokenSecret: "integration-publish-token-secret",
        tokenIssuer: "integration-control-plane-api",
        tokenAudience: "integration-data-plane-gateway",
      },
      session: {
        cookieSigningSecret: "integration-publish-cookie-secret",
      },
    },
    connect: {
      tokenSecret: "integration-connect-secret",
      tokenIssuer: "integration-control-plane-api",
      tokenAudience: "integration-data-plane-gateway",
    },
    bootstrap: {
      tokenSecret: "integration-bootstrap-secret",
      tokenIssuer: "integration-data-plane-worker",
      tokenAudience: "integration-data-plane-gateway",
    },
    egress: {
      tokenSecret: "integration-egress-secret",
      tokenIssuer: "integration-data-plane-worker",
      tokenAudience: "integration-tokenizer-proxy",
    },
  },
  telemetry: {
    enabled: false,
    debug: false,
  },
} as const;

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
