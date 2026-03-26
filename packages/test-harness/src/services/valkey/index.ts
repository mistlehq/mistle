import { systemClock, systemSleeper } from "@mistle/time";
import { GenericContainer, type StartedNetwork, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";
import { stopContainerIgnoringMissing } from "../../docker/cleanup.js";

const VALKEY_IMAGE = "valkey/valkey:9.0-alpine";
const VALKEY_PORT = 6379;
const DEFAULT_VALKEY_NETWORK_ALIAS = "valkey";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const READINESS_POLL_INTERVAL_MS = 100;

export type StartValkeyInput = {
  startupTimeoutMs?: number;
  manageProcessCleanup?: boolean;
  containerLabels?: Record<string, string>;
  network?: StartedNetwork;
  networkAlias?: string;
};

export type ValkeyService = {
  host: string;
  port: number;
  url: string;
  runtimeMetadata: {
    containerId: string;
  };
  stop: () => Promise<void>;
};

async function waitForValkeyReady(input: {
  container: StartedTestContainer;
  timeoutMs: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.container.exec(["valkey-cli", "PING"]);
    if (result.exitCode === 0 && result.output.trim() === "PONG") {
      return;
    }

    await systemSleeper.sleep(READINESS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for Valkey to become ready within ${String(input.timeoutMs)}ms.`,
  );
}

export async function startValkey(input: StartValkeyInput = {}): Promise<ValkeyService> {
  let container: StartedTestContainer | undefined;
  let stopped = false;

  let containerDefinition = new GenericContainer(VALKEY_IMAGE).withExposedPorts(VALKEY_PORT);
  containerDefinition = containerDefinition.withLabels(input.containerLabels ?? {});

  if (input.network !== undefined) {
    containerDefinition = containerDefinition
      .withNetwork(input.network)
      .withNetworkAliases(input.networkAlias ?? DEFAULT_VALKEY_NETWORK_ALIAS);
  }

  container = await containerDefinition.start();

  const host = container.getHost();
  const port = container.getMappedPort(VALKEY_PORT);
  await waitForValkeyReady({
    container,
    timeoutMs: input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  });

  const stopInternal = async (): Promise<void> => {
    stopped = true;

    if (container === undefined) {
      throw new Error("Valkey container was not started.");
    }

    await stopContainerIgnoringMissing(container, {
      remove: true,
      removeVolumes: true,
      timeout: 0,
    });
    container = undefined;
  };

  const unregisterProcessCleanupTask =
    (input.manageProcessCleanup ?? true)
      ? registerProcessCleanupTask(async () => {
          if (stopped || container === undefined) {
            return;
          }

          await stopInternal();
        })
      : () => {};

  return {
    host,
    port,
    url: `redis://${host}:${String(port)}`,
    runtimeMetadata: {
      containerId: container.getId(),
    },
    stop: async () => {
      if (stopped) {
        throw new Error("Valkey container was already stopped.");
      }

      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}
