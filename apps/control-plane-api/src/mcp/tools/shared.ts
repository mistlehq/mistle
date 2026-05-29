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
    throw new ForbiddenError("FORBIDDEN", `Missing required MCP permission: ${permission}.`);
  }
}

export function requireMcpSandboxProfileScope(
  organizationActor: AppOrganizationActor,
  input: {
    profileId: string;
    version: number;
  },
): void {
  if (organizationActor.kind !== "mcp_capability") {
    return;
  }

  if (
    organizationActor.capability.sandboxProfileId !== input.profileId ||
    organizationActor.capability.sandboxProfileVersion !== input.version
  ) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}

export function requireMcpSandboxInstanceProfileScope(
  organizationActor: AppOrganizationActor,
  input: {
    sandboxProfileId: string | undefined;
    sandboxProfileVersion: number | undefined;
  },
): void {
  if (organizationActor.kind !== "mcp_capability") {
    return;
  }

  if (
    input.sandboxProfileId !== organizationActor.capability.sandboxProfileId ||
    input.sandboxProfileVersion !== organizationActor.capability.sandboxProfileVersion
  ) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}

export function requireMcpSandboxInstanceScope(
  organizationActor: AppOrganizationActor,
  input: {
    sandboxInstanceId: string;
  },
): void {
  if (organizationActor.kind !== "mcp_capability") {
    return;
  }

  if (input.sandboxInstanceId !== organizationActor.capability.sandboxInstanceId) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
