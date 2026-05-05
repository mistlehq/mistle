import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { stopRunnerServicePools } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";

const RunId = "runner_service_pool_cross_process";
const PoolKey = "default/pooled-http-service/process";
const StartupPollIntervalMs = 25;

let coordinatorDirectoryPath: string | undefined;

describe("runner service pool", () => {
  afterEach(async () => {
    if (coordinatorDirectoryPath === undefined) {
      return;
    }

    await stopRunnerServicePools({
      runId: RunId,
      coordinatorDir: coordinatorDirectoryPath,
    });
    await rm(coordinatorDirectoryPath, {
      force: true,
      recursive: true,
    });
    coordinatorDirectoryPath = undefined;
  });

  it("shares one started service across separate worker processes", async () => {
    coordinatorDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-runner-service-pool-"));
    const lifecycleFilePath = join(coordinatorDirectoryPath, "lifecycle.log");
    const serverScriptPath = join(coordinatorDirectoryPath, "pooled-server.mjs");
    const acquirerScriptPath = join(coordinatorDirectoryPath, "acquire-service.mts");

    await writeFile(serverScriptPath, createServerScript(), "utf8");
    await writeFile(acquirerScriptPath, createAcquirerScript(), "utf8");

    const [firstAcquire, secondAcquire] = await Promise.all([
      runAcquirer({
        acquirerScriptPath,
        coordinatorDirectoryPath,
        lifecycleFilePath,
        serverScriptPath,
      }),
      runAcquirer({
        acquirerScriptPath,
        coordinatorDirectoryPath,
        lifecycleFilePath,
        serverScriptPath,
      }),
    ]);

    expect(firstAcquire.hostBaseUrl).toBe(secondAcquire.hostBaseUrl);

    const lifecycle = await readFile(lifecycleFilePath, "utf8");
    expect(lifecycle.trim().split("\n")).toEqual(["started"]);
  }, 30_000);

  it("honors a caller-specific lock acquisition timeout", async () => {
    coordinatorDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-runner-service-pool-"));
    const lifecycleFilePath = join(coordinatorDirectoryPath, "lifecycle.log");
    const lockMarkerFilePath = join(coordinatorDirectoryPath, "lock-acquired");
    const serverScriptPath = join(coordinatorDirectoryPath, "pooled-server.mjs");
    const acquirerScriptPath = join(coordinatorDirectoryPath, "acquire-service.mts");

    await writeFile(serverScriptPath, createServerScript(), "utf8");
    await writeFile(acquirerScriptPath, createAcquirerScript(), "utf8");

    const firstAcquire = runAcquirer({
      acquirerScriptPath,
      coordinatorDirectoryPath,
      lifecycleFilePath,
      serverScriptPath,
      lockMarkerFilePath,
      startDelayMs: 3_000,
    });
    await waitForFile(lockMarkerFilePath);

    await expect(
      runAcquirer({
        acquirerScriptPath,
        coordinatorDirectoryPath,
        lifecycleFilePath,
        serverScriptPath,
        lockTimeoutMs: 100,
      }),
    ).rejects.toThrow("Timed out acquiring runner service pool lock");

    await firstAcquire;
  }, 30_000);
});

function createServerScript(): string {
  return `
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";

const server = createServer((request, response) => {
  if (request.url === "/__healthz") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected pooled server to listen on a TCP port.");
  }

  awaitWriteStartup(JSON.stringify({
    hostBaseUrl: \`http://127.0.0.1:\${address.port}\`,
    pid: process.pid,
  }));
});

function awaitWriteStartup(payload) {
  writeFile(process.env.STARTUP_FILE, \`\${payload}\\n\`, "utf8")
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
`;
}

function createAcquirerScript(): string {
  const harnessEntryUrl = pathToFileURL(join(process.cwd(), "src/index.ts")).href;

  return `
import { spawn } from "node:child_process";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { acquireRunnerServicePoolLease } from "${harnessEntryUrl}";

const coordinatorDir = readEnv("COORDINATOR_DIR");
const lifecycleFilePath = readEnv("LIFECYCLE_FILE");
const serverScriptPath = readEnv("SERVER_SCRIPT");
const lockMarkerFilePath = readOptionalEnv("LOCK_MARKER_FILE");
const lockTimeoutMs = readOptionalNumberEnv("LOCK_TIMEOUT_MS");
const startDelayMs = readOptionalNumberEnv("START_DELAY_MS") ?? 0;

const lease = await acquireRunnerServicePoolLease({
  runId: "${RunId}",
  key: "${PoolKey}",
  coordinatorDir,
  ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
  healthCheck: async (service) => {
    const httpEndpoint = readHttpEndpoint(service);
    const response = await fetch(new URL("/__healthz", httpEndpoint.hostBaseUrl));
    if (!response.ok) {
      throw new Error(\`Expected health check to pass, received \${response.status}.\`);
    }
  },
  start: async () => {
    if (lockMarkerFilePath !== undefined) {
      await writeFile(lockMarkerFilePath, "acquired\\n", "utf8");
    }
    await sleep(startDelayMs);

    const startupFilePath = \`\${coordinatorDir}/startup-\${process.pid}.json\`;
    const server = spawn(process.execPath, [serverScriptPath], {
      detached: true,
      env: {
        ...process.env,
        STARTUP_FILE: startupFilePath,
      },
      stdio: "ignore",
    });
    server.unref();

    const startup = await readStartupFile(startupFilePath);
    await appendFile(lifecycleFilePath, "started\\n", "utf8");
    await rm(startupFilePath, { force: true });

    return {
      endpoints: {
        http: {
          hostBaseUrl: startup.hostBaseUrl,
        },
      },
      pid: startup.pid,
      stop: async () => {
        process.kill(startup.pid, "SIGTERM");
      },
    };
  },
});

console.log(JSON.stringify({
  hostBaseUrl: readHttpEndpoint(lease).hostBaseUrl,
}));

await lease.release();
process.exit(0);

function readEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(\`Missing required env var \${name}.\`);
  }

  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}

function readOptionalNumberEnv(name) {
  const value = readOptionalEnv(name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(\`Expected \${name} to be a finite number.\`);
  }

  return parsed;
}

async function sleep(delayMs) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readHttpEndpoint(service) {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected pooled server to expose an HTTP endpoint.");
  }

  return httpEndpoint;
}

async function readStartupFile(startupFilePath) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(startupFilePath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.hostBaseUrl !== "string" ||
        typeof parsed.pid !== "number"
      ) {
        throw new Error("Invalid pooled server startup payload.");
      }

      return {
        hostBaseUrl: parsed.hostBaseUrl,
        pid: parsed.pid,
      };
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, ${String(StartupPollIntervalMs)}));
    }
  }

  throw new Error("Timed out waiting for pooled server startup file.");
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}
`;
}

function runAcquirer(input: {
  acquirerScriptPath: string;
  coordinatorDirectoryPath: string;
  lifecycleFilePath: string;
  serverScriptPath: string;
  lockMarkerFilePath?: string;
  lockTimeoutMs?: number;
  startDelayMs?: number;
}): Promise<{ hostBaseUrl: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", input.acquirerScriptPath],
      {
        env: {
          ...process.env,
          COORDINATOR_DIR: input.coordinatorDirectoryPath,
          LIFECYCLE_FILE: input.lifecycleFilePath,
          SERVER_SCRIPT: input.serverScriptPath,
          ...(input.lockMarkerFilePath === undefined
            ? {}
            : { LOCK_MARKER_FILE: input.lockMarkerFilePath }),
          ...(input.lockTimeoutMs === undefined
            ? {}
            : { LOCK_TIMEOUT_MS: String(input.lockTimeoutMs) }),
          ...(input.startDelayMs === undefined
            ? {}
            : { START_DELAY_MS: String(input.startDelayMs) }),
        },
        timeout: 15_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.length > 0 ? stderr : error.message));
          return;
        }

        resolve(parseAcquirerOutput(stdout));
      },
    );
  });
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath, "utf8");
      return;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    await systemSleeper.sleep(StartupPollIntervalMs);
  }

  throw new Error(`Timed out waiting for file '${filePath}'.`);
}

function parseAcquirerOutput(stdout: string): { hostBaseUrl: string } {
  const lines = stdout.trim().split("\n");
  const lastLine = lines.at(-1);
  if (lastLine === undefined) {
    throw new Error("Expected acquirer to print JSON output.");
  }

  const parsed: unknown = JSON.parse(lastLine);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Expected acquirer output to be an object.");
  }

  const hostBaseUrl = Reflect.get(parsed, "hostBaseUrl");
  if (typeof hostBaseUrl !== "string") {
    throw new Error("Expected acquirer output to contain hostBaseUrl.");
  }

  return {
    hostBaseUrl,
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}
