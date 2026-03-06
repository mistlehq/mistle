import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_CONVERSATIONS_ROUTE_BASE_PATH } from "./constants.js";
import {
  continueSandboxConversationSessionRoute,
  SandboxConversationSessionResponseSchema,
  SandboxConversationsBadRequestResponseSchema,
  SandboxConversationsConflictResponseSchema,
  SandboxConversationsNotFoundResponseSchema,
  startSandboxConversationSessionRoute,
} from "./contracts.js";
import {
  SandboxConversationsBadRequestError,
  SandboxConversationsConflictError,
  SandboxConversationsNotFoundError,
} from "./services/factory.js";

export function createSandboxConversationsApp(): AppRoutes<
  typeof SANDBOX_CONVERSATIONS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(startSandboxConversationSessionRoute, async (ctx) => {
    try {
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const startedSession = await ctx.get("services").sandboxConversations.startSession({
        organizationId: session.session.activeOrganizationId,
        userId: session.user.id,
        profileId: body.profileId,
        profileVersion: body.profileVersion,
        integrationBindingId: body.integrationBindingId,
      });

      return ctx.json(createSessionAcceptedResponse(startedSession), 202);
    } catch (error) {
      return handleSandboxConversationError(ctx, error);
    }
  });

  routes.openapi(continueSandboxConversationSessionRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const continuedSession = await ctx.get("services").sandboxConversations.continueSession({
        organizationId: session.session.activeOrganizationId,
        userId: session.user.id,
        conversationId: params.conversationId,
      });

      return ctx.json(createSessionAcceptedResponse(continuedSession), 202);
    } catch (error) {
      return handleSandboxConversationError(ctx, error);
    }
  });

  return {
    basePath: SANDBOX_CONVERSATIONS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleSandboxConversationError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxConversationsBadRequestError) {
    const responseBody: z.infer<typeof SandboxConversationsBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof SandboxConversationsNotFoundError) {
    const responseBody: z.infer<typeof SandboxConversationsNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  if (error instanceof SandboxConversationsConflictError) {
    const responseBody: z.infer<typeof SandboxConversationsConflictResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 409);
  }

  throw error;
}

function createSessionAcceptedResponse(input: {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  workflowRunId: string | null;
}): z.infer<typeof SandboxConversationSessionResponseSchema> {
  return {
    status: "accepted",
    conversationId: input.conversationId,
    routeId: input.routeId,
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: input.workflowRunId,
  };
}
