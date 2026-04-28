import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { resolveLatestPublishedSandboxBaseImageRef } from "@mistle/config";
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
} from "../openworkflow/core/config.js";
import { initializeSandboxRuntime } from "../openworkflow/start-sandbox-instance/initialize-sandbox-runtime.js";
import { resumeSandboxRuntime } from "../openworkflow/start-sandbox-instance/resume-sandbox-runtime.js";
import { SandboxStartupModes } from "../openworkflow/start-sandbox-instance/sandbox-startup-input.js";
import { createSandboxRuntimeEnv } from "../openworkflow/start-sandbox-instance/start-sandbox.js";

const DockerSocketPath = "/var/run/docker.sock";
const IntegrationTestTimeoutMs = 300_000;
const OrganizationId = "org_resume_runtime_integration";
const SandboxBaseImageReference = await resolveLatestPublishedSandboxBaseImageRef();

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
    MISTLE_TELEMETRY_ENABLED: "false",
    MISTLE_TELEMETRY_DEBUG: "false",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-service-token",
    MISTLE_SANDBOX_PROVIDER: "docker",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: SandboxBaseImageReference,
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: input.websocketBaseUrl,
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: input.websocketBaseUrl,
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-connect-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-control-plane-api",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-bootstrap-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "integration-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-egress-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-secret",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: "integration-publish-cookie-secret",
    MISTLE_SANDBOX_STORAGE_BACKEND: "docker_volume",
    MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://unused",
    MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: "integration",
    MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: "http://127.0.0.1:5202",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: "http://127.0.0.1:5100",
    MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL: "http://tokenizer-proxy/tokenizer-proxy/egress",
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "it-pr14-",
  });
  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
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

function readSandboxGitConfig(input: { id: string; key: string }): string {
  const result = runContainerCommand({
    id: input.id,
    command: ["git", "config", "--global", input.key],
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to read global git config key ${input.key}. Exit code ${result.exitCode}. Output: ${result.output}`,
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
    "initializes sandbox runtime with a global git identity",
    async () => {
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
      const sandboxInstanceId = `sbi_pr8_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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

      try {
        const sandbox = await sandboxAdapter.start({
          image: {
            provider: SandboxProvider.DOCKER,
            imageId: SandboxBaseImageReference,
            createdAt: new Date().toISOString(),
          },
          env: createSandboxRuntimeEnv({
            config: runtimeConfig,
            sandboxInstanceId,
          }),
        });
        sandboxId = sandbox.id;

        await initializeSandboxRuntime(
          {
            config: runtimeConfig,
            sandboxRuntimeControl,
          },
          {
            organizationId: OrganizationId,
            sandboxInstanceId,
            providerSandboxId: sandbox.id,
            startupMode: SandboxStartupModes.NEW,
            runtimePlan: createRuntimePlan(),
            gitIdentity: {
              name: "Mistle User",
              email: "mistle-user@example.com",
            },
          },
        );

        expect(
          readSandboxGitConfig({
            id: sandbox.id,
            key: "user.name",
          }),
        ).toBe("Mistle User");
        expect(
          readSandboxGitConfig({
            id: sandbox.id,
            key: "user.email",
          }),
        ).toBe("mistle-user@example.com");
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
            organizationId: OrganizationId,
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
            organizationId: OrganizationId,
            sandboxInstanceId,
            providerSandboxId: resumedSandbox.id,
            runtimeProvider: SandboxProvider.DOCKER,
            runtimePlan: createRuntimePlan(),
            gitIdentity: {
              name: "Mistle User",
              email: "mistle-user@example.com",
            },
          },
        );

        expect(
          readSandboxGitConfig({
            id: resumedSandbox.id,
            key: "user.name",
          }),
        ).toBe("Mistle User");
        expect(
          readSandboxGitConfig({
            id: resumedSandbox.id,
            key: "user.email",
          }),
        ).toBe("mistle-user@example.com");
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
