import type { RouteHandler } from "@hono/zod-openapi";
import { HttpError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { completeLinkedAccountAuthorization } from "../../identity-linking/services/complete-linked-account-authorization.js";
import { buildIdentityLinkResultDashboardUrl } from "../../identity-linking/services/redirect-flow.js";
import type { AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const { providerFamily } = ctx.req.valid("param");
  const query = ctx.req.valid("query");
  const dashboardBaseUrl = ctx.get("config").dashboard.baseUrl;

  try {
    const redirectUrl = await completeLinkedAccountAuthorization(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
        integrationsConfig: ctx.get("config").integrations,
        controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
        dashboardBaseUrl,
      },
      {
        providerFamily,
        query,
      },
    );

    return ctx.redirect(redirectUrl, 302);
  } catch (error) {
    if (error instanceof HttpError) {
      return ctx.redirect(
        buildIdentityLinkResultDashboardUrl({
          dashboardBaseUrl,
          providerFamily,
          result: "failure",
          code: error.code,
        }),
        302,
      );
    }

    throw error;
  }
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
