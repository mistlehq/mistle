import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import * as checkGitHubLinkedAccountSigningKey from "./check-github-linked-account-signing-key/index.js";
import { ME_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteGitHubLinkedAccountSigningKey from "./delete-github-linked-account-signing-key/index.js";
import * as deleteLinkedAccountConfig from "./delete-linked-account-config/index.js";
import * as deleteLinkedAccount from "./delete-linked-account/index.js";
import * as deleteProfileImage from "./delete-profile-image/index.js";
import * as getProfileImageContent from "./get-profile-image-content/index.js";
import * as getProfileImage from "./get-profile-image/index.js";
import * as listLinkedAccounts from "./list-linked-accounts/index.js";
import * as putGitHubLinkedAccountPreferredEmail from "./put-github-linked-account-preferred-email/index.js";
import * as putGitHubLinkedAccountSigningKey from "./put-github-linked-account-signing-key/index.js";
import * as putProfileImage from "./put-profile-image/index.js";
import * as startLinkedAccountAuthorization from "./start-linked-account-authorization/index.js";
import * as startLinkedAccountConfigAuthorization from "./start-linked-account-config-authorization/index.js";

export function createMeRoutes(): AppRoutes<typeof ME_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(getProfileImage.route, getProfileImage.handler);
  routes.openapi(getProfileImageContent.route, getProfileImageContent.handler);
  routes.openapi(putProfileImage.route, putProfileImage.handler);
  routes.openapi(deleteProfileImage.route, deleteProfileImage.handler);
  routes.openapi(listLinkedAccounts.route, listLinkedAccounts.handler);
  routes.openapi(
    checkGitHubLinkedAccountSigningKey.route,
    checkGitHubLinkedAccountSigningKey.handler,
  );
  routes.openapi(putGitHubLinkedAccountSigningKey.route, putGitHubLinkedAccountSigningKey.handler);
  routes.openapi(
    putGitHubLinkedAccountPreferredEmail.route,
    putGitHubLinkedAccountPreferredEmail.handler,
  );
  routes.openapi(
    deleteGitHubLinkedAccountSigningKey.route,
    deleteGitHubLinkedAccountSigningKey.handler,
  );
  routes.openapi(
    startLinkedAccountConfigAuthorization.route,
    startLinkedAccountConfigAuthorization.handler,
  );
  routes.openapi(deleteLinkedAccountConfig.route, deleteLinkedAccountConfig.handler);
  routes.openapi(startLinkedAccountAuthorization.route, startLinkedAccountAuthorization.handler);
  routes.openapi(deleteLinkedAccount.route, deleteLinkedAccount.handler);

  return {
    basePath: ME_ROUTE_BASE_PATH,
    routes,
  };
}
