import { sandboxInstances } from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import { SandboxInstancesNotFoundResponseSchema } from "../src/sandbox-instances/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
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

async function insertSandboxInstance(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  organizationId: string;
  sandboxInstanceId: string;
}) {
  await input.dataPlaneFixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_session_link_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    status: "pending",
    startedByKind: "user",
    startedById: "usr_session_link_integration",
    source: "dashboard",
  });
}

describe("sandbox instance session link integration", () => {
  it("redirects a public session link to the dashboard session view without authentication", async ({
    fixture,
  }) => {
    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: fixture.config,
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
      const response = await controlPlaneRuntime.request(
        "/p/sessions/sbi_cp_session_link_public_001",
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:5173/sessions/sbi_cp_session_link_public_001",
      );
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("redirects an authorized user to the dashboard session view", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_session_link",
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
        email: "integration-sandbox-session-link@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_session_link_001",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_session_link_001/session-link",
        {
          method: "GET",
          headers: {
            cookie: authSession.cookie,
          },
          redirect: "manual",
        },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:5173/sessions/sbi_cp_session_link_001",
      );
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns unauthorized when the caller is not authenticated", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_session_link",
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
      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_session_link_unauthorized/session-link",
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        code: "UNAUTHORIZED",
        message: "Unauthorized API request.",
      });
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns not found when the sandbox instance belongs to a different organization", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_session_link",
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
      const ownerSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-session-link-owner@example.com",
      });
      const otherSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-session-link-other@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: ownerSession.organizationId,
        sandboxInstanceId: "sbi_cp_session_link_cross_org_001",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_session_link_cross_org_001/session-link",
        {
          method: "GET",
          headers: {
            cookie: otherSession.cookie,
          },
          redirect: "manual",
        },
      );

      expect(response.status).toBe(404);
      const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
      expect(body).toEqual({
        code: "INSTANCE_NOT_FOUND",
        message: "Sandbox instance 'sbi_cp_session_link_cross_org_001' was not found.",
      });
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});
