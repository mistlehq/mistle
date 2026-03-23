import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  createDataPlaneSandboxInstancesClient,
  type StopSandboxInstanceInput,
  type StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect } from "vitest";

import { INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "../src/internal-sandbox-instances/index.js";
import { it } from "./test-context.js";

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
}): StartSandboxInstanceInput["runtimePlan"] {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
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

function createStartSandboxInput(input: {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  userId: string;
  imageId: string;
}): StartSandboxInstanceInput {
  return {
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    runtimePlan: createRuntimePlan({
      sandboxProfileId: input.sandboxProfileId,
      version: input.sandboxProfileVersion,
    }),
    startedBy: {
      kind: "user",
      id: input.userId,
    },
    source: "dashboard",
    image: {
      imageId: input.imageId,
      createdAt: "2026-02-27T00:00:00.000Z",
    },
  };
}

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
  });
}

function createRouteUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function createStopSandboxInput(input: { sandboxInstanceId: string }): StopSandboxInstanceInput {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: "idle",
    expectedOwnerLeaseId: "sol_dp_api_integration_auth",
    idempotencyKey: "gateway-stop-auth-001",
  };
}

describe("internal sandbox instances auth integration", () => {
  it("allows requests with valid service token", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);

    const organizationId = "org_dp_api_integration_auth_valid";
    const sandboxInstanceId = "sbi_dp_api_integration_auth_valid";
    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_dp_api_integration_auth_valid",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerRuntimeId: "provider-sandbox-auth-valid",
      status: SandboxInstanceStatuses.STOPPED,
      startedByKind: "user",
      startedById: "usr_dp_api_integration_auth_valid",
      source: "dashboard",
    });

    const response = await client.getSandboxInstance({
      organizationId,
      instanceId: sandboxInstanceId,
    });
    expect(response).toEqual({
      failureCode: null,
      failureMessage: null,
      id: sandboxInstanceId,
      status: "stopped",
    });
  }, 60_000);

  it("rejects requests missing service token", async ({ fixture }) => {
    const response = await fetch(
      createRouteUrl(fixture.baseUrl, `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/start`),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          createStartSandboxInput({
            organizationId: "org_dp_api_integration_unauth_missing",
            sandboxProfileId: "sbp_dp_api_integration_unauth_missing",
            sandboxProfileVersion: 1,
            userId: "usr_dp_api_integration_unauth_missing",
            imageId: "im_dp_api_integration_unauth_missing",
          }),
        ),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  }, 60_000);

  it("rejects requests with invalid service token", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, "invalid-service-token");

    await expect(
      client.startSandboxInstance(
        createStartSandboxInput({
          organizationId: "org_dp_api_integration_unauth_invalid",
          sandboxProfileId: "sbp_dp_api_integration_unauth_invalid",
          sandboxProfileVersion: 1,
          userId: "usr_dp_api_integration_unauth_invalid",
          imageId: "im_dp_api_integration_unauth_invalid",
        }),
      ),
    ).rejects.toThrow("Internal service authentication failed.");
  }, 60_000);

  it("rejects malformed request bodies", async ({ fixture }) => {
    const response = await fetch(
      createRouteUrl(fixture.baseUrl, `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/start`),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_integration_invalid_body",
          sandboxProfileId: "sbp_dp_api_integration_invalid_body",
          sandboxProfileVersion: "1",
          runtimePlan: createRuntimePlan({
            sandboxProfileId: "sbp_dp_api_integration_invalid_body",
            version: 1,
          }),
          startedBy: {
            kind: "user",
            id: "usr_dp_api_integration_invalid_body",
          },
          source: "dashboard",
          image: {
            imageId: "im_dp_api_integration_invalid_body",
            createdAt: "2026-02-27T00:00:00.000Z",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        name: "ZodError",
      },
    });
  }, 60_000);

  it("rejects stop requests missing service token", async ({ fixture }) => {
    const response = await fetch(
      createRouteUrl(fixture.baseUrl, `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/stop`),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          createStopSandboxInput({
            sandboxInstanceId: "sbi_dp_api_integration_stop_unauth_missing",
          }),
        ),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  }, 60_000);

  it("rejects stop requests with invalid service token", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, "invalid-service-token");

    await expect(
      client.stopSandboxInstance(
        createStopSandboxInput({
          sandboxInstanceId: "sbi_dp_api_integration_stop_unauth_invalid",
        }),
      ),
    ).rejects.toThrow("Internal service authentication failed.");
  }, 60_000);

  it("returns null when a sandbox instance is not found", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);

    const response = await client.getSandboxInstance({
      organizationId: "org_dp_api_integration_missing",
      instanceId: "sbi_dp_api_integration_missing",
    });

    expect(response).toBeNull();
  }, 60_000);
});
