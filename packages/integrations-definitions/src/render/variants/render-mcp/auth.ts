import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const RenderFamilyId = "render";
export const RenderMcpVariantId = "render-mcp";

export const RenderCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const RenderCredentialSlotKeys = {
  API_KEY: "render.render-mcp.api-key.api-key",
} as const;

export const RenderConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type RenderConnectionConfig = z.output<typeof RenderConnectionConfigSchema>;
