import type { IncomingHttpHeaders } from "node:http";

import type { CompiledRuntimePlan, EgressCredentialRoute } from "@mistle/integrations-core";

import { buildTokenizerProxyRequest, type TokenizerProxyRequest } from "./forwarder.js";
import { resolveMatchingEgressRoute } from "./route-resolver.js";

export type ProxyRequestClassification = {
  host: string;
  method: string;
  path: string;
};

export type ProxyMediationMatch = {
  route: EgressCredentialRoute;
  request: TokenizerProxyRequest;
};

export type ProxyMediator = {
  match(
    classification: ProxyRequestClassification,
    request: {
      headers: IncomingHttpHeaders;
      body: ReadableStream<Uint8Array> | undefined;
      rawQuery: string;
    },
  ): ProxyMediationMatch | undefined;
};

export function createProxyMediator(input: {
  runtimePlan: CompiledRuntimePlan;
  tokenizerProxyEgressBaseUrl: string;
}): ProxyMediator {
  return {
    match(classification, request) {
      const route = resolveMatchingEgressRoute({
        routes: input.runtimePlan.egressRoutes,
        host: classification.host,
        method: classification.method,
        targetPath: classification.path,
      });

      if (route === undefined) {
        return undefined;
      }

      return {
        route,
        request: buildTokenizerProxyRequest({
          tokenizerProxyEgressBaseUrl: input.tokenizerProxyEgressBaseUrl,
          runtimePlan: input.runtimePlan,
          route,
          targetPath: classification.path,
          rawQuery: request.rawQuery,
          method: classification.method,
          headers: request.headers,
          body: request.body,
        }),
      };
    },
  };
}
