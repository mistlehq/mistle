import { z } from "zod";

import type { CredentialCache } from "../../egress/credential-cache.js";
import type { DataPlaneGatewayApp } from "../../types.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const CredentialCacheInvalidationRoutePath = "/internal/egress/credential-cache/invalidate";

const CredentialCacheInvalidationRequestSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

type RegisterCredentialCacheInvalidationRouteInput = {
  app: DataPlaneGatewayApp;
  credentialCache: CredentialCache;
  internalAuthServiceToken: string;
};

export function registerCredentialCacheInvalidationRoute(
  input: RegisterCredentialCacheInvalidationRouteInput,
): void {
  input.app.post(CredentialCacheInvalidationRoutePath, async (ctx) => {
    const providedServiceToken = ctx.req.header(DataPlaneInternalAuthHeader);
    if (
      providedServiceToken === undefined ||
      providedServiceToken !== input.internalAuthServiceToken
    ) {
      return ctx.json(
        {
          code: "UNAUTHORIZED",
          message: "Internal service authentication failed.",
        },
        401,
      );
    }

    const requestJson: unknown = await ctx.req.json().catch(() => null);
    const parsedRequest = CredentialCacheInvalidationRequestSchema.safeParse(requestJson);
    if (!parsedRequest.success) {
      return ctx.json(
        {
          code: "INVALID_REQUEST",
          message: "Credential cache invalidation request body is invalid.",
          issues: parsedRequest.error.issues,
        },
        400,
      );
    }

    const testEnvironmentId = ctx.get("testEnvironmentId");
    const result = await input.credentialCache.invalidateIntegrationConnection({
      connectionId: parsedRequest.data.connectionId,
      ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
    });

    return ctx.json(
      {
        status: "ok",
        deletedEntryCount: result.deletedEntryCount,
      },
      200,
    );
  });
}
