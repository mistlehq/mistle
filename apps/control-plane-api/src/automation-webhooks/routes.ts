import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import {
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  DeleteAutomationWebhookResponseSchema,
  createAutomationWebhookRoute,
  deleteAutomationWebhookRoute,
  getAutomationWebhookRoute,
  ListAutomationWebhooksResponseSchema,
  listAutomationWebhooksRoute,
  updateAutomationWebhookRoute,
} from "./contracts.js";
import {
  AutomationWebhooksBadRequestError,
  AutomationWebhooksNotFoundError,
} from "./services/factory.js";
import type { AutomationWebhookAggregate } from "./services/types.js";

export function createAutomationWebhooksRoutes(): AppRoutes<
  typeof AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listAutomationWebhooksRoute, async (ctx) => {
    try {
      const query = ctx.req.valid("query");
      const session = requireSession(ctx);
      const result = await ctx.get("services").automationWebhooks.listWebhookAutomations({
        ...query,
        organizationId: session.session.activeOrganizationId,
      });
      const responseBody: z.infer<typeof ListAutomationWebhooksResponseSchema> = {
        ...result,
        items: result.items.map(toAutomationWebhookResponse),
      };

      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleAutomationWebhookBadRequestError(ctx, error);
    }
  });

  routes.openapi(createAutomationWebhookRoute, async (ctx) => {
    try {
      const body = ctx.req.valid("json");
      const session = requireSession(ctx);
      const automationWebhook = await ctx
        .get("services")
        .automationWebhooks.createWebhookAutomation({
          name: body.name,
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          integrationConnectionId: body.integrationConnectionId,
          ...(body.eventTypes === undefined ? {} : { eventTypes: body.eventTypes }),
          ...(body.payloadFilter === undefined ? {} : { payloadFilter: body.payloadFilter }),
          inputTemplate: body.inputTemplate,
          conversationKeyTemplate: body.conversationKeyTemplate,
          ...(body.idempotencyKeyTemplate === undefined
            ? {}
            : { idempotencyKeyTemplate: body.idempotencyKeyTemplate }),
          target: {
            sandboxProfileId: body.target.sandboxProfileId,
            ...(body.target.sandboxProfileVersion === undefined
              ? {}
              : { sandboxProfileVersion: body.target.sandboxProfileVersion }),
          },
          organizationId: session.session.activeOrganizationId,
        });

      return ctx.json(toAutomationWebhookResponse(automationWebhook), 201);
    } catch (error) {
      return handleAutomationWebhookBadRequestError(ctx, error);
    }
  });

  routes.openapi(getAutomationWebhookRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = requireSession(ctx);
      const automationWebhook = await ctx.get("services").automationWebhooks.getWebhookAutomation({
        automationId: params.automationId,
        organizationId: session.session.activeOrganizationId,
      });

      return ctx.json(toAutomationWebhookResponse(automationWebhook), 200);
    } catch (error) {
      return handleAutomationWebhookNotFoundError(ctx, error);
    }
  });

  routes.openapi(updateAutomationWebhookRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = requireSession(ctx);
      const automationWebhook = await ctx
        .get("services")
        .automationWebhooks.updateWebhookAutomation({
          automationId: params.automationId,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          ...(body.integrationConnectionId === undefined
            ? {}
            : { integrationConnectionId: body.integrationConnectionId }),
          ...(body.eventTypes === undefined ? {} : { eventTypes: body.eventTypes }),
          ...(body.payloadFilter === undefined ? {} : { payloadFilter: body.payloadFilter }),
          ...(body.inputTemplate === undefined ? {} : { inputTemplate: body.inputTemplate }),
          ...(body.conversationKeyTemplate === undefined
            ? {}
            : { conversationKeyTemplate: body.conversationKeyTemplate }),
          ...(body.idempotencyKeyTemplate === undefined
            ? {}
            : { idempotencyKeyTemplate: body.idempotencyKeyTemplate }),
          ...(body.target === undefined
            ? {}
            : {
                target: {
                  ...(body.target.sandboxProfileId === undefined
                    ? {}
                    : { sandboxProfileId: body.target.sandboxProfileId }),
                  ...(body.target.sandboxProfileVersion === undefined
                    ? {}
                    : { sandboxProfileVersion: body.target.sandboxProfileVersion }),
                },
              }),
          organizationId: session.session.activeOrganizationId,
        });

      return ctx.json(toAutomationWebhookResponse(automationWebhook), 200);
    } catch (error) {
      return handleAutomationWebhookError(ctx, error);
    }
  });

  routes.openapi(deleteAutomationWebhookRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = requireSession(ctx);
      await ctx.get("services").automationWebhooks.deleteWebhookAutomation({
        automationId: params.automationId,
        organizationId: session.session.activeOrganizationId,
      });

      const responseBody: z.infer<typeof DeleteAutomationWebhookResponseSchema> = {
        status: "deleted",
        automationId: params.automationId,
      };

      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleAutomationWebhookNotFoundError(ctx, error);
    }
  });

  return {
    basePath: AUTOMATION_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}

function requireSession(ctx: AppContext) {
  const session = ctx.get("session");

  if (session === null) {
    throw new Error("Expected authenticated session to be available.");
  }

  return session;
}

function toAutomationWebhookResponse(
  automationWebhook: AutomationWebhookAggregate,
): z.infer<typeof AutomationWebhookSchema> {
  return {
    ...automationWebhook,
    ...(automationWebhook.eventTypes === null
      ? { eventTypes: null }
      : { eventTypes: [...automationWebhook.eventTypes] }),
    kind: "webhook",
  };
}

function handleAutomationWebhookBadRequestError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksBadRequestError) {
    const responseBody: z.infer<typeof AutomationWebhooksBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}

function handleAutomationWebhookError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksBadRequestError) {
    const responseBody: z.infer<typeof AutomationWebhooksBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof AutomationWebhooksNotFoundError) {
    const responseBody: z.infer<typeof AutomationWebhooksNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleAutomationWebhookNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksNotFoundError) {
    const responseBody: z.infer<typeof AutomationWebhooksNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
