import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";

import { readJsonObjectFromStream } from "../src/io/read-json-object-from-stream.js";
import { applyStartupToSupervisor } from "../src/supervisor/client.js";
import {
  parseStartupApplyResponsePayload,
  type StartupApplyResponse,
} from "../src/supervisor/protocol.js";
import { startSupervisorServer, type StartedSupervisorServer } from "../src/supervisor/server.js";

const StartedSupervisors: StartedSupervisorServer[] = [];
const TemporaryDirectories: string[] = [];
const SandboxRuntimeProjectRootPath = fileURLToPath(new URL("..", import.meta.url));
const SupervisorHelperPath = fileURLToPath(
  new URL("./helpers/supervisor-bootstrap-helper.mjs", import.meta.url),
);

const ValidStartupInputJson = JSON.stringify({
  bootstrapToken: "test-token",
  tunnelExchangeToken: "test-exchange-token",
  tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
  runtimePlan: {
    sandboxProfileId: "sbp_test",
    version: 1,
    image: {
      source: "base",
      imageRef: "mistle/sandbox-base:dev",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  },
});

function createLookupEnv(controlDirectoryPath: string): (key: string) => string | undefined {
  return (key) => {
    switch (key) {
      case "SANDBOX_RUNTIME_CONTROL_DIR":
        return controlDirectoryPath;
      default:
        return undefined;
    }
  };
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directoryPath = await mkdtemp(`/tmp/${prefix}`);
  TemporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function waitForFileContents(path: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await systemSleeper.sleep(20);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`timed out waiting for file ${path}`);
}

async function sendStartupApplyRequest(input: {
  socketPath: string;
  request: unknown;
}): Promise<StartupApplyResponse> {
  const socket = createConnection(input.socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.end(JSON.stringify(input.request));

  const rawResponse = await readJsonObjectFromStream({
    reader: socket,
    maxBytes: 1024 * 1024,
    label: "startup apply response",
  });
  const payload = JSON.parse(rawResponse);
  return parseStartupApplyResponsePayload(payload);
}

async function runApplyStartupCli(input: {
  controlDirectoryPath: string;
  startupInputJson: string;
  timeoutMs: number;
}): Promise<{ code: number; stderr: string }> {
  const child = spawn("pnpm", ["exec", "tsx", "src/main.ts", "apply-startup"], {
    cwd: SandboxRuntimeProjectRootPath,
    env: {
      ...process.env,
      SANDBOX_RUNTIME_CONTROL_DIR: input.controlDirectoryPath,
    },
    stdio: ["pipe", "ignore", "pipe"],
  });

  if (child.stdin === null || child.stderr === null) {
    throw new Error("apply-startup child stdio was not available.");
  }

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitPromise = new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`apply-startup child exited with signal ${signal}. stderr: ${stderr}`));
        return;
      }
      if (code === null) {
        reject(new Error(`apply-startup child exited without code. stderr: ${stderr}`));
        return;
      }

      resolve({
        code,
        stderr,
      });
    });
  });

  child.stdin.end(input.startupInputJson, "utf8");

  try {
    return await Promise.race([
      exitPromise,
      (async () => {
        await systemSleeper.sleep(input.timeoutMs);
        child.kill("SIGTERM");
        throw new Error(
          `apply-startup child did not exit within ${String(input.timeoutMs)}ms. stderr: ${stderr}`,
        );
      })(),
    ]);
  } finally {
    child.kill("SIGTERM");
  }
}

afterEach(async () => {
  while (StartedSupervisors.length > 0) {
    const supervisor = StartedSupervisors.pop();
    if (supervisor !== undefined) {
      await supervisor.close().catch(() => undefined);
    }
  }

  while (TemporaryDirectories.length > 0) {
    const directoryPath = TemporaryDirectories.pop();
    if (directoryPath !== undefined) {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }
  }
});

describe("startSupervisorServer", () => {
  it("rejects invalid startup tokens without consuming the valid token", async () => {
    const controlDirectoryPath = await createTemporaryDirectory("mistle-supervisor-");
    const outputPath = join(controlDirectoryPath, "bootstrap-startup-input.json");
    const lookupEnv = createLookupEnv(controlDirectoryPath);

    const supervisor = await startSupervisorServer({
      lookupEnv,
      bootstrapLaunchTarget: {
        command: process.execPath,
        args: [SupervisorHelperPath],
      },
      bootstrapEnvironment: {
        ...process.env,
        MISTLE_SUPERVISOR_HELPER_OUTPUT_PATH: outputPath,
      },
    });
    StartedSupervisors.push(supervisor);

    await expect(
      sendStartupApplyRequest({
        socketPath: supervisor.socketPath,
        request: {
          token: "wrong-token",
          startupInput: JSON.parse(ValidStartupInputJson),
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "startup apply token is invalid",
    });

    await expect(readFile(supervisor.tokenPath, "utf8")).resolves.toMatch(/\S/u);

    await applyStartupToSupervisor({
      lookupEnv,
      stdin: Readable.from([ValidStartupInputJson]),
    });

    const writtenStartupInput = await waitForFileContents(outputPath);
    expect(JSON.parse(writtenStartupInput)).toEqual(JSON.parse(ValidStartupInputJson));
  });

  it("applies startup input once and launches the bootstrap helper with stdin", async () => {
    const controlDirectoryPath = await createTemporaryDirectory("mistle-supervisor-");
    const outputPath = join(controlDirectoryPath, "bootstrap-startup-input.json");
    const lookupEnv = createLookupEnv(controlDirectoryPath);

    const supervisor = await startSupervisorServer({
      lookupEnv,
      bootstrapLaunchTarget: {
        command: process.execPath,
        args: [SupervisorHelperPath],
      },
      bootstrapEnvironment: {
        ...process.env,
        MISTLE_SUPERVISOR_HELPER_OUTPUT_PATH: outputPath,
      },
    });
    StartedSupervisors.push(supervisor);

    const startupToken = (await readFile(supervisor.tokenPath, "utf8")).trim();

    await applyStartupToSupervisor({
      lookupEnv,
      stdin: Readable.from([ValidStartupInputJson]),
    });

    const writtenStartupInput = await waitForFileContents(outputPath);
    expect(JSON.parse(writtenStartupInput)).toEqual(JSON.parse(ValidStartupInputJson));

    await expect(
      applyStartupToSupervisor({
        lookupEnv,
        stdin: Readable.from([ValidStartupInputJson]),
      }),
    ).rejects.toThrow(
      "sandbox startup token is unavailable because startup may already be applied",
    );

    await expect(readFile(supervisor.tokenPath, "utf8")).rejects.toThrow(
      /ENOENT|no such file or directory/u,
    );

    await expect(
      sendStartupApplyRequest({
        socketPath: supervisor.socketPath,
        request: {
          token: startupToken,
          startupInput: JSON.parse(ValidStartupInputJson),
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "sandbox startup has already been applied",
    });
  });

  it("lets the apply-startup CLI exit after supervisor acknowledges startup", async () => {
    const controlDirectoryPath = await createTemporaryDirectory("ms-supervisor-");
    const outputPath = join(controlDirectoryPath, "bootstrap-startup-input.json");
    const lookupEnv = createLookupEnv(controlDirectoryPath);

    const supervisor = await startSupervisorServer({
      lookupEnv,
      bootstrapLaunchTarget: {
        command: process.execPath,
        args: [SupervisorHelperPath],
      },
      bootstrapEnvironment: {
        ...process.env,
        MISTLE_SUPERVISOR_HELPER_OUTPUT_PATH: outputPath,
      },
    });
    StartedSupervisors.push(supervisor);

    await expect(
      runApplyStartupCli({
        controlDirectoryPath,
        startupInputJson: ValidStartupInputJson,
        timeoutMs: 2_000,
      }),
    ).resolves.toEqual({
      code: 0,
      stderr: "",
    });

    const writtenStartupInput = await waitForFileContents(outputPath);
    expect(JSON.parse(writtenStartupInput)).toEqual(JSON.parse(ValidStartupInputJson));
  });

  it("removes the startup socket and token file when the supervisor closes", async () => {
    const controlDirectoryPath = await createTemporaryDirectory("mistle-supervisor-");
    const lookupEnv = createLookupEnv(controlDirectoryPath);

    const supervisor = await startSupervisorServer({
      lookupEnv,
      bootstrapLaunchTarget: {
        command: process.execPath,
        args: [SupervisorHelperPath],
      },
      bootstrapEnvironment: process.env,
    });

    await expect(readFile(supervisor.tokenPath, "utf8")).resolves.toMatch(/\S/u);

    await supervisor.close();

    await expect(readFile(supervisor.tokenPath, "utf8")).rejects.toThrow(
      /ENOENT|no such file or directory/u,
    );
    await expect(readFile(supervisor.socketPath, "utf8")).rejects.toThrow(
      /ENOENT|no such file or directory/u,
    );
  });
});
