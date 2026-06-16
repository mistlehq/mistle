import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const AgentMailFamilyId = "agentmail";
export const AgentMailMcpVariantId = "agentmail-mcp";
export const AgentMailMcpIssuerUrl = "https://mcp.agentmail.to";
export const AgentMailMcpUrl = "https://mcp.agentmail.to/mcp";
export const AgentMailMcpResourceUrl = AgentMailMcpUrl;

export const AgentMailCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const AgentMailCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: AgentMailFamilyId,
  variantId: AgentMailMcpVariantId,
});

export const AgentMailMcpOAuthScopes = ["email", "profile", "user:org:read", "offline_access"];

export const AgentMailConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type AgentMailConnectionConfig = z.output<typeof AgentMailConnectionConfigSchema>;
