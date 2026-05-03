/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_SANDBOX_ROUTE_BASE_PATH,
} from "../src/internal/index.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

describe.concurrent("internal sandbox instances auth integration", () => {
  it("allows read requests with a valid internal service token", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_auth_valid";
    const organizationId = "org_dp_api_auth_valid";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_dp_api_auth_valid",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: "user",
      startedById: "usr_dp_api_auth_valid",
      source: "dashboard",
    });

    const response = await clientFor(env).getSandboxInstance({
      organizationId,
      instanceId: sandboxInstanceId,
    });

    expect(response).toEqual({
      connectable: false,
      failureCode: null,
      failureMessage: null,
      id: sandboxInstanceId,
      runtimePlan: null,
      status: "pending",
      title: null,
    });
  });

  it("rejects start requests missing the internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createStartSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects start requests with an invalid internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify(createStartSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects malformed start request bodies before enqueueing work", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
        },
        body: JSON.stringify({
          ...createStartSandboxInput(),
          sandboxProfileVersion: "1",
        }),
      },
    );

    await expectErrorResponse(response, {
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("rejects stop requests missing the internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_dp_api_auth_stop_missing/stop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createStopSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects stop requests with an invalid internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_dp_api_auth_stop_invalid/stop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify(createStopSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects reconcile requests missing the internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_dp_api_auth_reconcile_missing/reconcile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createReconcileSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects reconcile requests with an invalid internal service token", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_dp_api_auth_reconcile_invalid/reconcile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify(createReconcileSandboxInput()),
      },
    );

    await expectErrorResponse(response, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("returns null when a sandbox instance is not found", async ({ env }) => {
    await expect(
      clientFor(env).getSandboxInstance({
        organizationId: "org_dp_api_auth_missing",
        instanceId: "sbi_dp_api_auth_missing",
      }),
    ).resolves.toBeNull();
  });
});

function clientFor(env: IntegrationTestEnvironment) {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createRuntimePlan(): Record<string, unknown> {
  return {
    sandboxProfileId: "sbp_dp_api_auth",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:3",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

function createStartSandboxInput(): Record<string, unknown> {
  return {
    organizationId: "org_dp_api_auth",
    sandboxProfileId: "sbp_dp_api_auth",
    sandboxProfileVersion: 1,
    purpose: SandboxInstancePurposes.SESSION,
    runtimePlan: createRuntimePlan(),
    startedBy: {
      kind: "user",
      id: "usr_dp_api_auth",
    },
    source: "dashboard",
    image: {
      imageId: "im_dp_api_auth",
      createdAt: "2026-02-27T00:00:00.000Z",
      kind: "base",
    },
  };
}

function createStopSandboxInput(): Record<string, unknown> {
  return {
    stopReason: "idle",
    expectedOwnerLeaseId: "sol_dp_api_auth_stop",
    idempotencyKey: "integration-new-auth-stop",
  };
}

function createReconcileSandboxInput(): Record<string, unknown> {
  return {
    reason: "disconnect_grace_elapsed",
    expectedOwnerLeaseId: "sol_dp_api_auth_reconcile",
    idempotencyKey: "integration-new-auth-reconcile",
  };
}

async function expectErrorResponse(
  response: Response,
  input: {
    status: number;
    code: string;
    message: string;
  },
): Promise<void> {
  expect(response.status).toBe(input.status);
  await expect(response.json()).resolves.toEqual({
    code: input.code,
    message: input.message,
  });
}
