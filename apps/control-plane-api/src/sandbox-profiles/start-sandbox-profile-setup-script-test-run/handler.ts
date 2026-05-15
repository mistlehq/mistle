import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startProfileSetupScriptTestRun } from "../services/start-profile-setup-script-test-run.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user, session }: AppSession,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const startedSandboxInstance = await startProfileSetupScriptTestRun(
    {
      db,
      integrationRegistry,
      integrationsConfig,
      sandboxConfig,
      dataPlaneClient,
      defaultBaseImage: sandboxConfig.defaultBaseImage,
    },
    {
      organizationId: session.activeOrganizationId,
      profileId,
      profileVersion: version,
      setupScript: body.setupScript,
      ...(body.agentRuntimeId === undefined ? {} : { agentRuntimeId: body.agentRuntimeId }),
      ...(body.sandboxProvider === undefined
        ? {}
        : {
            sandboxRuntimeConfig: {
              sandboxProvider: body.sandboxProvider,
              sandboxConnectionId: body.sandboxConnectionId ?? null,
              sandboxResources: body.sandboxResources ?? null,
            },
          }),
      startedBy: {
        kind: "user",
        id: user.id,
      },
      source: "dashboard",
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    },
  );

  return ctx.json(startedSandboxInstance, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
