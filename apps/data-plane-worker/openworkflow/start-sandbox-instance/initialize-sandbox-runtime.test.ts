import { SandboxProvider, createSandboxAdapter } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSandboxStartupInput } from "./initialize-sandbox-runtime.js";
import { SandboxStartupModes } from "./sandbox-startup-input.js";

function createTestRuntimeConfig(): DataPlaneWorkerRuntimeConfig {
  const sandbox: DataPlaneWorkerRuntimeConfig["sandbox"] = {
    provider: SandboxProvider.DOCKER,
    internalGatewayWsUrl: "ws://gateway/tunnel/sandbox",
    bootstrap: {
      tokenSecret: "bootstrap-secret",
      tokenIssuer: "issuer",
      tokenAudience: "audience",
    },
    docker: {
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    },
  };
  const telemetry: DataPlaneWorkerRuntimeConfig["telemetry"] = {
    enabled: false,
    debug: false,
  };

  return {
    app: {
      database: {
        url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      },
      workflow: {
        databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
        namespaceId: "development",
        runMigrations: false,
        concurrency: 1,
      },
      runtimeState: {
        gatewayBaseUrl: "http://127.0.0.1:5202",
      },
      controlPlaneApi: {
        baseUrl: "http://127.0.0.1:5100",
      },
      sandbox,
      internalAuth: {
        serviceToken: "internal-service-token",
      },
      telemetry,
    },
    sandbox,
    telemetry,
  };
}

function createRuntimePlan(input?: {
  egressRoutes?: StartSandboxInstanceWorkflowInput["runtimePlan"]["egressRoutes"];
}): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: "sbp_runtime_plan_001",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:3",
    },
    egressRoutes: input?.egressRoutes ?? [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

describe("createSandboxStartupInput", () => {
  it("omits transparent proxy configuration unless gateway proxy development mode is enabled", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      sandboxInstanceId: "sbi_123",
      startupMode: SandboxStartupModes.NEW,
      runtimePlan: createRuntimePlan(),
      sandboxAdapter: createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: "/var/run/docker.sock",
          networkName: "mistle-sandbox-dev",
        },
      }),
      processEnv: {},
    });

    expect(startupInput.transparentProxy).toBeUndefined();
  });

  it("keeps acting-user context out of sandbox startup input when gateway proxy mode is disabled", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      sandboxInstanceId: "sbi_123",
      startupMode: SandboxStartupModes.EXISTING,
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          {
            egressRuleId: "egress_rule_1",
            bindingId: "ibd_1",
            familyId: "github",
            variantId: "github-cloud",
            match: {
              hosts: ["api.github.com"],
            },
            upstream: {
              baseUrl: "https://api.github.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            credentialResolver: {
              kind: "linked_principal",
              providerFamily: "github",
              actingUserRequired: true,
              resolutionMode: "required",
            },
          },
        ],
      }),
      actingUserId: "usr_123",
      processEnv: {},
    });

    expect(startupInput.actingUserId).toBeUndefined();
  });

  it("includes acting-user context in gateway proxy startup input when the workflow has one", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      sandboxInstanceId: "sbi_123",
      startupMode: SandboxStartupModes.EXISTING,
      runtimePlan: createRuntimePlan(),
      actingUserId: "usr_123",
      sandboxAdapter: createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: "/var/run/docker.sock",
          networkName: "mistle-sandbox-dev",
        },
      }),
      processEnv: {
        GATEWAY_PROXY_ENABLED: "1",
      },
    });

    expect(startupInput.actingUserId).toBe("usr_123");
  });

  it("includes provider and runtime transparent proxy exclusions in gateway proxy development mode", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      sandboxInstanceId: "sbi_123",
      startupMode: SandboxStartupModes.NEW,
      runtimePlan: createRuntimePlan(),
      sandboxAdapter: createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: "/var/run/docker.sock",
          networkName: "mistle-sandbox-dev",
        },
      }),
      processEnv: {
        GATEWAY_PROXY_ENABLED: "1",
      },
    });

    expect(startupInput.transparentProxy).toEqual({
      passthroughBypass: {
        kind: "socket_mark",
        mark: 38_514,
      },
      exclusions: [
        {
          kind: "cidr",
          value: "127.0.0.0/8",
          reason: "loopback traffic must remain local to the sandbox",
        },
        {
          kind: "cidr",
          value: "::1/128",
          reason: "IPv6 loopback traffic must remain local to the sandbox",
        },
        {
          kind: "cidr",
          value: "224.0.0.0/4",
          reason: "multicast traffic is outside transparent egress scope",
        },
        {
          kind: "cidr",
          value: "255.255.255.255/32",
          reason: "broadcast traffic is outside transparent egress scope",
        },
        {
          kind: "host",
          value: "host.docker.internal",
          reason: "Docker host gateway traffic must not be redirected away from the host bridge",
        },
        {
          kind: "host",
          value: "gateway",
          reason: "gateway tunnel traffic must not be redirected into sandboxd",
        },
      ],
    });
  });
});
