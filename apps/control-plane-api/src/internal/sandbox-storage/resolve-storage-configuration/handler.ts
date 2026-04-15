import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { resolveSandboxStorageConfiguration } from "../../../sandbox-storage/services/internal-sandbox-storage.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const body = ctx.req.valid("json");

  return ctx.json(
    await resolveSandboxStorageConfiguration({
      db: ctx.get("db"),
      organizationId: body.organizationId,
      encryptionConfig: {
        masterEncryptionKeys: ctx.get("config").integrations.masterEncryptionKeys,
      },
    }),
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
