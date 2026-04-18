import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATION_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteIdentityLinkProvider from "./delete-identity-link-provider/index.js";
import * as deleteLogo from "./delete-logo/index.js";
import * as getLogoContent from "./get-logo-content/index.js";
import * as getLogo from "./get-logo/index.js";
import * as getMembershipCapabilities from "./get-membership-capabilities/index.js";
import * as getOrganizationSandboxStorageSettings from "./get-organization-sandbox-storage-settings/index.js";
import * as listIdentityLinkProviders from "./list-identity-link-providers/index.js";
import * as listInvitations from "./list-invitations/index.js";
import * as listMembers from "./list-members/index.js";
import * as putIdentityLinkProviderStatus from "./put-identity-link-provider-status/index.js";
import * as putIdentityLinkProvider from "./put-identity-link-provider/index.js";
import * as putLogo from "./put-logo/index.js";
import * as putOrganizationSandboxStorageSettings from "./put-organization-sandbox-storage-settings/index.js";

export function createOrganizationRoutes(): AppRoutes<typeof ORGANIZATION_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getLogo.route, getLogo.handler);
  routes.openapi(getLogoContent.route, getLogoContent.handler);
  routes.openapi(putLogo.route, putLogo.handler);
  routes.openapi(deleteLogo.route, deleteLogo.handler);
  routes.openapi(getMembershipCapabilities.route, getMembershipCapabilities.handler);
  routes.openapi(listIdentityLinkProviders.route, listIdentityLinkProviders.handler);
  routes.openapi(
    getOrganizationSandboxStorageSettings.route,
    getOrganizationSandboxStorageSettings.handler,
  );
  routes.openapi(listMembers.route, listMembers.handler);
  routes.openapi(listInvitations.route, listInvitations.handler);
  routes.openapi(putIdentityLinkProvider.route, putIdentityLinkProvider.handler);
  routes.openapi(putIdentityLinkProviderStatus.route, putIdentityLinkProviderStatus.handler);
  routes.openapi(deleteIdentityLinkProvider.route, deleteIdentityLinkProvider.handler);
  routes.openapi(
    putOrganizationSandboxStorageSettings.route,
    putOrganizationSandboxStorageSettings.handler,
  );

  return {
    basePath: ORGANIZATION_ROUTE_BASE_PATH,
    routes,
  };
}
