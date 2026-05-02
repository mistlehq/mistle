import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireHostedRuntimeService, stopRunnerServicePools } from "@mistle/test-harness";
import { afterEach, describe, expect, it } from "vitest";

const RunId = "hosted_runtime_service";
const RuntimeKey = "default/hosted-runtime-service/runtime";

let coordinatorDirectoryPath: string | undefined;
let previousLifecycleFilePath: string | undefined;

describe("hosted runtime service", () => {
  afterEach(async () => {
    if (previousLifecycleFilePath === undefined) {
      delete process.env["MISTLE_HOSTED_RUNTIME_LIFECYCLE_FILE"];
    } else {
      process.env["MISTLE_HOSTED_RUNTIME_LIFECYCLE_FILE"] = previousLifecycleFilePath;
    }
    previousLifecycleFilePath = undefined;

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

  it("pools runtime services through a host process", async () => {
    coordinatorDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-hosted-runtime-"));
    const lifecycleFilePath = join(coordinatorDirectoryPath, "lifecycle.log");
    const runtimeModulePath = join(coordinatorDirectoryPath, "runtime-module.mjs");
    await writeFile(runtimeModulePath, createRuntimeModule(), "utf8");

    previousLifecycleFilePath = process.env["MISTLE_HOSTED_RUNTIME_LIFECYCLE_FILE"];
    process.env["MISTLE_HOSTED_RUNTIME_LIFECYCLE_FILE"] = lifecycleFilePath;

    const [firstLease, secondLease] = await Promise.all([
      acquireHostedRuntimeService({
        runId: RunId,
        coordinatorDir: coordinatorDirectoryPath,
        key: RuntimeKey,
        modulePath: runtimeModulePath,
        exportName: "startRuntime",
        healthCheckPath: "/__healthz",
      }),
      acquireHostedRuntimeService({
        runId: RunId,
        coordinatorDir: coordinatorDirectoryPath,
        key: RuntimeKey,
        modulePath: runtimeModulePath,
        exportName: "startRuntime",
        healthCheckPath: "/__healthz",
      }),
    ]);

    expect(readHostBaseUrl(firstLease)).toBe(readHostBaseUrl(secondLease));
    const lifecycle = await readFile(lifecycleFilePath, "utf8");
    expect(lifecycle.trim().split("\n")).toEqual(["started"]);

    await firstLease.release();
    await secondLease.release();
  });
});

function readHostBaseUrl(lease: {
  endpoints: {
    http?: {
      hostBaseUrl: string;
    };
  };
}): string {
  const httpEndpoint = lease.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected hosted runtime lease to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

function createRuntimeModule(): string {
  return `
import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";

export async function startRuntime(input) {
  const lifecycleFilePath = process.env.MISTLE_HOSTED_RUNTIME_LIFECYCLE_FILE;
  if (lifecycleFilePath === undefined || lifecycleFilePath.length === 0) {
    throw new Error("Missing lifecycle file path.");
  }

  const server = createServer((request, response) => {
    if (request.url === "/__healthz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise((resolve) => {
    server.listen(input.port, input.host, resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected hosted runtime server to listen on a TCP port.");
  }

  await appendFile(lifecycleFilePath, "started\\n", "utf8");

  return {
    hostBaseUrl: \`http://127.0.0.1:\${address.port}\`,
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
}
`;
}
