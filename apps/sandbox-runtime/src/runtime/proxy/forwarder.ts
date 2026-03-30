import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import {
  copyHeadersWithoutHopByHop,
  headerBagFromIncomingHeaders,
  headerBagToOutgoingHeaders,
  type HeaderBag,
} from "./headers.js";

export const HEADER_EGRESS_GRANT = "x-mistle-egress-grant";

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
  egressGrant: string;
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
  setHeader(headers, HEADER_EGRESS_GRANT, input.egressGrant);

  return {
    url: tokenizerProxyUrl,
    method: input.method,
    headers: headerBagToOutgoingHeaders(headers),
    body: input.body,
  };
}
