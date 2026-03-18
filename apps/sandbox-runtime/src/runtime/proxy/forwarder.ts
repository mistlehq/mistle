import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import type { EgressCredentialRoute } from "@mistle/integrations-core";

import {
  copyHeadersWithoutHopByHop,
  headerBagFromIncomingHeaders,
  headerBagToOutgoingHeaders,
  type HeaderBag,
} from "./headers.js";

export const HEADER_EGRESS_RULE_ID = "x-mistle-egress-rule-id";
export const HEADER_EGRESS_BINDING_ID = "x-mistle-egress-binding-id";
export const HEADER_EGRESS_UPSTREAM_BASE_URL = "x-mistle-egress-upstream-base-url";
export const HEADER_EGRESS_AUTH_INJECTION_TYPE = "x-mistle-egress-auth-injection-type";
export const HEADER_EGRESS_AUTH_INJECTION_TARGET = "x-mistle-egress-auth-injection-target";
export const HEADER_EGRESS_AUTH_INJECTION_USERNAME = "x-mistle-egress-auth-injection-username";
export const HEADER_EGRESS_CONNECTION_ID = "x-mistle-egress-connection-id";
export const HEADER_EGRESS_CREDENTIAL_SECRET_TYPE = "x-mistle-egress-credential-secret-type";
export const HEADER_EGRESS_CREDENTIAL_PURPOSE = "x-mistle-egress-credential-purpose";
export const HEADER_EGRESS_CREDENTIAL_RESOLVER_KEY = "x-mistle-egress-credential-resolver-key";
export const HEADER_SANDBOX_PROFILE_ID = "x-mistle-sandbox-profile-id";
export const HEADER_SANDBOX_PROFILE_VERSION = "x-mistle-sandbox-profile-version";

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

export type BuildTokenizerProxyRequestInput = {
  tokenizerProxyEgressBaseUrl: string;
  runtimePlan: {
    sandboxProfileId: string;
    version: number;
  };
  route: EgressCredentialRoute;
  targetPath: string;
  rawQuery: string;
  method: string;
  headers: IncomingHttpHeaders;
  body: ReadableStream<Uint8Array> | undefined;
};

export type TokenizerProxyRequest = {
  url: URL;
  method: string;
  headers: OutgoingHttpHeaders;
  body: ReadableStream<Uint8Array> | undefined;
};

function setHeader(
  headerBag: HeaderBag,
  headerName: string,
  headerValue: string | undefined,
): void {
  if (headerValue === undefined || headerValue.trim().length === 0) {
    return;
  }

  headerBag.set(headerName, [headerValue]);
}

export function buildTokenizerProxyRequest(
  input: BuildTokenizerProxyRequestInput,
): TokenizerProxyRequest {
  const tokenizerProxyUrl = new URL(input.tokenizerProxyEgressBaseUrl);
  tokenizerProxyUrl.pathname = joinPath(tokenizerProxyUrl.pathname, input.targetPath);
  tokenizerProxyUrl.search = input.rawQuery.length === 0 ? "" : `?${input.rawQuery}`;
  tokenizerProxyUrl.hash = "";

  const headers = copyHeadersWithoutHopByHop(headerBagFromIncomingHeaders(input.headers), true);
  setHeader(headers, HEADER_EGRESS_RULE_ID, input.route.egressRuleId);
  setHeader(headers, HEADER_EGRESS_BINDING_ID, input.route.bindingId);
  setHeader(headers, HEADER_EGRESS_UPSTREAM_BASE_URL, input.route.upstream.baseUrl);
  setHeader(headers, HEADER_EGRESS_AUTH_INJECTION_TYPE, input.route.authInjection.type);
  setHeader(headers, HEADER_EGRESS_AUTH_INJECTION_TARGET, input.route.authInjection.target);
  setHeader(headers, HEADER_EGRESS_AUTH_INJECTION_USERNAME, input.route.authInjection.username);
  setHeader(headers, HEADER_EGRESS_CONNECTION_ID, input.route.credentialResolver.connectionId);
  setHeader(
    headers,
    HEADER_EGRESS_CREDENTIAL_SECRET_TYPE,
    input.route.credentialResolver.secretType,
  );
  setHeader(headers, HEADER_EGRESS_CREDENTIAL_PURPOSE, input.route.credentialResolver.purpose);
  setHeader(
    headers,
    HEADER_EGRESS_CREDENTIAL_RESOLVER_KEY,
    input.route.credentialResolver.resolverKey,
  );
  setHeader(headers, HEADER_SANDBOX_PROFILE_ID, input.runtimePlan.sandboxProfileId);
  setHeader(headers, HEADER_SANDBOX_PROFILE_VERSION, String(input.runtimePlan.version));

  return {
    url: tokenizerProxyUrl,
    method: input.method,
    headers: headerBagToOutgoingHeaders(headers),
    body: input.body,
  };
}
