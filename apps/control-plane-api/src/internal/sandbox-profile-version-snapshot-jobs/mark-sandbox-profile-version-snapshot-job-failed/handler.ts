import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { markSandboxProfileVersionSnapshotJobFailed } from "../services/mark-sandbox-profile-version-snapshot-job-failed.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const body = ctx.req.valid("json");

  return ctx.json(
    await markSandboxProfileVersionSnapshotJobFailed(
      {
        db: ctx.get("db"),
      },
      body,
    ),
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
