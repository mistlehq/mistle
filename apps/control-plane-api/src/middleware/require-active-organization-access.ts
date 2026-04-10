import { handleHttpError } from "@mistle/http/errors.js";
import type { MiddlewareHandler } from "hono";

import { requireActiveOrganizationAccess } from "../auth/services/organization-authorization.js";
import type { AppContextBindings } from "../types.js";

export function createRequireActiveOrganizationAccessMiddleware(): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const session = ctx.get("session");

    if (session === null) {
      throw new Error("Expected authenticated session to be available.");
    }

    try {
      await requireActiveOrganizationAccess({
        db: ctx.get("db"),
        actorUserId: session.user.id,
        activeOrganizationId: session.activeOrganizationId,
      });
    } catch (error) {
      return handleHttpError(ctx, error);
    }

    await next();
  };
}
