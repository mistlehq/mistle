import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { encryptSandboxStorageCredential } from "../../../sandbox-storage/services/internal-sandbox-storage.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const body = ctx.req.valid("json");

  return ctx.json(
    await encryptSandboxStorageCredential({
      db: ctx.get("db"),
      organizationId: body.organizationId,
      credentialKind: body.credentialKind,
      plaintext: body.plaintext,
      encryptionConfig: {
        masterEncryptionKeys: ctx.get("config").integrations.masterEncryptionKeys,
      },
    }),
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
