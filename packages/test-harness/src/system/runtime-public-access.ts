import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { systemSleeper } from "@mistle/time";

import {
  buildCloudflaredTunnelConfig,
  parseCloudflaredTunnelCredentialsJson,
} from "./cloudflared-config.js";

const execFileAsync = promisify(execFile);

const CloudflaredImageReference = "cloudflare/cloudflared:latest";
const CloudflaredTunnelPollIntervalMs = 500;
const CloudflaredTunnelStartupTimeoutMs = 60_000;
const DockerHostGatewayName = "host.docker.internal";
const RuntimePublicAccessTunnelLabel = "mistle.runtime-public-access.tunnel-id";

export type RuntimePublicAccessTunnel = {
  publicBaseUrls: ReadonlyMap<string, string>;
  stop: () => Promise<void>;
};

export async function startRuntimeCloudflaredTunnel(input: {
  tunnelId: string;
  tunnelCredentialsJson: string;
  ingressRules: ReadonlyArray<{
    publicHostname: string;
    localBaseUrl: string;
  }>;
}): Promise<RuntimePublicAccessTunnel> {
  const configDirectory = await mkdtemp(join(tmpdir(), "mistle-runtime-cloudflared-"));
  const configPath = join(configDirectory, "config.yml");
  const credentialsPath = join(configDirectory, "credentials.json");
  const containerName = `mistle-runtime-cloudflared-${randomUUID().replaceAll("-", "")}`;
  if (input.ingressRules.length === 0) {
    throw new Error("Runtime Cloudflare public access requires at least one ingress rule.");
  }

  const publicBaseUrls = new Map(
    input.ingressRules.map((rule) => [rule.publicHostname, `https://${rule.publicHostname}`]),
  );
  parseCloudflaredTunnelCredentialsJson({
    tunnelId: input.tunnelId,
    credentialsJson: input.tunnelCredentialsJson,
  });
  const configContent = buildCloudflaredTunnelConfig({
    tunnelId: input.tunnelId,
    credentialsFilePath: "/etc/cloudflared/credentials.json",
    ingressRules: input.ingressRules.map((rule) => ({
      publicHostname: rule.publicHostname,
      serviceUrl: createDockerReachableServiceUrl(rule.localBaseUrl),
    })),
  });

  await writeFile(credentialsPath, input.tunnelCredentialsJson, "utf8");
  await writeFile(configPath, configContent, "utf8");

  let started = false;
  try {
    await removeExistingRuntimeCloudflaredTunnel(input.tunnelId);
    await execFileAsync(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        containerName,
        "--label",
        `${RuntimePublicAccessTunnelLabel}=${input.tunnelId}`,
        "--add-host",
        `${DockerHostGatewayName}:host-gateway`,
        "--volume",
        `${configPath}:/etc/cloudflared/config.yml:ro`,
        "--volume",
        `${credentialsPath}:/etc/cloudflared/credentials.json:ro`,
        CloudflaredImageReference,
        "tunnel",
        "--config",
        "/etc/cloudflared/config.yml",
        "run",
        input.tunnelId,
      ],
      {
        timeout: 30_000,
        maxBuffer: 1_000_000,
      },
    );
    started = true;

    for (const publicBaseUrl of publicBaseUrls.values()) {
      await waitForCloudflaredHealth({
        publicBaseUrl,
        timeoutMs: CloudflaredTunnelStartupTimeoutMs,
      });
    }

    return {
      publicBaseUrls,
      stop: async () => {
        if (started) {
          await execFileAsync("docker", ["stop", containerName], {
            timeout: 30_000,
            maxBuffer: 1_000_000,
          }).catch(() => undefined);
        }

        await rm(configDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const writtenConfig = await readFile(configPath, "utf8").catch(() => "");
    const writtenCredentials = await readFile(credentialsPath, "utf8").catch(() => "");
    const logs = started ? await readCloudflaredLogs(containerName) : "";

    if (started) {
      await execFileAsync("docker", ["stop", containerName], {
        timeout: 30_000,
        maxBuffer: 1_000_000,
      }).catch(() => undefined);
    }
    await rm(configDirectory, { recursive: true, force: true });

    throw new Error(
      `Failed to start runtime Cloudflare public access for ${input.ingressRules
        .map((rule) => rule.publicHostname)
        .join(
          ", ",
        )}. ${error instanceof Error ? error.message : String(error)} Config: ${writtenConfig} Credentials: ${writtenCredentials} Logs: ${logs}`,
    );
  }
}

async function removeExistingRuntimeCloudflaredTunnel(tunnelId: string): Promise<void> {
  const result = await execFileAsync("docker", [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=${RuntimePublicAccessTunnelLabel}=${tunnelId}`,
  ]);
  const containerIds = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (containerIds.length === 0) {
    return;
  }

  await execFileAsync("docker", ["rm", "--force", ...containerIds], {
    timeout: 30_000,
    maxBuffer: 1_000_000,
  });
}

function createDockerReachableServiceUrl(localBaseUrl: string): string {
  const url = new URL(localBaseUrl);
  url.hostname = DockerHostGatewayName;
  return url.toString().replace(/\/$/u, "");
}

async function waitForCloudflaredHealth(input: {
  publicBaseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const response = await fetch(new URL("/__healthz", input.publicBaseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the tunnel route is active or the explicit timeout expires.
    }

    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime Cloudflare public access at ${input.publicBaseUrl}/__healthz after ${String(input.timeoutMs)}ms.`,
  );
}

async function readCloudflaredLogs(containerName: string): Promise<string> {
  try {
    const result = await execFileAsync("docker", ["logs", containerName], {
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });

    return result.stderr.trim().length > 0 ? result.stderr : result.stdout;
  } catch (error) {
    return readErrorString(error, "stderr") || readErrorString(error, "stdout");
  }
}

function readErrorString(error: unknown, property: "stderr" | "stdout"): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, property);
  const output = descriptor?.value;
  if (typeof output === "string") {
    return output;
  }

  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }

  return "";
}
