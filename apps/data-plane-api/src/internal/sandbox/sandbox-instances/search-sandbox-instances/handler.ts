import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { listSandboxInstances } from "../../../sandbox-instances/services/list-sandbox-instances.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const input = ctx.req.valid("json");
  const startedByFilter =
    input.startedByKind === undefined || input.startedById === undefined
      ? {}
      : { startedByKind: input.startedByKind, startedById: input.startedById };
  const startedByScopeFilter =
    input.startedByScope === undefined || input.startedByUserId === undefined
      ? {}
      : { startedByScope: input.startedByScope, startedByUserId: input.startedByUserId };

  const response = await listSandboxInstances(
    {
      db,
      tables,
    },
    {
      organizationId: input.organizationId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...startedByFilter,
      ...startedByScopeFilter,
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.titleSearch === undefined ? {} : { titleSearch: input.titleSearch }),
      ...(input.matchingSandboxProfileIds === undefined
        ? {}
        : { matchingSandboxProfileIds: input.matchingSandboxProfileIds }),
      ...(input.matchingStartedByUserIds === undefined
        ? {}
        : { matchingStartedByUserIds: input.matchingStartedByUserIds }),
      ...(input.matchingStartedBySystemIds === undefined
        ? {}
        : { matchingStartedBySystemIds: input.matchingStartedBySystemIds }),
      ...(input.startedBySystemIds === undefined
        ? {}
        : { startedBySystemIds: input.startedBySystemIds }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.before === undefined ? {} : { before: input.before }),
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
