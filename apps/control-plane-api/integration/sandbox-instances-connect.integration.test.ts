import { sandboxInstances } from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import {
  SandboxInstanceConnectionTokenSchema,
  SandboxInstancesConflictResponseSchema,
} from "../src/sandbox-instances/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import {
  destroyDockerSandboxContainer,
  startDockerSandboxContainer,
  stopDockerSandboxContainer,
} from "./helpers/docker-sandbox-runtime.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];
const startedSandboxContainerIds: string[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }

  while (startedSandboxContainerIds.length > 0) {
    const containerId = startedSandboxContainerIds.pop();
    if (containerId !== undefined) {
      await destroyDockerSandboxContainer(containerId);
    }
  }
});

function createControlPlaneConfig(input: {
  baseConfig: ControlPlaneApiConfig;
  dataPlaneBaseUrl: string;
}): ControlPlaneApiConfig {
  return {
    ...input.baseConfig,
    dataPlaneApi: {
      baseUrl: input.dataPlaneBaseUrl,
    },
  };
}

async function createAuthenticatedControlPlaneSession(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  db: Awaited<ReturnType<typeof createControlPlaneApiRuntime>>["db"];
  email: string;
}) {
  return createAuthenticatedSession({
    request: input.request,
    db: input.db,
    otpLength: input.fixture.config.auth.otpLength,
    email: input.email,
  });
}

async function insertSandboxInstance(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  organizationId: string;
  sandboxInstanceId: string;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  providerSandboxId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}) {
  await input.dataPlaneFixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_connect_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId ?? null,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_connect_integration",
    source: "dashboard",
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
  });
}

describe("sandbox instance connect integration", () => {
  it("mints a connection token immediately for connectable instances", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_connect",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-running@example.com",
      });
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_running_001",
        status: "running",
        providerSandboxId,
      });
      await dataPlaneFixture.attachSandboxRuntime({
        sandboxInstanceId: "sbi_cp_connect_running_001",
        runtimeReady: true,
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_running_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(201);
      const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
      expect(body.instanceId).toBe("sbi_cp_connect_running_001");
      expect(body.url).toContain("/sbi_cp_connect_running_001?");
      expect(body.token).not.toBe("");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_FAILED when a persisted running sandbox is missing at the provider", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_connect",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-reconcile-running@example.com",
      });

      const originalSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(originalSandboxId);

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_reconcile_running_001",
        status: "running",
        providerSandboxId: originalSandboxId,
      });

      await destroyDockerSandboxContainer(originalSandboxId);

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_reconcile_running_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_FAILED");
      expect(body.message).toContain("Sandbox runtime was not found at the provider");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_NOT_RESUMABLE for pending instances", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_connect",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-starting@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_starting_001",
        status: "pending",
        providerSandboxId: null,
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_starting_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_NOT_RESUMABLE");
      expect(body.message).toContain("is 'pending' and is not connectable");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_NOT_RESUMABLE for stopped instances", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_connect",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-stopped@example.com",
      });
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);
      await stopDockerSandboxContainer(providerSandboxId);

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_stopped_001",
        status: "stopped",
        providerSandboxId,
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_stopped_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_NOT_RESUMABLE");
      expect(body.message).toContain("is 'stopped' and is not connectable");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_FAILED for failed instances", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_connect",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-failed@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_failed_001",
        status: "failed",
        failureCode: "sandbox_start_failed",
        failureMessage: "Sandbox runtime failed to start.",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_failed_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_FAILED");
      expect(body.message).toContain("Sandbox runtime failed to start.");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});
