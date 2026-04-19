import { z } from "@hono/zod-openapi";

import { ResolveIntegrationCredentialResponseSchema } from "../../integration-credentials/resolve-integration-credential/schema.js";

export const ResolvePrincipalCredentialRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    actingUserId: z.string().min(1),
    providerFamily: z.string().min(1),
    credentialKind: z.string().min(1).optional(),
  })
  .strict();

export { ResolveIntegrationCredentialResponseSchema as ResolvePrincipalCredentialResponseSchema };
