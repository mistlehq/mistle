import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { describe, expect } from "vitest";

import type { DataPlaneTrpcRouter } from "../src/trpc/router.js";
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
    runtimeClientSetups: [],
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
): ReturnType<typeof createTRPCClient<DataPlaneTrpcRouter>> {
  return createTRPCClient<DataPlaneTrpcRouter>({
    links: [
      httpBatchLink({
        url: new URL("/trpc", baseUrl).toString(),
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: serviceToken,
        },
      }),
    ],
  });
}

describe("tRPC internal service auth integration", () => {
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
      client.sandboxInstances.start.mutate(
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
