import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { createDraftFormConnection } from "../services/create-draft-form-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { methodId, targetKey } = ctx.req.valid("param");
  const { displayName } = ctx.req.valid("json");

  const createdConnection = await createDraftFormConnection(
    {
      db,
      integrationRegistry,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      methodId,
      displayName,
    },
  );

  return ctx.json(createdConnection, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
