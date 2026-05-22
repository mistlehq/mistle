import type { IncomingMessage, ServerResponse } from "node:http";

import type { NodeRequestHandler } from "../types.js";

const OidcWellKnownPaths = new Set([
  "/.well-known/openid-configuration",
  "/.well-known/oauth-authorization-server",
]);

const OidcRoutePrefix = "/oauth";

export type OidcProviderRequestCallback = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

export type OidcProviderRequestHandlerInput = {
  callback: () => OidcProviderRequestCallback;
};

export function createOidcProviderNodeRequestHandler(
  provider: OidcProviderRequestHandlerInput,
): NodeRequestHandler {
  const providerRequestHandler = provider.callback();

  return {
    matches: (request) => isOidcProviderRequestPath(request.url),
    handle: providerRequestHandler,
  };
}

export function isOidcProviderRequestPath(requestUrl: string | undefined): boolean {
  if (requestUrl === undefined) {
    return false;
  }

  const pathname = parseRequestPathname(requestUrl);
  return (
    OidcWellKnownPaths.has(pathname) ||
    pathname === OidcRoutePrefix ||
    pathname.startsWith(`${OidcRoutePrefix}/`)
  );
}

function parseRequestPathname(requestUrl: string): string {
  return new URL(requestUrl, "http://control-plane-api.local").pathname;
}
