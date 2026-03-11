export type EgressTelemetryBaseAttributesInput = {
  routeId?: string;
  method: string;
  requestPath: string;
  bindingId: string;
  connectionId: string;
};

export function createEgressTelemetryBaseAttributes(
  input: EgressTelemetryBaseAttributesInput,
): Record<string, string> {
  return {
    ...(input.routeId === undefined ? {} : { "mistle.egress.route_id": input.routeId }),
    "mistle.integration.binding_id": input.bindingId,
    "mistle.integration.connection_id": input.connectionId,
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
