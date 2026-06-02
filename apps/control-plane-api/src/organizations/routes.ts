import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ORGANIZATION_ROUTE_BASE_PATH } from "./constants.js";
import * as createIdentityLinkProviderConfig from "./create-identity-link-provider-config/index.js";
import * as deleteIdentityLinkProviderConfig from "./delete-identity-link-provider-config/index.js";
import * as deleteIdentityLinkProvider from "./delete-identity-link-provider/index.js";
import * as deleteLogo from "./delete-logo/index.js";
import * as ensureBillingCustomer from "./ensure-billing-customer/index.js";
import * as getBilling from "./get-billing/index.js";
import * as getIdentityLinkProviderGitCommitSigningImpact from "./get-identity-link-provider-git-commit-signing-impact/index.js";
import * as getLogoContent from "./get-logo-content/index.js";
import * as getLogo from "./get-logo/index.js";
import * as getMembershipCapabilities from "./get-membership-capabilities/index.js";
import * as listIdentityLinkProviderConfigLinks from "./list-identity-link-provider-config-links/index.js";
import * as listIdentityLinkProviderLinks from "./list-identity-link-provider-links/index.js";
import * as listIdentityLinkProviders from "./list-identity-link-providers/index.js";
import * as listInvitations from "./list-invitations/index.js";
import * as listMembers from "./list-members/index.js";
import * as putIdentityLinkProviderConfigStatus from "./put-identity-link-provider-config-status/index.js";
import * as putIdentityLinkProviderConfig from "./put-identity-link-provider-config/index.js";
import * as putIdentityLinkProviderStatus from "./put-identity-link-provider-status/index.js";
import * as putIdentityLinkProvider from "./put-identity-link-provider/index.js";
import * as putLogo from "./put-logo/index.js";

export function createOrganizationRoutes(): AppRoutes<typeof ORGANIZATION_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getLogo.route, getLogo.handler);
  routes.openapi(getLogoContent.route, getLogoContent.handler);
  routes.openapi(putLogo.route, putLogo.handler);
  routes.openapi(deleteLogo.route, deleteLogo.handler);
  routes.openapi(getBilling.route, getBilling.handler);
  routes.openapi(ensureBillingCustomer.route, ensureBillingCustomer.handler);
  routes.openapi(getMembershipCapabilities.route, getMembershipCapabilities.handler);
  routes.openapi(listIdentityLinkProviders.route, listIdentityLinkProviders.handler);
  routes.openapi(listIdentityLinkProviderLinks.route, listIdentityLinkProviderLinks.handler);
  routes.openapi(
    getIdentityLinkProviderGitCommitSigningImpact.route,
    getIdentityLinkProviderGitCommitSigningImpact.handler,
  );
  routes.openapi(createIdentityLinkProviderConfig.route, createIdentityLinkProviderConfig.handler);
  routes.openapi(putIdentityLinkProviderConfig.route, putIdentityLinkProviderConfig.handler);
  routes.openapi(
    putIdentityLinkProviderConfigStatus.route,
    putIdentityLinkProviderConfigStatus.handler,
  );
  routes.openapi(deleteIdentityLinkProviderConfig.route, deleteIdentityLinkProviderConfig.handler);
  routes.openapi(
    listIdentityLinkProviderConfigLinks.route,
    listIdentityLinkProviderConfigLinks.handler,
  );
  routes.openapi(listMembers.route, listMembers.handler);
  routes.openapi(listInvitations.route, listInvitations.handler);
  routes.openapi(putIdentityLinkProvider.route, putIdentityLinkProvider.handler);
  routes.openapi(putIdentityLinkProviderStatus.route, putIdentityLinkProviderStatus.handler);
  routes.openapi(deleteIdentityLinkProvider.route, deleteIdentityLinkProvider.handler);

  return {
    basePath: ORGANIZATION_ROUTE_BASE_PATH,
    routes,
  };
}
