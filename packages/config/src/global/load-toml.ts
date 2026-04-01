import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, PartialGlobalConfigSchema } from "./schema.js";

function loadTelemetrySignalFromToml(signalToml: Record<string, unknown>): Record<string, unknown> {
  const signalHeaders = asObjectRecord(signalToml.headers);

  return {
    ...(typeof signalToml.endpoint === "string"
      ? {
          endpoint: signalToml.endpoint,
        }
      : {}),
    ...(Object.keys(signalHeaders).length > 0
      ? {
          headers: signalHeaders,
        }
      : {}),
  };
}

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  const global = asObjectRecord(tomlRoot.global);
  const telemetry = asObjectRecord(global.telemetry);
  const telemetryTraces = asObjectRecord(telemetry.traces);
  const telemetryLogs = asObjectRecord(telemetry.logs);
  const telemetryMetrics = asObjectRecord(telemetry.metrics);
  const telemetryTracesSignal = loadTelemetrySignalFromToml(telemetryTraces);
  const telemetryLogsSignal = loadTelemetrySignalFromToml(telemetryLogs);
  const telemetryMetricsSignal = loadTelemetrySignalFromToml(telemetryMetrics);
  const internalAuth = asObjectRecord(global.internal_auth);
  const sandbox = asObjectRecord(global.sandbox);
  const sandboxBootstrap = asObjectRecord(sandbox.bootstrap);
  const sandboxConnect = asObjectRecord(sandbox.connect);
  const sandboxEgress = asObjectRecord(sandbox.egress);
  const sandboxPublish = asObjectRecord(sandbox.publish);
  const sandboxPublishAccess = asObjectRecord(sandboxPublish.access);
  const sandboxPublishSession = asObjectRecord(sandboxPublish.session);

  return PartialGlobalConfigSchema.parse({
    env: global.env,
    ...(typeof telemetry.enabled === "boolean" ||
    typeof telemetry.debug === "boolean" ||
    Object.keys(telemetryTracesSignal).length > 0 ||
    Object.keys(telemetryLogsSignal).length > 0 ||
    Object.keys(telemetryMetricsSignal).length > 0 ||
    typeof telemetry.resource_attributes === "string"
      ? {
          telemetry: {
            enabled: telemetry.enabled,
            debug: telemetry.debug,
            ...(Object.keys(telemetryTracesSignal).length > 0
              ? {
                  traces: telemetryTracesSignal,
                }
              : {}),
            ...(Object.keys(telemetryLogsSignal).length > 0
              ? {
                  logs: telemetryLogsSignal,
                }
              : {}),
            ...(Object.keys(telemetryMetricsSignal).length > 0
              ? {
                  metrics: telemetryMetricsSignal,
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
    typeof sandboxEgress.token_secret === "string" ||
    typeof sandboxPublish.base_domain === "string" ||
    typeof sandboxPublishAccess.token_secret === "string" ||
    typeof sandboxPublishSession.cookie_signing_secret === "string"
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
            publish: {
              baseDomain: sandboxPublish.base_domain,
              access: {
                tokenSecret: sandboxPublishAccess.token_secret,
                tokenIssuer: sandboxPublishAccess.token_issuer,
                tokenAudience: sandboxPublishAccess.token_audience,
              },
              session: {
                cookieSigningSecret: sandboxPublishSession.cookie_signing_secret,
              },
            },
          },
        }
      : {}),
  });
}
