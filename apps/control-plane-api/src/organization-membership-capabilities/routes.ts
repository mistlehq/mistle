import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH } from "./constants.js";
import {
  getOrganizationMembershipCapabilitiesRoute,
  MembershipCapabilitiesErrorResponseSchema,
  MembershipCapabilitiesSuccessResponseSchema,
} from "./contracts.js";
import {
  getOrganizationMembershipCapabilities,
  type OrganizationMembershipCapabilitiesSuccess,
} from "./services/get-organization-membership-capabilities.js";

export function createOrganizationMembershipCapabilitiesRoutes(): AppRoutes<
  typeof ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(getOrganizationMembershipCapabilitiesRoute, async (ctx) => {
    const params = ctx.req.valid("param");
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected authenticated session to be available.");
    }

    const result = await getOrganizationMembershipCapabilities(
      {
        db: ctx.get("db"),
      },
      {
        actorUserId: session.user.id,
        organizationId: params.organizationId,
      },
    );

    if (result.kind === "not_found") {
      return ctx.json(
        buildErrorResponse({
          code: "NOT_FOUND",
          message: "Organization was not found.",
        }),
        404,
      );
    }

    if (result.kind === "forbidden") {
      return ctx.json(
        buildErrorResponse({
          code: "FORBIDDEN",
          message: "Forbidden API request.",
        }),
        403,
      );
    }

    return ctx.json(buildSuccessResponse(result), 200);
  });

  return {
    basePath: ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH,
    routes,
  };
}

function buildErrorResponse(input: {
  code: "FORBIDDEN" | "NOT_FOUND";
  message: string;
}): z.infer<typeof MembershipCapabilitiesErrorResponseSchema> {
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
): z.infer<typeof MembershipCapabilitiesSuccessResponseSchema> {
  return {
    ok: true,
    data: result.data,
    error: null,
  };
}
