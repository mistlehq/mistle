import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { getProfileVersionMaintenanceScript } from "../../sandbox-profiles/services/get-profile-version-maintenance-script.js";
import { getProfileVersionSetupScript } from "../../sandbox-profiles/services/get-profile-version-setup-script.js";
import { getProfile } from "../../sandbox-profiles/services/get-profile.js";
import { listProfiles } from "../../sandbox-profiles/services/list-profiles.js";
import { putProfileVersionDraft } from "../../sandbox-profiles/services/put-profile-version-draft.js";
import { putProfileVersionMaintenanceScript } from "../../sandbox-profiles/services/put-profile-version-maintenance-script.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpListSandboxProfilesInputSchema,
  mcpProfileDraftSetupScriptPutInputSchema,
  mcpProfileMaintenanceScriptPutInputSchema,
  mcpSandboxProfileIdParamsSchema,
  mcpSandboxProfileVersionParamsSchema,
} from "../tool-schemas.js";
import {
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

      if (context.organizationActor.kind === "mcp_capability") {
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
      if (context.organizationActor.kind === "mcp_capability") {
        requireMcpSandboxProfileScope(context.organizationActor, {
          profileId,
          version: context.organizationActor.capability.sandboxProfileVersion,
        });
      }

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
