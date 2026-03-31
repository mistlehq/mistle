import type { PublishTargetAuthorizeResult } from "@mistle/sandbox-session-protocol";

import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type { DataPlaneGatewayApp, DataPlaneGatewayRuntimeConfig } from "../types.js";
import {
  PublishedTargetBootstrapError,
  verifyOwnedPublishedTargetBootstrapRequest,
  verifySharedPublishedTargetBootstrapRequest,
} from "./auth/published-target-bootstrap.js";
import { mintPublishedTargetSessionSetCookieHeader } from "./auth/published-target-session-cookie.js";
import {
  BootstrapPublishControlBootstrapDisconnectedError,
  BootstrapPublishControlRequestCoordinator,
  BootstrapPublishControlRequestTimeoutError,
} from "./bootstrap-publish-control-request-coordinator.js";

type RegisterPublishedTargetRoutesInput = {
  app: DataPlaneGatewayApp;
  bootstrapPublishControlRequestCoordinator: BootstrapPublishControlRequestCoordinator;
  environment: DataPlaneGatewayRuntimeConfig["environment"];
  publishConfig: DataPlaneGatewayRuntimeConfig["sandbox"]["publish"];
  relayCoordinator: TunnelRelayCoordinator;
  tunnelSessionRegistry: TunnelSessionRegistry;
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
}
