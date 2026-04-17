import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  createDockerClient,
  SandboxPersistentStorageLayout,
  SandboxProvider,
  SandboxStorageBackend,
} from "@mistle/sandbox";
import { reserveAvailablePort } from "@mistle/test-harness";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  createDataPlaneWorkerRuntimeConfig,
  loadDataPlaneWorkerConfig,
  requireDataPlaneWorkerGlobalConfig,
} from "../openworkflow/core/config.js";
import { initializeSandboxRuntime } from "../openworkflow/start-sandbox-instance/initialize-sandbox-runtime.js";
import { resumeSandboxRuntime } from "../openworkflow/start-sandbox-instance/resume-sandbox-runtime.js";
import { SandboxStartupModes } from "../openworkflow/start-sandbox-instance/sandbox-startup-input.js";
import { createSandboxRuntimeEnv } from "../openworkflow/start-sandbox-instance/start-sandbox.js";

const DockerSocketPath = "/var/run/docker.sock";
const IntegrationTestTimeoutMs = 300_000;
const SandboxBaseImageReference =
  "ghcr.io/mistlehq/sandbox-base@sha256:4d5cdf8bc0c87f4732544352f68c4d4f2e23341ef193fda4a53ed6214f6c9643";

function hasDockerResumeIntegrationRuntime(): boolean {
  if (!existsSync(DockerSocketPath)) {
    return false;
  }

  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function deleteVolume(volumeName: string): void {
  try {
    execFileSync("docker", ["volume", "rm", volumeName], {
      stdio: "ignore",
    });
  } catch {}
}

function createRuntimePlan(): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: "sbp_resume_runtime_integration",
    version: 1,
    image: {
      source: "base",
      imageRef: SandboxBaseImageReference,
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

function createWorkerRuntimeConfig(input: { websocketBaseUrl: string }) {
  const loadedConfig = loadDataPlaneWorkerConfig({
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: "integration-service-token",
    MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
    MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: SandboxBaseImageReference,
    MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: input.websocketBaseUrl,
    MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: input.websocketBaseUrl,
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "integration-connect-secret",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "integration-bootstrap-secret",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "integration-data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET: "integration-egress-secret",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER: "integration-data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-secret",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
      "integration-publish-cookie-secret",
    MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND: "docker_volume",
    MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: "postgresql://unused",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: "postgresql://unused",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "integration",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
    MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL: "http://127.0.0.1:5202",
    MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
      "http://tokenizer-proxy/tokenizer-proxy/egress",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "it-pr14-",
  });
  requireDataPlaneWorkerGlobalConfig(loadedConfig, "resume sandbox runtime integration");

  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
    global: loadedConfig.global,
  });
}

function runContainerCommand(input: { id: string; command: string[] }): {
  exitCode: number;
  output: string;
} {
  const result = spawnSync("docker", ["exec", input.id, ...input.command], {
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`.trimEnd(),
  };
}

function writeSandboxFile(input: { id: string; path: string; fileContents: string }): void {
  const result = runContainerCommand({
    id: input.id,
    command: ["sh", "-lc", `cat <<'EOF' > ${input.path}\n${input.fileContents}\nEOF`],
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to write sandbox file at ${input.path}. Exit code ${result.exitCode}. Output: ${result.output}`,
    );
  }
}

function resolveBootstrapTunnelHostForDockerContainer(): string {
  if (process.platform === "darwin" || process.platform === "win32") {
    return "host.docker.internal";
  }

  const gateway = execFileSync(
    "docker",
    ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"],
    {
      encoding: "utf8",
    },
  ).trim();

  if (gateway.length === 0) {
    throw new Error("Docker bridge gateway address is required for bootstrap tunnel integration.");
  }

  return gateway;
}

function readSandboxFile(input: { id: string; path: string }): string {
  const result = runContainerCommand({
    id: input.id,
    command: ["cat", input.path],
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to read sandbox file at ${input.path}. Exit code ${result.exitCode}. Output: ${result.output}`,
    );
  }

  return result.output;
}

const describeIfDockerResumeIntegration = hasDockerResumeIntegrationRuntime()
  ? describe
  : describe.skip;

describeIfDockerResumeIntegration("resume sandbox runtime integration", () => {
  const createdVolumeNames = new Set<string>();

  afterEach(() => {
    for (const volumeName of createdVolumeNames) {
      deleteVolume(volumeName);
    }
    createdVolumeNames.clear();
  });

  it(
    "cold-initializes resumed persistent Docker sandboxes while preserving durable storage",
    async () => {
      const dockerClient = createDockerClient({
        socketPath: DockerSocketPath,
      });
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });
      const sandboxInstanceId = `sbi_pr14_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const volumeName = `it-pr14-${sandboxInstanceId}`;
      const markerPath = "/root/.mistle-pr14-durable.txt";
      const markerValue = `pr14-${randomUUID()}`;
      const bootstrapPort = await reserveAvailablePort({
        host: "127.0.0.1",
      });
      const bootstrapTunnelHost = resolveBootstrapTunnelHostForDockerContainer();
      const bootstrapServer = new WebSocketServer({
        host: "0.0.0.0",
        port: bootstrapPort,
      });
      const bootstrapSockets = new Set<WebSocket>();
      bootstrapServer.on("connection", (socket: WebSocket) => {
        bootstrapSockets.add(socket);
        socket.once("close", () => {
          bootstrapSockets.delete(socket);
        });
      });
      const runtimeConfig = createWorkerRuntimeConfig({
        websocketBaseUrl: `ws://${bootstrapTunnelHost}:${String(bootstrapPort)}/tunnel/sandbox`,
      });
      let sandboxId: string | undefined;

      createdVolumeNames.add(volumeName);
      await dockerClient.createVolume({
        volumeName,
      });

      try {
        const image = {
          provider: SandboxProvider.DOCKER,
          imageId: SandboxBaseImageReference,
          createdAt: new Date().toISOString(),
        };
        const storagePreparation = await sandboxAdapter.prepareStorageForStart({
          sandboxInstanceId,
          image,
          storage: {
            backend: SandboxStorageBackend.DOCKER_VOLUME,
            handle: volumeName,
            layout: SandboxPersistentStorageLayout,
          },
        });
        const sandbox = await sandboxAdapter.start({
          image,
          env: createSandboxRuntimeEnv({
            config: runtimeConfig,
            sandboxInstanceId,
          }),
          storagePreparation,
        });
        sandboxId = sandbox.id;

        await initializeSandboxRuntime(
          {
            config: runtimeConfig,
            sandboxRuntimeControl,
          },
          {
            sandboxInstanceId,
            providerSandboxId: sandbox.id,
            startupMode: SandboxStartupModes.NEW,
            runtimePlan: createRuntimePlan(),
          },
        );

        writeSandboxFile({
          id: sandbox.id,
          path: markerPath,
          fileContents: markerValue,
        });

        await sandboxAdapter.stop({
          id: sandbox.id,
        });

        const resumedSandbox = await sandboxAdapter.resume({
          id: sandbox.id,
        });

        await resumeSandboxRuntime(
          {
            config: runtimeConfig,
            sandboxRuntimeControl,
          },
          {
            sandboxInstanceId,
            providerSandboxId: resumedSandbox.id,
            runtimeProvider: SandboxProvider.DOCKER,
            runtimePlan: createRuntimePlan(),
          },
        );

        expect(
          readSandboxFile({
            id: resumedSandbox.id,
            path: markerPath,
          }),
        ).toBe(markerValue);
      } finally {
        for (const socket of bootstrapSockets) {
          socket.terminate();
        }

        await new Promise<void>((resolve, reject) => {
          bootstrapServer.close((error?: Error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }

            resolve();
          });
        });

        if (sandboxId !== undefined) {
          try {
            await sandboxAdapter.destroy({
              id: sandboxId,
            });
          } catch {}
        }
      }
    },
    IntegrationTestTimeoutMs,
  );
});
