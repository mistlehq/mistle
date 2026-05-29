import type { RouteHandler } from "@hono/zod-openapi";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { ForbiddenError, withHttpErrorHandler } from "@mistle/http/errors.js";
import { asc, eq } from "drizzle-orm";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import type { AppAuthContext, AppContextBindings } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const authContext = ctx.get("authContext");
  if (authContext === null) {
    throw new Error("Expected authenticated request context to be available.");
  }

  const userContext = resolveUserOrganizationContext(authContext);
  if (userContext === null) {
    throw new ForbiddenError("FORBIDDEN", "User-backed authentication is required.");
  }

  const db = ctx.get("db");
  const tables = getControlPlaneDatabaseSchema(db);
  const organizations = await db
    .select({
      id: tables.organizations.id,
      name: tables.organizations.name,
      slug: tables.organizations.slug,
      role: tables.members.role,
    })
    .from(tables.members)
    .innerJoin(tables.organizations, eq(tables.organizations.id, tables.members.organizationId))
    .where(eq(tables.members.userId, userContext.userId))
    .orderBy(asc(tables.organizations.name), asc(tables.organizations.id));

  return ctx.json(
    {
      organizations: organizations.map((organization) => ({
        ...organization,
        isCurrent: organization.id === userContext.organizationId,
      })),
    },
    200,
  );
};

function resolveUserOrganizationContext(
  authContext: AppAuthContext,
): { userId: string; organizationId: string } | null {
  if (authContext.kind === "oauth") {
    if (!authContext.permissions.includes(OrganizationPermissions.ORGANIZATION_READ)) {
      throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
    }

    return {
      userId: authContext.oauth.userId,
      organizationId: authContext.oauth.organizationId,
    };
  }

  if (authContext.kind === "session") {
    return {
      userId: authContext.session.user.id,
      organizationId: authContext.session.activeOrganizationId,
    };
  }

  return null;
}

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
