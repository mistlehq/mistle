import { EgressCredentialRouteSchema } from "@mistle/integrations-core";
import { z } from "zod";

export const InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    integrationConnectionId: z.string().min(1),
    providerToolIds: z.array(z.string().min(1)).min(1).max(20),
    targetUrl: z.url(),
    method: z.string().min(1),
    transport: z.enum(["http", "websocket"]),
  })
  .strict();

export const InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteResponseSchema = z
  .object({
    route: EgressCredentialRouteSchema,
  })
  .strict();
