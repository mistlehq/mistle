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
import { logSandboxRuntimeEvent } from "./logger.js";
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
import { createProxyServer } from "./proxy/proxy-server.js";
import { readStartupInput, DefaultStartupInputMaxBytes } from "./read-startup-input.js";
import { applyCurrentProcessSecurity } from "./security.js";
import { type StartupInput } from "./startup-input.js";

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

  const config = loadRuntimeConfig(input.lookupEnv);
  const startupInput = await readStartupInput({
    reader: input.stdin,
    maxBytes: DefaultStartupInputMaxBytes,
  });
  const startupStartedAtMs = Date.now();
  logSandboxRuntimeEvent({
    level: "info",
    event: "sandbox_runtime_startup_started",
    fields: {
      artifactCount: startupInput.runtimePlan.artifacts.length,
      workspaceSourceCount: startupInput.runtimePlan.workspaceSources.length,
      runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
      agentRuntimeCount: startupInput.runtimePlan.agentRuntimes.length,
    },
  });
  const state = {
    startupReady: false,
  };
  const certificateAuthority = loadProxyCertificateAuthority(config);
  const proxyServer = createProxyServer({
    runtimePlan: startupInput.runtimePlan,
    tokenizerProxyEgressBaseUrl: config.tokenizerProxyEgressBaseUrl,
    egressGrantByRuleId: startupInput.egressGrantByRuleId,
    ...(certificateAuthority === undefined ? {} : { certificateAuthority }),
  });

  const listenAddress = parseListenAddress(config.listenAddr);
  const server = createRuntimeHttpServer({
    state,
    proxyServer,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenAddress.port, listenAddress.host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error: unknown) => {
    throw new Error(
      `failed to bind listen addr ${config.listenAddr}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const restoreProxyEnvironment = applyEnvironmentEntries(
    resolveBaselineProxyEnvironment({
      listenAddr: config.listenAddr,
      tokenizerProxyEgressBaseUrl: config.tokenizerProxyEgressBaseUrl,
    }),
  );
  let restoreArtifactEnvironment: (() => void) | undefined;

  let processManager: RuntimeClientProcessManager | undefined;
  let tunnelClient: StartedTunnelClient | undefined;
  let startupStage:
    | "apply_runtime_plan"
    | "start_runtime_clients"
    | "start_tunnel"
    | "startup_ready" = "apply_runtime_plan";
  try {
    logSandboxRuntimeEvent({
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
    });
    logSandboxRuntimeEvent({
      level: "info",
      event: "sandbox_runtime_plan_apply_completed",
      fields: {
        elapsedMs: Date.now() - applyRuntimePlanStartedAtMs,
      },
    });
    const artifactEnvironment = aggregateArtifactEnvironment(startupInput.runtimePlan.artifacts);
    if (artifactEnvironment !== undefined) {
      restoreArtifactEnvironment = applyEnvironmentEntries(artifactEnvironment);
    }
    startupStage = "start_runtime_clients";
    logSandboxRuntimeEvent({
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
    logSandboxRuntimeEvent({
      level: "info",
      event: "sandbox_runtime_clients_start_completed",
      fields: {
        elapsedMs: Date.now() - startRuntimeClientsStartedAtMs,
        runtimeClientCount: startupInput.runtimePlan.runtimeClients.length,
      },
    });
    try {
      startupStage = "start_tunnel";
      logSandboxRuntimeEvent({
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
      });
    } catch (error) {
      throw new Error(
        `failed to start sandbox tunnel: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    state.startupReady = true;
    startupStage = "startup_ready";
    logSandboxRuntimeEvent({
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
    restoreProxyEnvironment();
    await closeServer(server);

    logSandboxRuntimeEvent({
      level: "error",
      event: "sandbox_runtime_startup_failed",
      fields: {
        stage: startupStage,
        message: error instanceof Error ? error.message : String(error),
      },
    });

    throw new Error(
      error instanceof Error && error.message.startsWith("runtime client process[")
        ? `failed to start runtime client processes: ${error.message}`
        : error instanceof Error && error.message.startsWith("failed to start sandbox tunnel:")
          ? error.message
          : `failed to apply runtime plan: ${error instanceof Error ? error.message : String(error)}`,
    );
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
      restoreProxyEnvironment();
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
