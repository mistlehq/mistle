import type { RouteHandler } from "@hono/zod-openapi";
import type { ControlPlaneTransaction } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";
import type { IdentityLinkProviderMetadata } from "../../identity-linking/services/provider-metadata.js";
import { resolveIdentityLinkProviderMetadataOrThrow } from "../../identity-linking/services/resolve-organization-identity-link-provider-config.js";
import { resolveValidatedProviderConnectionOrThrow } from "../../identity-linking/services/resolve-validated-provider-connection.js";
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

  const impact = await db.transaction(async (tx) => {
    const provider = await resolveIdentityLinkProviderMetadataOrThrow(
      {
        db: tx,
        integrationRegistry: ctx.get("integrationRegistry"),
      },
      {
        providerFamily,
      },
    );
    if (action === "enable") {
      await resolveValidatedProviderConnectionOrThrow(
        {
          db: tx,
          integrationRegistry: ctx.get("integrationRegistry"),
        },
        {
          organizationId: session.activeOrganizationId,
          integrationConnectionId,
          provider,
        },
      );
    } else {
      await validateConfiguredProviderConnectionForDisablePreview(
        {
          db: tx,
        },
        {
          organizationId: session.activeOrganizationId,
          integrationConnectionId,
          provider,
        },
      );
    }

    return await previewProfileGitCommitSigningForIdentityLinking(tx, {
      organizationId: session.activeOrganizationId,
      providerFamily,
      integrationConnectionId,
      action,
    });
  });

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

async function validateConfiguredProviderConnectionForDisablePreview(
  ctx: {
    db: ControlPlaneTransaction;
  },
  input: {
    organizationId: string;
    integrationConnectionId: string;
    provider: IdentityLinkProviderMetadata;
  },
): Promise<void> {
  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.id, input.integrationConnectionId),
      ),
  });

  if (connection === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.integrationConnectionId}' was not found.`,
    );
  }

  if (!input.provider.eligibleTargetKeys.includes(connection.targetKey)) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' does not belong to identity-linking provider '${input.provider.providerFamily}'.`,
    );
  }

  const config = await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.provider.providerFamily),
        eq(table.integrationConnectionId, input.integrationConnectionId),
      ),
  });

  if (config === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider '${input.provider.providerFamily}' is not configured with integration connection '${input.integrationConnectionId}'.`,
    );
  }
}
