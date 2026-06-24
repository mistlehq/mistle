import type { IntegrationBindingKind } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { createProfileVersionDraft } from "../../sandbox-profiles/services/create-profile-version-draft.js";
import { createProfile } from "../../sandbox-profiles/services/create-profile.js";
import { discardProfileVersionDraft } from "../../sandbox-profiles/services/discard-profile-version-draft.js";
import { evaluateProfileVersionDraftTriggerImpact } from "../../sandbox-profiles/services/evaluate-profile-version-draft-trigger-impact.js";
import { getProfileVersionIntegrationBindings } from "../../sandbox-profiles/services/get-profile-version-integration-bindings.js";
import { getProfileVersionMaintenanceScript } from "../../sandbox-profiles/services/get-profile-version-maintenance-script.js";
import { getProfileVersionPublishability } from "../../sandbox-profiles/services/get-profile-version-publishability.js";
import { getProfileVersionSetupScript } from "../../sandbox-profiles/services/get-profile-version-setup-script.js";
import { getProfile } from "../../sandbox-profiles/services/get-profile.js";
import { listProfiles } from "../../sandbox-profiles/services/list-profiles.js";
import { publishProfileVersion } from "../../sandbox-profiles/services/publish-profile-version.js";
import { putProfileVersionDraft } from "../../sandbox-profiles/services/put-profile-version-draft.js";
import { putProfileVersionMaintenanceScript } from "../../sandbox-profiles/services/put-profile-version-maintenance-script.js";
import { updateProfile } from "../../sandbox-profiles/services/update-profile.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpCreateSandboxProfileInputSchema,
  mcpListSandboxProfilesInputSchema,
  mcpProfileDraftSetupScriptPutInputSchema,
  mcpProfileMaintenanceScriptPutInputSchema,
  mcpSandboxProfileDraftUpdateInputSchema,
  mcpSandboxProfileIdParamsSchema,
  mcpSandboxProfileVersionParamsSchema,
  mcpUpdateSandboxProfileInputSchema,
} from "../tool-schemas.js";
import {
  requireMcpSandboxProfileIdScope,
  requireMcpSandboxProfileScope,
  requireMcpToolPermission,
  structuredResult,
} from "./shared.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const MutatingToolAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerProfileTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "profile_create",
    {
      title: "Create sandbox profile",
      description:
        "Create a sandbox profile with an initial draft sandbox profile version. Use this when the aligned setup requires a new profile rather than editing an existing one.",
      inputSchema: mcpCreateSandboxProfileInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Create sandbox profile",
      },
    },
    async ({ displayName, sandboxProvider, sandboxResources }) => {
      requireMcpSandboxProviderForResources({
        sandboxProvider,
        sandboxResources,
      });
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_CREATE,
      );

      const profile = await createProfile(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          sandboxConfig: context.sandboxConfig,
        },
        {
          displayName,
          organizationId: context.organizationActor.organizationId,
          ...(sandboxProvider === undefined ? {} : { sandboxProvider }),
          ...(sandboxResources === undefined ? {} : { sandboxResources }),
        },
      );

      return structuredResult(profile);
    },
  );

  server.registerTool(
    "profile_list",
    {
      title: "List sandbox profiles",
      description: "List sandbox profiles available to the current Mistle actor",
      inputSchema: mcpListSandboxProfilesInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List sandbox profiles",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );

      if (
        context.organizationActor.kind === "mcp_capability" &&
        context.organizationActor.capability.kind === "setup_assistant"
      ) {
        const profile = await getProfile(
          {
            db: context.db,
          },
          {
            organizationId: context.organizationActor.organizationId,
            profileId: context.organizationActor.capability.sandboxProfileId,
          },
        );

        return structuredResult({
          totalResults: 1,
          items: [profile],
          nextPage: null,
          previousPage: null,
        });
      }

      const result = await listProfiles(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          after: input.after,
          before: input.before,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
      );

      return structuredResult(result);
    },
  );

  server.registerTool(
    "profile_get",
    {
      title: "Get a sandbox profile",
      description: "Get a sandbox profile by id using the current Mistle actor",
      inputSchema: mcpSandboxProfileIdParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get a sandbox profile",
      },
    },
    async ({ profileId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileIdScope(context.organizationActor, {
        profileId,
      });

      const profile = await getProfile(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
        },
      );

      return structuredResult(profile);
    },
  );

  server.registerTool(
    "profile_update",
    {
      title: "Update sandbox profile",
      description:
        "Update sandbox profile metadata. This does not change a sandbox profile version's saved configuration.",
      inputSchema: mcpUpdateSandboxProfileInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Update sandbox profile",
      },
    },
    async ({ displayName, profileId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileIdScope(context.organizationActor, {
        profileId,
      });

      const profile = await updateProfile(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          displayName,
        },
      );

      return structuredResult(profile);
    },
  );

  server.registerTool(
    "profile_draft_create",
    {
      title: "Create sandbox profile draft",
      description:
        "Create a draft sandbox profile version by cloning the profile's latest version. Use this before editing an existing profile that has no current draft.",
      inputSchema: mcpSandboxProfileIdParamsSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Create sandbox profile draft",
      },
    },
    async ({ profileId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileIdScope(context.organizationActor, {
        profileId,
      });

      const draft = await createProfileVersionDraft(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
        },
      );

      return structuredResult(draft);
    },
  );

  server.registerTool(
    "profile_draft_update",
    {
      title: "Update sandbox profile draft",
      description:
        "Update saved sandbox profile version configuration on an existing draft. Omitted fields are preserved. If integrationBindings is provided, it replaces the draft's complete integration binding set.",
      inputSchema: mcpSandboxProfileDraftUpdateInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Update sandbox profile draft",
      },
    },
    async ({
      agentRuntimeId,
      associatedResourceEventRoutingConfig,
      gitCommitSigningIntegrationConnectionId,
      integrationBindings,
      mistleMcpApiKeyId,
      mistleMcpEnabled,
      profileId,
      sandboxConnectionId,
      sandboxProvider,
      sandboxResources,
      setupScript,
      skillsConfig,
      version,
    }) => {
      requireMcpDraftUpdateField({
        agentRuntimeId,
        associatedResourceEventRoutingConfig,
        gitCommitSigningIntegrationConnectionId,
        integrationBindings,
        mistleMcpApiKeyId,
        mistleMcpEnabled,
        sandboxConnectionId,
        sandboxProvider,
        sandboxResources,
        setupScript,
        skillsConfig,
      });
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const draft = await putProfileVersionDraft(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          sandboxConfig: context.sandboxConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
          ...(setupScript === undefined ? {} : { setupScript }),
          ...(agentRuntimeId === undefined ? {} : { agentRuntimeId }),
          ...(gitCommitSigningIntegrationConnectionId === undefined
            ? {}
            : { gitCommitSigningIntegrationConnectionId }),
          ...(mistleMcpEnabled === undefined ? {} : { mistleMcpEnabled }),
          ...(mistleMcpApiKeyId === undefined ? {} : { mistleMcpApiKeyId }),
          ...(sandboxProvider === undefined ? {} : { sandboxProvider }),
          ...(sandboxConnectionId === undefined ? {} : { sandboxConnectionId }),
          ...(sandboxResources === undefined ? {} : { sandboxResources }),
          ...(skillsConfig === undefined ? {} : { skillsConfig }),
          ...(associatedResourceEventRoutingConfig === undefined
            ? {}
            : { associatedResourceEventRoutingConfig }),
          ...(integrationBindings === undefined
            ? {}
            : {
                integrationBindings:
                  mapMcpSandboxProfileVersionIntegrationBindings(integrationBindings),
              }),
        },
      );

      return structuredResult(draft);
    },
  );

  server.registerTool(
    "profile_version_integration_bindings_get",
    {
      title: "Get sandbox profile version integration bindings",
      description:
        "Get the complete integration binding set for a sandbox profile version. Read this before replacing integrationBindings on a draft so unrelated bindings can be preserved.",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox profile version integration bindings",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const bindings = await getProfileVersionIntegrationBindings(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(bindings);
    },
  );

  server.registerTool(
    "profile_version_publishability_get",
    {
      title: "Get sandbox profile version publishability",
      description:
        "Get whether a sandbox profile draft version can be published and the issues blocking publish.",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox profile version publishability",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const publishability = await getProfileVersionPublishability(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          sandboxConfig: context.sandboxConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(publishability);
    },
  );

  server.registerTool(
    "profile_version_draft_trigger_impact_get",
    {
      title: "Get sandbox profile draft trigger impact",
      description:
        "Get existing triggers that would be affected by publishing the draft sandbox profile version.",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox profile draft trigger impact",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const impact = await evaluateProfileVersionDraftTriggerImpact(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(impact);
    },
  );

  server.registerTool(
    "profile_version_publish",
    {
      title: "Publish sandbox profile version",
      description:
        "Publish a draft sandbox profile version and create or reuse its snapshot. Publishing does not start a sandbox session.",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Publish sandbox profile version",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const published = await publishProfileVersion(
        {
          db: context.db,
          dataPlaneClient: context.dataPlaneClient,
          integrationsConfig: context.integrationsConfig,
          integrationRegistry: context.integrationRegistry,
          mcpConfig: context.mcpConfig,
          sandboxConfig: context.sandboxConfig,
          defaultBaseImage: context.sandboxConfig.defaultBaseImage,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(published);
    },
  );

  server.registerTool(
    "profile_draft_discard",
    {
      title: "Discard sandbox profile draft",
      description:
        "Discard a draft sandbox profile version. Draft-only profiles cannot discard their only version.",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Discard sandbox profile draft",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const discarded = await discardProfileVersionDraft(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(discarded);
    },
  );

  server.registerTool(
    "profile_setup_script_get",
    {
      title: "Get sandbox profile setup script",
      description: "Get the setup script for a sandbox profile version",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox profile setup script",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const setupScript = await getProfileVersionSetupScript(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(setupScript);
    },
  );

  server.registerTool(
    "profile_draft_setup_script_put",
    {
      title: "Put sandbox profile draft setup script",
      description: "Update the setup script for a sandbox profile draft version",
      inputSchema: mcpProfileDraftSetupScriptPutInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Put sandbox profile draft setup script",
      },
    },
    async ({ profileId, version, setupScript }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const draft = await putProfileVersionDraft(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          sandboxConfig: context.sandboxConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
          setupScript,
        },
      );

      return structuredResult(draft);
    },
  );

  server.registerTool(
    "profile_maintenance_script_get",
    {
      title: "Get sandbox profile maintenance script",
      description: "Get the snapshot maintenance script for a sandbox profile version",
      inputSchema: mcpSandboxProfileVersionParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox profile maintenance script",
      },
    },
    async ({ profileId, version }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const maintenanceScript = await getProfileVersionMaintenanceScript(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
        },
      );

      return structuredResult(maintenanceScript);
    },
  );

  server.registerTool(
    "profile_maintenance_script_put",
    {
      title: "Put sandbox profile maintenance script",
      description: "Update the snapshot maintenance script for a sandbox profile version",
      inputSchema: mcpProfileMaintenanceScriptPutInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Put sandbox profile maintenance script",
      },
    },
    async ({ profileId, version, maintenanceScript }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const updatedScript = await putProfileVersionMaintenanceScript(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
          maintenanceScript,
        },
      );

      return structuredResult(updatedScript);
    },
  );
}

function mapMcpSandboxProfileVersionIntegrationBindings(input: {
  bindings: Array<{
    id?: string | undefined;
    clientRef?: string | undefined;
    connectionId: string;
    kind: IntegrationBindingKind;
    config: Record<string, unknown>;
  }>;
}): {
  bindings: Array<{
    id?: string;
    clientRef?: string;
    connectionId: string;
    kind: IntegrationBindingKind;
    config: Record<string, unknown>;
  }>;
} {
  return {
    bindings: input.bindings.map((binding) => ({
      connectionId: binding.connectionId,
      kind: binding.kind,
      config: binding.config,
      ...(binding.id === undefined ? {} : { id: binding.id }),
      ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
    })),
  };
}

function requireMcpSandboxProviderForResources(input: {
  sandboxProvider: string | undefined;
  sandboxResources: object | null | undefined;
}): void {
  if (input.sandboxResources === undefined || input.sandboxProvider !== undefined) {
    return;
  }

  throw new BadRequestError("BAD_REQUEST", "Sandbox resources require a sandbox provider.");
}

function requireMcpDraftUpdateField(input: {
  setupScript: string | null | undefined;
  agentRuntimeId: string | undefined;
  gitCommitSigningIntegrationConnectionId: string | null | undefined;
  mistleMcpEnabled: boolean | undefined;
  mistleMcpApiKeyId: string | null | undefined;
  sandboxProvider: string | undefined;
  sandboxConnectionId: string | null | undefined;
  sandboxResources: object | null | undefined;
  skillsConfig: object | null | undefined;
  associatedResourceEventRoutingConfig: object | undefined;
  integrationBindings: object | undefined;
}): void {
  if (
    input.setupScript !== undefined ||
    input.agentRuntimeId !== undefined ||
    input.gitCommitSigningIntegrationConnectionId !== undefined ||
    input.mistleMcpEnabled !== undefined ||
    input.mistleMcpApiKeyId !== undefined ||
    input.sandboxProvider !== undefined ||
    input.sandboxConnectionId !== undefined ||
    input.sandboxResources !== undefined ||
    input.skillsConfig !== undefined ||
    input.associatedResourceEventRoutingConfig !== undefined ||
    input.integrationBindings !== undefined
  ) {
    return;
  }

  throw new BadRequestError("BAD_REQUEST", "At least one draft field must be provided.");
}
