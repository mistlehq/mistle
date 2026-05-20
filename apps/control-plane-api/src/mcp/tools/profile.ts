import { ForbiddenError } from "@mistle/http/errors.js";
import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import {
  OrganizationPermissions,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";
import {
  listSandboxProfilesQuerySchema,
  listSandboxProfilesResponseSchema,
  sandboxProfileIdParamsSchema,
  sandboxProfileSchema,
} from "../../sandbox-profiles/schemas.js";
import { getProfile } from "../../sandbox-profiles/services/get-profile.js";
import { listProfiles } from "../../sandbox-profiles/services/list-profiles.js";
import type { AppOrganizationActor } from "../../types.js";
import type { MistleMcpServerContext } from "../server.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
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
}

function structuredResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
  };
}

function requireMcpToolPermission(
  organizationActor: AppOrganizationActor,
  permission: OrganizationPermission,
): void {
  if (!organizationActor.permissions.includes(permission)) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
