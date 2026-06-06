/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxInstancePurposes } from "@mistle/db/data-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  SandboxProfilesCompileErrorCodes,
  StartSandboxProfileSetupAssistantResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox profile Setup Assistant integration", () => {
  it("starts a setup-assistant sandbox without passing the setup script", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-assistant@example.com",
    });

    await createAssistantProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_setup_assistant_001",
      targetKey: "openai-setup-assistant",
      connectionId: "icn_setup_assistant_agent",
      bindingId: "ibd_setup_assistant_agent",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_assistant_001/versions/1/setup-script/assistant",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "setup-assistant-test",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileSetupAssistantResponseSchema.parse(await response.json());
    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      where: (table, { eq }) => eq(table.id, body.sandboxInstanceId),
    });
    expect(sandboxInstance?.purpose).toBe(SandboxInstancePurposes.SETUP_ASSISTANT);
    expect(sandboxInstance?.sandboxProfileId).toBe("sbp_setup_assistant_001");
    expect(sandboxInstance?.sandboxProfileVersion).toBe(1);

    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBeUndefined();
    expect(queuedWorkflowInput.purpose).toBe("setup_assistant");
    expect(queuedWorkflowInput.image).toMatchObject({
      kind: "base",
    });
    expect(queuedWorkflowInput.runtimePlan.egressRoutes).toContainEqual(
      expect.objectContaining({
        egressRuleId: "egress_rule_platform_mistle_mcp",
        credentialResolver: {
          kind: "mistle_mcp_setup_assistant_token",
          sandboxProfileId: "sbp_setup_assistant_001",
          sandboxProfileVersion: 1,
        },
      }),
    );
  });

  it("starts a maintenance setup assistant from the usable snapshot", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-maintenance-assistant@example.com",
    });

    await createAssistantProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_maintenance_assistant_001",
      targetKey: "openai-maintenance-assistant",
      connectionId: "icn_maintenance_assistant_agent",
      bindingId: "ibd_maintenance_assistant_agent",
      snapshotImageId: "sha256:maintenance-assistant-snapshot",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_maintenance_assistant_001/versions/1/setup-script/assistant",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "maintenance-assistant-test",
          scriptKind: "maintenance",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileSetupAssistantResponseSchema.parse(await response.json());
    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      where: (table, { eq }) => eq(table.id, body.sandboxInstanceId),
    });
    expect(sandboxInstance?.purpose).toBe(SandboxInstancePurposes.SETUP_ASSISTANT);
    expect(sandboxInstance?.sandboxProfileId).toBe("sbp_maintenance_assistant_001");
    expect(sandboxInstance?.sandboxProfileVersion).toBe(1);

    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBeUndefined();
    expect(queuedWorkflowInput.purpose).toBe("setup_assistant");
    expect(queuedWorkflowInput.image).toMatchObject({
      imageId: "sha256:maintenance-assistant-snapshot",
      kind: "snapshot",
    });
    expect(queuedWorkflowInput.runtimePlan.egressRoutes).toContainEqual(
      expect.objectContaining({
        egressRuleId: "egress_rule_platform_mistle_mcp",
        credentialResolver: {
          kind: "mistle_mcp_setup_assistant_token",
          sandboxProfileId: "sbp_maintenance_assistant_001",
          sandboxProfileVersion: 1,
        },
      }),
    );
    expect(queuedWorkflowInput.runtimePlan.runtimeClients[0]?.setup.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "codex_config",
          writeMode: "merge",
        }),
        expect.objectContaining({
          fileId: "codex_global_agents",
          writeMode: "merge",
        }),
      ]),
    );
  });

  it("rejects setup assistant when the selected agent runtime has no saved connection", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-assistant-missing-agent@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_assistant_missing_agent",
        organizationId: session.organizationId,
        displayName: "Setup Assistant Missing Agent Profile",
        activeVersion: null,
        createdAt: "2026-05-04T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_assistant_missing_agent",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
        sandboxProvider: "docker",
        sandboxConnectionId: null,
        sandboxVcpuCount: null,
        sandboxMemoryMb: null,
        sandboxDiskMb: null,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_assistant_missing_agent/versions/1/setup-script/assistant",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "setup-assistant-missing-agent-test",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_CONNECTION_REQUIRED,
      message:
        "Sandbox profile 'sbp_setup_assistant_missing_agent' version 1 needs a saved agent runtime connection before starting Setup Assistant.",
    });
  });
});

async function createAssistantProfile(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  profileId: string;
  targetKey: string;
  connectionId: string;
  bindingId: string;
  snapshotImageId?: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "Setup Assistant Profile",
      activeVersion: input.snapshotImageId === undefined ? null : 1,
      createdAt: "2026-05-04T00:00:00.000Z",
    }),
  );
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      ...sandboxProfileVersionRow({
        sandboxProfileId: input.profileId,
        version: 1,
        state:
          input.snapshotImageId === undefined
            ? SandboxProfileVersionStates.DRAFT
            : SandboxProfileVersionStates.PUBLISHED,
        setupScript: "pnpm install\npnpm dev:bootstrap",
        sandboxProvider: "docker",
        sandboxConnectionId: null,
        sandboxVcpuCount: null,
        sandboxMemoryMb: null,
        sandboxDiskMb: null,
      }),
      ...(input.snapshotImageId === undefined
        ? {}
        : {
            snapshotImageProvider: "docker",
            snapshotImageId: input.snapshotImageId,
          }),
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values(
    integrationTargetRow({
      targetKey: input.targetKey,
      variantId: "openai-default",
      enabled: true,
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationConnections).values(
    integrationConnectionRow({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: "Setup Assistant agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    }),
  );
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values(
      sandboxProfileVersionIntegrationBindingRow({
        id: input.bindingId,
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: 1,
        connectionId: input.connectionId,
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    );
}
