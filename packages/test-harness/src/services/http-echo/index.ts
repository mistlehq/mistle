import { systemClock, systemSleeper } from "@mistle/time";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";

const HTTP_ECHO_IMAGE = "mendhak/http-https-echo:38";
const HTTP_ECHO_PORT = 8080;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const READINESS_POLL_INTERVAL_MS = 100;

export type StartHttpEchoInput = {
  startupTimeoutMs?: number;
};

export type HttpEchoService = {
  baseUrl: string;
  stop: () => Promise<void>;
};

async function waitForHttpEchoReadiness(input: {
  baseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      const response = await fetch(input.baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout
    }

    await systemSleeper.sleep(READINESS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for HTTP echo service to become ready within ${input.timeoutMs}ms.`,
  );
}

export async function startHttpEcho(input: StartHttpEchoInput = {}): Promise<HttpEchoService> {
  let container: StartedTestContainer | undefined;
  let stopped = false;

  container = await new GenericContainer(HTTP_ECHO_IMAGE).withExposedPorts(HTTP_ECHO_PORT).start();

  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(HTTP_ECHO_PORT)}`;
  await waitForHttpEchoReadiness({
    baseUrl,
    timeoutMs: input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  });

  const stopInternal = async (): Promise<void> => {
    stopped = true;

    if (container === undefined) {
      throw new Error("HTTP echo container was not started.");
    }

    await container.stop({
      remove: true,
      removeVolumes: true,
      timeout: 0,
    });
    container = undefined;
  };

  const unregisterProcessCleanupTask = registerProcessCleanupTask(async () => {
    if (stopped || container === undefined) {
      return;
    }

    await stopInternal();
  });

  return {
    baseUrl,
    stop: async () => {
      if (stopped) {
        throw new Error("HTTP echo container was already stopped.");
      }

      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}
