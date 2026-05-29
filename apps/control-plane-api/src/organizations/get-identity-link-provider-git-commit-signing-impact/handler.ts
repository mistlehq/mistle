import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { previewProfileGitCommitSigningForIdentityLinking } from "../../identity-linking/services/sync-profile-git-commit-signing.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { providerFamily } = ctx.req.valid("param");
  const { action, integrationConnectionId } = ctx.req.valid("query");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const impact = await db.transaction(async (tx) =>
    previewProfileGitCommitSigningForIdentityLinking(tx, {
      organizationId: session.activeOrganizationId,
      providerFamily,
      integrationConnectionId,
      action,
    }),
  );

  return ctx.json(
    {
      action: impact.action,
      updatedProfileCount: impact.updatedProfileIds.length,
      invariantViolationCount: impact.invariantViolations.length,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
