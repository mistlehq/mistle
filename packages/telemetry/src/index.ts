import { ClientRequest, IncomingMessage, ServerResponse } from "node:http";

import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  type Span,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { PgRequestHookInformation } from "@opentelemetry/instrumentation-pg";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";

const TELEMETRY_STATE_SYMBOL = Symbol.for("@mistle/telemetry/state");
const ENABLED_ENV = "MISTLE_TELEMETRY_ENABLED";
const DEBUG_ENV = "MISTLE_TELEMETRY_DEBUG";
const OTLP_TRACES_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
const OTLP_LOGS_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT";
const OTLP_METRICS_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT";
const OTEL_NODE_ENABLED_INSTRUMENTATIONS_ENV = "OTEL_NODE_ENABLED_INSTRUMENTATIONS";
const DISABLED_VALUES = new Set(["0", "false"]);
const ENABLED_VALUES = new Set(["1", "true"]);
const DEFAULT_NODE_INSTRUMENTATIONS: readonly string[] = ["http", "undici", "pg", "pino"];
const SQL_STATEMENT_LOG_MAX_LENGTH = 1024;
const OTelLog = logs.getLogger("@mistle/telemetry");

type HttpRequestMetadata = {
  kind: "server" | "client";
  method: string;
  target: string;
  host: string | undefined;
  userAgent: string | undefined;
};

const HttpRequestMetadataBySpan = new WeakMap<Span, HttpRequestMetadata>();

function shouldMirrorHookLogsToConsole(): boolean {
  return process.env.NODE_ENV !== "production";
}

type GlobalTelemetryState =
  | {
      status: "disabled";
      serviceName: string;
    }
  | {
      status: "enabled";
      serviceName: string;
      sdk: NodeSDK;
      shutdownPromise: Promise<void> | undefined;
    };

type TelemetryConfig =
  | {
      enabled: false;
      debug: boolean;
    }
  | {
      enabled: true;
      debug: boolean;
      tracesEndpoint: string;
      logsEndpoint: string;
      metricsEndpoint: string;
    };

export type InitializeTelemetryInput = {
  serviceName: string;
  env?: NodeJS.ProcessEnv;
};

export type DisabledTelemetrySignalRuntimeConfig = {
  endpoint?: string | undefined;
};

export type EnabledTelemetrySignalRuntimeConfig = {
  endpoint: string;
};

export type DisabledTelemetryRuntimeConfig = {
  enabled: false;
  debug: boolean;
  traces?: DisabledTelemetrySignalRuntimeConfig | undefined;
  logs?: DisabledTelemetrySignalRuntimeConfig | undefined;
  metrics?: DisabledTelemetrySignalRuntimeConfig | undefined;
  resourceAttributes?: string | undefined;
};

export type EnabledTelemetryRuntimeConfig = {
  enabled: true;
  debug: boolean;
  traces: EnabledTelemetrySignalRuntimeConfig;
  logs: EnabledTelemetrySignalRuntimeConfig;
  metrics: EnabledTelemetrySignalRuntimeConfig;
  resourceAttributes?: string | undefined;
};

export type TelemetryRuntimeConfig = DisabledTelemetryRuntimeConfig | EnabledTelemetryRuntimeConfig;

export type TelemetryHandle = {
  enabled: boolean;
  serviceName: string;
  shutdown: () => Promise<void>;
};

function toHeaderString(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue === "string") {
    return headerValue;
  }

  if (Array.isArray(headerValue)) {
    return headerValue.join(",");
  }

  return undefined;
}

function toOutgoingHeaderString(
  headerValue: number | string | string[] | undefined,
): string | undefined {
  if (typeof headerValue === "number") {
    return String(headerValue);
  }

  return toHeaderString(headerValue);
}

function normalizeSqlStatement(statement: string): string {
  const normalizedStatement = statement.replace(/\s+/g, " ").trim();
  if (normalizedStatement.length <= SQL_STATEMENT_LOG_MAX_LENGTH) {
    return normalizedStatement;
  }

  return `${normalizedStatement.slice(0, SQL_STATEMENT_LOG_MAX_LENGTH)}...`;
}

function inferSqlOperation(statement: string): string {
  const operation = statement.split(" ", 1).at(0);
  if (operation === undefined || operation.length === 0) {
    return "UNKNOWN";
  }

  return operation.toUpperCase();
}

function buildPgQueryLogAttributes(input: {
  operation: string;
  statement: string;
  queryInfo: PgRequestHookInformation;
}): Record<string, string | number> {
  const attributes: Record<string, string | number> = {
    "db.operation.name": input.operation,
    "db.statement": input.statement,
    "db.system.name": "postgresql",
  };

  if (input.queryInfo.connection.database !== undefined) {
    attributes["db.namespace"] = input.queryInfo.connection.database;
  }
  if (input.queryInfo.connection.host !== undefined) {
    attributes["server.address"] = input.queryInfo.connection.host;
  }
  if (input.queryInfo.connection.port !== undefined) {
    attributes["server.port"] = input.queryInfo.connection.port;
  }
  if (input.queryInfo.connection.user !== undefined) {
    attributes["db.user"] = input.queryInfo.connection.user;
  }

  return attributes;
}

function emitPgQueryLog(input: { span: Span; queryInfo: PgRequestHookInformation }): void {
  const statement = normalizeSqlStatement(input.queryInfo.query.text);
  const operation = inferSqlOperation(statement);
  const databaseName = input.queryInfo.connection.database ?? "unknown-db";
  const body = `${operation} ${databaseName}: ${statement}`;

  OTelLog.emit({
    eventName: "db.query",
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body,
    attributes: buildPgQueryLogAttributes({
      operation,
      statement,
      queryInfo: input.queryInfo,
    }),
    context: trace.setSpan(context.active(), input.span),
  });

  if (shouldMirrorHookLogsToConsole()) {
    console.info(`[otel][db.query] ${body}`);
  }
}

function isHealthCheckRequest(request: IncomingMessage): boolean {
  return request.url?.startsWith("/__healthz") === true;
}

function extractHttpRequestMetadata(request: ClientRequest | IncomingMessage): HttpRequestMetadata {
  if (request instanceof IncomingMessage) {
    return {
      kind: "server",
      method: request.method ?? "UNKNOWN",
      target: request.url ?? "/",
      host: toHeaderString(request.headers.host),
      userAgent: toHeaderString(request.headers["user-agent"]),
    };
  }

  return {
    kind: "client",
    method: request.method ?? "UNKNOWN",
    target: request.path,
    host: toOutgoingHeaderString(request.getHeader("host")),
    userAgent: toOutgoingHeaderString(request.getHeader("user-agent")),
  };
}

function emitHttpRequestLog(input: {
  span: Span;
  requestMetadata: HttpRequestMetadata;
  response: IncomingMessage | ServerResponse;
}): void {
  const statusCode = input.response.statusCode ?? 0;
  const attributes: Record<string, string | number> = {
    "http.request.method": input.requestMetadata.method,
    "http.response.status_code": statusCode,
    "url.path": input.requestMetadata.target,
  };

  if (input.requestMetadata.kind === "server") {
    attributes["mistle.http.kind"] = "server";
  } else {
    attributes["mistle.http.kind"] = "client";
  }
  if (input.requestMetadata.host !== undefined) {
    attributes["server.address"] = input.requestMetadata.host;
  }
  if (input.requestMetadata.userAgent !== undefined) {
    attributes["user_agent.original"] = input.requestMetadata.userAgent;
  }

  const eventName =
    input.requestMetadata.kind === "server" ? "http.server.request" : "http.client.request";
  const bodyPrefix =
    input.requestMetadata.kind === "server" ? "HTTP server request" : "HTTP client request";
  const hostSuffix =
    input.requestMetadata.host === undefined ? "" : ` host=${input.requestMetadata.host}`;
  const body = `${bodyPrefix}: ${input.requestMetadata.method} ${input.requestMetadata.target} -> ${String(statusCode)}${hostSuffix}`;

  OTelLog.emit({
    eventName,
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body,
    attributes,
    context: trace.setSpan(context.active(), input.span),
  });

  if (shouldMirrorHookLogsToConsole()) {
    console.info(`[otel][${eventName}] ${body}`);
  }
}

function configureDefaultNodeInstrumentations(): void {
  process.env[OTEL_NODE_ENABLED_INSTRUMENTATIONS_ENV] = DEFAULT_NODE_INSTRUMENTATIONS.join(",");
}

function normalizeBooleanEnv(rawValue: string | undefined, envName: string): boolean | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (ENABLED_VALUES.has(normalizedValue)) {
    return true;
  }
  if (DISABLED_VALUES.has(normalizedValue)) {
    return false;
  }

  throw new Error(
    `${envName} must be one of: ${Array.from(ENABLED_VALUES).join(", ")} or ${Array.from(DISABLED_VALUES).join(", ")}.`,
  );
}

function resolveRequiredEndpoint(env: NodeJS.ProcessEnv, envName: string): string {
  const endpoint = env[envName]?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error(`${envName} is required when ${ENABLED_ENV}=1.`);
  }

  return endpoint;
}

function readTelemetryConfig(env: NodeJS.ProcessEnv): TelemetryConfig {
  const enabled = normalizeBooleanEnv(env[ENABLED_ENV], ENABLED_ENV) ?? false;
  const debug = normalizeBooleanEnv(env[DEBUG_ENV], DEBUG_ENV) ?? false;

  if (!enabled) {
    return {
      enabled: false,
      debug,
    };
  }

  return {
    enabled: true,
    debug,
    tracesEndpoint: resolveRequiredEndpoint(env, OTLP_TRACES_ENDPOINT_ENV),
    logsEndpoint: resolveRequiredEndpoint(env, OTLP_LOGS_ENDPOINT_ENV),
    metricsEndpoint: resolveRequiredEndpoint(env, OTLP_METRICS_ENDPOINT_ENV),
  };
}

function readGlobalState(): GlobalTelemetryState | undefined {
  return (globalThis as Record<symbol, GlobalTelemetryState | undefined>)[TELEMETRY_STATE_SYMBOL];
}

function writeGlobalState(state: GlobalTelemetryState): void {
  (globalThis as Record<symbol, GlobalTelemetryState | undefined>)[TELEMETRY_STATE_SYMBOL] = state;
}

function createDisabledTelemetryHandle(serviceName: string): TelemetryHandle {
  return {
    enabled: false,
    serviceName,
    shutdown: async () => {},
  };
}

function createEnabledTelemetryHandle(
  state: Extract<GlobalTelemetryState, { status: "enabled" }>,
): TelemetryHandle {
  return {
    enabled: true,
    serviceName: state.serviceName,
    shutdown: async () => {
      await shutdownEnabledTelemetry(state);
    },
  };
}

async function shutdownEnabledTelemetry(
  state: Extract<GlobalTelemetryState, { status: "enabled" }>,
): Promise<void> {
  if (state.shutdownPromise !== undefined) {
    await state.shutdownPromise;
    return;
  }

  state.shutdownPromise = state.sdk.shutdown();
  await state.shutdownPromise;
}

export function initializeTelemetry(input: InitializeTelemetryInput): TelemetryHandle {
  const serviceName = input.serviceName.trim();
  if (serviceName.length === 0) {
    throw new Error("Telemetry serviceName is required.");
  }

  const existingState = readGlobalState();
  if (existingState !== undefined) {
    if (existingState.serviceName !== serviceName) {
      throw new Error(
        `Telemetry is already initialized for '${existingState.serviceName}', cannot reinitialize for '${serviceName}'.`,
      );
    }

    if (existingState.status === "disabled") {
      return createDisabledTelemetryHandle(existingState.serviceName);
    }

    return createEnabledTelemetryHandle(existingState);
  }

  const env = input.env ?? process.env;
  const config = readTelemetryConfig(env);

  if (config.debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  if (!config.enabled) {
    const disabledState: GlobalTelemetryState = {
      status: "disabled",
      serviceName,
    };
    writeGlobalState(disabledState);

    return createDisabledTelemetryHandle(serviceName);
  }

  process.env[OTLP_TRACES_ENDPOINT_ENV] = config.tracesEndpoint;
  process.env[OTLP_LOGS_ENDPOINT_ENV] = config.logsEndpoint;
  process.env[OTLP_METRICS_ENDPOINT_ENV] = config.metricsEndpoint;
  configureDefaultNodeInstrumentations();

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: config.tracesEndpoint,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: config.logsEndpoint,
        }),
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: isHealthCheckRequest,
          requestHook: (span, request) => {
            HttpRequestMetadataBySpan.set(span, extractHttpRequestMetadata(request));
          },
          responseHook: (span, response) => {
            const requestMetadata = HttpRequestMetadataBySpan.get(span);
            if (requestMetadata === undefined) {
              return;
            }

            HttpRequestMetadataBySpan.delete(span);
            emitHttpRequestLog({
              span,
              requestMetadata,
              response,
            });
          },
        },
        "@opentelemetry/instrumentation-pg": {
          requestHook: (span, queryInfo) => {
            emitPgQueryLog({
              span,
              queryInfo,
            });
          },
        },
        "@opentelemetry/instrumentation-pino": {
          disableLogSending: false,
          disableLogCorrelation: false,
        },
      }),
    ],
  });

  sdk.start();

  const enabledState: GlobalTelemetryState = {
    status: "enabled",
    serviceName,
    sdk,
    shutdownPromise: undefined,
  };
  writeGlobalState(enabledState);

  return createEnabledTelemetryHandle(enabledState);
}

export function initializeTelemetryFromConfig(input: {
  serviceName: string;
  config: TelemetryRuntimeConfig;
}): TelemetryHandle {
  const telemetryEnv: NodeJS.ProcessEnv = {
    MISTLE_TELEMETRY_ENABLED: input.config.enabled ? "1" : "0",
    MISTLE_TELEMETRY_DEBUG: input.config.debug ? "1" : "0",
    ...(input.config.enabled
      ? {
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: input.config.traces.endpoint,
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: input.config.logs.endpoint,
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: input.config.metrics.endpoint,
          ...(input.config.resourceAttributes === undefined
            ? {}
            : {
                OTEL_RESOURCE_ATTRIBUTES: input.config.resourceAttributes,
              }),
        }
      : {}),
  };

  if (input.config.enabled && input.config.resourceAttributes !== undefined) {
    process.env.OTEL_RESOURCE_ATTRIBUTES = input.config.resourceAttributes;
  }

  return initializeTelemetry({
    serviceName: input.serviceName,
    env: telemetryEnv,
  });
}

export async function shutdownTelemetry(): Promise<void> {
  const state = readGlobalState();
  if (state === undefined) {
    throw new Error("Telemetry has not been initialized.");
  }

  if (state.status === "disabled") {
    return;
  }

  await shutdownEnabledTelemetry(state);
}
