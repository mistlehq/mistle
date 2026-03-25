import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { type Writable } from "node:stream";

import { assertUnixSocketPeerMatchesCurrentProcessUid } from "@mistle/sandbox-rs-napi";

import { readJsonObjectFromStream } from "../io/read-json-object-from-stream.js";
import { type StartupInput } from "../runtime/startup-input.js";
import { type BootstrapLaunchTarget } from "./bootstrap-launch-target.js";
import { loadSupervisorConfig } from "./config.js";
import {
  DefaultSupervisorMessageMaxBytes,
  parseStartupApplyRequestPayload,
  type StartupApplyResponse,
} from "./protocol.js";

type LookupEnv = (key: string) => string | undefined;

type StartSupervisorServerInput = {
  lookupEnv: LookupEnv;
  bootstrapLaunchTarget: BootstrapLaunchTarget;
  bootstrapEnvironment?: NodeJS.ProcessEnv;
  stderr?: Writable;
};

export type StartedSupervisorServer = {
  socketPath: string;
  tokenPath: string;
  close: () => Promise<void>;
  closed: Promise<void>;
};

type ActiveBootstrapProcess = {
  child: ChildProcess;
};

function getSocketFileDescriptor(socket: Socket): number {
  const handle = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(socket),
    "_handle",
  )?.get?.call(socket);
  if (typeof handle !== "object" || handle === null) {
    throw new Error("startup apply connection fd is unavailable");
  }

  const fd = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Object.getPrototypeOf(handle)),
    "fd",
  )?.get?.call(handle);
  if (typeof fd !== "number" || !Number.isInteger(fd) || fd < 0) {
    throw new Error("startup apply connection fd is unavailable");
  }

  return fd;
}

function formatChildExit(
  child: ChildProcess,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const pidText = child.pid === undefined ? "unknown" : String(child.pid);
  const exitCodeText = code === null ? "null" : String(code);
  const signalText = signal === null ? "null" : signal;
  return `sandbox bootstrap process exited (pid=${pidText} code=${exitCodeText} signal=${signalText})`;
}

async function writeResponse(socket: Socket, response: StartupApplyResponse): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.end(JSON.stringify(response), () => {
      socket.off("error", reject);
      resolve();
    });
  });
}

async function ensureAuthorizedPeer(socket: Socket): Promise<void> {
  assertUnixSocketPeerMatchesCurrentProcessUid(getSocketFileDescriptor(socket));
}

async function launchBootstrapProcess(input: {
  startupInput: StartupInput;
  bootstrapLaunchTarget: BootstrapLaunchTarget;
  bootstrapEnvironment: NodeJS.ProcessEnv;
  stderr: Writable;
}): Promise<ChildProcess> {
  const child = spawn(input.bootstrapLaunchTarget.command, input.bootstrapLaunchTarget.args, {
    env: input.bootstrapEnvironment,
    stdio: ["pipe", "inherit", "inherit"],
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  if (child.stdin === null) {
    throw new Error("sandbox bootstrap stdin is unavailable");
  }

  await new Promise<void>((resolve, reject) => {
    child.stdin.once("error", reject);
    child.stdin.end(JSON.stringify(input.startupInput), "utf8", () => {
      resolve();
    });
  });

  child.on("exit", (code, signal) => {
    input.stderr.write(`${formatChildExit(child, code, signal)}\n`);
  });

  return child;
}

async function readStartupApplyToken(tokenPath: string): Promise<string> {
  const token = (await readFile(tokenPath, "utf8")).trim();
  if (token.length === 0) {
    throw new Error(`startup token file "${tokenPath}" is empty`);
  }

  return token;
}

async function writeStartupApplyToken(tokenPath: string): Promise<void> {
  await writeFile(tokenPath, `${randomBytes(32).toString("base64url")}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function startSupervisorServer(
  input: StartSupervisorServerInput,
): Promise<StartedSupervisorServer> {
  const config = loadSupervisorConfig(input.lookupEnv);
  const stderr = input.stderr ?? process.stderr;

  const server = createServer({
    allowHalfOpen: true,
  });
  const activeSockets = new Set<Socket>();
  let activeBootstrapProcess: ActiveBootstrapProcess | undefined;
  let startupConsumed = false;
  let startupApplying = false;
  let closing = false;

  async function handleConnection(socket: Socket): Promise<void> {
    await ensureAuthorizedPeer(socket);
    const rawRequest = await readJsonObjectFromStream({
      reader: socket,
      maxBytes: DefaultSupervisorMessageMaxBytes,
      label: "startup apply request",
    });

    let payload: unknown;
    try {
      payload = JSON.parse(rawRequest);
    } catch (error) {
      throw new Error(
        `startup apply request must be valid json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (startupConsumed || startupApplying) {
      throw new Error("sandbox startup has already been applied");
    }

    const request = parseStartupApplyRequestPayload(payload);
    const expectedToken = await readStartupApplyToken(config.tokenPath);
    if (request.token !== expectedToken) {
      throw new Error("startup apply token is invalid");
    }

    startupApplying = true;
    try {
      await rm(config.tokenPath, {
        force: true,
      });

      activeBootstrapProcess = {
        child: await launchBootstrapProcess({
          startupInput: request.startupInput,
          bootstrapLaunchTarget: input.bootstrapLaunchTarget,
          bootstrapEnvironment: input.bootstrapEnvironment ?? process.env,
          stderr,
        }),
      };
      startupConsumed = true;
    } finally {
      if (!startupConsumed) {
        startupApplying = false;
      }
    }

    await writeResponse(socket, {
      ok: true,
    });
  }

  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });

    void handleConnection(socket).catch(async (error) => {
      await writeResponse(socket, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    });
  });

  try {
    await mkdir(config.controlDirectoryPath, {
      recursive: true,
      mode: 0o700,
    });
    await chmod(config.controlDirectoryPath, 0o700);
    await writeStartupApplyToken(config.tokenPath);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(config.socketPath, 0o600);
  } catch (error) {
    server.close();
    await rm(config.socketPath, {
      force: true,
    }).catch(() => undefined);
    await rm(config.tokenPath, {
      force: true,
    }).catch(() => undefined);
    throw error;
  }

  const closed = new Promise<void>((resolve) => {
    server.once("close", () => {
      resolve();
    });
  });

  return {
    socketPath: config.socketPath,
    tokenPath: config.tokenPath,
    close: async () => {
      if (closing) {
        await closed;
        return;
      }

      closing = true;

      for (const socket of activeSockets) {
        socket.destroy();
      }

      if (activeBootstrapProcess?.child.pid !== undefined) {
        activeBootstrapProcess.child.kill("SIGTERM");
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await rm(config.socketPath, {
        force: true,
      });
      await rm(config.tokenPath, {
        force: true,
      });
    },
    closed,
  };
}
