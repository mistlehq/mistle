import { SandboxProvider, createSandboxAdapter } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  createSandboxActivationInput,
  createSandboxStartupInput,
} from "./initialize-sandbox-runtime.js";
import { SandboxStartupModes } from "./sandbox-startup-input.js";

function createTestRuntimeConfig(): DataPlaneWorkerRuntimeConfig {
  const sandbox: DataPlaneWorkerRuntimeConfig["sandbox"] = {
    internalGatewayWsUrl: "ws://gateway/tunnel/sandbox",
    bootstrap: {
      tokenSecret: "bootstrap-secret",
      tokenIssuer: "issuer",
      tokenAudience: "audience",
    },
    docker: {
      enabled: true,
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
        databasePoolMax: 2,
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
  it("includes transparent proxy configuration when the sandbox provider supports it", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      operationId: "op_test_001",
      operationKind: "start",
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
    });

    expect(startupInput.transparentProxy?.passthroughBypass).toEqual({
      kind: "socket_mark",
      mark: 38_514,
    });
  });

  it("keeps acting-user context out of sandbox startup input when no sandbox adapter is available", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      operationId: "op_test_001",
      operationKind: "resume",
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
              integrationConnectionId: "icn_github",
              actingUserRequired: true,
              resolutionMode: "required",
            },
          },
        ],
      }),
      actingUserId: "usr_123",
    });

    expect(startupInput.actingUserId).toBeUndefined();
  });

  it("includes acting-user context in sandbox startup input when the workflow has one", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      operationId: "op_test_001",
      operationKind: "resume",
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
    });

    expect(startupInput.actingUserId).toBe("usr_123");
  });

  it("includes provider and runtime transparent proxy exclusions", async () => {
    const startupInput = await createSandboxStartupInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      operationId: "op_test_001",
      operationKind: "start",
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
      ],
    });
  });
});

describe("createSandboxActivationInput", () => {
  it("builds the same session configuration without legacy startup fields", async () => {
    const activationInput = await createSandboxActivationInput({
      config: createTestRuntimeConfig(),
      organizationId: "org_123",
      operationId: "op_test_001",
      operationKind: "resume",
      sandboxInstanceId: "sbi_123",
      runtimePlan: createRuntimePlan(),
      actingUserId: "usr_123",
      sandboxAdapter: createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: "/var/run/docker.sock",
          networkName: "mistle-sandbox-dev",
        },
      }),
    });

    expect(activationInput.operationKind).toBe("resume");
    expect("startupMode" in activationInput).toBe(false);
    expect("executionMode" in activationInput).toBe(false);
    expect(activationInput.actingUserId).toBe("usr_123");
    expect(activationInput.transparentProxy).toEqual({
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
      ],
    });
  });
});
