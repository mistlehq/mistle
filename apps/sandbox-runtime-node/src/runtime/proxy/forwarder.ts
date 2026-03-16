import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import type { EgressCredentialRoute } from "@mistle/integrations-core";

import {
  copyHeadersWithoutHopByHop,
  headerBagFromIncomingHeaders,
  headerBagToOutgoingHeaders,
  type HeaderBag,
} from "./headers.js";

export const HeaderEgressRuleId = "x-mistle-egress-rule-id";
export const HeaderEgressBindingId = "x-mistle-egress-binding-id";
export const HeaderEgressUpstreamBaseUrl = "x-mistle-egress-upstream-base-url";
export const HeaderEgressAuthInjectionType = "x-mistle-egress-auth-injection-type";
export const HeaderEgressAuthInjectionTarget = "x-mistle-egress-auth-injection-target";
export const HeaderEgressAuthInjectionUsername = "x-mistle-egress-auth-injection-username";
export const HeaderEgressConnectionId = "x-mistle-egress-connection-id";
export const HeaderEgressCredentialSecretType = "x-mistle-egress-credential-secret-type";
export const HeaderEgressCredentialPurpose = "x-mistle-egress-credential-purpose";
export const HeaderEgressCredentialResolverKey = "x-mistle-egress-credential-resolver-key";
export const HeaderSandboxProfileId = "x-mistle-sandbox-profile-id";
export const HeaderSandboxProfileVersion = "x-mistle-sandbox-profile-version";

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
  setHeader(headers, HeaderEgressRuleId, input.route.egressRuleId);
  setHeader(headers, HeaderEgressBindingId, input.route.bindingId);
  setHeader(headers, HeaderEgressUpstreamBaseUrl, input.route.upstream.baseUrl);
  setHeader(headers, HeaderEgressAuthInjectionType, input.route.authInjection.type);
  setHeader(headers, HeaderEgressAuthInjectionTarget, input.route.authInjection.target);
  setHeader(headers, HeaderEgressAuthInjectionUsername, input.route.authInjection.username);
  setHeader(headers, HeaderEgressConnectionId, input.route.credentialResolver.connectionId);
  setHeader(headers, HeaderEgressCredentialSecretType, input.route.credentialResolver.secretType);
  setHeader(headers, HeaderEgressCredentialPurpose, input.route.credentialResolver.purpose);
  setHeader(headers, HeaderEgressCredentialResolverKey, input.route.credentialResolver.resolverKey);
  setHeader(headers, HeaderSandboxProfileId, input.runtimePlan.sandboxProfileId);
  setHeader(headers, HeaderSandboxProfileVersion, String(input.runtimePlan.version));

  return {
    url: tokenizerProxyUrl,
    method: input.method,
    headers: headerBagToOutgoingHeaders(headers),
    body: input.body,
  };
}
