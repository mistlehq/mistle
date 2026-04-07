import { randomUUID } from "node:crypto";

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
  type StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import { describe, expect } from "vitest";

import { seedSandboxInstanceTitle } from "../openworkflow/handle-automation-conversation-delivery/seed-sandbox-instance-title.js";
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

function createStartSandboxInstanceInput(input: {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
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
      kind: "system",
      id: `worker-${input.sandboxProfileId}`,
    },
    source: "webhook",
    image: {
      imageId: `img-${input.sandboxProfileId}`,
      createdAt: "2026-04-07T00:00:00.000Z",
    },
  };
}

async function startSandboxInstance(input: {
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
}): Promise<string> {
  const startedSandbox = await input.dataPlaneClient.startSandboxInstance(
    createStartSandboxInstanceInput({
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
    }),
  );

  return startedSandbox.sandboxInstanceId;
}

describe("sandbox instance title seeding integration", () => {
  it("seeds the sandbox instance title from the conversation name when the instance is untitled", async ({
    fixture,
  }) => {
    const dataPlaneClient = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = `org_worker_title_seed_${suffix}`;
    const sandboxProfileId = `sbp_worker_title_seed_${suffix}`;
    const sandboxInstanceId = await startSandboxInstance({
      dataPlaneClient,
      organizationId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
    });

    await seedSandboxInstanceTitle(
      {
        dataPlaneClient,
      },
      {
        organizationId,
        sandboxInstanceId,
        conversationName: "Release coordination",
        conversationPreview: "fallback preview",
      },
    );

    const sandboxInstance = await dataPlaneClient.getSandboxInstance({
      organizationId,
      instanceId: sandboxInstanceId,
    });

    expect(sandboxInstance?.title).toBe("Release coordination");
  }, 60_000);

  it("does not overwrite an existing sandbox instance title", async ({ fixture }) => {
    const dataPlaneClient = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = `org_worker_title_preserve_${suffix}`;
    const sandboxProfileId = `sbp_worker_title_preserve_${suffix}`;
    const sandboxInstanceId = await startSandboxInstance({
      dataPlaneClient,
      organizationId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
    });

    await dataPlaneClient.patchSandboxInstanceTitle({
      organizationId,
      instanceId: sandboxInstanceId,
      title: "User-edited title",
    });

    await seedSandboxInstanceTitle(
      {
        dataPlaneClient,
      },
      {
        organizationId,
        sandboxInstanceId,
        conversationName: "Worker should not overwrite this",
        conversationPreview: null,
      },
    );

    const sandboxInstance = await dataPlaneClient.getSandboxInstance({
      organizationId,
      instanceId: sandboxInstanceId,
    });

    expect(sandboxInstance?.title).toBe("User-edited title");
  }, 60_000);

  it("ignores blank metadata without patching the sandbox instance title", async ({ fixture }) => {
    const dataPlaneClient = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = `org_worker_title_blank_${suffix}`;
    const sandboxProfileId = `sbp_worker_title_blank_${suffix}`;
    const sandboxInstanceId = await startSandboxInstance({
      dataPlaneClient,
      organizationId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
    });

    await seedSandboxInstanceTitle(
      {
        dataPlaneClient,
      },
      {
        organizationId,
        sandboxInstanceId,
        conversationName: "   ",
        conversationPreview: null,
      },
    );

    const sandboxInstance = await dataPlaneClient.getSandboxInstance({
      organizationId,
      instanceId: sandboxInstanceId,
    });

    expect(sandboxInstance?.title).toBeNull();
  }, 60_000);
});
