import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../services/errors.js";
import { resolveInternalIntegrationTargetSecrets } from "../services/resolve-target-secrets.js";
import { route } from "./route.js";
import { ResolveIntegrationTargetSecretsRequestSchema } from "./schema.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const requestBody = await ctx.req
    .json()
    .catch((): unknown => ({ __parseError: "invalid_json_body" }));
  const parsedInput = ResolveIntegrationTargetSecretsRequestSchema.safeParse(requestBody);
  if (!parsedInput.success) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.INVALID_RESOLVE_INPUT,
      400,
      "Target secrets resolve request body is invalid.",
    );
  }

  const integrationsConfig = ctx.get("config").integrations;
  const resolvedTargetSecrets = resolveInternalIntegrationTargetSecrets(
    {
      integrationsConfig,
    },
    parsedInput.data,
  );

  return ctx.json(resolvedTargetSecrets, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
