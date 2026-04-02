import { once } from "node:events";
import { type Server } from "node:http";
import { type Readable } from "node:stream";

import { applyRuntimePlan } from "../runtime-plan/index.js";
import {
  startTunnelClient,
  type StartedTunnelClient,
  type TunnelCompletion,
} from "../tunnel/client.js";
import { aggregateArtifactEnvironment } from "./artifact-environment.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";
import { createRuntimeHttpServer } from "./http-server.js";
import { BufferedLogger, type Logger } from "./logger.js";
import { parseListenAddress } from "./parse-listen-address.js";
import {
  startRuntimeClientProcessManager,
  type RuntimeClientProcessExit,
  type RuntimeClientProcessManager,
} from "./processes/runtime-client-process-manager.js";
import { flattenRuntimeClientProcesses } from "./processes/runtime-client-processes.js";
import { loadProxyCertificateAuthority } from "./proxy/load-proxy-ca.js";
import {
  resolveBaselineProxyEnvironment,
  applyEnvironmentEntries,
} from "./proxy/proxy-environment.js";
import { createProxyServer, type ProxyServer } from "./proxy/proxy-server.js";
import { readStartupInput, DefaultStartupInputMaxBytes } from "./read-startup-input.js";
import { applyCurrentProcessSecurity } from "./security.js";
import { type StartupInput } from "./startup-input.js";
import { RuntimeStartupModes } from "./startup-input.js";

type LookupEnv = (key: string) => string | undefined;

export type RunRuntimeInput = {
  lookupEnv: LookupEnv;
  stdin: Readable;
};

export type StartedRuntime = {
  config: RuntimeConfig;
  startupInput: StartupInput;
  server: Server;
  baseUrl: string;
  logger: Logger;
  unexpectedProcessExit: Promise<RuntimeClientProcessExit>;
  tunnelCompletion: Promise<TunnelCompletion>;
  close: () => Promise<void>;
  closed: Promise<void>;
};

function getBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("runtime server address is unavailable");
  }

  const host = address.address === "::" ? "127.0.0.1" : address.address;
  return `http://${host}:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startRuntime(input: RunRuntimeInput): Promise<StartedRuntime> {
  applyCurrentProcessSecurity();

  if (input.lookupEnv === undefined) {
    throw new Error("lookup env function is required");
  }

  if (input.stdin === undefined || input.stdin === null) {
    throw new Error("stdin reader is required");
  }

  const logger = new BufferedLogger();
  let config: RuntimeConfig;
  let startupInput: StartupInput;
  const state = {
    startupReady: false,
  };
  let proxyServer: ProxyServer | undefined;
  let server: Server | undefined;
  let restoreProxyEnvironment: (() => void) | undefined;
  let restoreArtifactEnvironment: (() => void) | undefined;
  let processManager: RuntimeClientProcessManager | undefined;
  let tunnelClient: StartedTunnelClient | undefined;
  let startupStage:
    | "load_runtime_config"
    | "read_startup_input"
    | "load_proxy_ca"
    | "bind_http_server"
    | "skip_runtime_plan"
    | "apply_runtime_plan"
    | "start_runtime_clients"
    | "start_tunnel"
    | "startup_ready" = "load_runtime_config";
  const startupStartedAtMs = Date.now();
  try {
    config = loadRuntimeConfig(input.lookupEnv);
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_config_loaded",
      fields: {
        listenAddr: config.listenAddr,
        tokenizerProxyEgressBaseUrl: config.tokenizerProxyEgressBaseUrl,
        proxyCaConfigured: config.proxyCaConfigured,
      },
    });
    startupStage = "read_startup_input";
    startupInput = await readStartupInput({
      reader: input.stdin,
      maxBytes: DefaultStartupInputMaxBytes,
    });
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_startup_input_loaded",
      fields: {
        startupMode: startupInput.startupMode,
        tunnelGatewayWsUrl: startupInput.tunnelGatewayWsUrl,
        egressRouteCount: startupInput.runtimePlan.egressRoutes.length,
        artifactCount: startupInput.runtimePlan.artifacts.length,
        workspaceSourceCount: startupInput.runtimePlan.workspaceSources.length,
        runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
        agentRuntimeCount: startupInput.runtimePlan.agentRuntimes.length,
      },
    });
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_startup_started",
      fields: {
        startupMode: startupInput.startupMode,
        artifactCount: startupInput.runtimePlan.artifacts.length,
        workspaceSourceCount: startupInput.runtimePlan.workspaceSources.length,
        runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
        agentRuntimeCount: startupInput.runtimePlan.agentRuntimes.length,
      },
    });
    startupStage = "load_proxy_ca";
    if (config.proxyCaConfigured) {
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_proxy_ca_load_started",
      });
    } else {
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_proxy_ca_not_configured",
      });
    }
    const certificateAuthority = loadProxyCertificateAuthority(config);
    if (certificateAuthority !== undefined) {
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_proxy_ca_load_completed",
      });
    }
    proxyServer = createProxyServer({
      runtimePlan: startupInput.runtimePlan,
      tokenizerProxyEgressBaseUrl: config.tokenizerProxyEgressBaseUrl,
      egressGrantByRuleId: startupInput.egressGrantByRuleId,
      ...(certificateAuthority === undefined ? {} : { certificateAuthority }),
    });

    startupStage = "bind_http_server";
    const listenAddress = parseListenAddress(config.listenAddr);
    server = createRuntimeHttpServer({
      state,
      proxyServer,
    });
    const runtimeServer = server;

    await new Promise<void>((resolve, reject) => {
      runtimeServer.once("error", reject);
      runtimeServer.listen(listenAddress.port, listenAddress.host, () => {
        runtimeServer.off("error", reject);
        resolve();
      });
    }).catch((error: unknown) => {
      throw new Error(
        `failed to bind listen addr ${config.listenAddr}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_http_server_listening",
      fields: {
        baseUrl: getBaseUrl(server),
      },
    });

    restoreProxyEnvironment = applyEnvironmentEntries(
      resolveBaselineProxyEnvironment({
        listenAddr: config.listenAddr,
        tokenizerProxyEgressBaseUrl: config.tokenizerProxyEgressBaseUrl,
      }),
    );

    if (startupInput.startupMode === RuntimeStartupModes.NEW) {
      // Initial startup owns provisioning the sandbox filesystem from the
      // compiled runtime plan before any long-lived processes are relaunched.
      startupStage = "apply_runtime_plan";
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_apply_started",
        fields: {
          artifactCount: startupInput.runtimePlan.artifacts.length,
          workspaceSourceCount: startupInput.runtimePlan.workspaceSources.length,
        },
      });
      const applyRuntimePlanStartedAtMs = Date.now();
      await applyRuntimePlan({
        runtimePlan: startupInput.runtimePlan,
        logger,
      });
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_apply_completed",
        fields: {
          elapsedMs: Date.now() - applyRuntimePlanStartedAtMs,
        },
      });
    } else {
      // Resume must preserve user/runtime state accumulated inside the sandbox,
      // so existing sandboxes skip runtime-plan mutation and only relaunch the
      // processes/tunnel that depend on fresh connection material.
      startupStage = "skip_runtime_plan";
      logger.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_apply_skipped",
      });
    }
    const artifactEnvironment = aggregateArtifactEnvironment(startupInput.runtimePlan.artifacts);
    if (artifactEnvironment !== undefined) {
      restoreArtifactEnvironment = applyEnvironmentEntries(artifactEnvironment);
    }
    startupStage = "start_runtime_clients";
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_clients_start_started",
      fields: {
        runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
      },
    });
    const startRuntimeClientsStartedAtMs = Date.now();
    processManager = await startRuntimeClientProcessManager(
      flattenRuntimeClientProcesses(startupInput.runtimePlan.runtimeClients),
    );
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_clients_start_completed",
      fields: {
        elapsedMs: Date.now() - startRuntimeClientsStartedAtMs,
        runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
      },
    });
    try {
      startupStage = "start_tunnel";
      logger.logEvent({
        level: "info",
        event: "sandbox_tunnel_client_starting",
        fields: {
          runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
          agentRuntimeCount: startupInput.runtimePlan.agentRuntimes.length,
        },
      });
      tunnelClient = startTunnelClient({
        signal: new AbortController().signal,
        gatewayWsUrl: startupInput.tunnelGatewayWsUrl,
        bootstrapToken: startupInput.bootstrapToken,
        tunnelExchangeToken: startupInput.tunnelExchangeToken,
        agentRuntimes: startupInput.runtimePlan.agentRuntimes,
        runtimeClients: startupInput.runtimePlan.runtimeClients,
        logger,
      });
    } catch (error) {
      throw new Error(
        `failed to start sandbox tunnel: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    state.startupReady = true;
    startupStage = "startup_ready";
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_startup_ready",
      fields: {
        elapsedMs: Date.now() - startupStartedAtMs,
      },
    });
  } catch (error) {
    if (tunnelClient !== undefined) {
      await tunnelClient.close().catch(() => undefined);
    }
    if (processManager !== undefined) {
      await processManager.stop().catch(() => undefined);
    }
    restoreArtifactEnvironment?.();
    restoreProxyEnvironment?.();
    if (server !== undefined) {
      await closeServer(server).catch(() => undefined);
    }
    if (proxyServer !== undefined) {
      await proxyServer.close().catch(() => undefined);
    }

    logger.logEvent({
      level: "error",
      event: "sandbox_runtime_startup_failed",
      fields: {
        stage: startupStage,
        message: error instanceof Error ? error.message : String(error),
      },
    });

    if (error instanceof Error && error.message.startsWith("runtime client process[")) {
      throw new Error(`failed to start runtime client processes: ${error.message}`);
    }
    if (error instanceof Error && error.message.startsWith("failed to start sandbox tunnel:")) {
      throw error;
    }

    throw new Error(
      `failed during sandbox runtime startup (${startupStage}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (server === undefined) {
    throw new Error("runtime server is required");
  }
  if (proxyServer === undefined) {
    throw new Error("proxy server is required");
  }

  const closed = once(server, "close").then(() => undefined);
  const unexpectedProcessExit =
    processManager?.unexpectedExit ??
    new Promise<RuntimeClientProcessExit>(() => {
      // Intentionally pending when there are no runtime client processes.
    });
  if (tunnelClient === undefined) {
    throw new Error("sandbox tunnel client is required");
  }

  return {
    config,
    startupInput,
    server,
    baseUrl: getBaseUrl(server),
    logger,
    unexpectedProcessExit,
    tunnelCompletion: tunnelClient.completion,
    close: async () => {
      await tunnelClient.close();
      await closeServer(server);
      await proxyServer.close();

      if (processManager !== undefined) {
        await processManager.stop();
      }

      restoreArtifactEnvironment?.();
      restoreProxyEnvironment?.();
    },
    closed,
  };
}

export async function runRuntime(input: RunRuntimeInput): Promise<never> {
  const runtime = await startRuntime(input);
  const result = await Promise.race([
    runtime.closed.then(() => ({
      type: "closed" as const,
    })),
    runtime.unexpectedProcessExit.then((processExit) => ({
      type: "process-exit" as const,
      processExit,
    })),
    runtime.tunnelCompletion.then((completion) => ({
      type: "tunnel-completion" as const,
      completion,
    })),
  ]);

  try {
    await runtime.close();
  } catch {
    // Preserve the primary unexpected-exit error.
  }

  if (result.type === "process-exit") {
    if (result.processExit.err !== undefined) {
      throw new Error(
        `runtime client process '${result.processExit.processKey}' exited unexpectedly: ${result.processExit.err.message}`,
      );
    }

    throw new Error(
      `runtime client process '${result.processExit.processKey}' exited unexpectedly`,
    );
  }

  if (result.type === "closed") {
    throw new Error("sandbox runtime server closed unexpectedly");
  }

  switch (result.completion.kind) {
    case "aborted":
      throw new Error("sandbox tunnel aborted unexpectedly");
    case "closed":
      throw new Error("sandbox tunnel closed unexpectedly");
    case "error":
      throw new Error(`sandbox tunnel failed: ${result.completion.error.message}`);
  }
}
