import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../services/errors.js";
import { resolveIntegrationCredential } from "../services/resolve-credential.js";
import { route } from "./route.js";
import { ResolveIntegrationCredentialRequestSchema } from "./schema.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const requestBody = await ctx.req
    .json()
    .catch((): unknown => ({ __parseError: "invalid_json_body" }));
  const parsedInput = ResolveIntegrationCredentialRequestSchema.safeParse(requestBody);
  if (!parsedInput.success) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.INVALID_RESOLVE_INPUT,
      400,
      "Credential resolve request body is invalid.",
    );
  }

  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;

  const resolvedCredential = await resolveIntegrationCredential(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      connectionId: parsedInput.data.connectionId,
      secretType: parsedInput.data.secretType,
      ...(parsedInput.data.bindingId === undefined
        ? {}
        : { bindingId: parsedInput.data.bindingId }),
      ...(parsedInput.data.purpose === undefined ? {} : { purpose: parsedInput.data.purpose }),
      ...(parsedInput.data.resolverKey === undefined
        ? {}
        : { resolverKey: parsedInput.data.resolverKey }),
    },
  );

  return ctx.json(
    {
      value: resolvedCredential.value,
      ...(resolvedCredential.expiresAt === undefined
        ? {}
        : { expiresAt: resolvedCredential.expiresAt }),
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
