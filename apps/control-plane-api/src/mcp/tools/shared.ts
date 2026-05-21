import { ForbiddenError } from "@mistle/http/errors.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import type { AppOrganizationActor } from "../../types.js";

export function structuredResult(structuredContent: Record<string, unknown>): CallToolResult {
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

export function requireMcpToolPermission(
  organizationActor: AppOrganizationActor,
  permission: OrganizationPermission,
): void {
  if (!organizationActor.permissions.includes(permission)) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
