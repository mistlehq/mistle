import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_PROFILES_ROUTE_BASE_PATH } from "./constants.js";
import * as createSandboxProfileVersion from "./create-sandbox-profile-version/index.js";
import * as createSandboxProfile from "./create-sandbox-profile/index.js";
import * as deleteSandboxProfileVersionRefreshSchedule from "./delete-sandbox-profile-version-refresh-schedule/index.js";
import * as deleteSandboxProfile from "./delete-sandbox-profile/index.js";
import * as discardSandboxProfileVersionDraft from "./discard-sandbox-profile-version-draft/index.js";
import * as getSandboxProfileVersionAutomationConfig from "./get-sandbox-profile-version-automation-config/index.js";
import * as getSandboxProfileVersionIntegrationBindings from "./get-sandbox-profile-version-integration-bindings/index.js";
import * as getSandboxProfileVersionPublishability from "./get-sandbox-profile-version-publishability/index.js";
import * as getSandboxProfileVersionSetupScript from "./get-sandbox-profile-version-setup-script/index.js";
import * as getSandboxProfile from "./get-sandbox-profile/index.js";
import * as listLaunchableSandboxProfiles from "./list-launchable-sandbox-profiles/index.js";
import * as listSandboxProfileVersions from "./list-sandbox-profile-versions/index.js";
import * as listSandboxProfiles from "./list-sandbox-profiles/index.js";
import * as publishSandboxProfileVersion from "./publish-sandbox-profile-version/index.js";
import * as putSandboxProfileVersionDraft from "./put-sandbox-profile-version-draft/index.js";
import * as putSandboxProfileVersionRefreshSchedule from "./put-sandbox-profile-version-refresh-schedule/index.js";
import * as refreshSandboxProfileVersion from "./refresh-sandbox-profile-version/index.js";
import * as retrySandboxProfileVersionPublishSnapshot from "./retry-sandbox-profile-version-publish-snapshot/index.js";
import * as startSandboxProfileInstance from "./start-sandbox-profile-instance/index.js";
import * as startSandboxProfileSetupAssistant from "./start-sandbox-profile-setup-assistant/index.js";
import * as startSandboxProfileSetupScriptTestRun from "./start-sandbox-profile-setup-script-test-run/index.js";
import * as updateSandboxProfile from "./update-sandbox-profile/index.js";

export function createSandboxProfilesRoutes(): AppRoutes<typeof SANDBOX_PROFILES_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listSandboxProfiles.route, listSandboxProfiles.handler);
  routes.openapi(listLaunchableSandboxProfiles.route, listLaunchableSandboxProfiles.handler);
  routes.openapi(createSandboxProfile.route, createSandboxProfile.handler);
  routes.openapi(createSandboxProfileVersion.route, createSandboxProfileVersion.handler);
  routes.openapi(getSandboxProfile.route, getSandboxProfile.handler);
  routes.openapi(updateSandboxProfile.route, updateSandboxProfile.handler);
  routes.openapi(deleteSandboxProfile.route, deleteSandboxProfile.handler);
  routes.openapi(listSandboxProfileVersions.route, listSandboxProfileVersions.handler);
  routes.openapi(
    getSandboxProfileVersionPublishability.route,
    getSandboxProfileVersionPublishability.handler,
  );
  routes.openapi(
    getSandboxProfileVersionAutomationConfig.route,
    getSandboxProfileVersionAutomationConfig.handler,
  );
  routes.openapi(
    getSandboxProfileVersionSetupScript.route,
    getSandboxProfileVersionSetupScript.handler,
  );
  routes.openapi(
    getSandboxProfileVersionIntegrationBindings.route,
    getSandboxProfileVersionIntegrationBindings.handler,
  );
  routes.openapi(putSandboxProfileVersionDraft.route, putSandboxProfileVersionDraft.handler);
  routes.openapi(
    putSandboxProfileVersionRefreshSchedule.route,
    putSandboxProfileVersionRefreshSchedule.handler,
  );
  routes.openapi(
    deleteSandboxProfileVersionRefreshSchedule.route,
    deleteSandboxProfileVersionRefreshSchedule.handler,
  );
  routes.openapi(
    discardSandboxProfileVersionDraft.route,
    discardSandboxProfileVersionDraft.handler,
  );
  routes.openapi(publishSandboxProfileVersion.route, publishSandboxProfileVersion.handler);
  routes.openapi(refreshSandboxProfileVersion.route, refreshSandboxProfileVersion.handler);
  routes.openapi(
    retrySandboxProfileVersionPublishSnapshot.route,
    retrySandboxProfileVersionPublishSnapshot.handler,
  );
  routes.openapi(
    startSandboxProfileSetupScriptTestRun.route,
    startSandboxProfileSetupScriptTestRun.handler,
  );
  routes.openapi(
    startSandboxProfileSetupAssistant.route,
    startSandboxProfileSetupAssistant.handler,
  );
  routes.openapi(startSandboxProfileInstance.route, startSandboxProfileInstance.handler);

  return {
    basePath: SANDBOX_PROFILES_ROUTE_BASE_PATH,
    routes,
  };
}
