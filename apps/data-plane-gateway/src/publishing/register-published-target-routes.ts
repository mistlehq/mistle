import type { NodeWebSocket } from "@hono/node-ws";
import {
  parsePublishedTargetHost,
  PublishedTargetHostError,
  type ParsedPublishedTargetHost,
} from "@mistle/published-target-auth";
import type { PublishTargetAuthorizeResult } from "@mistle/sandbox-session-protocol";

import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type { DataPlaneGatewayApp, DataPlaneGatewayRuntimeConfig } from "../types.js";
import {
  PublishedTargetBootstrapError,
  verifyOwnedPublishedTargetBootstrapRequest,
  verifySharedPublishedTargetBootstrapRequest,
} from "./auth/published-target-bootstrap.js";
import {
  mintPublishedTargetSessionSetCookieHeader,
  PublishedTargetRequestCookieError,
  verifyPublishedTargetSessionFromCookieHeader,
} from "./auth/published-target-session-cookie.js";
import {
  BootstrapPublishControlBootstrapDisconnectedError,
  BootstrapPublishControlRequestCoordinator,
  BootstrapPublishControlRequestTimeoutError,
} from "./bootstrap-publish-control-request-coordinator.js";
import { BootstrapPublishRouter, PublishedHttpRequestError } from "./bootstrap-publish-router.js";

type RegisterPublishedTargetRoutesInput = {
  app: DataPlaneGatewayApp;
  bootstrapPublishControlRequestCoordinator: BootstrapPublishControlRequestCoordinator;
  environment: DataPlaneGatewayRuntimeConfig["environment"];
  publishConfig: DataPlaneGatewayRuntimeConfig["sandbox"]["publish"];
  publishRouter: BootstrapPublishRouter;
  relayCoordinator: TunnelRelayCoordinator;
  tunnelSessionRegistry: TunnelSessionRegistry;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
};

class PublishedTargetAuthorizationError extends Error {
  public constructor(public readonly reason: PublishTargetAuthorizeResult["reason"]) {
    super(
      reason === undefined
        ? "Published target authorization failed."
        : `Published target authorization failed: ${reason}.`,
    );
    this.name = "PublishedTargetAuthorizationError";
  }
}

function createAuthorizePayload(input: { port: number; requestId: string }): string {
  return JSON.stringify({
    type: "publish.target.authorize",
    requestId: input.requestId,
    target: {
      kind: "port",
      port: input.port,
    },
  });
}

function getRemainingTokenLifetimeSeconds(expiresAtEpochSeconds: number): number {
  return Math.max(1, expiresAtEpochSeconds - Math.floor(Date.now() / 1000));
}

function createAuthorizeStatus(input: { reason: PublishTargetAuthorizeResult["reason"] }): number {
  switch (input.reason) {
    case "target_internal":
      return 403;
    case "target_not_found":
      return 404;
    case "target_not_live":
      return 409;
    default:
      return 500;
  }
}

async function authorizePublishedPort(input: {
  bootstrapPublishControlRequestCoordinator: BootstrapPublishControlRequestCoordinator;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  tunnelSessionRegistry: TunnelSessionRegistry;
  port: number;
}): Promise<void> {
  const bootstrapTarget = input.tunnelSessionRegistry.getBootstrapTarget({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (bootstrapTarget === undefined) {
    throw new PublishedTargetBootstrapError(
      `Sandbox bootstrap tunnel is not connected for '${input.sandboxInstanceId}'.`,
    );
  }

  const pendingAuthorizeRequest =
    input.bootstrapPublishControlRequestCoordinator.beginAuthorizeRequest({
      sandboxInstanceId: input.sandboxInstanceId,
    });

  await input.relayCoordinator.forwardPeerMessage({
    sandboxInstanceId: input.sandboxInstanceId,
    fromSide: "connection",
    payload: createAuthorizePayload({
      port: input.port,
      requestId: pendingAuthorizeRequest.requestId,
    }),
  });

  const authorizeResult = await pendingAuthorizeRequest.result;
  if (authorizeResult.authorized) {
    return;
  }

  throw new PublishedTargetAuthorizationError(authorizeResult.reason);
}

function createBootstrapErrorResponse(error: unknown): Response {
  if (error instanceof PublishedTargetBootstrapError) {
    return new Response(error.message, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 400,
    });
  }
  if (error instanceof BootstrapPublishControlRequestTimeoutError) {
    return new Response(error.message, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 504,
    });
  }
  if (error instanceof BootstrapPublishControlBootstrapDisconnectedError) {
    return new Response(error.message, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    });
  }
  if (error instanceof PublishedTargetAuthorizationError) {
    return new Response(error.message, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: createAuthorizeStatus({
        reason: error.reason,
      }),
    });
  }

  throw error;
}

type ParsedPublishedPortHost = ParsedPublishedTargetHost & {
  target: {
    kind: "port";
    port: number;
  };
};

function parsePublishedPortHost(input: {
  baseDomain: string;
  host: string | undefined;
}): ParsedPublishedPortHost | undefined {
  if (input.host === undefined) {
    return undefined;
  }

  try {
    const parsedHost = parsePublishedTargetHost({
      baseDomain: input.baseDomain,
      host: input.host,
    });
    if (parsedHost.target.kind !== "port") {
      return undefined;
    }

    return {
      ...parsedHost,
      target: {
        kind: "port",
        port: parsedHost.target.port,
      },
    };
  } catch (error) {
    if (error instanceof PublishedTargetHostError) {
      return undefined;
    }

    throw error;
  }
}

function createTextErrorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function verifyPublishedPortSession(input: {
  cookieHeader: string | undefined;
  parsedHost: ParsedPublishedPortHost;
  publishConfig: DataPlaneGatewayRuntimeConfig["sandbox"]["publish"];
}):
  | {
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
    } {
  let session;
  try {
    session = verifyPublishedTargetSessionFromCookieHeader({
      config: input.publishConfig.session,
      cookieHeader: input.cookieHeader,
      expectedHost: input.parsedHost.host,
    });
  } catch (error) {
    if (error instanceof PublishedTargetRequestCookieError) {
      return {
        message: error.message,
        ok: false,
        status: 401,
      };
    }

    throw error;
  }

  if (
    session.sandboxInstanceId !== input.parsedHost.sandboxInstanceId ||
    session.targetKind !== "port" ||
    session.targetId !== String(input.parsedHost.target.port)
  ) {
    return {
      message: "Published target session does not match the requested host target.",
      ok: false,
      status: 403,
    };
  }

  return {
    ok: true,
  };
}

export function registerPublishedTargetRoutes(input: RegisterPublishedTargetRoutesInput): void {
  input.app.get("/_mistle/bootstrap", async (ctx) => {
    try {
      const { parsedHost, verifiedToken } = await verifyOwnedPublishedTargetBootstrapRequest({
        accessTokenConfig: input.publishConfig.access,
        baseDomain: input.publishConfig.baseDomain,
        host: ctx.req.header("host"),
        requestUrl: ctx.req.url,
      });

      await authorizePublishedPort({
        bootstrapPublishControlRequestCoordinator: input.bootstrapPublishControlRequestCoordinator,
        relayCoordinator: input.relayCoordinator,
        sandboxInstanceId: parsedHost.sandboxInstanceId,
        tunnelSessionRegistry: input.tunnelSessionRegistry,
        port: parsedHost.target.port,
      });

      const setCookieHeader = mintPublishedTargetSessionSetCookieHeader({
        baseDomain: input.publishConfig.baseDomain,
        config: input.publishConfig.session,
        environment: input.environment,
        host: parsedHost.host,
        maxAgeSeconds: getRemainingTokenLifetimeSeconds(verifiedToken.expiresAtEpochSeconds),
        session: {
          sessionKind: "owned",
          organizationId: verifiedToken.organizationId,
          sandboxInstanceId: verifiedToken.sandboxInstanceId,
          targetId: verifiedToken.targetId,
          targetKind: verifiedToken.targetKind,
          userId: verifiedToken.userId,
        },
      });

      ctx.header("set-cookie", setCookieHeader);
      return ctx.redirect("/", 302);
    } catch (error) {
      return createBootstrapErrorResponse(error);
    }
  });

  input.app.get("/_mistle/share", async (ctx) => {
    try {
      const { parsedHost, verifiedToken } = await verifySharedPublishedTargetBootstrapRequest({
        baseDomain: input.publishConfig.baseDomain,
        host: ctx.req.header("host"),
        requestUrl: ctx.req.url,
        shareTokenConfig: input.publishConfig.access,
      });

      await authorizePublishedPort({
        bootstrapPublishControlRequestCoordinator: input.bootstrapPublishControlRequestCoordinator,
        relayCoordinator: input.relayCoordinator,
        sandboxInstanceId: parsedHost.sandboxInstanceId,
        tunnelSessionRegistry: input.tunnelSessionRegistry,
        port: parsedHost.target.port,
      });

      const setCookieHeader = mintPublishedTargetSessionSetCookieHeader({
        baseDomain: input.publishConfig.baseDomain,
        config: input.publishConfig.session,
        environment: input.environment,
        host: parsedHost.host,
        maxAgeSeconds: getRemainingTokenLifetimeSeconds(verifiedToken.expiresAtEpochSeconds),
        session: {
          sessionKind: "shared",
          sandboxInstanceId: verifiedToken.sandboxInstanceId,
          targetId: verifiedToken.targetId,
          targetKind: verifiedToken.targetKind,
        },
      });

      ctx.header("set-cookie", setCookieHeader);
      return ctx.redirect("/", 302);
    } catch (error) {
      return createBootstrapErrorResponse(error);
    }
  });

  input.app.get("*", async (ctx, next) => {
    if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
      await next();
      return;
    }

    const parsedHost = parsePublishedPortHost({
      baseDomain: input.publishConfig.baseDomain,
      environment: input.environment,
      host: ctx.req.header("host"),
      localBaseDomain: input.publishConfig.localBaseDomain,
    });
    if (parsedHost === undefined) {
      await next();
      return;
    }

    if (ctx.req.path === "/_mistle/bootstrap" || ctx.req.path === "/_mistle/share") {
      await next();
      return;
    }

    const sessionResult = verifyPublishedPortSession({
      cookieHeader: ctx.req.header("cookie"),
      parsedHost,
      publishConfig: input.publishConfig,
    });
    if (!sessionResult.ok) {
      return createTextErrorResponse(sessionResult.status, sessionResult.message);
    }

    try {
      const admittedWebSocket = {
        sandboxInstanceId: parsedHost.sandboxInstanceId,
        streamId: await input.publishRouter.openPublishedWebSocket({
          host: parsedHost.host,
          request: ctx.req.raw,
          sandboxInstanceId: parsedHost.sandboxInstanceId,
          targetPort: parsedHost.target.port,
        }),
      };

      return input.upgradeWebSocket(ctx, {
        onClose: (event) => {
          void input.publishRouter.closePublishedWebSocket({
            code: event.code,
            ...(event.reason.length === 0
              ? {}
              : {
                  reason: event.reason,
                }),
            sandboxInstanceId: admittedWebSocket.sandboxInstanceId,
            streamId: admittedWebSocket.streamId,
          });
        },
        onError: (_event, ws) => {
          ws.raw?.terminate();
          void input.publishRouter.failPublishedWebSocket({
            sandboxInstanceId: admittedWebSocket.sandboxInstanceId,
            streamId: admittedWebSocket.streamId,
          });
        },
        onMessage: (event) => {
          void input.publishRouter.forwardBrowserWebSocketFrame({
            data: event.data,
            sandboxInstanceId: admittedWebSocket.sandboxInstanceId,
            streamId: admittedWebSocket.streamId,
          });
        },
        onOpen: (_event, ws) => {
          input.publishRouter.bindPublishedWebSocket({
            browserSocket: ws,
            sandboxInstanceId: admittedWebSocket.sandboxInstanceId,
            streamId: admittedWebSocket.streamId,
          });
        },
      });
    } catch (error) {
      if (error instanceof PublishedHttpRequestError) {
        return createTextErrorResponse(error.status, error.message);
      }

      throw error;
    }
  });

  input.app.all("*", async (ctx, next) => {
    const parsedHost = parsePublishedPortHost({
      baseDomain: input.publishConfig.baseDomain,
      host: ctx.req.header("host"),
    });
    if (parsedHost === undefined) {
      await next();
      return;
    }

    if (ctx.req.path === "/_mistle/bootstrap" || ctx.req.path === "/_mistle/share") {
      await next();
      return;
    }

    const sessionResult = verifyPublishedPortSession({
      cookieHeader: ctx.req.header("cookie"),
      parsedHost,
      publishConfig: input.publishConfig,
    });
    if (!sessionResult.ok) {
      return createTextErrorResponse(sessionResult.status, sessionResult.message);
    }

    try {
      return await input.publishRouter.proxyPublishedHttpRequest({
        host: parsedHost.host,
        request: ctx.req.raw,
        sandboxInstanceId: parsedHost.sandboxInstanceId,
        targetPort: parsedHost.target.port,
      });
    } catch (error) {
      if (error instanceof PublishedHttpRequestError) {
        return createTextErrorResponse(error.status, error.message);
      }

      throw error;
    }
  });
}
