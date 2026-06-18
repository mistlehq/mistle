import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { DESIGNER_ROUTE_BASE_PATH } from "./constants.js";
import * as createDesignerSession from "./create-designer-session/index.js";
import * as getDesignerSessionBySandboxInstance from "./get-designer-session-by-sandbox-instance/index.js";
import * as getDesignerSession from "./get-designer-session/index.js";
import * as listDesignerSessions from "./list-designer-sessions/index.js";
import * as putDesignerSessionCanvasTabsBySandboxInstance from "./put-designer-session-canvas-tabs-by-sandbox-instance/index.js";
import * as putDesignerSessionCanvasTabs from "./put-designer-session-canvas-tabs/index.js";

export function createDesignerRoutes(): AppRoutes<typeof DESIGNER_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(createDesignerSession.route, createDesignerSession.handler);
  routes.openapi(listDesignerSessions.route, listDesignerSessions.handler);
  routes.openapi(
    getDesignerSessionBySandboxInstance.route,
    getDesignerSessionBySandboxInstance.handler,
  );
  routes.openapi(
    putDesignerSessionCanvasTabsBySandboxInstance.route,
    putDesignerSessionCanvasTabsBySandboxInstance.handler,
  );
  routes.openapi(getDesignerSession.route, getDesignerSession.handler);
  routes.openapi(putDesignerSessionCanvasTabs.route, putDesignerSessionCanvasTabs.handler);

  return {
    basePath: DESIGNER_ROUTE_BASE_PATH,
    routes,
  };
}
