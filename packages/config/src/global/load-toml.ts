import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, PartialGlobalConfigSchema } from "./schema.js";

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  const global = asObjectRecord(tomlRoot.global);
  const telemetry = asObjectRecord(global.telemetry);
  const telemetryTraces = asObjectRecord(telemetry.traces);
  const telemetryLogs = asObjectRecord(telemetry.logs);
  const telemetryMetrics = asObjectRecord(telemetry.metrics);
  const internalAuth = asObjectRecord(global.internal_auth);
  const sandbox = asObjectRecord(global.sandbox);
  const sandboxBootstrap = asObjectRecord(sandbox.bootstrap);
  const sandboxConnect = asObjectRecord(sandbox.connect);
  const sandboxEgress = asObjectRecord(sandbox.egress);

  return PartialGlobalConfigSchema.parse({
    env: global.env,
    ...(typeof telemetry.enabled === "boolean" ||
    typeof telemetry.debug === "boolean" ||
    typeof telemetryTraces.endpoint === "string" ||
    typeof telemetryLogs.endpoint === "string" ||
    typeof telemetryMetrics.endpoint === "string" ||
    typeof telemetry.resource_attributes === "string"
      ? {
          telemetry: {
            enabled: telemetry.enabled,
            debug: telemetry.debug,
            ...(typeof telemetryTraces.endpoint === "string"
              ? {
                  traces: {
                    endpoint: telemetryTraces.endpoint,
                  },
                }
              : {}),
            ...(typeof telemetryLogs.endpoint === "string"
              ? {
                  logs: {
                    endpoint: telemetryLogs.endpoint,
                  },
                }
              : {}),
            ...(typeof telemetryMetrics.endpoint === "string"
              ? {
                  metrics: {
                    endpoint: telemetryMetrics.endpoint,
                  },
                }
              : {}),
            resourceAttributes: telemetry.resource_attributes,
          },
        }
      : {}),
    ...(typeof internalAuth.service_token === "string"
      ? {
          internalAuth: {
            serviceToken: internalAuth.service_token,
          },
        }
      : {}),
    ...(typeof sandbox.provider === "string" ||
    typeof sandbox.default_base_image === "string" ||
    typeof sandbox.gateway_ws_url === "string" ||
    typeof sandbox.internal_gateway_ws_url === "string" ||
    typeof sandboxBootstrap.token_secret === "string" ||
    typeof sandboxConnect.token_secret === "string" ||
    typeof sandboxEgress.token_secret === "string"
      ? {
          sandbox: {
            provider: sandbox.provider,
            defaultBaseImage: sandbox.default_base_image,
            gatewayWsUrl: sandbox.gateway_ws_url,
            internalGatewayWsUrl: sandbox.internal_gateway_ws_url,
            bootstrap: {
              tokenSecret: sandboxBootstrap.token_secret,
              tokenIssuer: sandboxBootstrap.token_issuer,
              tokenAudience: sandboxBootstrap.token_audience,
            },
            connect: {
              tokenSecret: sandboxConnect.token_secret,
              tokenIssuer: sandboxConnect.token_issuer,
              tokenAudience: sandboxConnect.token_audience,
            },
            egress: {
              tokenSecret: sandboxEgress.token_secret,
              tokenIssuer: sandboxEgress.token_issuer,
              tokenAudience: sandboxEgress.token_audience,
            },
          },
        }
      : {}),
  });
}
