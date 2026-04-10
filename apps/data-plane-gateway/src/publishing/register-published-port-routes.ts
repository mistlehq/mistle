import {
  parsePublishedPortHost,
  PublishedPortBootstrapTokenError,
  PublishedPortHostError,
  verifyPublishedPortBootstrapToken,
  type PublishedPortBootstrapTokenConfig,
} from "@mistle/published-port-auth";

import type { DataPlaneGatewayApp } from "../types.js";
import {
  mintPublishedPortSessionCookieValue,
  serializePublishedPortSessionSetCookie,
} from "./auth/published-port-session.js";
import {
  PortsTargetAuthorizeError,
  PortsTargetAuthorizeService,
} from "./ports-target-authorize-service.js";

const PublishedPortSessionTtlSeconds = 3600;

export function registerPublishedPortRoutes(input: {
  app: DataPlaneGatewayApp;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  publishConfig: {
    baseDomain: string;
    access: PublishedPortBootstrapTokenConfig;
    session: {
      cookieSigningSecret: string;
    };
  };
}): void {
  input.app.get("/_mistle/bootstrap", async (ctx) => {
    const hostHeader = ctx.req.header("host") ?? "";
    const token = ctx.req.query("token") ?? "";

    let parsedHost;
    try {
      parsedHost = parsePublishedPortHost({
        config: {
          baseDomain: input.publishConfig.baseDomain,
        },
        host: hostHeader,
      });
    } catch (error) {
      if (error instanceof PublishedPortHostError) {
        return ctx.json(
          {
            code: error.code,
            message: error.message,
          },
          400,
        );
      }

      throw error;
    }

    let verifiedToken;
    try {
      verifiedToken = await verifyPublishedPortBootstrapToken({
        config: input.publishConfig.access,
        token,
      });
    } catch (error) {
      if (error instanceof PublishedPortBootstrapTokenError) {
        return ctx.json(
          {
            code: error.code,
            message: error.message,
          },
          401,
        );
      }

      throw error;
    }

    if (
      verifiedToken.host !== parsedHost.host ||
      verifiedToken.sandboxInstanceId !== parsedHost.sandboxInstanceId ||
      verifiedToken.port !== parsedHost.port
    ) {
      return ctx.json(
        {
          code: "BOOTSTRAP_BINDING_MISMATCH",
          message: "Publish bootstrap token does not match the requested host.",
        },
        401,
      );
    }

    let authorizeResult;
    try {
      authorizeResult = await input.portsTargetAuthorizeService.authorizePort({
        sandboxInstanceId: verifiedToken.sandboxInstanceId,
        port: verifiedToken.port,
      });
    } catch (error) {
      if (error instanceof PortsTargetAuthorizeError) {
        return ctx.json(
          {
            code: error.code,
            message: error.message,
          },
          409,
        );
      }

      throw error;
    }

    if (!authorizeResult.authorized) {
      return ctx.json(
        {
          code: authorizeResult.reason,
          message:
            authorizeResult.reason === "port_unreachable"
              ? "Sandbox port could not be reached at publish time."
              : "Sandbox port does not speak a supported browser-publish protocol.",
        },
        409,
      );
    }

    const sessionExpiresAtEpochSeconds =
      Math.floor(Date.now() / 1000) + PublishedPortSessionTtlSeconds;
    const sessionCookieValue = mintPublishedPortSessionCookieValue({
      cookieSigningSecret: input.publishConfig.session.cookieSigningSecret,
      expiresAtEpochSeconds: sessionExpiresAtEpochSeconds,
      host: parsedHost.host,
      sandboxInstanceId: parsedHost.sandboxInstanceId,
      port: parsedHost.port,
      protocol: authorizeResult.protocol,
      websocketCapable: authorizeResult.websocketCapable,
    });

    ctx.header(
      "set-cookie",
      serializePublishedPortSessionSetCookie({
        cookieValue: sessionCookieValue,
        expiresAtEpochSeconds: sessionExpiresAtEpochSeconds,
        isSecure: new URL(ctx.req.url).protocol === "https:",
      }),
    );

    return ctx.redirect("/", 302);
  });
}
