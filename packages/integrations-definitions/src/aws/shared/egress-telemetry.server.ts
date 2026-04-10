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
