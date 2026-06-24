import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { McpTokenError, verifyMcpToken } from "@mistle/gateway-tunnel-auth";
import { UnauthorizedError } from "@mistle/http/errors.js";

import type { AppAuthContext, ControlPlaneApiConfig } from "../../types.js";
import { authenticateApiKeyReference } from "./api-key-authentication.js";
import { OrganizationPermissions } from "./organization-policy.js";

export async function authenticateMcpToken(input: {
  db: ControlPlaneDatabase;
  token: string;
  config: ControlPlaneApiConfig["mcp"]["auth"];
}): Promise<Extract<AppAuthContext, { kind: "api_key" | "mcp_capability" }>> {
  let verifiedToken;
  try {
    verifiedToken = await verifyMcpToken({
      token: input.token,
      config: {
        tokenSecret: input.config.secret,
        tokenIssuer: input.config.issuer,
        tokenAudience: input.config.audience,
      },
    });
  } catch (error) {
    if (error instanceof McpTokenError) {
      throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized MCP request.");
    }

    throw error;
  }

  if (verifiedToken.kind === "api_key") {
    return authenticateApiKeyReference({
      db: input.db,
      apiKeyId: verifiedToken.apiKeyId,
      organizationId: verifiedToken.organizationId,
    });
  }

  if (verifiedToken.kind === "designer") {
    const designerSession = await input.db.query.designerSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, verifiedToken.designerSessionId),
          eq(table.organizationId, verifiedToken.organizationId),
          eq(table.sandboxInstanceId, verifiedToken.sub),
        ),
    });
    if (designerSession === undefined) {
      throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized MCP request.");
    }

    return {
      kind: "mcp_capability",
      organizationId: verifiedToken.organizationId,
      capability: {
        kind: "designer",
        sandboxInstanceId: verifiedToken.sub,
      },
      permissions: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_READ,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
        OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
        OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
        OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_READ,
        OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_CREATE,
        OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_UPDATE,
        OrganizationPermissions.CREDENTIAL_KEY_READ,
        OrganizationPermissions.TRIGGER_READ,
        OrganizationPermissions.TRIGGER_CREATE,
        OrganizationPermissions.TRIGGER_UPDATE,
      ],
    };
  }

  return {
    kind: "mcp_capability",
    organizationId: verifiedToken.organizationId,
    capability: {
      kind: "setup_assistant",
      sandboxInstanceId: verifiedToken.sub,
      sandboxProfileId: verifiedToken.sandboxProfileId,
      sandboxProfileVersion: verifiedToken.sandboxProfileVersion,
    },
    permissions: [
      OrganizationPermissions.SANDBOX_PROFILE_READ,
      OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      OrganizationPermissions.SANDBOX_SESSION_CREATE,
      OrganizationPermissions.SANDBOX_SESSION_READ,
      OrganizationPermissions.SANDBOX_SESSION_CONNECT,
    ],
  };
}
