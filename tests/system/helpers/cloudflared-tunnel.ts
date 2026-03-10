import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { systemSleeper } from "@mistle/time";

const execFileAsync = promisify(execFile);

const DefaultCloudflaredImage = "cloudflare/cloudflared:latest";
const DefaultStartupTimeoutMs = 60_000;
const PollIntervalMs = 1_000;
const CommandTimeoutMs = 30_000;
const CommandMaxBufferBytes = 1_000_000;

type ExecResult = {
  stdout: string;
  stderr: string;
};

export type StartCloudflaredTunnelInput = {
  tunnelToken: string;
  publicHostname: string;
  targetLocalPort: number;
  image?: string;
  startupTimeoutMs?: number;
};

export type StartedCloudflaredTunnel = {
  publicBaseUrl: string;
  stop: () => Promise<void>;
};

function readErrorOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "Unknown command error.";
  }

  const stderr = Reflect.get(error, "stderr");
  if (typeof stderr === "string" && stderr.trim().length > 0) {
    return stderr.trim();
  }

  const stdout = Reflect.get(error, "stdout");
  if (typeof stdout === "string" && stdout.trim().length > 0) {
    return stdout.trim();
  }

  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : "Unknown command error.";
}

async function execFileOrThrow(input: {
  command: string;
  args: ReadonlyArray<string>;
}): Promise<ExecResult> {
  try {
    const result = await execFileAsync(input.command, [...input.args], {
      timeout: CommandTimeoutMs,
      maxBuffer: CommandMaxBufferBytes,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    throw new Error(
      `Command failed: ${input.command} ${input.args.join(" ")}. Output: ${readErrorOutput(error)}`,
    );
  }
}

async function readContainerLogs(containerName: string): Promise<string> {
  try {
    const result = await execFileOrThrow({
      command: "docker",
      args: ["logs", containerName],
    });

    return result.stderr.trim().length > 0 ? result.stderr : result.stdout;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function waitForPublicHealth(input: {
  publicBaseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    try {
      const response = await fetch(`${input.publicBaseUrl}/__healthz`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for cloudflared tunnel healthcheck at ${input.publicBaseUrl}/__healthz after ${String(input.timeoutMs)}ms.`,
  );
}

export async function startCloudflaredTunnel(
  input: StartCloudflaredTunnelInput,
): Promise<StartedCloudflaredTunnel> {
  const containerName = `mistle-system-cloudflared-${randomUUID()}`;
  const configDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-system-cloudflared-"));
  const configPath = join(configDirectoryPath, "config.yml");
  const publicBaseUrl = `https://${input.publicHostname}`;
  const startupTimeoutMs = input.startupTimeoutMs ?? DefaultStartupTimeoutMs;
  const image = input.image ?? DefaultCloudflaredImage;

  const configContent = [
    "ingress:",
    `  - hostname: ${input.publicHostname}`,
    `    service: http://host.docker.internal:${String(input.targetLocalPort)}`,
    "  - service: http_status:404",
    "",
  ].join("\n");

  await writeFile(configPath, configContent, "utf8");

  let started = false;

  try {
    await execFileOrThrow({
      command: "docker",
      args: [
        "run",
        "--detach",
        "--rm",
        "--name",
        containerName,
        "--add-host",
        "host.docker.internal:host-gateway",
        "--volume",
        `${configPath}:/etc/cloudflared/config.yml:ro`,
        image,
        "tunnel",
        "--config",
        "/etc/cloudflared/config.yml",
        "run",
        "--token",
        input.tunnelToken,
      ],
    });
    started = true;

    await waitForPublicHealth({
      publicBaseUrl,
      timeoutMs: startupTimeoutMs,
    });

    return {
      publicBaseUrl,
      stop: async () => {
        if (started) {
          await execFileOrThrow({
            command: "docker",
            args: ["stop", containerName],
          }).catch(() => undefined);
        }

        await rm(configDirectoryPath, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const logs = started ? await readContainerLogs(containerName) : "";
    const writtenConfig = await readFile(configPath, "utf8").catch(() => "");

    if (started) {
      await execFileOrThrow({
        command: "docker",
        args: ["stop", containerName],
      }).catch(() => undefined);
    }

    await rm(configDirectoryPath, { recursive: true, force: true });

    throw new Error(
      `Failed to start cloudflared tunnel for ${input.publicHostname}. ${error instanceof Error ? error.message : String(error)} Config: ${writtenConfig} Logs: ${logs}`,
    );
  }
}
