import type { RouteHandler } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  getOrganizationMembershipCapabilities,
  type OrganizationMembershipCapabilitiesSuccess,
} from "../services/get-organization-membership-capabilities.js";
import { route } from "./route.js";
import { errorResponseSchema, successResponseSchema } from "./schema.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const db = ctx.get("db");
  const { organizationId } = ctx.req.valid("param");

  const result = await getOrganizationMembershipCapabilities(
    {
      db,
    },
    {
      actorUserId: user.id,
      organizationId,
    },
  );

  if (result.kind === "not_found") {
    return ctx.json(
      buildErrorResponse({ code: "NOT_FOUND", message: "Organization was not found." }),
      404,
    );
  }

  if (result.kind === "forbidden") {
    return ctx.json(
      buildErrorResponse({ code: "FORBIDDEN", message: "Forbidden API request." }),
      403,
    );
  }

  return ctx.json(buildSuccessResponse(result), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withRequiredSession(routeHandler);

function buildErrorResponse(input: {
  code: "FORBIDDEN" | "NOT_FOUND";
  message: string;
}): z.infer<typeof errorResponseSchema> {
  return {
    ok: false,
    data: null,
    error: {
      code: input.code,
      message: input.message,
      retryable: false,
    },
  };
}

function buildSuccessResponse(
  result: OrganizationMembershipCapabilitiesSuccess,
): z.infer<typeof successResponseSchema> {
  return {
    ok: true,
    data: result.data,
    error: null,
  };
}
