import type { RouteHandler } from "@hono/zod-openapi";
import { ApiKeyActorKinds } from "@mistle/db/control-plane";
import { BadRequestError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import {
  isOrganizationPermission,
  OrganizationPermissions,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { ApiKeysBadRequestCodes } from "../constants.js";
import { createApiKey } from "../services/create-api-key.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const body = ctx.req.valid("json");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.API_KEY_MANAGE,
  });

  const permissions = parseRequestPermissions(body.permissions);
  const result = await createApiKey(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      actorKind: ApiKeyActorKinds.USER,
      actorId: session.userId,
      name: body.name,
      permissions,
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
    },
  );

  return ctx.json(result, 201);
};

function parseRequestPermissions(permissions: readonly string[]): OrganizationPermission[] {
  const parsedPermissions: OrganizationPermission[] = [];

  for (const permission of permissions) {
    if (!isOrganizationPermission(permission)) {
      throw new BadRequestError(
        ApiKeysBadRequestCodes.INVALID_CREATE_API_KEY_INPUT,
        `Permission '${permission}' is not recognized.`,
      );
    }

    parsedPermissions.push(permission);
  }

  return parsedPermissions;
}

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
