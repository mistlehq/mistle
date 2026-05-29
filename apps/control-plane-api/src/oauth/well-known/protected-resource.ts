import type { Context } from "hono";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import type { AppContextBindings, ControlPlaneApiMcpConfig } from "../../types.js";

export const McpOAuthScopes = [
  OrganizationPermissions.SANDBOX_PROFILE_READ,
  OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  OrganizationPermissions.SANDBOX_SESSION_CREATE,
  OrganizationPermissions.SANDBOX_SESSION_READ,
  OrganizationPermissions.SANDBOX_SESSION_CONNECT,
] as const satisfies readonly OrganizationPermission[];

export type OAuthProtectedResourceMetadata = {
  resource: string;
  authorization_servers: [string];
  scopes_supported: typeof McpOAuthScopes;
  bearer_methods_supported: ["header"];
};

export function createMcpProtectedResourceMetadata(input: {
  mcpResource: string;
  authorizationServer: string;
}): OAuthProtectedResourceMetadata {
  return {
    resource: input.mcpResource,
    authorization_servers: [input.authorizationServer],
    scopes_supported: McpOAuthScopes,
    bearer_methods_supported: ["header"],
  };
}

export function requireCanonicalMcpResourceUrl(config: ControlPlaneApiMcpConfig): URL {
  const resourceUrl = new URL(config.url);
  if (resourceUrl.protocol !== "https:" && resourceUrl.protocol !== "http:") {
    throw new Error("MCP URL must use http or https.");
  }

  if (resourceUrl.pathname === "/" || resourceUrl.pathname.length === 0) {
    throw new Error("MCP URL must include a path.");
  }
  if (resourceUrl.search.length > 0 || resourceUrl.hash.length > 0) {
    throw new Error("MCP URL must not include a query string or fragment.");
  }

  return resourceUrl;
}

export function getMcpProtectedResourceMetadataUrl(config: ControlPlaneApiMcpConfig): string {
  const mcpResourceUrl = requireCanonicalMcpResourceUrl(config);
  return new URL("/.well-known/oauth-protected-resource/mcp", mcpResourceUrl).toString();
}

export function isConfiguredMcpResourceRequest(ctx: Context<AppContextBindings>): boolean {
  const config = ctx.get("config").mcp;
  const configuredResourceUrl = requireCanonicalMcpResourceUrl(config);
  const requestUrl = createEffectivePublicRequestUrlFromContext(ctx);

  return matchesMcpResourceUrl({
    requestUrl,
    configuredResourceUrl,
  });
}

export function isConfiguredMcpProtectedResourceMetadataRequest(
  ctx: Context<AppContextBindings>,
): boolean {
  const configuredResourceUrl = requireCanonicalMcpResourceUrl(ctx.get("config").mcp);
  const requestUrl = createEffectivePublicRequestUrlFromContext(ctx);
  const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", configuredResourceUrl);

  return (
    requestUrl.protocol === metadataUrl.protocol &&
    requestUrl.host === metadataUrl.host &&
    requestUrl.pathname === metadataUrl.pathname
  );
}

export function createEffectivePublicRequestUrl(input: {
  requestUrl: string;
  trustForwardedHeaders: boolean;
  forwarded: string | null;
  xForwardedProto: string | null;
  xForwardedHost: string | null;
}): URL {
  const requestUrl = new URL(input.requestUrl);
  if (!input.trustForwardedHeaders) {
    return requestUrl;
  }

  const forwarded = parseForwardedHeader(input.forwarded);
  const proto =
    forwarded === null
      ? parseFirstHeaderValue(input.xForwardedProto)
      : requireForwardedHeaderPart(forwarded.proto, "proto");
  const host =
    forwarded === null
      ? parseFirstHeaderValue(input.xForwardedHost)
      : requireForwardedHeaderPart(forwarded.host, "host");
  if (proto !== null) {
    requestUrl.protocol = proto.endsWith(":") ? proto : `${proto}:`;
  }
  if (host !== null) {
    requestUrl.host = host;
  }

  return requestUrl;
}

function requireForwardedHeaderPart(value: string | null, name: string): string {
  if (value === null) {
    throw new Error(`Trusted Forwarded header is missing ${name}.`);
  }

  return value;
}

function createEffectivePublicRequestUrlFromContext(ctx: Context<AppContextBindings>): URL {
  const config = ctx.get("config").mcp;
  return createEffectivePublicRequestUrl({
    requestUrl: ctx.req.url,
    trustForwardedHeaders: config.trustForwardedHeaders,
    forwarded: ctx.req.header("forwarded") ?? null,
    xForwardedProto: ctx.req.header("x-forwarded-proto") ?? null,
    xForwardedHost: ctx.req.header("x-forwarded-host") ?? null,
  });
}

export function matchesMcpResourceUrl(input: {
  requestUrl: URL;
  configuredResourceUrl: URL;
}): boolean {
  return (
    input.requestUrl.protocol === input.configuredResourceUrl.protocol &&
    input.requestUrl.host === input.configuredResourceUrl.host &&
    input.requestUrl.pathname === input.configuredResourceUrl.pathname
  );
}

function parseForwardedHeader(
  header: string | null,
): { proto: string | null; host: string | null } | null {
  const firstEntry = parseFirstHeaderValue(header);
  if (firstEntry === null) {
    return null;
  }

  let proto: string | null = null;
  let host: string | null = null;
  for (const rawPart of firstEntry.split(";")) {
    const [rawName, ...rawValueParts] = rawPart.split("=");
    const name = rawName?.trim().toLowerCase();
    const value = rawValueParts.join("=").trim();
    if (name === "proto" && value.length > 0) {
      proto = unquoteForwardedValue(value);
    }
    if (name === "host" && value.length > 0) {
      host = unquoteForwardedValue(value);
    }
  }

  return { proto, host };
}

function parseFirstHeaderValue(header: string | null): string | null {
  const value = header?.split(",")[0]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function unquoteForwardedValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value;
}
