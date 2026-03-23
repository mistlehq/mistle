import { z } from "@hono/zod-openapi";

export {
  RefreshIntegrationConnectionResourcesBadRequestResponseSchema as InternalRefreshIntegrationConnectionResourcesBadRequestResponseSchema,
  RefreshIntegrationConnectionResourcesNotFoundResponseSchema as InternalRefreshIntegrationConnectionResourcesNotFoundResponseSchema,
  RefreshIntegrationConnectionResourcesResponseSchema as InternalRefreshIntegrationConnectionResourcesResponseSchema,
} from "../../../integration-connections/refresh-integration-connection-resources/schema.js";

export const InternalRefreshIntegrationConnectionResourcesRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    connectionId: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();
