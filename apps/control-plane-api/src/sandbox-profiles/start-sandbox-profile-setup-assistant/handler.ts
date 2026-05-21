import type { RouteHandler } from "@hono/zod-openapi";
import { SandboxInstancePurposes } from "@mistle/db/data-plane";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startProfileMaintenanceSetupAssistant } from "../services/start-profile-maintenance-setup-assistant.js";
import { startProfileSetupSandbox } from "../services/start-profile-setup-sandbox.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user, session }: AppSession,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { integrations: integrationsConfig, mcp: mcpConfig } = ctx.get("config");
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const serviceInput = {
    db,
    integrationRegistry,
    integrationsConfig,
    mcpConfig,
    sandboxConfig,
    dataPlaneClient,
    defaultBaseImage: sandboxConfig.defaultBaseImage,
  };
  const startedBy: { kind: "user"; id: string } = {
    kind: "user",
    id: user.id,
  };
  const startedSandboxInstance =
    body.scriptKind === "maintenance"
      ? await startProfileMaintenanceSetupAssistant(serviceInput, {
          organizationId: session.activeOrganizationId,
          profileId,
          profileVersion: version,
          mistleMcpCredentialResolver: {
            kind: "setup_assistant",
          },
          startedBy,
          source: "dashboard",
          ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
        })
      : await startProfileSetupSandbox(serviceInput, {
          organizationId: session.activeOrganizationId,
          profileId,
          profileVersion: version,
          purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
          mistleMcpCredentialResolver: {
            kind: "setup_assistant",
          },
          startedBy,
          source: "dashboard",
          ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
        });

  return ctx.json(startedSandboxInstance, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
