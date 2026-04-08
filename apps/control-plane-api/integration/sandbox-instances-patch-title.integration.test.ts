import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import { SandboxInstancesNotFoundResponseSchema } from "../src/sandbox-instances/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
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

describe("sandbox instance title patch integration", () => {
  it("patches the sandbox instance title for the active organization", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_patch_title",
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
        email: "integration-sandbox-patch-title@example.com",
      });

      await dataPlaneFixture.db.insert(sandboxInstances).values({
        id: "sbi_cp_patch_title",
        organizationId: authSession.organizationId,
        sandboxProfileId: "sbp_cp_patch_title",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-patch-title",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: authSession.userId,
        source: "dashboard",
        title: null,
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_patch_title/title",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: JSON.stringify({
            title: "Updated from control plane",
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_cp_patch_title",
        title: "Updated from control plane",
      });

      const patchedSandboxInstance = await dataPlaneFixture.db.query.sandboxInstances.findFirst({
        columns: {
          id: true,
          title: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.id, "sbi_cp_patch_title"),
      });

      expect(patchedSandboxInstance).toEqual({
        id: "sbi_cp_patch_title",
        title: "Updated from control plane",
      });
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns not found when the sandbox instance is outside the active organization", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_patch_title_not_found",
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
        email: "integration-sandbox-patch-title-not-found@example.com",
      });

      await dataPlaneFixture.db.insert(sandboxInstances).values({
        id: "sbi_cp_patch_title_not_found",
        organizationId: "org_cp_patch_title_other",
        sandboxProfileId: "sbp_cp_patch_title",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-patch-title-not-found",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: authSession.userId,
        source: "dashboard",
        title: "Existing title",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_patch_title_not_found/title",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: JSON.stringify({
            title: "Should not be written",
          }),
        },
      );

      expect(response.status).toBe(404);
      const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
      expect(body).toEqual({
        code: "INSTANCE_NOT_FOUND",
        message: "Sandbox instance 'sbi_cp_patch_title_not_found' was not found.",
      });

      const untouchedSandboxInstance = await dataPlaneFixture.db.query.sandboxInstances.findFirst({
        columns: {
          title: true,
        },
        where: (table, { eq: whereEq }) => whereEq(table.id, "sbi_cp_patch_title_not_found"),
      });

      expect(untouchedSandboxInstance).toEqual({
        title: "Existing title",
      });
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("rejects blank titles", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_patch_title_validation",
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
        email: "integration-sandbox-patch-title-validation@example.com",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_patch_title_validation/title",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: JSON.stringify({
            title: "   ",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
      });
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});
