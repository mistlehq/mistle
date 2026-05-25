import { z } from "@hono/zod-openapi";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import {
  listSandboxProfilesQuerySchema,
  listSandboxProfilesResponseSchema,
  sandboxProfileVersionMaintenanceScriptSchema,
  putSandboxProfileVersionDraftResponseSchema,
  sandboxProfileIdParamsSchema,
  sandboxProfileVersionParamsSchema,
  sandboxProfileSchema,
} from "../../sandbox-profiles/schemas.js";
import { getProfile } from "../../sandbox-profiles/services/get-profile.js";
import { listProfiles } from "../../sandbox-profiles/services/list-profiles.js";
import { putProfileVersionDraft } from "../../sandbox-profiles/services/put-profile-version-draft.js";
import { putProfileVersionMaintenanceScript } from "../../sandbox-profiles/services/put-profile-version-maintenance-script.js";
import type { MistleMcpServerContext } from "../server.js";
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

const profileDraftSetupScriptPutInputSchema = sandboxProfileVersionParamsSchema
  .extend({
    setupScript: z.string().min(1).nullable(),
  })
  .strict();

const profileMaintenanceScriptPutInputSchema = sandboxProfileVersionParamsSchema
  .extend({
    maintenanceScript: z.string().min(1).nullable(),
  })
  .strict();

export function registerProfileTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "profile_list",
    {
      title: "List sandbox profiles",
      description: "List sandbox profiles available to the current Mistle actor",
      inputSchema: listSandboxProfilesQuerySchema,
      outputSchema: listSandboxProfilesResponseSchema,
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
          ...input,
          organizationId: context.organizationActor.organizationId,
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
      inputSchema: sandboxProfileIdParamsSchema,
      outputSchema: sandboxProfileSchema,
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
    "profile_draft_setup_script_put",
    {
      title: "Put sandbox profile draft setup script",
      description: "Update the setup script for a sandbox profile draft version",
      inputSchema: profileDraftSetupScriptPutInputSchema,
      outputSchema: putSandboxProfileVersionDraftResponseSchema,
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
    "profile_maintenance_script_put",
    {
      title: "Put sandbox profile maintenance script",
      description: "Update the snapshot maintenance script for a sandbox profile version",
      inputSchema: profileMaintenanceScriptPutInputSchema,
      outputSchema: sandboxProfileVersionMaintenanceScriptSchema,
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
