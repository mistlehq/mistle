import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import type { DataPlaneTrpcRouter } from "@mistle/data-plane-trpc/router";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { describe, expect } from "vitest";

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
    artifactRemovals: [],
    runtimeClients: [],
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
      kind: "base",
      createdAt: "2026-02-27T00:00:00.000Z",
    },
  };
}

function createTrpcClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
  });
}

describe("tRPC internal service auth integration", () => {
  it("allows requests with valid service token", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, fixture.internalAuthServiceToken);

    const organizationId = "org_dp_api_integration_auth_valid";
    const sandboxInstanceId = "sbi_dp_api_integration_auth_valid";
    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_dp_api_integration_auth_valid",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-sandbox-auth-valid",
      status: SandboxInstanceStatuses.RUNNING,
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
      status: "running",
    });
  }, 60_000);

  it("rejects requests missing service token", async ({ fixture }) => {
    const client = createTRPCClient<DataPlaneTrpcRouter>({
      links: [
        httpBatchLink({
          url: new URL("/trpc", fixture.baseUrl).toString(),
        }),
      ],
    });

    await expect(
      client.sandboxInstances.start.mutate(
        createStartSandboxInput({
          organizationId: "org_dp_api_integration_unauth_missing",
          sandboxProfileId: "sbp_dp_api_integration_unauth_missing",
          sandboxProfileVersion: 1,
          userId: "usr_dp_api_integration_unauth_missing",
          imageId: "im_dp_api_integration_unauth_missing",
        }),
      ),
    ).rejects.toThrow("Internal service authentication failed.");
  }, 60_000);

  it("rejects requests with invalid service token", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, "invalid-service-token");

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
});
