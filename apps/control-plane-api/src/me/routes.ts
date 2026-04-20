import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { ME_ROUTE_BASE_PATH } from "./constants.js";
import * as deleteLinkedAccount from "./delete-linked-account/index.js";
import * as deleteProfileImage from "./delete-profile-image/index.js";
import * as getProfileImageContent from "./get-profile-image-content/index.js";
import * as getProfileImage from "./get-profile-image/index.js";
import * as listLinkedAccounts from "./list-linked-accounts/index.js";
import * as putGitHubLinkedAccountPreferredEmail from "./put-github-linked-account-preferred-email/index.js";
import * as putProfileImage from "./put-profile-image/index.js";
import * as startLinkedAccountAuthorization from "./start-linked-account-authorization/index.js";

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
    putGitHubLinkedAccountPreferredEmail.route,
    putGitHubLinkedAccountPreferredEmail.handler,
  );
  routes.openapi(startLinkedAccountAuthorization.route, startLinkedAccountAuthorization.handler);
  routes.openapi(deleteLinkedAccount.route, deleteLinkedAccount.handler);

  return {
    basePath: ME_ROUTE_BASE_PATH,
    routes,
  };
}
