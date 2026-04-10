import {
  createAwsResponseTelemetryAttributes,
  createAwsSigV4TelemetryAttributes,
} from "./aws/shared/egress-telemetry.server.js";

type AwsSigV4EgressTelemetryHandler = {
  type: "aws_sigv4";
  createRequestTelemetryAttributes: typeof createAwsSigV4TelemetryAttributes;
  createResponseTelemetryAttributes: typeof createAwsResponseTelemetryAttributes;
};

export type ProviderEgressTelemetryHandler = AwsSigV4EgressTelemetryHandler;

const AwsSigV4EgressTelemetryHandler: AwsSigV4EgressTelemetryHandler = {
  type: "aws_sigv4",
  createRequestTelemetryAttributes: createAwsSigV4TelemetryAttributes,
  createResponseTelemetryAttributes: createAwsResponseTelemetryAttributes,
};

export function resolveProviderEgressTelemetryHandler(
  authInjectionType: string,
): ProviderEgressTelemetryHandler | undefined {
  if (authInjectionType === "aws_sigv4") {
    return AwsSigV4EgressTelemetryHandler;
  }

  return undefined;
}
