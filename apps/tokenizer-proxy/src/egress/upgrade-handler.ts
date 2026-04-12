import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Socket } from "node:net";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { EgressGrantConfig } from "@mistle/sandbox-egress-auth";

import { logger } from "../logger.js";
import { EGRESS_BASE_PATH, EgressRequestHeaders } from "./constants.js";
import { CredentialCache, type CachedCredential } from "./credential-cache.js";
import {
  authorizeEgressGrant,
  EgressGrantRequestError,
  type AuthorizedEgressGrant,
  type StaticAuthorizedEgressGrant,
} from "./grant.js";

type CreateEgressProxyUpgradeHandlerInput = {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  egressGrantConfig: EgressGrantConfig;
};

type CredentialCacheKey = Parameters<CredentialCache["get"]>[0];
type CredentialResolverInput = {
  connectionId: string;
  secretType: string;
  slotKey?: string;
  resolverKey?: string;
};

function readOptionalHeader(headers: IncomingHttpHeaders, headerName: string): string | undefined {
  const value = headers[headerName.toLowerCase()];
  if (value === undefined) {
    return undefined;
  }

  const firstValue = Array.isArray(value) ? value[0] : value;
  if (firstValue === undefined) {
    return undefined;
  }

  const trimmedValue = firstValue.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

function joinPath(basePath: string, suffixPath: string): string {
  const normalizedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedSuffixPath = suffixPath.startsWith("/") ? suffixPath.slice(1) : suffixPath;

  if (normalizedBasePath.length === 0 || normalizedBasePath === "/") {
    return normalizedSuffixPath.length === 0 ? "/" : `/${normalizedSuffixPath}`;
  }

  return normalizedSuffixPath.length === 0
    ? normalizedBasePath
    : `${normalizedBasePath}/${normalizedSuffixPath}`;
}

function resolveTargetPath(requestUrl: string): string {
  const requestPath = new URL(requestUrl, "http://tokenizer-proxy.internal").pathname;
  if (requestPath === EGRESS_BASE_PATH) {
    return "/";
  }

  if (!requestPath.startsWith(`${EGRESS_BASE_PATH}/`)) {
    throw new Error(
      `Egress request path '${requestPath}' is outside egress scope '${EGRESS_BASE_PATH}'.`,
    );
  }

  return requestPath.slice(EGRESS_BASE_PATH.length);
}

function normalizePath(path: string): string {
  if (path === "") {
    return "/";
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

function resolveForwardPath(basePath: string, targetPath: string): string {
  const normalizedBasePath = normalizePath(basePath);
  const normalizedTargetPath = normalizePath(targetPath);

  if (
    normalizedBasePath !== "/" &&
    (normalizedTargetPath === normalizedBasePath ||
      normalizedTargetPath.startsWith(`${normalizedBasePath}/`))
  ) {
    return normalizedTargetPath;
  }

  return joinPath(normalizedBasePath, normalizedTargetPath);
}

function createUpstreamUrl(input: {
  requestUrl: string;
  targetPath: string;
  upstreamBaseUrl: string;
}): URL {
  const upstreamUrl = new URL(input.upstreamBaseUrl);
  const incomingUrl = new URL(input.requestUrl, "http://tokenizer-proxy.internal");

  upstreamUrl.pathname = resolveForwardPath(upstreamUrl.pathname, input.targetPath);

  for (const [queryKey, queryValue] of incomingUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(queryKey, queryValue);
  }

  upstreamUrl.hash = "";

  return upstreamUrl;
}

function toBasicAuthorizationValue(input: { secretValue: string; username?: string }): string {
  const credentials =
    input.username === undefined ? input.secretValue : `${input.username}:${input.secretValue}`;

  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function toBearerAuthorizationValue(secretValue: string): string {
  return `Bearer ${secretValue}`;
}

function resolveStaticCredentialValueOrThrow(input: {
  credential: CachedCredential;
  context: string;
}): string {
  if (input.credential.kind !== "value") {
    throw new Error(`${input.context} requires a string credential value.`);
  }

  return input.credential.value;
}

function resolveStaticAuthInjectionOrThrow(egressGrant: AuthorizedEgressGrant): {
  authInjectionType: StaticAuthorizedEgressGrant["authInjectionType"];
  authInjectionTarget: string;
  authInjectionUsername?: string;
} {
  if (!("authInjectionTarget" in egressGrant)) {
    throw new Error("Websocket egress auth injection requires a concrete injection target.");
  }

  return {
    authInjectionType: egressGrant.authInjectionType,
    authInjectionTarget: egressGrant.authInjectionTarget,
    ...(egressGrant.authInjectionType !== "basic" || egressGrant.authInjectionUsername === undefined
      ? {}
      : { authInjectionUsername: egressGrant.authInjectionUsername }),
  };
}

function applyAuthInjection(input: {
  upstreamUrl: URL;
  outgoingHeaders: Headers;
  authInjectionType: AuthorizedEgressGrant["authInjectionType"];
  authInjectionTarget: string;
  authInjectionUsername?: string;
  secretValue: string;
}): void {
  switch (input.authInjectionType) {
    case "bearer":
      input.outgoingHeaders.set(
        input.authInjectionTarget,
        toBearerAuthorizationValue(input.secretValue),
      );
      return;
    case "basic":
      input.outgoingHeaders.set(
        input.authInjectionTarget,
        toBasicAuthorizationValue({
          secretValue: input.secretValue,
          ...(input.authInjectionUsername === undefined
            ? {}
            : { username: input.authInjectionUsername }),
        }),
      );
      return;
    case "header":
      input.outgoingHeaders.set(input.authInjectionTarget, input.secretValue);
      return;
    case "query":
      input.upstreamUrl.searchParams.set(input.authInjectionTarget, input.secretValue);
      return;
  }
}

function applyAdditionalHeaders(input: {
  outgoingHeaders: Headers;
  additionalHeaders: Readonly<Record<string, string>>;
}): void {
  for (const [headerName, headerValue] of Object.entries(input.additionalHeaders)) {
    input.outgoingHeaders.set(headerName, headerValue);
  }
}

function createCredentialCacheKey(input: {
  bindingId: string;
  resolver: CredentialResolverInput;
}): CredentialCacheKey {
  return {
    bindingId: input.bindingId,
    connectionId: input.resolver.connectionId,
    secretType: input.resolver.secretType,
    ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
    ...(input.resolver.resolverKey === undefined
      ? {}
      : { resolverKey: input.resolver.resolverKey }),
  };
}

function appendHeader(headers: Headers, headerName: string, headerValue: string | string[]): void {
  if (Array.isArray(headerValue)) {
    for (const value of headerValue) {
      headers.append(headerName, value);
    }
    return;
  }

  headers.append(headerName, headerValue);
}

function removeForwardingHeaders(headers: Headers): void {
  const explicitlyBlockedHeaders = [
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
    "cdn-loop",
    "via",
  ] as const;

  for (const headerName of explicitlyBlockedHeaders) {
    headers.delete(headerName);
  }

  for (const headerName of [...headers.keys()]) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (normalizedHeaderName.startsWith("cf-")) {
      headers.delete(headerName);
    }
  }
}

function buildOutgoingRequestHeaders(headers: IncomingHttpHeaders): Headers {
  const outgoingHeaders = new Headers();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerValue === undefined) {
      continue;
    }

    appendHeader(outgoingHeaders, headerName, headerValue);
  }

  const blockedHeaderNames = [
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    ...Object.values(EgressRequestHeaders).map((headerName) => headerName.toLowerCase()),
  ];

  for (const headerName of blockedHeaderNames) {
    outgoingHeaders.delete(headerName);
  }

  removeForwardingHeaders(outgoingHeaders);

  return outgoingHeaders;
}

function writeFailure(
  socket: Socket,
  statusCode: number,
  statusText: string,
  message: string,
): void {
  socket.end(
    `HTTP/1.1 ${String(statusCode)} ${statusText}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${String(
      Buffer.byteLength(message),
    )}\r\nconnection: close\r\n\r\n${message}`,
  );
}

function writeRawResponse(socket: Socket, response: IncomingMessage): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(
      `HTTP/${response.httpVersion} ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\n`,
    );
    for (const [headerName, headerValue] of Object.entries(response.headers)) {
      if (headerValue === undefined) {
        continue;
      }

      if (Array.isArray(headerValue)) {
        for (const value of headerValue) {
          socket.write(`${headerName}: ${value}\r\n`);
        }
        continue;
      }

      socket.write(`${headerName}: ${headerValue}\r\n`);
    }
    socket.write("\r\n");

    response.on("error", reject);
    response.on("end", () => {
      resolve();
    });
    response.pipe(socket, { end: false });
  });
}

function connectTunnel(left: Socket, right: Socket, head: Buffer): void {
  if (head.length > 0) {
    right.write(head);
  }

  left.pipe(right);
  right.pipe(left);

  left.once("close", () => {
    right.destroy();
  });
  right.once("close", () => {
    left.destroy();
  });
}

async function resolveCredentialValue(input: {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  bindingId: string;
  resolver: CredentialResolverInput;
  context: string;
}): Promise<string> {
  const cacheKey = createCredentialCacheKey({
    bindingId: input.bindingId,
    resolver: input.resolver,
  });

  const cachedCredential = input.credentialCache.get(cacheKey);
  if (cachedCredential !== undefined) {
    return resolveStaticCredentialValueOrThrow({
      credential: cachedCredential,
      context: input.context,
    });
  }

  const resolvedCredential = await input.controlPlaneInternalClient.resolveIntegrationCredential({
    connectionId: input.resolver.connectionId,
    bindingId: input.bindingId,
    secretType: input.resolver.secretType,
    ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
    ...(input.resolver.resolverKey === undefined
      ? {}
      : { resolverKey: input.resolver.resolverKey }),
  });

  input.credentialCache.set(cacheKey, resolvedCredential);
  return resolveStaticCredentialValueOrThrow({
    credential: resolvedCredential,
    context: input.context,
  });
}

export function createEgressProxyUpgradeHandler(input: CreateEgressProxyUpgradeHandlerInput) {
  return (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    void (async () => {
      if ((request.method ?? "GET").toUpperCase() !== "GET") {
        writeFailure(socket, 405, "Method Not Allowed", "Websocket upgrades must use GET.");
        return;
      }

      const requestUrl = request.url;
      if (requestUrl === undefined) {
        writeFailure(socket, 400, "Bad Request", "Upgrade request URL is required.");
        return;
      }

      let targetPath: string;
      try {
        targetPath = resolveTargetPath(requestUrl);
      } catch (error) {
        writeFailure(
          socket,
          400,
          "Bad Request",
          error instanceof Error ? error.message : "Failed to resolve websocket egress target.",
        );
        return;
      }

      let egressGrant: AuthorizedEgressGrant;
      try {
        egressGrant = await authorizeEgressGrant({
          grantToken: readOptionalHeader(request.headers, EgressRequestHeaders.GRANT),
          config: input.egressGrantConfig,
          method: request.method ?? "GET",
          targetPath,
        });
      } catch (error) {
        if (error instanceof EgressGrantRequestError) {
          writeFailure(
            socket,
            error.statusCode,
            error.statusCode === 401 ? "Unauthorized" : "Forbidden",
            error.message,
          );
          return;
        }

        writeFailure(
          socket,
          401,
          "Unauthorized",
          error instanceof Error ? error.message : "Egress grant is invalid.",
        );
        return;
      }

      let credentialValue: string;
      try {
        credentialValue = await resolveCredentialValue({
          controlPlaneInternalClient: input.controlPlaneInternalClient,
          credentialCache: input.credentialCache,
          bindingId: egressGrant.bindingId,
          resolver: {
            connectionId: egressGrant.connectionId,
            secretType: egressGrant.secretType,
            ...(egressGrant.slotKey === undefined ? {} : { slotKey: egressGrant.slotKey }),
            ...(egressGrant.resolverKey === undefined
              ? {}
              : { resolverKey: egressGrant.resolverKey }),
          },
          context: "Websocket egress auth injection",
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            egressRuleId: egressGrant.egressRuleId,
            bindingId: egressGrant.bindingId,
            connectionId: egressGrant.connectionId,
          },
          "Failed to resolve integration credential for websocket egress request",
        );
        writeFailure(socket, 502, "Bad Gateway", "Failed to resolve integration credential.");
        return;
      }

      const upstreamUrl = createUpstreamUrl({
        requestUrl,
        targetPath,
        upstreamBaseUrl: egressGrant.upstreamBaseUrl,
      });

      const outgoingHeaders = buildOutgoingRequestHeaders(request.headers);
      if (egressGrant.additionalHeaders !== undefined) {
        applyAdditionalHeaders({
          outgoingHeaders,
          additionalHeaders: egressGrant.additionalHeaders,
        });
      }
      if (egressGrant.additionalCredentialHeaders !== undefined) {
        try {
          for (const header of egressGrant.additionalCredentialHeaders) {
            const resolvedHeaderValue = await resolveCredentialValue({
              controlPlaneInternalClient: input.controlPlaneInternalClient,
              credentialCache: input.credentialCache,
              bindingId: egressGrant.bindingId,
              resolver: {
                connectionId: header.connectionId,
                secretType: header.secretType,
                ...(header.slotKey === undefined ? {} : { slotKey: header.slotKey }),
                ...(header.resolverKey === undefined ? {} : { resolverKey: header.resolverKey }),
              },
              context: `Additional credential-backed header '${header.header}'`,
            });
            outgoingHeaders.set(header.header, resolvedHeaderValue);
          }
        } catch (error) {
          logger.error(
            {
              err: error,
              egressRuleId: egressGrant.egressRuleId,
              bindingId: egressGrant.bindingId,
            },
            "Failed to resolve additional credential-backed egress headers for websocket request",
          );
          writeFailure(socket, 502, "Bad Gateway", "Failed to resolve integration credential.");
          return;
        }
      }
      applyAuthInjection({
        upstreamUrl,
        outgoingHeaders,
        ...resolveStaticAuthInjectionOrThrow(egressGrant),
        secretValue: credentialValue,
      });

      const sendRequest = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
      const upstreamRequest = sendRequest(upstreamUrl, {
        method: "GET",
        headers: Object.fromEntries(outgoingHeaders.entries()),
      });

      upstreamRequest.once("response", async (upstreamResponse) => {
        try {
          await writeRawResponse(socket, upstreamResponse);
        } catch {
          socket.destroy();
          upstreamResponse.destroy();
          return;
        }

        socket.end();
      });

      upstreamRequest.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
        socket.write(
          `HTTP/${upstreamResponse.httpVersion} ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? ""}\r\n`,
        );
        for (const [headerName, headerValue] of Object.entries(upstreamResponse.headers)) {
          if (headerValue === undefined) {
            continue;
          }

          if (Array.isArray(headerValue)) {
            for (const value of headerValue) {
              socket.write(`${headerName}: ${value}\r\n`);
            }
            continue;
          }

          socket.write(`${headerName}: ${headerValue}\r\n`);
        }
        socket.write("\r\n");

        connectTunnel(socket, upstreamSocket, upstreamHead);
        if (head.length > 0) {
          upstreamSocket.write(head);
        }
      });

      upstreamRequest.once("error", (error) => {
        logger.error(
          {
            err: error,
            egressRuleId: egressGrant.egressRuleId,
            upstreamBaseUrl: egressGrant.upstreamBaseUrl,
          },
          "Failed to forward websocket egress request to upstream",
        );
        writeFailure(socket, 502, "Bad Gateway", "Failed to forward request to upstream.");
      });

      upstreamRequest.end();
    })();
  };
}
