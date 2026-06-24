/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  PortAccessLinkCreatedByKinds,
  SandboxProfileStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { mintMcpToken } from "@mistle/gateway-tunnel-auth";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  SandboxInstancePortAccessSchema,
  SandboxInstanceStatusResponseSchema,
  SandboxOperationEventsResponseSchema,
} from "../src/sandbox-instances/index.js";
import {
  ListSandboxProfilesResponseSchema,
  CreateSandboxProfileVersionResponseSchema,
  DiscardSandboxProfileVersionDraftResponseSchema,
  GetSandboxProfileVersionDraftTriggerImpactResponseSchema,
  GetSandboxProfileVersionIntegrationBindingsResponseSchema,
  GetSandboxProfileVersionPublishabilityResponseSchema,
  PublishSandboxProfileVersionResponseSchema,
  PutSandboxProfileVersionDraftResponseSchema,
  SandboxProfileSchema,
  SandboxProfileVersionMaintenanceScriptSchema,
  SandboxProfileVersionSetupScriptSchema,
  StartSandboxProfileSetupScriptTestRunResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyCredential, createApiKeyToken } from "./helpers/api-keys.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";
import { callMcpJsonRpcResponse, callMcpTool, listMcpTools } from "./helpers/mcp-json-rpc.js";
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

const itManagedE2BDeployment = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
  __serviceOptions: {
    sandbox: {
      provider: "e2b",
      e2b: {
        apiKey: "integration-managed-e2b-api-key",
      },
    },
  },
});

const McpTokenConfig = {
  tokenSecret: "integration-new-mcp-auth-secret",
  tokenIssuer: "integration-new-control-plane-api",
  tokenAudience: "integration-new-mistle-mcp",
};

const DockerSandboxRuntimeColumns = {
  sandboxProvider: "docker",
  sandboxConnectionId: null,
  sandboxVcpuCount: null,
  sandboxMemoryMb: null,
  sandboxDiskMb: null,
} as const;

describe.concurrent("MCP profile tools integration", () => {
  it("lists MCP tools with JSON Schema-compatible input schemas", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-tools-list@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP tools lister",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_CREATE,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
        OrganizationPermissions.SANDBOX_SESSION_READ,
        OrganizationPermissions.SANDBOX_SESSION_CONNECT,
      ],
    });

    const tools = await listMcpTools({ env, token });

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_scheduled_trigger",
      "create_webhook_trigger",
      "get_trigger",
      "list_supported_capabilities",
      "list_trigger_webhook_events",
      "list_triggers",
      "profile_create",
      "profile_draft_create",
      "profile_draft_discard",
      "profile_draft_setup_script_put",
      "profile_draft_update",
      "profile_get",
      "profile_list",
      "profile_maintenance_script_get",
      "profile_maintenance_script_put",
      "profile_maintenance_script_test_start",
      "profile_setup_script_get",
      "profile_setup_script_test_start",
      "profile_update",
      "profile_version_draft_trigger_impact_get",
      "profile_version_integration_bindings_get",
      "profile_version_publish",
      "profile_version_publishability_get",
      "rename_trigger",
      "sandbox_instance_get",
      "sandbox_instance_port_access_create",
      "sandbox_operation_events_list",
      "set_trigger_enabled",
      "set_trigger_schedule",
      "set_trigger_webhook_events",
      "update_trigger_user_message",
    ]);
    expect(tools.find((tool) => tool.name === "create_scheduled_trigger")?.annotations).toEqual(
      expect.objectContaining({
        idempotentHint: false,
      }),
    );
    expect(tools.find((tool) => tool.name === "create_webhook_trigger")?.annotations).toEqual(
      expect.objectContaining({
        idempotentHint: false,
      }),
    );
    expect(tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
  });

  it("lists sandbox profiles with the REST response shape scoped to the API key organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-profile-list-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-profile-list-b@example.com",
    });
    const token = await createApiKeyToken({
      cookie: firstOrgSession.cookie,
      env,
      name: "MCP profile reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      {
        id: "sbp_mcp_list_a",
        organizationId: firstOrgSession.organizationId,
        displayName: "MCP List Profile A",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "sbp_mcp_list_b",
        organizationId: secondOrgSession.organizationId,
        displayName: "MCP List Profile B",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-02-02T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    ]);

    const result = await callMcpTool({
      env,
      token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(result.isError).toBeUndefined();
    const profileList = ListSandboxProfilesResponseSchema.parse(result.structuredContent);
    expect(profileList.totalResults).toBe(1);
    expect(profileList.items.map((profile) => profile.id)).toEqual(["sbp_mcp_list_a"]);
  });

  it("gets a sandbox profile with the REST response shape", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-get@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile getter",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_mcp_get",
      organizationId: session.organizationId,
      displayName: "MCP Get Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "profile_get",
      arguments: {
        profileId: "sbp_mcp_get",
      },
    });

    expect(result.isError).toBeUndefined();
    const profile = SandboxProfileSchema.parse(result.structuredContent);
    expect(profile.id).toBe("sbp_mcp_get");
    expect(profile.organizationId).toBe(session.organizationId);
    expect(profile.displayName).toBe("MCP Get Profile");
  });

  it("creates a profile, updates metadata, and updates draft configuration with bindings", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-draft-full-update@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile draft full writer",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_CREATE,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-profile-draft-full-update",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_profile_draft_full_update_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-profile-draft-full-update",
        displayName: "MCP profile draft full update agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );

    const createResult = await callMcpTool({
      env,
      token,
      name: "profile_create",
      arguments: {
        displayName: "MCP Created Profile",
        sandboxProvider: SandboxProvider.DOCKER,
      },
    });
    expect(createResult.isError).toBeUndefined();
    const createdProfile = SandboxProfileSchema.parse(createResult.structuredContent);
    expect(createdProfile.displayName).toBe("MCP Created Profile");
    expect(createdProfile.activeVersion).toBeNull();

    const updateProfileResult = await callMcpTool({
      env,
      token,
      name: "profile_update",
      arguments: {
        profileId: createdProfile.id,
        displayName: "MCP Updated Profile",
      },
    });
    expect(updateProfileResult.isError).toBeUndefined();
    expect(SandboxProfileSchema.parse(updateProfileResult.structuredContent).displayName).toBe(
      "MCP Updated Profile",
    );

    const draftUpdateResult = await callMcpTool({
      env,
      token,
      name: "profile_draft_update",
      arguments: {
        profileId: createdProfile.id,
        version: 1,
        setupScript: "echo install dependencies",
        sandboxProvider: SandboxProvider.DOCKER,
        integrationBindings: {
          bindings: [
            {
              clientRef: "agent",
              connectionId: "icn_mcp_profile_draft_full_update_agent",
              kind: IntegrationBindingKinds.AGENT,
              config: {},
            },
          ],
        },
      },
    });
    expect(draftUpdateResult.isError).toBeUndefined();
    const updatedDraft = PutSandboxProfileVersionDraftResponseSchema.parse(
      draftUpdateResult.structuredContent,
    );
    expect(updatedDraft).toMatchObject({
      sandboxProfileId: createdProfile.id,
      version: 1,
      setupScript: "echo install dependencies",
      sandboxProvider: SandboxProvider.DOCKER,
      sandboxResources: null,
    });
    expect(updatedDraft.integrationBindings.bindings).toEqual([
      expect.objectContaining({
        connectionId: "icn_mcp_profile_draft_full_update_agent",
        kind: IntegrationBindingKinds.AGENT,
      }),
    ]);

    const bindingsResult = await callMcpTool({
      env,
      token,
      name: "profile_version_integration_bindings_get",
      arguments: {
        profileId: createdProfile.id,
        version: 1,
      },
    });
    expect(bindingsResult.isError).toBeUndefined();
    const bindings = GetSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      bindingsResult.structuredContent,
    );
    expect(bindings.bindings.map((binding) => binding.connectionId)).toEqual([
      "icn_mcp_profile_draft_full_update_agent",
    ]);

    const publishabilityResult = await callMcpTool({
      env,
      token,
      name: "profile_version_publishability_get",
      arguments: {
        profileId: createdProfile.id,
        version: 1,
      },
    });
    expect(publishabilityResult.isError).toBeUndefined();
    expect(
      GetSandboxProfileVersionPublishabilityResponseSchema.parse(
        publishabilityResult.structuredContent,
      ).publishable,
    ).toBe(true);

    const triggerImpactResult = await callMcpTool({
      env,
      token,
      name: "profile_version_draft_trigger_impact_get",
      arguments: {
        profileId: createdProfile.id,
        version: 1,
      },
    });
    expect(triggerImpactResult.isError).toBeUndefined();
    expect(
      GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
        triggerImpactResult.structuredContent,
      ),
    ).toEqual({
      hasBreakingChanges: false,
      affectedTriggers: [],
    });
  });

  it("creates and discards an existing profile draft", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-draft-create-discard@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile draft lifecycle writer",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_draft_create_discard",
        organizationId: session.organizationId,
        displayName: "MCP Draft Create Discard Profile",
        activeVersion: 1,
        createdAt: "2026-05-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_draft_create_discard",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        setupScript: "echo published",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const createDraftResult = await callMcpTool({
      env,
      token,
      name: "profile_draft_create",
      arguments: {
        profileId: "sbp_mcp_draft_create_discard",
      },
    });
    expect(createDraftResult.isError).toBeUndefined();
    const createdDraft = CreateSandboxProfileVersionResponseSchema.parse(
      createDraftResult.structuredContent,
    );
    expect(createdDraft).toMatchObject({
      sandboxProfileId: "sbp_mcp_draft_create_discard",
      version: 2,
      state: SandboxProfileVersionStates.DRAFT,
    });
    const persistedCreatedDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_mcp_draft_create_discard"), eq(table.version, 2)),
    });
    expect(persistedCreatedDraft?.setupScript).toBe("echo published");

    const discardResult = await callMcpTool({
      env,
      token,
      name: "profile_draft_discard",
      arguments: {
        profileId: "sbp_mcp_draft_create_discard",
        version: 2,
      },
    });
    expect(discardResult.isError).toBeUndefined();
    expect(
      DiscardSandboxProfileVersionDraftResponseSchema.parse(discardResult.structuredContent),
    ).toEqual({
      discardedVersion: 2,
      hasDraft: false,
    });

    const remainingDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        version: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, "sbp_mcp_draft_create_discard"),
          eq(table.state, SandboxProfileVersionStates.DRAFT),
        ),
    });
    expect(remainingDraft).toBeUndefined();
  });

  it("canonicalizes sandbox profile draft skills config origin URLs before persistence", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-draft-skills-canonical@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile draft skills writer",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_draft_skills_canonical",
        organizationId: session.organizationId,
        displayName: "MCP Draft Skills Canonical Profile",
        createdAt: "2026-05-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_draft_skills_canonical",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo skills",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const result = await callMcpTool({
      env,
      token,
      name: "profile_draft_update",
      arguments: {
        profileId: "sbp_mcp_draft_skills_canonical",
        version: 1,
        skillsConfig: {
          originUrl: "https://github.com/acme/skills",
          selectedSkills: [],
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const updatedDraft = PutSandboxProfileVersionDraftResponseSchema.parse(
      result.structuredContent,
    );
    expect(updatedDraft.skillsConfig).toEqual({
      originUrl: "https://github.com/acme/skills.git",
      selectedSkills: [],
    });

    const persistedDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        skillsConfig: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_mcp_draft_skills_canonical"), eq(table.version, 1)),
    });
    expect(persistedDraft?.skillsConfig).toEqual({
      originUrl: "https://github.com/acme/skills.git",
      selectedSkills: [],
    });
  });

  it("rejects invalid sandbox profile draft associated-resource payload filters", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-draft-associated-filter-invalid@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile draft associated filter writer",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_draft_associated_filter_invalid",
        organizationId: session.organizationId,
        displayName: "MCP Draft Associated Filter Invalid Profile",
        createdAt: "2026-05-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_draft_associated_filter_invalid",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo associated",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const result = await callMcpTool({
      env,
      token,
      name: "profile_draft_update",
      arguments: {
        profileId: "sbp_mcp_draft_associated_filter_invalid",
        version: 1,
        associatedResourceEventRoutingConfig: {
          resources: [
            {
              resourceKind: "github.pull_request",
              eventTypes: ["github.pull_request.opened"],
              payloadFilter: {
                "github.pull_request.closed": {
                  op: "eq",
                  path: ["action"],
                  value: "closed",
                },
              },
            },
          ],
        },
      },
    });

    expect(result.isError).toBe(true);
    const persistedDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        associatedResourceEventRoutingConfig: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, "sbp_mcp_draft_associated_filter_invalid"),
          eq(table.version, 1),
        ),
    });
    expect(persistedDraft?.associatedResourceEventRoutingConfig).toEqual({});
  });

  itManagedE2BDeployment(
    "updates sandbox profile draft resources without resending the existing provider",
    async ({ env }) => {
      const session = await env.auth.createSession({
        email: "integration-new-mcp-profile-draft-resource-only@example.com",
      });
      const token = await createApiKeyToken({
        cookie: session.cookie,
        env,
        name: "MCP profile draft resource writer",
        permissions: [
          OrganizationPermissions.SANDBOX_PROFILE_READ,
          OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        ],
      });

      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
        sandboxProfileRow({
          id: "sbp_mcp_draft_resource_only",
          organizationId: session.organizationId,
          displayName: "MCP Draft Resource Only Profile",
          createdAt: "2026-05-03T00:00:00.000Z",
        }),
      );
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
        sandboxProfileVersionRow({
          sandboxProfileId: "sbp_mcp_draft_resource_only",
          version: 1,
          state: SandboxProfileVersionStates.DRAFT,
          setupScript: "echo resources",
          sandboxProvider: SandboxProvider.E2B,
          sandboxVcpuCount: 2,
          sandboxMemoryMb: 4096,
        }),
      );

      const result = await callMcpTool({
        env,
        token,
        name: "profile_draft_update",
        arguments: {
          profileId: "sbp_mcp_draft_resource_only",
          version: 1,
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 8192,
          },
        },
      });

      expect(result.isError).toBeUndefined();
      const updatedDraft = PutSandboxProfileVersionDraftResponseSchema.parse(
        result.structuredContent,
      );
      expect(updatedDraft.sandboxProvider).toBe(SandboxProvider.E2B);
      expect(updatedDraft.sandboxResources).toEqual({
        vcpuCount: 4,
        memoryMb: 8192,
      });
    },
  );

  it("publishes a draft profile version without starting a sandbox session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-publish@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile publisher",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_profile_publish",
        organizationId: session.organizationId,
        displayName: "MCP Profile Publish",
        createdAt: "2026-05-04T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_profile_publish",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo publish",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const publishResult = await callMcpTool({
      env,
      token,
      name: "profile_version_publish",
      arguments: {
        profileId: "sbp_mcp_profile_publish",
        version: 1,
      },
    });
    expect(publishResult.isError).toBeUndefined();
    const published = PublishSandboxProfileVersionResponseSchema.parse(
      publishResult.structuredContent,
    );
    expect(published.version).toMatchObject({
      sandboxProfileId: "sbp_mcp_profile_publish",
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
    });
    expect(published.snapshotAction.kind).toBe("created");

    const profile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_mcp_profile_publish"),
    });
    expect(profile?.activeVersion).toBeNull();
  });

  it("gets sandbox profile setup and maintenance scripts with REST response shapes", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-script-get@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile script reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });
    const setupScript = "pnpm install\npnpm build";
    const maintenanceScript = "git pull --ff-only\npnpm install";

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_script_get",
        organizationId: session.organizationId,
        displayName: "MCP Script Get Profile",
        createdAt: "2026-05-07T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_script_get",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        setupScript,
        maintenanceScript,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const setupResult = await callMcpTool({
      env,
      token,
      name: "profile_setup_script_get",
      arguments: {
        profileId: "sbp_mcp_script_get",
        version: 1,
      },
    });
    const maintenanceResult = await callMcpTool({
      env,
      token,
      name: "profile_maintenance_script_get",
      arguments: {
        profileId: "sbp_mcp_script_get",
        version: 1,
      },
    });

    expect(setupResult.isError).toBeUndefined();
    expect(maintenanceResult.isError).toBeUndefined();
    expect(SandboxProfileVersionSetupScriptSchema.parse(setupResult.structuredContent)).toEqual({
      sandboxProfileId: "sbp_mcp_script_get",
      version: 1,
      setupScript,
    });
    expect(
      SandboxProfileVersionMaintenanceScriptSchema.parse(maintenanceResult.structuredContent),
    ).toEqual({
      sandboxProfileId: "sbp_mcp_script_get",
      version: 1,
      maintenanceScript,
    });
  });

  it("updates a sandbox profile draft setup script with the REST response shape", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-draft-setup-put@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile draft setup script writer",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_draft_setup_put",
        organizationId: session.organizationId,
        displayName: "MCP Draft Setup Put Profile",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_draft_setup_put",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const setupScript = "pnpm install\npnpm test";
    const result = await callMcpTool({
      env,
      token,
      name: "profile_draft_setup_script_put",
      arguments: {
        profileId: "sbp_mcp_draft_setup_put",
        version: 1,
        setupScript,
      },
    });

    expect(result.isError).toBeUndefined();
    const draft = PutSandboxProfileVersionDraftResponseSchema.parse(result.structuredContent);
    expect(draft.sandboxProfileId).toBe("sbp_mcp_draft_setup_put");
    expect(draft.version).toBe(1);
    expect(draft.setupScript).toBe(setupScript);

    const persistedDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_mcp_draft_setup_put"), eq(table.version, 1)),
    });
    expect(persistedDraft?.setupScript).toBe(setupScript);
  });

  it("updates a sandbox profile maintenance script with the REST response shape", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-maintenance-put@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile maintenance script writer",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_maintenance_put",
        organizationId: session.organizationId,
        displayName: "MCP Maintenance Put Profile",
        createdAt: "2026-05-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_maintenance_put",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        maintenanceScript: "echo old maintenance",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const maintenanceScript = "git pull --ff-only\npnpm install";
    const result = await callMcpTool({
      env,
      token,
      name: "profile_maintenance_script_put",
      arguments: {
        profileId: "sbp_mcp_maintenance_put",
        version: 1,
        maintenanceScript,
      },
    });

    expect(result.isError).toBeUndefined();
    const updatedScript = SandboxProfileVersionMaintenanceScriptSchema.parse(
      result.structuredContent,
    );
    expect(updatedScript).toEqual({
      sandboxProfileId: "sbp_mcp_maintenance_put",
      version: 1,
      maintenanceScript,
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_mcp_maintenance_put"), eq(table.version, 1)),
    });
    expect(persistedVersion?.maintenanceScript).toBe(maintenanceScript);
  });

  it("starts a setup script test run with the REST response shape", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-setup-script-test-start@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile setup script tester",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_setup_script_test_start",
        organizationId: session.organizationId,
        displayName: "MCP Setup Script Test Start Profile",
        createdAt: "2026-05-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_setup_script_test_start",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo persisted",
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-setup-script-test-start",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_setup_script_test_start_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-setup-script-test-start",
        displayName: "MCP setup script test agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_setup_script_test_start_agent",
          sandboxProfileId: "sbp_mcp_setup_script_test_start",
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_setup_script_test_start_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const result = await callMcpTool({
      env,
      token,
      name: "profile_setup_script_test_start",
      arguments: {
        profileId: "sbp_mcp_setup_script_test_start",
        version: 1,
        setupScript: "echo tested through mcp",
        idempotencyKey: "mcp-setup-script-test-start-001",
      },
    });

    expect(result.isError).toBeUndefined();
    const startedTestRun = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(
      result.structuredContent,
    );
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: startedTestRun.sandboxInstanceId,
    });

    expect(startedTestRun.status).toBe("accepted");
    expect(queuedWorkflowInput.purpose).toBe("setup_check");
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBe("echo tested through mcp");
    expect(queuedWorkflowInput.startedBy).toEqual({
      kind: "api_key",
      id: expect.any(String),
    });
  });

  it("starts a maintenance script test run with the REST response shape", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-maintenance-script-test-start@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile maintenance script tester",
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_maintenance_script_test_start",
        organizationId: session.organizationId,
        displayName: "MCP Maintenance Script Test Start Profile",
        activeVersion: 1,
        createdAt: "2026-05-02T01:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      ...sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_maintenance_script_test_start",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        maintenanceScript: "echo persisted maintenance",
        ...DockerSandboxRuntimeColumns,
      }),
      snapshotImageProvider: SandboxProvider.DOCKER,
      snapshotImageId: "sha256:mcp-maintenance-script-test-start",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-maintenance-script-test-start",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_maintenance_script_test_start_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-maintenance-script-test-start",
        displayName: "MCP maintenance script test agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_maintenance_script_test_start_agent",
          sandboxProfileId: "sbp_mcp_maintenance_script_test_start",
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_maintenance_script_test_start_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const result = await callMcpTool({
      env,
      token,
      name: "profile_maintenance_script_test_start",
      arguments: {
        profileId: "sbp_mcp_maintenance_script_test_start",
        version: 1,
        maintenanceScript: "echo tested maintenance through mcp",
        idempotencyKey: "mcp-maintenance-script-test-start-001",
      },
    });

    expect(result.isError).toBeUndefined();
    const startedTestRun = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(
      result.structuredContent,
    );
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: startedTestRun.sandboxInstanceId,
    });

    expect(startedTestRun.status).toBe("accepted");
    expect(queuedWorkflowInput.purpose).toBe("setup_check");
    expect(queuedWorkflowInput.image).toMatchObject({
      kind: "snapshot",
      imageId: "sha256:mcp-maintenance-script-test-start",
    });
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBe("echo tested maintenance through mcp");
    expect(queuedWorkflowInput.startedBy).toEqual({
      kind: "api_key",
      id: expect.any(String),
    });
  });

  it("gets sandbox status and setup script test events with REST response shapes", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-sandbox-test-feedback@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP sandbox feedback reader",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_feedback",
      status: SandboxInstanceStatuses.FAILED,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      operationEventRow({
        id: "soe_mcp_feedback_001",
        sandboxInstanceId: "sbi_mcp_feedback",
        operationId: "op_mcp_feedback",
        sequence: 1,
        phase: "setup_script",
        status: "failed",
        message: "setup script failed",
      }),
      operationEventRow({
        id: "soe_mcp_feedback_002",
        sandboxInstanceId: "sbi_mcp_feedback",
        operationId: "op_mcp_feedback",
        sequence: 2,
        recordKind: "transcript",
        phase: "setup_script",
        status: null,
        stream: "stderr",
        message: "",
        payloadBytes: Buffer.from("missing dependency", "utf8"),
      }),
      ...Array.from({ length: 20 }, (_, index) => {
        const sequence = index + 3;
        return operationEventRow({
          id: `soe_mcp_feedback_${String(sequence).padStart(3, "0")}`,
          sandboxInstanceId: "sbi_mcp_feedback",
          operationId: "op_mcp_feedback",
          sequence,
          phase: "setup_script",
          status: "failed",
          message: `setup script failed ${sequence}`,
        });
      }),
    ]);

    const instanceResult = await callMcpTool({
      env,
      token,
      name: "sandbox_instance_get",
      arguments: {
        instanceId: "sbi_mcp_feedback",
      },
    });
    const eventsResult = await callMcpTool({
      env,
      token,
      name: "sandbox_operation_events_list",
      arguments: {
        instanceId: "sbi_mcp_feedback",
        operationId: "op_mcp_feedback",
        afterSequence: 1,
      },
    });
    expect(instanceResult.isError).toBeUndefined();
    expect(eventsResult.isError).toBeUndefined();
    const sandboxInstance = SandboxInstanceStatusResponseSchema.parse(
      instanceResult.structuredContent,
    );
    const operationEvents = SandboxOperationEventsResponseSchema.parse(
      eventsResult.structuredContent,
    );

    expect(sandboxInstance).toMatchObject({
      id: "sbi_mcp_feedback",
      status: "failed",
    });
    expect(operationEvents.events.map((event) => event.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => {
        const sequence = index + 2;
        return `soe_mcp_feedback_${String(sequence).padStart(3, "0")}`;
      }),
    );
    expect(operationEvents.events[0]).toMatchObject({
      sandboxInstanceId: "sbi_mcp_feedback",
      operationKind: "setup_check",
      operationId: "op_mcp_feedback",
      phase: "setup_script",
      stream: "stderr",
      payloadBase64: "bWlzc2luZyBkZXBlbmRlbmN5",
    });
  });

  it("creates a short Port Access link for a sandbox instance and records the MCP actor", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-port-access-create@example.com",
    });
    const credential = await createApiKeyCredential({
      cookie: session.cookie,
      env,
      name: "MCP sandbox port access",
      permissions: [
        OrganizationPermissions.SANDBOX_SESSION_READ,
        OrganizationPermissions.SANDBOX_SESSION_CONNECT,
      ],
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_port_access",
      status: SandboxInstanceStatuses.RUNNING,
    });

    const result = await callMcpTool({
      env,
      token: credential.token,
      name: "sandbox_instance_port_access_create",
      arguments: {
        instanceId: "sbi_mcp_port_access",
        port: 4173,
      },
    });

    expect(result.isError).toBeUndefined();
    const portAccess = SandboxInstancePortAccessSchema.parse(result.structuredContent);
    const url = new URL(portAccess.url);
    const slug = url.pathname.replace("/p/ports/", "");

    expect(slug).toMatch(/^[0-9A-Za-z]{12}$/u);
    expect(portAccess.host).toContain("p-4173--");
    expect(Date.parse(portAccess.expiresAt)).toBeGreaterThan(Date.now());

    const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
      where: (table, { eq }) => eq(table.slug, slug),
    });
    expect(persistedLink).toMatchObject({
      slug,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_port_access",
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.AGENT,
      createdById: credential.apiKey.id,
    });
    expect(Date.parse(persistedLink?.expiresAt ?? "")).toBe(Date.parse(portAccess.expiresAt));
  });

  it("allows setup assistant MCP tokens to create Port Access links for the scoped sandbox instance", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-port-access-setup-assistant@example.com",
    });
    const sandboxInstanceId = "sbi_mcp_port_access_setup_assistant";
    const sandboxProfileId = "sbp_mcp_port_access_setup_assistant";
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: sandboxInstanceId,
        organizationId: session.organizationId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const result = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_port_access_create",
      arguments: {
        instanceId: sandboxInstanceId,
        port: 4173,
      },
    });

    expect(result.isError).toBeUndefined();
    const portAccess = SandboxInstancePortAccessSchema.parse(result.structuredContent);
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");

    const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
      where: (table, { eq }) => eq(table.slug, slug),
    });
    expect(persistedLink).toMatchObject({
      slug,
      organizationId: session.organizationId,
      sandboxInstanceId,
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.AGENT,
      createdById: sandboxInstanceId,
    });
  });

  it("prevents setup assistant MCP tokens from creating Port Access links for sibling sandbox instances", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-port-access-setup-assistant-instance-scope@example.com",
    });
    const scopedSandboxInstanceId = "sbi_mcp_port_access_setup_assistant_scoped";
    const siblingSandboxInstanceId = "sbi_mcp_port_access_setup_assistant_sibling";
    const sandboxProfileId = "sbp_mcp_port_access_setup_assistant_instance_scope";
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: scopedSandboxInstanceId,
        organizationId: session.organizationId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: scopedSandboxInstanceId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      status: SandboxInstanceStatuses.RUNNING,
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: siblingSandboxInstanceId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const result = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_port_access_create",
      arguments: {
        instanceId: siblingSandboxInstanceId,
        port: 4173,
      },
    });

    expect(result.isError).toBe(true);
    const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
      where: (table, { eq }) => eq(table.sandboxInstanceId, siblingSandboxInstanceId),
    });
    expect(persistedLink).toBeUndefined();
  });

  it("returns a tool error when creating Port Access without sandbox connect permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-port-access-connect-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP sandbox reader",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "sandbox_instance_port_access_create",
      arguments: {
        instanceId: "sbi_mcp_port_access_forbidden",
        port: 4173,
      },
    });

    expect(result.isError).toBe(true);
  });

  it("authorizes setup assistant MCP tokens to read sandbox feedback for the scoped profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-setup-assistant-feedback@example.com",
    });
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: "sbi_mcp_setup_assistant_feedback",
        organizationId: session.organizationId,
        sandboxProfileId: "sbp_mcp_setup_assistant_feedback",
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_setup_assistant_feedback_test",
      sandboxProfileId: "sbp_mcp_setup_assistant_feedback",
      sandboxProfileVersion: 1,
      status: SandboxInstanceStatuses.FAILED,
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_setup_assistant_feedback_other",
      sandboxProfileId: "sbp_mcp_setup_assistant_feedback_other",
      sandboxProfileVersion: 1,
      status: SandboxInstanceStatuses.FAILED,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values(
      operationEventRow({
        id: "soe_mcp_setup_assistant_feedback_001",
        sandboxInstanceId: "sbi_mcp_setup_assistant_feedback_test",
        operationId: "op_mcp_setup_assistant_feedback",
        sequence: 1,
        phase: "setup_script",
        status: "failed",
        message: "setup script failed",
      }),
    );

    const instanceResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_get",
      arguments: {
        instanceId: "sbi_mcp_setup_assistant_feedback_test",
      },
    });
    const eventsResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_operation_events_list",
      arguments: {
        instanceId: "sbi_mcp_setup_assistant_feedback_test",
        operationId: "op_mcp_setup_assistant_feedback",
      },
    });
    const otherInstanceResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_get",
      arguments: {
        instanceId: "sbi_mcp_setup_assistant_feedback_other",
      },
    });

    expect(instanceResult.isError).toBeUndefined();
    expect(eventsResult.isError).toBeUndefined();
    expect(otherInstanceResult.isError).toBe(true);
    const operationEvents = SandboxOperationEventsResponseSchema.parse(
      eventsResult.structuredContent,
    );
    expect(operationEvents.events.map((event) => event.id)).toEqual([
      "soe_mcp_setup_assistant_feedback_001",
    ]);
  });

  it("keeps designer MCP sandbox feedback reads scoped to the token sandbox instance", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-designer-feedback-scope@example.com",
    });
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "designer",
        sub: "sbi_mcp_designer_feedback_scoped",
        organizationId: session.organizationId,
        designerSessionId: "dsn_mcp_designer_feedback_scope",
      },
      ttlSeconds: 300,
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_feedback_scoped",
      purpose: SandboxInstancePurposes.DESIGNER,
      status: SandboxInstanceStatuses.FAILED,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_mcp_designer_feedback_scope",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_feedback_scoped",
      initialPrompt: null,
      canvasTabs: [],
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_feedback_other",
      purpose: SandboxInstancePurposes.DESIGNER,
      status: SandboxInstanceStatuses.FAILED,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      operationEventRow({
        id: "soe_mcp_designer_feedback_scoped_001",
        sandboxInstanceId: "sbi_mcp_designer_feedback_scoped",
        operationId: "op_mcp_designer_feedback_scoped",
        sequence: 1,
        phase: "setup_script",
        status: "failed",
        message: "designer scoped setup failed",
      }),
      operationEventRow({
        id: "soe_mcp_designer_feedback_other_001",
        sandboxInstanceId: "sbi_mcp_designer_feedback_other",
        operationId: "op_mcp_designer_feedback_other",
        sequence: 1,
        phase: "setup_script",
        status: "failed",
        message: "designer other setup failed",
      }),
    ]);

    const scopedInstanceResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_get",
      arguments: {
        instanceId: "sbi_mcp_designer_feedback_scoped",
      },
    });
    const scopedEventsResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_operation_events_list",
      arguments: {
        instanceId: "sbi_mcp_designer_feedback_scoped",
        operationId: "op_mcp_designer_feedback_scoped",
      },
    });
    const otherInstanceResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_instance_get",
      arguments: {
        instanceId: "sbi_mcp_designer_feedback_other",
      },
    });
    const otherEventsResult = await callMcpTool({
      env,
      token: token.token,
      name: "sandbox_operation_events_list",
      arguments: {
        instanceId: "sbi_mcp_designer_feedback_other",
        operationId: "op_mcp_designer_feedback_other",
      },
    });

    expect(scopedInstanceResult.isError).toBeUndefined();
    expect(scopedEventsResult.isError).toBeUndefined();
    expect(otherInstanceResult.isError).toBe(true);
    expect(otherEventsResult.isError).toBe(true);
    const operationEvents = SandboxOperationEventsResponseSchema.parse(
      scopedEventsResult.structuredContent,
    );
    expect(operationEvents.events.map((event) => event.id)).toEqual([
      "soe_mcp_designer_feedback_scoped_001",
    ]);
  });

  it("rejects designer MCP tokens without a matching Designer session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-designer-session-auth@example.com",
    });
    const missingSessionToken = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "designer",
        sub: "sbi_mcp_designer_missing_session",
        organizationId: session.organizationId,
        designerSessionId: "dsn_mcp_designer_missing_session",
      },
      ttlSeconds: 300,
    });
    const mismatchedSessionToken = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "designer",
        sub: "sbi_mcp_designer_mismatched_claim",
        organizationId: session.organizationId,
        designerSessionId: "dsn_mcp_designer_mismatched_session",
      },
      ttlSeconds: 300,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_mcp_designer_mismatched_session",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_mismatched_actual",
      initialPrompt: null,
      canvasTabs: [],
    });

    const missingSessionResponse = await callMcpJsonRpcResponse({
      env,
      token: missingSessionToken.token,
      id: "mcp-designer-missing-session-test",
      method: "tools/list",
      params: {},
    });
    const mismatchedSessionResponse = await callMcpJsonRpcResponse({
      env,
      token: mismatchedSessionToken.token,
      id: "mcp-designer-mismatched-session-test",
      method: "tools/list",
      params: {},
    });

    expect(missingSessionResponse.status).toBe(401);
    expect(mismatchedSessionResponse.status).toBe(401);
  });

  it("prevents designer MCP tokens from starting profile test sandboxes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-designer-session-create-forbidden@example.com",
    });
    const profileId = "sbp_mcp_designer_session_create_forbidden";
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "designer",
        sub: "sbi_mcp_designer_session_create_forbidden",
        organizationId: session.organizationId,
        designerSessionId: "dsn_mcp_designer_session_create_forbidden",
      },
      ttlSeconds: 300,
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_mcp_designer_session_create_forbidden",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_session_create_forbidden",
      initialPrompt: null,
      canvasTabs: [],
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "MCP Designer Session Create Forbidden Profile",
        createdAt: "2026-05-13T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo persisted",
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-designer-session-create-forbidden",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_designer_session_create_forbidden_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-designer-session-create-forbidden",
        displayName: "MCP Designer Session Create Forbidden Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_designer_session_create_forbidden_agent",
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_designer_session_create_forbidden_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const result = await callMcpTool({
      env,
      token: token.token,
      name: "profile_setup_script_test_start",
      arguments: {
        profileId,
        version: 1,
        setupScript: "echo should not start",
        idempotencyKey: "mcp-designer-session-create-forbidden-001",
      },
    });

    expect(result.isError).toBe(true);
    const startedSandbox = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.sandboxProfileId, profileId),
        ),
    });
    expect(startedSandbox).toBeUndefined();
  });

  it("authorizes profile tools with a gateway-injected MCP token referencing an API key", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-token-profile-list@example.com",
    });
    const apiKeyCredential = await createApiKeyCredential({
      cookie: session.cookie,
      env,
      name: "MCP token profile reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_mcp_token_list",
      organizationId: session.organizationId,
      displayName: "MCP Token List Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const mcpToken = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "api_key",
        sub: "sbi_mcp_token_list",
        organizationId: session.organizationId,
        apiKeyId: apiKeyCredential.apiKey.id,
      },
      ttlSeconds: 300,
    });

    const result = await callMcpTool({
      env,
      token: mcpToken.token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(result.isError).toBeUndefined();
    const profileList = ListSandboxProfilesResponseSchema.parse(result.structuredContent);
    expect(profileList.totalResults).toBe(1);
    expect(profileList.items.map((profile) => profile.id)).toEqual(["sbp_mcp_token_list"]);
  });

  it("authorizes setup assistant MCP tokens for setup tools scoped to the token profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-setup-assistant-capability@example.com",
    });
    const profileId = "sbp_mcp_setup_assistant_capability";
    const sandboxInstanceId = "sbi_mcp_setup_assistant_capability";

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Capability Profile",
        createdAt: "2026-05-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo persisted",
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-setup-assistant-capability",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_setup_assistant_capability_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-setup-assistant-capability",
        displayName: "MCP setup assistant capability agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_setup_assistant_capability_agent",
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_setup_assistant_capability_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: sandboxInstanceId,
        organizationId: session.organizationId,
        sandboxProfileId: profileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    const setupScript = "echo written by setup assistant";
    const putResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_draft_setup_script_put",
      arguments: {
        profileId,
        version: 1,
        setupScript,
      },
    });
    const testRunResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_setup_script_test_start",
      arguments: {
        profileId,
        version: 1,
        setupScript,
        idempotencyKey: "mcp-setup-assistant-capability-test-001",
      },
    });

    expect(putResult.isError).toBeUndefined();
    expect(testRunResult.isError).toBeUndefined();
    const draft = PutSandboxProfileVersionDraftResponseSchema.parse(putResult.structuredContent);
    const startedTestRun = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(
      testRunResult.structuredContent,
    );
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: startedTestRun.sandboxInstanceId,
    });

    expect(draft.setupScript).toBe(setupScript);
    expect(queuedWorkflowInput.startedBy).toEqual({
      kind: "system",
      id: sandboxInstanceId,
    });
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBe(setupScript);
  });

  it("authorizes setup assistant MCP tokens for scoped full sandbox profile draft tools", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-setup-assistant-full-draft-tools@example.com",
    });
    const profileId = "sbp_mcp_setup_assistant_full_draft_tools";

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-setup-assistant-full-draft-tools",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_setup_assistant_full_draft_tools_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-setup-assistant-full-draft-tools",
        displayName: "MCP setup assistant full draft tools agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Full Draft Tools Profile",
        createdAt: "2026-05-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo persisted",
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_setup_assistant_full_draft_tools_agent",
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_setup_assistant_full_draft_tools_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: "sbi_mcp_setup_assistant_full_draft_tools",
        organizationId: session.organizationId,
        sandboxProfileId: profileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    const result = await callMcpTool({
      env,
      token: token.token,
      name: "profile_draft_update",
      arguments: {
        profileId,
        version: 1,
        setupScript: "echo allowed",
      },
    });
    const bindingsResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_version_integration_bindings_get",
      arguments: {
        profileId,
        version: 1,
      },
    });
    const publishabilityResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_version_publishability_get",
      arguments: {
        profileId,
        version: 1,
      },
    });
    const triggerImpactResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_version_draft_trigger_impact_get",
      arguments: {
        profileId,
        version: 1,
      },
    });

    expect(result.isError).toBeUndefined();
    expect(bindingsResult.isError).toBeUndefined();
    expect(publishabilityResult.isError).toBeUndefined();
    expect(triggerImpactResult.isError).toBeUndefined();
    expect(
      GetSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
        bindingsResult.structuredContent,
      ).bindings.map((binding) => binding.connectionId),
    ).toEqual(["icn_mcp_setup_assistant_full_draft_tools_agent"]);
    expect(
      GetSandboxProfileVersionPublishabilityResponseSchema.parse(
        publishabilityResult.structuredContent,
      ).publishable,
    ).toBe(true);
    expect(
      GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
        triggerImpactResult.structuredContent,
      ),
    ).toEqual({
      hasBreakingChanges: false,
      affectedTriggers: [],
    });
    const draft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, profileId), eq(table.version, 1)),
    });
    expect(draft?.setupScript).toBe("echo allowed");
  });

  it("authorizes setup assistant MCP tokens to read only the scoped sandbox profile", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-setup-assistant-read-scope@example.com",
    });
    const scopedProfileId = "sbp_mcp_setup_assistant_read_scope";
    const otherProfileId = "sbp_mcp_setup_assistant_read_other";
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: "sbi_mcp_setup_assistant_read_scope",
        organizationId: session.organizationId,
        sandboxProfileId: scopedProfileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      sandboxProfileRow({
        id: scopedProfileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Read Scope Profile",
        createdAt: "2026-05-06T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: otherProfileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Read Other Profile",
        createdAt: "2026-05-06T01:00:00.000Z",
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: scopedProfileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        setupScript: "echo scoped setup",
        maintenanceScript: "echo scoped maintenance",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: scopedProfileId,
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo other version setup",
        maintenanceScript: "echo other version maintenance",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    ]);

    const scopedGetResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_get",
      arguments: {
        profileId: scopedProfileId,
      },
    });
    const otherGetResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_get",
      arguments: {
        profileId: otherProfileId,
      },
    });
    const listResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });
    const setupScriptResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_setup_script_get",
      arguments: {
        profileId: scopedProfileId,
        version: 1,
      },
    });
    const maintenanceScriptResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_get",
      arguments: {
        profileId: scopedProfileId,
        version: 1,
      },
    });
    const otherVersionSetupScriptResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_setup_script_get",
      arguments: {
        profileId: scopedProfileId,
        version: 2,
      },
    });
    const otherProfileMaintenanceScriptResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_get",
      arguments: {
        profileId: otherProfileId,
        version: 1,
      },
    });

    expect(scopedGetResult.isError).toBeUndefined();
    expect(otherGetResult.isError).toBe(true);
    expect(listResult.isError).toBeUndefined();
    expect(setupScriptResult.isError).toBeUndefined();
    expect(maintenanceScriptResult.isError).toBeUndefined();
    expect(otherVersionSetupScriptResult.isError).toBe(true);
    expect(otherProfileMaintenanceScriptResult.isError).toBe(true);
    const scopedProfile = SandboxProfileSchema.parse(scopedGetResult.structuredContent);
    const profileList = ListSandboxProfilesResponseSchema.parse(listResult.structuredContent);
    const scopedSetupScript = SandboxProfileVersionSetupScriptSchema.parse(
      setupScriptResult.structuredContent,
    );
    const scopedMaintenanceScript = SandboxProfileVersionMaintenanceScriptSchema.parse(
      maintenanceScriptResult.structuredContent,
    );
    expect(scopedProfile.id).toBe(scopedProfileId);
    expect(profileList.totalResults).toBe(1);
    expect(profileList.items.map((profile) => profile.id)).toEqual([scopedProfileId]);
    expect(scopedSetupScript.setupScript).toBe("echo scoped setup");
    expect(scopedMaintenanceScript.maintenanceScript).toBe("echo scoped maintenance");
  });

  it("authorizes setup assistant MCP tokens for maintenance tools scoped to the token profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-maintenance-assistant-capability@example.com",
    });
    const profileId = "sbp_mcp_maintenance_assistant_capability";
    const sandboxInstanceId = "sbi_mcp_maintenance_assistant_capability";

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "MCP Maintenance Assistant Capability Profile",
        activeVersion: 1,
        createdAt: "2026-05-04T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      ...sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        maintenanceScript: "echo persisted maintenance",
        ...DockerSandboxRuntimeColumns,
      }),
      snapshotImageProvider: SandboxProvider.DOCKER,
      snapshotImageId: "sha256:mcp-maintenance-assistant-capability",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-maintenance-assistant-capability",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_maintenance_assistant_capability_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-maintenance-assistant-capability",
        displayName: "MCP maintenance assistant capability agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_maintenance_assistant_capability_agent",
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          connectionId: "icn_mcp_maintenance_assistant_capability_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: sandboxInstanceId,
        organizationId: session.organizationId,
        sandboxProfileId: profileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    const maintenanceScript = "echo written by maintenance assistant";
    const putResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_put",
      arguments: {
        profileId,
        version: 1,
        maintenanceScript,
      },
    });
    const testRunResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_test_start",
      arguments: {
        profileId,
        version: 1,
        maintenanceScript,
        idempotencyKey: "mcp-maintenance-assistant-capability-test-001",
      },
    });

    expect(putResult.isError).toBeUndefined();
    expect(testRunResult.isError).toBeUndefined();
    const updatedScript = SandboxProfileVersionMaintenanceScriptSchema.parse(
      putResult.structuredContent,
    );
    const startedTestRun = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(
      testRunResult.structuredContent,
    );
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: startedTestRun.sandboxInstanceId,
    });

    expect(updatedScript.maintenanceScript).toBe(maintenanceScript);
    expect(queuedWorkflowInput.startedBy).toEqual({
      kind: "system",
      id: sandboxInstanceId,
    });
    expect(queuedWorkflowInput.image).toMatchObject({
      kind: "snapshot",
      imageId: "sha256:mcp-maintenance-assistant-capability",
    });
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBe(maintenanceScript);
  });

  it("rejects setup assistant MCP tokens for another sandbox profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-setup-assistant-capability-scope@example.com",
    });
    const scopedProfileId = "sbp_mcp_setup_assistant_capability_scope";
    const otherProfileId = "sbp_mcp_setup_assistant_capability_other";

    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: "sbi_mcp_setup_assistant_capability_scope",
        organizationId: session.organizationId,
        sandboxProfileId: scopedProfileId,
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      sandboxProfileRow({
        id: scopedProfileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Capability Scope Profile",
        activeVersion: 3,
        createdAt: "2026-05-05T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: otherProfileId,
        organizationId: session.organizationId,
        displayName: "MCP Setup Assistant Capability Other Profile",
        createdAt: "2026-05-05T01:00:00.000Z",
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: scopedProfileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        setupScript: "echo scoped version",
        ...DockerSandboxRuntimeColumns,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: scopedProfileId,
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo valid wrong version draft",
        ...DockerSandboxRuntimeColumns,
      }),
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: scopedProfileId,
          version: 3,
          state: SandboxProfileVersionStates.PUBLISHED,
          maintenanceScript: "echo valid wrong version maintenance",
          ...DockerSandboxRuntimeColumns,
        }),
        snapshotImageProvider: SandboxProvider.DOCKER,
        snapshotImageId: "sha256:mcp-setup-assistant-scope-wrong-version",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: otherProfileId,
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo valid wrong profile draft",
        maintenanceScript: "echo valid wrong profile maintenance",
        ...DockerSandboxRuntimeColumns,
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-mcp-setup-assistant-capability-scope",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_mcp_setup_assistant_capability_scope_agent",
        organizationId: session.organizationId,
        targetKey: "openai-mcp-setup-assistant-capability-scope",
        displayName: "MCP setup assistant scope agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_mcp_setup_assistant_capability_scope_agent",
          sandboxProfileId: scopedProfileId,
          sandboxProfileVersion: 3,
          connectionId: "icn_mcp_setup_assistant_capability_scope_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const profileResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_draft_setup_script_put",
      arguments: {
        profileId: otherProfileId,
        version: 1,
        setupScript: "echo wrong profile",
      },
    });
    const versionResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_draft_setup_script_put",
      arguments: {
        profileId: scopedProfileId,
        version: 2,
        setupScript: "echo wrong version",
      },
    });
    const maintenanceProfileResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_put",
      arguments: {
        profileId: otherProfileId,
        version: 1,
        maintenanceScript: "echo wrong maintenance profile",
      },
    });
    const maintenanceVersionResult = await callMcpTool({
      env,
      token: token.token,
      name: "profile_maintenance_script_test_start",
      arguments: {
        profileId: scopedProfileId,
        version: 3,
        maintenanceScript: "echo wrong maintenance version",
      },
    });

    expect(profileResult.isError).toBe(true);
    expect(versionResult.isError).toBe(true);
    expect(maintenanceProfileResult.isError).toBe(true);
    expect(maintenanceVersionResult.isError).toBe(true);

    const otherProfileVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, otherProfileId), eq(table.version, 1)),
    });
    const wrongVersionDraft = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, scopedProfileId), eq(table.version, 2)),
    });
    expect(otherProfileVersion?.setupScript).toBe("echo valid wrong profile draft");
    expect(otherProfileVersion?.maintenanceScript).toBe("echo valid wrong profile maintenance");
    expect(wrongVersionDraft?.setupScript).toBe("echo valid wrong version draft");
  });

  it("returns a tool error when the API key lacks sandbox profile read permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP organization reader",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "profile_list",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });

  it("returns a tool error when the API key lacks sandbox profile update permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-update-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "profile_draft_setup_script_put",
      arguments: {
        profileId: "sbp_mcp_update_forbidden",
        version: 1,
        setupScript: "pnpm install",
      },
    });

    expect(result.isError).toBe(true);
  });
});

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];
type SandboxOperationEventRow = DataPlaneTables["sandboxOperationEvents"]["$inferInsert"];

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    sandboxProfileId?: string;
    sandboxProfileVersion?: number;
    purpose?: SandboxInstanceRow["purpose"];
    status?: SandboxInstanceRow["status"];
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId ?? `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: input.sandboxProfileVersion ?? 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: input.status ?? SandboxInstanceStatuses.PENDING,
    startedByKind: "api_key",
    startedById: "apk_mcp_feedback",
    source: SandboxInstanceSources.DASHBOARD,
    purpose: input.purpose ?? SandboxInstancePurposes.SETUP_CHECK,
    failureCode: input.status === SandboxInstanceStatuses.FAILED ? "SETUP_SCRIPT_FAILED" : null,
    failureMessage:
      input.status === SandboxInstanceStatuses.FAILED ? "Setup script exited with code 1." : null,
  } satisfies SandboxInstanceRow);
}

function operationEventRow(
  input: Partial<SandboxOperationEventRow> & {
    id: string;
    sandboxInstanceId: string;
    operationId: string;
    sequence: number;
  },
): SandboxOperationEventRow {
  return {
    operationKind: "setup_check",
    recordKind: "lifecycle",
    observedAt: "2026-05-13T00:00:00.000Z",
    source: "sandboxd",
    phase: "setup_script",
    status: "started",
    stream: null,
    message: "setup script event",
    payloadBytes: null,
    attributes: {},
    ...input,
  };
}
