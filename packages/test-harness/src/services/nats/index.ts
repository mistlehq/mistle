import { systemClock, systemSleeper } from "@mistle/time";
import { connect } from "@nats-io/transport-node";
import { GenericContainer, type StartedNetwork, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";
import { stopContainerIgnoringMissing } from "../../docker/cleanup.js";

const NATS_IMAGE = "nats:2.14.0-alpine";
const NATS_PORT = 4222;
const DEFAULT_NATS_NETWORK_ALIAS = "nats";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const READINESS_POLL_INTERVAL_MS = 100;

export type StartNatsInput = {
  startupTimeoutMs?: number;
  manageProcessCleanup?: boolean;
  containerLabels?: Record<string, string>;
  network?: StartedNetwork;
  networkAlias?: string;
};

export type NatsService = {
  host: string;
  port: number;
  url: string;
  runtimeMetadata: {
    containerId: string;
  };
  stop: () => Promise<void>;
};

async function waitForNatsReady(input: { url: string; timeoutMs: number }): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;
  let lastError: unknown;

  while (systemClock.nowMs() < deadline) {
    try {
      const connection = await connect({
        servers: input.url,
        timeout: READINESS_POLL_INTERVAL_MS,
      });
      await connection.close();
      return;
    } catch (error) {
      lastError = error;
      await systemSleeper.sleep(READINESS_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out waiting for NATS to become ready within ${String(input.timeoutMs)}ms: ${formatError(lastError)}`,
  );
}

export async function startNats(input: StartNatsInput = {}): Promise<NatsService> {
  let container: StartedTestContainer | undefined;
  let stopped = false;

  let containerDefinition = new GenericContainer(NATS_IMAGE).withExposedPorts(NATS_PORT);
  containerDefinition = containerDefinition.withLabels(input.containerLabels ?? {});

  if (input.network !== undefined) {
    containerDefinition = containerDefinition
      .withNetwork(input.network)
      .withNetworkAliases(input.networkAlias ?? DEFAULT_NATS_NETWORK_ALIAS);
  }

  container = await containerDefinition.start();

  const host = container.getHost();
  const port = container.getMappedPort(NATS_PORT);
  const url = `nats://${host}:${String(port)}`;
  await waitForNatsReady({
    url,
    timeoutMs: input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  });

  const stopInternal = async (): Promise<void> => {
    stopped = true;

    if (container === undefined) {
      throw new Error("NATS container was not started.");
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
    url,
    runtimeMetadata: {
      containerId: container.getId(),
    },
    stop: async () => {
      if (stopped) {
        throw new Error("NATS container was already stopped.");
      }

      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
