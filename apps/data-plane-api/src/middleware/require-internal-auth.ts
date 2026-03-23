import type { MiddlewareHandler } from "hono";

import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "../internal/constants.js";
import type { AppContextBindings } from "../types.js";

type CreateRequireInternalAuthMiddlewareInput = {
  errorCode: string;
  errorMessage: string;
};

export function createRequireInternalAuthMiddleware(
  input: CreateRequireInternalAuthMiddlewareInput,
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const providedServiceToken = ctx.req.header(DATA_PLANE_INTERNAL_AUTH_HEADER);

    if (
      providedServiceToken === undefined ||
      providedServiceToken !== ctx.get("internalAuthServiceToken")
    ) {
      return ctx.json(
        {
          code: input.errorCode,
          message: input.errorMessage,
        },
        401,
      );
    }

    await next();
  };
}
