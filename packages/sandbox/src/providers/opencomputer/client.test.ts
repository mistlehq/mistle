import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Image } from "@opencomputer/sdk/node";
import { describe, expect, it } from "vitest";

import {
  OpenComputerClientError,
  OpenComputerClientErrorCodes,
  OpenComputerClientOperationIds,
} from "./client-errors.js";
import {
  OpenComputerApiClient,
  createOpenComputerActivateCommandArgs,
  createOpenComputerBaseImage,
  createOpenComputerDaemonCommand,
  createOpenComputerImageManifest,
  createOpenComputerImageFromManifest,
  createOpenComputerRootShellCommand,
  createOpenComputerSandboxdCommand,
  createOpenComputerStartSandboxBody,
  normalizeOpenComputerInspectDisposition,
  normalizeOpenComputerInspectState,
  validateOpenComputerSnapshotForImage,
} from "./client.js";
import { OpenComputerSnapshotStates, createOpenComputerResourceFields } from "./schemas.js";

describe("OpenComputer client helpers", () => {
  it("maps start resources to OpenComputer field names and validates tier pairs", () => {
    expect(createOpenComputerResourceFields({ vcpuCount: 1, memoryMb: 1024 })).toEqual({
      cpuCount: 1,
      memoryMB: 1024,
    });
    expect(
      createOpenComputerResourceFields({ vcpuCount: 1, memoryMb: 4096, diskMb: 20_480 }),
    ).toEqual({
      cpuCount: 1,
      memoryMB: 4096,
      diskMB: 20_480,
    });
    expect(() => createOpenComputerResourceFields({ vcpuCount: 2, memoryMb: 4096 })).toThrow(
      "OpenComputer resources must match a supported tier",
    );
  });

  it("creates start bodies without custom provider ids", () => {
    expect(
      createOpenComputerStartSandboxBody({
        sandboxInstanceId: "sandbox_instance_123",
        image: { kind: "snapshot", id: "mistle-base" },
        env: { FOO: "bar" },
        resources: { vcpuCount: 1, memoryMb: 1024 },
      }),
    ).toEqual({
      snapshot: "mistle-base",
      timeout: 0,
      envs: { FOO: "bar" },
      metadata: {
        mistleSandboxInstanceId: "sandbox_instance_123",
        mistleProvider: "opencomputer",
      },
      cpuCount: 1,
      memoryMB: 1024,
    });
  });

  it("normalizes sandbox status into provider-neutral lifecycle state", () => {
    expect(normalizeOpenComputerInspectState("running")).toBe("running");
    expect(normalizeOpenComputerInspectDisposition("running")).toBe("active");
    expect(normalizeOpenComputerInspectState("hibernated")).toBe("stopped");
    expect(normalizeOpenComputerInspectDisposition("hibernated")).toBe("resumable_stopped");
    expect(normalizeOpenComputerInspectDisposition("hibernating")).toBe("stopping");
    expect(normalizeOpenComputerInspectDisposition("killed")).toBe("terminal_stopped");
  });

  it("constructs sudo based sandboxd commands with the required root path", () => {
    expect(createOpenComputerDaemonCommand()).toContain("/usr/sbin");
    expect(createOpenComputerSandboxdCommand({ args: ["ready"] })).toEqual({
      command: "sudo",
      args: [
        "-n",
        "env",
        "PATH=/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "/opt/mistle/bin/sandboxd",
        "ready",
      ],
    });
    expect(createOpenComputerRootShellCommand({ script: "id -u" })).toEqual({
      command: "sudo",
      args: [
        "-n",
        "env",
        "PATH=/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "sh",
        "-euc",
        "id -u",
      ],
    });
    expect(
      createOpenComputerRootShellCommand({
        script: "printf '%s' \"$MISTLE_SANDBOXD_ARTIFACT_VERSION\"",
        env: {
          MISTLE_SANDBOXD_ARTIFACT_VERSION: "0.32.0",
          MISTLE_SANDBOXD_ARTIFACT_URL: "https://example.com/sandboxd.tar.gz",
        },
      }),
    ).toEqual({
      command: "sudo",
      args: [
        "-n",
        "env",
        "PATH=/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "MISTLE_SANDBOXD_ARTIFACT_VERSION=0.32.0",
        "MISTLE_SANDBOXD_ARTIFACT_URL=https://example.com/sandboxd.tar.gz",
        "sh",
        "-euc",
        "printf '%s' \"$MISTLE_SANDBOXD_ARTIFACT_VERSION\"",
      ],
    });
    expect(
      createOpenComputerSandboxdCommand({
        args: ["activate"],
        env: { MISTLE_SANDBOX_BOOTSTRAP_TOKEN: "bootstrap-token" },
      }),
    ).toEqual({
      command: "sudo",
      args: [
        "-n",
        "env",
        "PATH=/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "MISTLE_SANDBOX_BOOTSTRAP_TOKEN=bootstrap-token",
        "/opt/mistle/bin/sandboxd",
        "activate",
      ],
    });
  });

  it("passes activation payload length through --stdin-bytes", () => {
    expect(createOpenComputerActivateCommandArgs({ payload: new Uint8Array([1, 2, 3]) })).toEqual([
      "activate",
      "--stdin-bytes",
      "3",
    ]);
  });

  it("validates named snapshot manifests and ready status", () => {
    const image = createOpenComputerBaseImage({});
    const manifest = image.toJSON();
    expect(() =>
      validateOpenComputerSnapshotForImage({
        expectedImage: image,
        snapshot: {
          name: "mistle-base",
          status: OpenComputerSnapshotStates.READY,
          manifest,
        },
      }),
    ).not.toThrow();

    expect(() =>
      validateOpenComputerSnapshotForImage({
        expectedImage: image,
        snapshot: {
          name: "mistle-base",
          status: OpenComputerSnapshotStates.READY,
          manifest: { base: "base", steps: [] },
        },
      }),
    ).toThrow(OpenComputerClientError);
  });

  it("treats building snapshots as retryable image preparation failures", () => {
    const image = createOpenComputerBaseImage({});
    const clientError = captureOpenComputerClientError(() =>
      validateOpenComputerSnapshotForImage({
        expectedImage: image,
        snapshot: {
          name: "mistle-base",
          status: OpenComputerSnapshotStates.BUILDING,
          manifest: image.toJSON(),
        },
      }),
    );
    expect(clientError.code).toBe(OpenComputerClientErrorCodes.INVALID_ARGUMENT);
    expect(clientError.retryable).toBe(true);
  });

  it("keeps requested source identity in OpenComputer image manifests", () => {
    const firstImage = createOpenComputerBaseImage({
      source: { kind: "image", imageId: "ghcr.io/mistlehq/base:first" },
    });
    const secondImage = createOpenComputerBaseImage({
      source: { kind: "image", imageId: "ghcr.io/mistlehq/base:second" },
    });

    expect(firstImage.toJSON()).not.toEqual(secondImage.toJSON());
  });

  it("uses sudo for privileged base image setup commands", () => {
    const manifest = JSON.stringify(createOpenComputerBaseImage({}).toJSON());

    expect(manifest).toContain("sudo -n install -d -m 0755 /opt/mistle/bin");
    expect(manifest).toContain("sudo -n install -d -m 0700 /run/mistle");
    expect(manifest).toContain("sudo -n tee /etc/profile.d/mistle-path.sh");
  });

  it("does not install systemd packages that interfere with OpenComputer checkpoint boot", () => {
    const manifest = JSON.stringify(createOpenComputerBaseImage({}).toJSON());

    expect(manifest).not.toContain("systemd-sysv");
    expect(manifest).not.toContain('"systemd"');
  });

  it("replays deferred image manifests through the OpenComputer image builder", () => {
    const image = createOpenComputerBaseImage({
      source: {
        kind: "sdk_image",
        imageId: "mistle-sdk",
        baseImageRef: "ghcr.io/mistlehq/base:latest",
      },
    });

    const manifest = createOpenComputerImageManifest(image);
    expect(createOpenComputerImageFromManifest(manifest).toJSON()).toEqual(image.toJSON());
  });

  it("preserves binary add_file content when replaying deferred image manifests", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "mistle-opencomputer-test-"));
    const binaryPath = join(temporaryDirectory, "sandboxd.gz");
    try {
      writeFileSync(binaryPath, new Uint8Array([0, 159, 146, 150, 255]));
      const image = Image.base().addLocalFile(binaryPath, "/tmp/sandboxd.gz");
      const manifest = createOpenComputerImageManifest(image);

      expect(createOpenComputerImageFromManifest(manifest).toJSON()).toEqual(image.toJSON());
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("revalidates same-name snapshot prepares when deferred manifests differ", async () => {
    const firstManifest = createOpenComputerImageManifest(
      createOpenComputerBaseImage({
        source: { kind: "sdk_image", imageId: "mistle-sdk", baseImageRef: "ubuntu:24.04" },
      }),
    );
    const secondManifest = createOpenComputerImageManifest(
      createOpenComputerBaseImage({
        source: { kind: "sdk_image", imageId: "mistle-sdk", baseImageRef: "ubuntu:22.04" },
      }),
    );
    let snapshotReadCount = 0;
    const api = await startSimulatedOpenComputerApi(async (request, response) => {
      if (request.method === "GET" && request.url === "/api/snapshots/mistle-sdk") {
        snapshotReadCount += 1;
        if (snapshotReadCount === 1) {
          response.writeHead(404);
          response.end("missing");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            name: "mistle-sdk",
            status: OpenComputerSnapshotStates.READY,
            manifest: firstManifest,
          }),
        );
        return;
      }

      if (request.method === "POST" && request.url === "/api/snapshots") {
        await readRequestBody(request);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            name: "mistle-sdk",
            status: OpenComputerSnapshotStates.READY,
            manifest: firstManifest,
          }),
        );
        return;
      }

      response.writeHead(404);
      response.end();
    });
    const client = new OpenComputerApiClient({
      config: { apiKey: "test-key", apiBaseUrl: api.url },
    });

    try {
      await expect(
        client.prepareImage({
          image: { kind: "image", id: "mistle-sdk", manifest: firstManifest },
        }),
      ).resolves.toEqual({ image: { kind: "snapshot", id: "mistle-sdk" } });

      await expect(
        client.prepareImage({
          image: { kind: "image", id: "mistle-sdk", manifest: secondManifest },
        }),
      ).rejects.toThrow("different image manifest");
      expect(snapshotReadCount).toBe(2);
    } finally {
      await api.close();
    }
  });

  it("creates sandboxes under the normalized API base path", async () => {
    let sandboxCreateBody: unknown;
    const api = await startSimulatedOpenComputerApi(async (request, response) => {
      if (request.method === "POST" && request.url === "/api/sandboxes") {
        sandboxCreateBody = JSON.parse(await readRequestBody(request));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ sandboxID: "sb-1" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const client = new OpenComputerApiClient({
      config: { apiKey: "test-key", apiBaseUrl: api.url },
    });

    try {
      await expect(
        client.startSandbox({
          image: { kind: "snapshot", id: "mistle-base" },
        }),
      ).resolves.toEqual({ sandboxId: "sb-1" });
      expect(sandboxCreateBody).toMatchObject({
        snapshot: "mistle-base",
        timeout: 0,
      });
    } finally {
      await api.close();
    }
  });

  it("captures snapshots when callers provide a provider request timeout", async () => {
    let checkpointBody: unknown;
    const api = await startSimulatedOpenComputerApi(async (request, response) => {
      if (request.method === "POST" && request.url === "/api/sandboxes/sb-1/checkpoints") {
        checkpointBody = JSON.parse(await readRequestBody(request));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ checkpointId: "checkpoint-1" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const client = new OpenComputerApiClient({
      config: { apiKey: "test-key", apiBaseUrl: api.url },
    });

    try {
      await expect(
        client.captureSandboxSnapshot({
          sandboxId: "sb-1",
          name: "mistle-sb-1",
          requestTimeoutMs: 1_000,
        }),
      ).resolves.toEqual({ checkpointId: "checkpoint-1" });
      expect(checkpointBody).toEqual({ name: "mistle-sb-1" });
    } finally {
      await api.close();
    }
  });

  it("fails malformed exec/run responses that omit the exit code", async () => {
    const api = await startSimulatedOpenComputerApi((request, response) => {
      if (request.method === "POST" && request.url === "/api/sandboxes/sb-1/exec/run") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ stdout: "ready" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const client = new OpenComputerApiClient({
      config: { apiKey: "test-key", apiBaseUrl: api.url },
    });

    try {
      await expect(
        client.runCommand({
          sandboxId: "sb-1",
          command: "true",
          operation: OpenComputerClientOperationIds.RUN_COMMAND,
          commandDescription: "Run test command",
        }),
      ).rejects.toThrow("exit code");
    } finally {
      await api.close();
    }
  });
});

function captureOpenComputerClientError(fn: () => void): OpenComputerClientError {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpenComputerClientError) {
      return error;
    }
    throw new Error("Expected OpenComputerClientError.", { cause: error });
  }
  throw new Error("Expected OpenComputerClientError.");
}

async function startSimulatedOpenComputerApi(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Simulated OpenComputer API did not bind a TCP port.");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      await closeServer(server);
    },
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
