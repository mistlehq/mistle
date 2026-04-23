/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture with real cross-service flows.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { systemClock, systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { it } from "./system-test-context.js";

const TestTimeoutMs = 8 * 60_000;
const PollIntervalMs = 1_000;
const execFileAsync = promisify(execFile);

async function waitForHttpOk(input: {
  baseUrl: string;
  path: string;
  description: string;
  timeoutMs: number;
}): Promise<void> {
  const deadlineMs = systemClock.nowMs() + input.timeoutMs;
  let lastError: string | null = null;

  while (systemClock.nowMs() < deadlineMs) {
    try {
      const response = await fetch(`${input.baseUrl}${input.path}`);
      if (response.status === 200) {
        return;
      }

      const bodyText = await response.text().catch(() => "");
      lastError = `${input.description} returned status ${String(response.status)}. Response body: ${bodyText}`;
    } catch (error) {
      lastError = `${input.description} fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${input.description}.${lastError === null ? "" : ` Last error: ${lastError}`}`,
  );
}

async function readContainerLogsTail(input: {
  containerId: string;
  tail: number;
}): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(input.tail), input.containerId],
      { cwd: process.cwd() },
    );
    const combined = `${stdout}${stderr}`.trim();
    return combined.length > 0 ? combined : "<no logs>";
  } catch (error) {
    return `<failed to read container logs: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function readContainerPortMapping(input: {
  containerId: string;
  containerPort: number;
}): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["port", input.containerId, String(input.containerPort)],
      { cwd: process.cwd() },
    );
    const combined = `${stdout}${stderr}`.trim();
    return combined.length > 0 ? combined : "<no port mapping output>";
  } catch (error) {
    return `<failed to read container port mapping: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function readContainerStateSummary(containerId: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "inspect",
        "--format",
        "{{.State.Status}} running={{.State.Running}} restarting={{.State.Restarting}} exitCode={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} ports={{json .NetworkSettings.Ports}}",
        containerId,
      ],
      { cwd: process.cwd() },
    );
    const combined = `${stdout}${stderr}`.trim();
    return combined.length > 0 ? combined : "<no inspect output>";
  } catch (error) {
    return `<failed to inspect container state: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

describe("sandbox gateway restart resilience", () => {
  it(
    "keeps a running sandbox reachable across a gateway restart",
    async ({ fixture }) => {
      let currentStep = "start sandbox";

      try {
        const sandboxInstanceId = await fixture.startSandboxAndWaitReady();

        currentStep = "verify PTY before restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "restart gateway";
        await fixture.restartContainer(fixture.dataPlaneGatewayContainerId, {
          timeoutSeconds: 1,
        });
        await waitForHttpOk({
          baseUrl: fixture.dataPlaneGatewayBaseUrl,
          path: "/__healthz",
          description: "gateway host healthcheck after restart",
          timeoutMs: TestTimeoutMs,
        });
        await fixture.waitForSandboxStatus(sandboxInstanceId, "running");
        const sandboxStatus = await fixture.waitForSandboxConnectable(sandboxInstanceId, true);

        expect(sandboxStatus.id).toBe(sandboxInstanceId);
        expect(sandboxStatus.connectable).toBe(true);

        currentStep = "verify PTY after restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);
      } catch (error) {
        const gatewayLogs = await readContainerLogsTail({
          containerId: fixture.dataPlaneGatewayContainerId,
          tail: 200,
        });
        const gatewayPortMapping = await readContainerPortMapping({
          containerId: fixture.dataPlaneGatewayContainerId,
          containerPort: 5202,
        });
        const gatewayStateSummary = await readContainerStateSummary(
          fixture.dataPlaneGatewayContainerId,
        );
        throw new Error(
          `Gateway restart resilience test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }. Gateway state: ${gatewayStateSummary}. Gateway port mapping: ${gatewayPortMapping}. Gateway logs: ${gatewayLogs}`,
        );
      }
    },
    TestTimeoutMs,
  );
});
