import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import {
  InternalIdentityLinkingError,
  InternalIdentityLinkingErrorCodes,
} from "../services/errors.js";
import { signCommitPayload } from "../services/sign-commit-payload.js";
import { route } from "./route.js";
import { SignCommitPayloadRequestSchema } from "./schema.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const requestBody = await ctx.req
    .json()
    .catch((): unknown => ({ __parseError: "invalid_json_body" }));
  const parsedInput = SignCommitPayloadRequestSchema.safeParse(requestBody);
  if (!parsedInput.success) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.INVALID_SIGN_COMMIT_PAYLOAD_INPUT,
      400,
      "Linked-principal commit signing request body is invalid.",
    );
  }

  const config = ctx.get("config");
  const sandboxBootstrapConfig = ctx.get("sandboxConfig").bootstrap;
  if (sandboxBootstrapConfig === undefined) {
    throw new Error("Sandbox bootstrap signing config is missing.");
  }

  const signedPayload = await signCommitPayload(
    {
      db: ctx.get("db"),
      integrationsConfig: config.integrations,
      sandboxBootstrapConfig,
    },
    parsedInput.data,
  );

  return ctx.json(signedPayload, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
