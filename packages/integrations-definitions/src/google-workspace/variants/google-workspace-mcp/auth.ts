import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleWorkspaceFamilyId = "google-workspace";
export const GoogleWorkspaceMcpVariantId = "google-workspace-mcp";

export const GoogleWorkspaceCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
  SERVICE_ACCOUNT_KEY_JSON: "api_key";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  SERVICE_ACCOUNT_KEY_JSON: "api_key",
};

export const GoogleWorkspaceCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GoogleWorkspaceFamilyId,
  variantId: GoogleWorkspaceMcpVariantId,
});

export const GoogleWorkspaceServiceAccountCredentialSlotKeys: {
  SERVICE_ACCOUNT_KEY_JSON: "google-workspace.google-workspace-mcp.service-account-key-json";
} = {
  SERVICE_ACCOUNT_KEY_JSON: "google-workspace.google-workspace-mcp.service-account-key-json",
};

export const GoogleWorkspaceConnectionMethodIds: {
  OAUTH2_AUTHORIZATION_CODE: typeof IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE;
  SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION: "google-workspace-service-account-domain-wide-delegation";
} = {
  OAUTH2_AUTHORIZATION_CODE: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
  SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION: "google-workspace-service-account-domain-wide-delegation",
};

export const GoogleWorkspaceOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.messages.create",
  "https://www.googleapis.com/auth/chat.users.readstate.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
];

export const GoogleWorkspaceConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const GoogleWorkspaceConnectionConfigSchema = z
  .object({
    connection_method: z.literal(GoogleWorkspaceConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export const GoogleWorkspaceServiceAccountConnectionConfigSchema = z
  .object({
    connection_method: z.literal(
      GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
    ),
  })
  .strict();

export const GoogleWorkspaceAnyConnectionConfigSchema = z.discriminatedUnion("connection_method", [
  GoogleWorkspaceConnectionConfigSchema,
  GoogleWorkspaceServiceAccountConnectionConfigSchema,
]);

export type GoogleWorkspaceConnectionStartConfig = z.output<
  typeof GoogleWorkspaceConnectionStartConfigSchema
>;
export type GoogleWorkspaceConnectionConfig = z.output<
  typeof GoogleWorkspaceAnyConnectionConfigSchema
>;
export type GoogleWorkspaceServiceAccountConnectionConfig = z.output<
  typeof GoogleWorkspaceServiceAccountConnectionConfigSchema
>;
