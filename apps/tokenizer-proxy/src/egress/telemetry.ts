export type EgressTelemetryBaseAttributesInput = {
  egressRuleId?: string;
  method: string;
  requestPath: string;
  bindingId: string;
  connectionId?: string;
  providerFamily?: string;
};

export type CredentialCacheTelemetryResult = "hit" | "miss" | "refresh_skew_expired";

export function createEgressTelemetryBaseAttributes(
  input: EgressTelemetryBaseAttributesInput,
): Record<string, string> {
  return {
    ...(input.egressRuleId === undefined ? {} : { "mistle.egress.rule_id": input.egressRuleId }),
    "mistle.integration.binding_id": input.bindingId,
    ...(input.connectionId === undefined
      ? {}
      : { "mistle.integration.connection_id": input.connectionId }),
    ...(input.providerFamily === undefined
      ? {}
      : { "mistle.identity_linking.provider_family": input.providerFamily }),
    "http.request.method": input.method,
    "url.path": input.requestPath,
  };
}

export function createUpstreamTelemetryAttributes(input: {
  upstreamUrl: URL;
}): Record<string, string> {
  return {
    "server.address": input.upstreamUrl.host,
    "url.path": input.upstreamUrl.pathname,
  };
}

export function createCredentialCacheTelemetryAttributes(input: {
  result: CredentialCacheTelemetryResult;
}): Record<string, string> {
  return {
    "mistle.credential.cache.result": input.result,
  };
}
