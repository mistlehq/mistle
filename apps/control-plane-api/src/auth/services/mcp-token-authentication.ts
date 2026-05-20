import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { McpTokenError, verifyMcpToken } from "@mistle/gateway-tunnel-auth";
import { UnauthorizedError } from "@mistle/http/errors.js";

import type { AppAuthContext, ControlPlaneApiConfig } from "../../types.js";
import { authenticateApiKeyReference } from "./api-key-authentication.js";

export async function authenticateMcpToken(input: {
  db: ControlPlaneDatabase;
  token: string;
  config: ControlPlaneApiConfig["mcp"]["auth"];
}): Promise<Extract<AppAuthContext, { kind: "api_key" }>> {
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

  return authenticateApiKeyReference({
    db: input.db,
    apiKeyId: verifiedToken.apiKeyId,
    organizationId: verifiedToken.organizationId,
  });
}
