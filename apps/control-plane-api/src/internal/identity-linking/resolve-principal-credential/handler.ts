import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import {
  InternalIdentityLinkingError,
  InternalIdentityLinkingErrorCodes,
} from "../services/errors.js";
import { resolvePrincipalCredential } from "../services/resolve-principal-credential.js";
import { route } from "./route.js";
import { ResolvePrincipalCredentialRequestSchema } from "./schema.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const requestBody = await ctx.req
    .json()
    .catch((): unknown => ({ __parseError: "invalid_json_body" }));
  const parsedInput = ResolvePrincipalCredentialRequestSchema.safeParse(requestBody);
  if (!parsedInput.success) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.INVALID_RESOLVE_INPUT,
      400,
      "Linked-principal credential resolve request body is invalid.",
    );
  }

  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;

  const resolvedCredential = await resolvePrincipalCredential(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: parsedInput.data.organizationId,
      actingUserId: parsedInput.data.actingUserId,
      providerFamily: parsedInput.data.providerFamily,
      ...(parsedInput.data.credentialKind === undefined
        ? {}
        : { credentialKind: parsedInput.data.credentialKind }),
    },
  );

  return ctx.json(resolvedCredential, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
