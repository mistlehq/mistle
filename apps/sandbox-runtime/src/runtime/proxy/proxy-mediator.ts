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

export type ProxyRoutingDecision =
  | {
      kind: "passthrough";
    }
  | {
      kind: "mediated";
      match: ProxyMediationMatch;
    };

export type ProxyMediator = {
  resolve(
    classification: ProxyRequestClassification,
    request: {
      headers: IncomingHttpHeaders;
      body: ReadableStream<Uint8Array> | undefined;
      rawQuery: string;
    },
  ): ProxyRoutingDecision;
};

export function createProxyMediator(input: {
  runtimePlan: CompiledRuntimePlan;
  tokenizerProxyEgressBaseUrl: string;
  egressGrantByRuleId: Record<string, string>;
}): ProxyMediator {
  return {
    resolve(classification, request) {
      const route = resolveMatchingEgressRoute({
        routes: input.runtimePlan.egressRoutes,
        host: classification.host,
        method: classification.method,
        targetPath: classification.path,
      });

      if (route === undefined) {
        return {
          kind: "passthrough",
        };
      }

      const egressGrant = input.egressGrantByRuleId[route.egressRuleId];
      if (egressGrant === undefined) {
        throw new Error(`missing egress grant for route ${route.egressRuleId}`);
      }

      return {
        kind: "mediated",
        match: {
          route,
          request: buildTokenizerProxyRequest({
            tokenizerProxyEgressBaseUrl: input.tokenizerProxyEgressBaseUrl,
            egressGrant,
            targetPath: classification.path,
            rawQuery: request.rawQuery,
            method: classification.method,
            headers: request.headers,
            body: request.body,
          }),
        },
      };
    },
  };
}
