import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import {
  createPublicOrganizationSandboxStorageSettingsResponse,
  upsertOrganizationSandboxStorageSettings,
} from "../../sandbox-storage/services/organization-sandbox-storage-settings.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const body = ctx.req.valid("json");

  await requireActiveOrganizationPermission({
    db: ctx.get("db"),
    actorUserId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const result = await upsertOrganizationSandboxStorageSettings({
    db: ctx.get("db"),
    organizationId: session.activeOrganizationId,
    persistentSandboxesEnabled: body.persistentSandboxesEnabled,
    storageConfigSource: body.storageConfigSource,
    organizationStorageConfig: body.organizationStorageConfig,
    encryptionConfig: {
      masterEncryptionKeys: ctx.get("config").integrations.masterEncryptionKeys,
    },
  });

  return ctx.json(createPublicOrganizationSandboxStorageSettingsResponse(result), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
