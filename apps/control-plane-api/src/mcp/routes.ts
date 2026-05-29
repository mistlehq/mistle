import { systemClock } from "@mistle/time";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import { isConfiguredMcpResourceRequest } from "../oauth/well-known/protected-resource.js";
import type { AppContextBindings, AppRoutes } from "../types.js";
import { MCP_ROUTE_BASE_PATH } from "./constants.js";
import { createMistleMcpServer } from "./server.js";

export function createMcpRoutes(): AppRoutes<typeof MCP_ROUTE_BASE_PATH> {
  const routes = new Hono<AppContextBindings>();

  routes.all("/", async (ctx) => {
    if (!isConfiguredMcpResourceRequest(ctx)) {
      return ctx.notFound();
    }

    const organizationActor = ctx.get("organizationActor");
    if (organizationActor === null) {
      throw new Error("Expected organization actor to be available.");
    }
    const { integrations: integrationsConfig, mcp: mcpConfig } = ctx.get("config");

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMistleMcpServer({
      clock: systemClock,
      controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
      dashboardBaseUrl: ctx.get("config").dashboard.baseUrl,
      dataPlaneClient: ctx.get("dataPlaneClient"),
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig,
      mcpConfig,
      organizationActor,
      portAccessConfig: ctx.get("portAccessConfig"),
      sandboxConfig: ctx.get("sandboxConfig"),
    });
    await server.connect(transport);

    return transport.handleRequest(ctx.req.raw);
  });

  return {
    basePath: MCP_ROUTE_BASE_PATH,
    routes,
  };
}
