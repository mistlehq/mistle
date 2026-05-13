import { TextDecoder } from "node:util";

import type { RouteHandler } from "@hono/zod-openapi";
import { BadRequestError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { IdentityLinkingBadRequestCodes } from "../../identity-linking/constants.js";
import { checkGitHubLinkedAccountSigningKey } from "../../identity-linking/services/check-github-linked-account-signing-key.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const Utf8TextDecoder = new TextDecoder("utf-8", { fatal: true });

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const { file } = ctx.req.valid("form");
  let privateKey: string;
  try {
    privateKey = Utf8TextDecoder.decode(await file.arrayBuffer());
  } catch {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT,
      "GitHub signing key upload must be valid UTF-8 text.",
    );
  }

  const config = ctx.get("config");
  const result = await checkGitHubLinkedAccountSigningKey(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      ...(config.commitSign === undefined ? {} : { commitSignConfig: config.commitSign }),
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.user.id,
      privateKey,
    },
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
