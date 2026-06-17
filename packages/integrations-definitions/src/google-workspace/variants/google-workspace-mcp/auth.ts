import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleWorkspaceFamilyId = "google-workspace";
export const GoogleWorkspaceMcpVariantId = "google-workspace-mcp";

export const GoogleWorkspaceCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const GoogleWorkspaceCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GoogleWorkspaceFamilyId,
  variantId: GoogleWorkspaceMcpVariantId,
});

export const GoogleWorkspaceOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.messages.readonly",
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
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type GoogleWorkspaceConnectionStartConfig = z.output<
  typeof GoogleWorkspaceConnectionStartConfigSchema
>;
export type GoogleWorkspaceConnectionConfig = z.output<
  typeof GoogleWorkspaceConnectionConfigSchema
>;
