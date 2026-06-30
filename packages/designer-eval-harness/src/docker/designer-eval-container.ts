import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemSleeper } from "@mistle/time";
import { GenericContainer, type StartedTestContainer, type WaitStrategy } from "testcontainers";

import type { MaterializedDesignerRuntimeFile } from "../runtime/materialize-runtime-files.ts";

export const DesignerEvalCodexAppServerPort = 4501;
export const DesignerEvalCodexAppServerListenUrl = `ws://0.0.0.0:${String(
  DesignerEvalCodexAppServerPort,
)}`;
export const DesignerEvalCodexAppServerReadyPath = "/readyz";
const DesignerEvalWebSocketTokenPath = "/var/lib/mistle/codex-app-server-ws-token";

export type DesignerEvalContainerRuntimeClient = {
  imageRef: string;
  command: readonly string[];
};

export type DesignerEvalContainerBindMount = {
  source: string;
  target: string;
  mode: "ro" | "rw";
};

export type StartedDesignerEvalContainer = {
  websocketAuthToken: string;
  websocketUrl: string;
  stop: () => Promise<void>;
};

export async function startDesignerEvalContainer(input: {
  runtimeClient: DesignerEvalContainerRuntimeClient;
  materializedFiles: readonly MaterializedDesignerRuntimeFile[];
  bindMounts?: readonly DesignerEvalContainerBindMount[];
  containerName?: string;
  startupTimeoutMs?: number;
}): Promise<StartedDesignerEvalContainer> {
  const websocketAuth = await createDesignerEvalWebSocketAuth();
  let container: StartedTestContainer;
  try {
    container = await createDesignerEvalContainerDefinition({
      runtimeClient: input.runtimeClient,
      materializedFiles: input.materializedFiles,
      bindMounts: [
        ...(input.bindMounts ?? []),
        {
          source: websocketAuth.tokenFilePath,
          target: DesignerEvalWebSocketTokenPath,
          mode: "ro",
        },
      ],
      ...(input.containerName === undefined ? {} : { containerName: input.containerName }),
      waitStrategy: new DesignerEvalCodexAppServerWaitStrategy(input.startupTimeoutMs ?? 60_000),
      startupTimeoutMs: input.startupTimeoutMs ?? 60_000,
    }).start();
  } catch (error) {
    await websocketAuth.cleanup();
    throw error;
  }

  return {
    websocketAuthToken: websocketAuth.token,
    websocketUrl: `ws://${container.getHost()}:${String(
      container.getMappedPort(DesignerEvalCodexAppServerPort),
    )}`,
    stop: async () => {
      try {
        await container.stop();
      } finally {
        await websocketAuth.cleanup();
      }
    },
  };
}

class DesignerEvalCodexAppServerWaitStrategy implements WaitStrategy {
  readonly #startupTimeoutMs: number;

  constructor(startupTimeoutMs: number) {
    this.#startupTimeoutMs = startupTimeoutMs;
  }

  async waitUntilReady(
    _container: Parameters<WaitStrategy["waitUntilReady"]>[0],
    boundPorts: Parameters<WaitStrategy["waitUntilReady"]>[1],
  ): Promise<void> {
    const startedAt = Date.now();
    const mappedPort = boundPorts.getBinding(DesignerEvalCodexAppServerPort);
    const readyUrl = `http://127.0.0.1:${String(mappedPort)}${DesignerEvalCodexAppServerReadyPath}`;

    while (Date.now() - startedAt < this.#startupTimeoutMs) {
      if (await isReady(readyUrl)) {
        return;
      }
      await systemSleeper.sleep(250);
    }

    throw new Error(
      `URL ${DesignerEvalCodexAppServerReadyPath} not accessible on host port ${String(
        mappedPort,
      )} after ${String(this.#startupTimeoutMs)}ms`,
    );
  }

  withStartupTimeout(startupTimeoutMs: number): WaitStrategy {
    return new DesignerEvalCodexAppServerWaitStrategy(startupTimeoutMs);
  }

  isStartupTimeoutSet(): boolean {
    return true;
  }

  getStartupTimeout(): number {
    return this.#startupTimeoutMs;
  }
}

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export function createDesignerEvalContainerDefinition(input: {
  runtimeClient: DesignerEvalContainerRuntimeClient;
  materializedFiles: readonly MaterializedDesignerRuntimeFile[];
  bindMounts: readonly DesignerEvalContainerBindMount[];
  containerName?: string;
  waitStrategy: WaitStrategy;
  startupTimeoutMs: number;
}): GenericContainer {
  let container = new GenericContainer(input.runtimeClient.imageRef)
    .withEntrypoint([""])
    .withCommand(createDesignerEvalCodexAppServerCommand(input.runtimeClient.command))
    .withExposedPorts(DesignerEvalCodexAppServerPort)
    .withWaitStrategy(input.waitStrategy)
    .withStartupTimeout(input.startupTimeoutMs);

  if (input.containerName !== undefined) {
    container = container.withName(input.containerName);
  }

  const materializedFileMounts: DesignerEvalContainerBindMount[] = input.materializedFiles.map(
    (file) => ({
      source: file.localPath,
      target: file.runtimePath,
      mode: "ro",
    }),
  );
  const bindMounts = [...materializedFileMounts, ...input.bindMounts];

  if (bindMounts.length > 0) {
    container = container.withBindMounts(
      bindMounts.map((mount) => ({
        source: mount.source,
        target: mount.target,
        mode: mount.mode,
      })),
    );
  }

  return container;
}

export function createDesignerEvalCodexAppServerCommand(command: readonly string[]): string[] {
  if (command.length === 0) {
    throw new Error("Designer eval Codex app-server command must not be empty.");
  }

  const listenFlagIndex = command.indexOf("--listen");
  const authArgs = createDesignerEvalCodexAppServerAuthArgs();
  if (listenFlagIndex < 0) {
    return [...command, "--listen", DesignerEvalCodexAppServerListenUrl, ...authArgs];
  }
  if (listenFlagIndex === command.length - 1) {
    throw new Error("Designer eval Codex app-server command has --listen without a value.");
  }

  return [
    ...command.map((segment, index) =>
      index === listenFlagIndex + 1 ? DesignerEvalCodexAppServerListenUrl : segment,
    ),
    ...authArgs,
  ];
}

export function createStartedDesignerEvalContainer(input: {
  container: StartedTestContainer;
  websocketAuthToken: string;
}): StartedDesignerEvalContainer {
  return {
    websocketAuthToken: input.websocketAuthToken,
    websocketUrl: `ws://${input.container.getHost()}:${String(
      input.container.getMappedPort(DesignerEvalCodexAppServerPort),
    )}`,
    stop: async () => {
      await input.container.stop();
    },
  };
}

function createDesignerEvalCodexAppServerAuthArgs(): string[] {
  return ["--ws-auth", "capability-token", "--ws-token-file", DesignerEvalWebSocketTokenPath];
}

async function createDesignerEvalWebSocketAuth(): Promise<{
  cleanup: () => Promise<void>;
  token: string;
  tokenFilePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "mistle-designer-eval-ws-auth-"));
  const tokenFilePath = join(directory, "token");
  const token = randomBytes(32).toString("base64url");
  await writeFile(tokenFilePath, token, {
    mode: 0o600,
  });

  return {
    cleanup: async () => {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    },
    token,
    tokenFilePath,
  };
}
