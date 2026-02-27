import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContextBindings, AppRoutes } from "../types.js";

import {
  buildMembershipCapabilities,
  parseOrganizationRole,
  type OrganizationRole,
} from "../auth/services/organization-policy.js";
import { ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH } from "./constants.js";
import {
  getOrganizationMembershipCapabilitiesRoute,
  MembershipCapabilitiesErrorResponseSchema,
  MembershipCapabilitiesSuccessResponseSchema,
} from "./contracts.js";

export function createOrganizationMembershipCapabilitiesApp(): AppRoutes<
  typeof ORGANIZATION_MEMBERSHIP_CAPABILITIES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(getOrganizationMembershipCapabilitiesRoute, async (ctx) => {
    const params = ctx.req.valid("param");
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected authenticated session to be available.");
    }

    const membership = await ctx.get("db").query.members.findFirst({
      columns: {
        role: true,
      },
      where: (members, { and, eq }) =>
        and(eq(members.organizationId, params.organizationId), eq(members.userId, session.user.id)),
    });

    if (membership === undefined) {
      const organization = await ctx.get("db").query.organizations.findFirst({
        columns: {
          id: true,
        },
        where: (organizations, { eq }) => eq(organizations.id, params.organizationId),
      });

      if (organization === undefined) {
        return ctx.json(
          buildErrorResponse({
            code: "NOT_FOUND",
            message: "Organization was not found.",
          }),
          404,
        );
      }

      return ctx.json(
        buildErrorResponse({
          code: "FORBIDDEN",
          message: "Forbidden API request.",
        }),
        403,
      );
    }

    const actorRole = parseOrganizationRole(membership.role);
    if (actorRole === null) {
      throw new Error("Unexpected organization role was found.");
    }

    return ctx.json(
      buildSuccessResponse({
        actorRole,
        organizationId: params.organizationId,
      }),
      200,
    );
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

function buildSuccessResponse(input: {
  actorRole: OrganizationRole;
  organizationId: string;
}): z.infer<typeof MembershipCapabilitiesSuccessResponseSchema> {
  return {
    ok: true,
    data: buildMembershipCapabilities(input),
    error: null,
  };
}
