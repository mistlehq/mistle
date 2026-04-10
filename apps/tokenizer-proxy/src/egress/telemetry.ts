export type EgressTelemetryBaseAttributesInput = {
  egressRuleId?: string;
  method: string;
  requestPath: string;
  bindingId: string;
  connectionId: string;
};

export type CredentialCacheTelemetryResult = "hit" | "miss" | "refresh_skew_expired";

export function createEgressTelemetryBaseAttributes(
  input: EgressTelemetryBaseAttributesInput,
): Record<string, string> {
  return {
    ...(input.egressRuleId === undefined ? {} : { "mistle.egress.rule_id": input.egressRuleId }),
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

export function createCredentialCacheTelemetryAttributes(input: {
  result: CredentialCacheTelemetryResult;
}): Record<string, string> {
  return {
    "mistle.credential.cache.result": input.result,
  };
}

export function createAwsSigV4TelemetryAttributes(input: {
  service: string;
  region: string;
  hasBody: boolean;
  bodyByteLength: number;
}): Record<string, string | number | boolean> {
  return {
    "mistle.auth.injection.type": "aws_sigv4",
    "mistle.aws.service": input.service,
    "mistle.aws.region": input.region,
    "mistle.aws.request.has_body": input.hasBody,
    "mistle.aws.request.body_bytes": input.bodyByteLength,
  };
}

export function createAwsResponseTelemetryAttributes(input: {
  headers: Headers;
}): Record<string, string> {
  const attributes: Record<string, string> = {};
  const requestId = input.headers.get("x-amz-request-id");
  if (requestId !== null) {
    attributes["mistle.aws.response.request_id"] = requestId;
  }

  const extendedRequestId = input.headers.get("x-amz-id-2");
  if (extendedRequestId !== null) {
    attributes["mistle.aws.response.extended_request_id"] = extendedRequestId;
  }

  const amznRequestId = input.headers.get("x-amzn-requestid");
  if (amznRequestId !== null) {
    attributes["mistle.aws.response.amzn_request_id"] = amznRequestId;
  }

  return attributes;
}
