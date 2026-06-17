import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import * as bootstrapRuntimeConversation from "./bootstrap-runtime-conversation/index.js";
import { DESIGNER_ROUTE_BASE_PATH } from "./constants.js";
import * as createDesignerSession from "./create-designer-session/index.js";
import * as getDesignerSession from "./get-designer-session/index.js";
import * as getRuntimeConversationTranscript from "./get-runtime-conversation-transcript/index.js";
import * as listDesignerSessions from "./list-designer-sessions/index.js";
import * as putDesignerSessionCanvasTabs from "./put-designer-session-canvas-tabs/index.js";
import * as submitRuntimeFollowUp from "./submit-runtime-follow-up/index.js";

export function createDesignerRoutes(): AppRoutes<typeof DESIGNER_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(createDesignerSession.route, createDesignerSession.handler);
  routes.openapi(bootstrapRuntimeConversation.route, bootstrapRuntimeConversation.handler);
  routes.openapi(getRuntimeConversationTranscript.route, getRuntimeConversationTranscript.handler);
  routes.openapi(submitRuntimeFollowUp.route, submitRuntimeFollowUp.handler);
  routes.openapi(listDesignerSessions.route, listDesignerSessions.handler);
  routes.openapi(getDesignerSession.route, getDesignerSession.handler);
  routes.openapi(putDesignerSessionCanvasTabs.route, putDesignerSessionCanvasTabs.handler);

  return {
    basePath: DESIGNER_ROUTE_BASE_PATH,
    routes,
  };
}
