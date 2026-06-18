import { isInternalServiceTokenValid } from "@mistle/http/internal-auth.js";
import type { MiddlewareHandler } from "hono";

import type { AppContextBindings } from "../types.js";

type CreateRequireInternalAuthMiddlewareInput = {
  headerName: string;
  errorCode: string;
  errorMessage: string;
};

export function createRequireInternalAuthMiddleware(
  input: CreateRequireInternalAuthMiddlewareInput,
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const providedServiceToken = ctx.req.header(input.headerName);
    if (
      !isInternalServiceTokenValid({
        providedToken: providedServiceToken,
        expectedToken: ctx.get("internalAuthServiceToken"),
      })
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
