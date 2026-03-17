import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const NotionCredentialSecretTypes = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
} as const;

export const NotionConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2),
    workspace_id: z.string().min(1).optional(),
    workspace_name: z.string().min(1).optional(),
  })
  .loose();

export type NotionConnectionConfig = z.output<typeof NotionConnectionConfigSchema>;

export function resolveNotionCredentialSecretType(input: unknown): "oauth2_access_token" {
  const parsedConnectionConfig = NotionConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.OAUTH2) {
    return NotionCredentialSecretTypes.OAUTH2_ACCESS_TOKEN;
  }

  throw new Error(
    `Unsupported Notion connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
