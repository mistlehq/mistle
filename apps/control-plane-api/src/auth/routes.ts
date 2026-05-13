import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";
import { z } from "zod";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { AUTH_ROUTE_BASE_PATH } from "./constants.js";
import * as getAuthMethods from "./get-auth-methods/index.js";

const SignupDisabledMessage = "Signups are disabled. Use an existing account email.";

const SendSignInOtpBodySchema = z.looseObject({
  email: z.email().transform((email) => email.toLowerCase()),
  type: z.literal("sign-in"),
});

export function createAuthRoutes(): AppRoutes<typeof AUTH_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getAuthMethods.route, getAuthMethods.handler);
  routes.use("/email-otp/send-verification-otp", async (ctx, next) => {
    const config = ctx.get("config");
    if (config.auth.allowSignups || ctx.req.method !== "POST") {
      await next();
      return;
    }

    const requestBody = await ctx.req.raw
      .clone()
      .json()
      .catch((): unknown => null);
    const parsedRequestBody = SendSignInOtpBodySchema.safeParse(requestBody);
    if (!parsedRequestBody.success) {
      await next();
      return;
    }

    const db = ctx.get("db");
    const existingUser = await db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.email, parsedRequestBody.data.email),
    });
    if (existingUser === undefined) {
      return ctx.json(
        {
          code: "SIGNUPS_DISABLED",
          message: SignupDisabledMessage,
        },
        403,
      );
    }

    await next();
  });
  routes.all("*", (ctx) => {
    return ctx.get("auth").handler(ctx.req.raw);
  });

  return {
    basePath: AUTH_ROUTE_BASE_PATH,
    routes,
  };
}
