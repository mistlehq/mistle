import type {
  PortAccessBootstrapTokenConfig,
  PortAccessHostConfig,
} from "@mistle/port-access-auth";
import type { Clock } from "@mistle/time";

import type { DataPlaneGatewayApp } from "../types.js";
import type { PortAccessSessionConfig } from "./auth/port-access-session.js";
import { bootstrapPortAccess } from "./port-access-bootstrap.js";
import type { PortsTargetAuthorizeService } from "./ports-target-authorize-service.js";

const PortAccessBootstrapPath = "/_mistle/access/bootstrap";

function textResponse(message: string, status: 400 | 401 | 403 | 409 | 502): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function registerPortAccessRoutes(input: {
  app: DataPlaneGatewayApp;
  bootstrapTokenConfig: PortAccessBootstrapTokenConfig;
  hostConfig: PortAccessHostConfig;
  sessionConfig: PortAccessSessionConfig;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  clock: Clock;
}): void {
  input.app.get(PortAccessBootstrapPath, async (ctx) => {
    const result = await bootstrapPortAccess({
      bootstrapTokenConfig: input.bootstrapTokenConfig,
      hostConfig: input.hostConfig,
      sessionConfig: input.sessionConfig,
      portsTargetAuthorizeService: input.portsTargetAuthorizeService,
      clock: input.clock,
      requestUrl: ctx.req.url,
      requestHost: ctx.req.header("host"),
      token: ctx.req.query("token"),
      forwardedProto: ctx.req.header("x-forwarded-proto"),
    });

    if (result.kind === "failure") {
      return textResponse(result.message, result.status);
    }

    const response = ctx.redirect(result.location, 302);
    response.headers.append("set-cookie", result.setCookieHeader);
    return response;
  });
}
