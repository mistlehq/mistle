/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture and real cross-service flows.
 */

import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { systemScheduler, type TimerHandle } from "@mistle/time";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";

import { runSandboxExecCommandInSandbox } from "./helpers/codex-sandbox.js";
import {
  createOpenAiConnection,
  createSandboxProfile,
  closeWebSocketIfOpen,
  bootstrapPortAccess,
  mintConnectionToken,
  mintPortAccess,
  NodeToolCommand,
  readHeaderValue,
  resolveGatewayTunnelWebSocketUrl,
  resolvePortAccessWebSocketUrl,
  sendGatewayHttpRequest,
  startSandboxInstance,
  updateSandboxBindings,
  waitForCondition,
  waitForSandboxInstanceRunning,
  waitForWebSocketOpen,
  WebSocketMessageTimeoutMs,
  WebSocketOpenTimeoutMs,
  withTimeout,
} from "./helpers/port-access.js";
import { it, type SystemTestFixture } from "./system-test-context.js";

const ViteFixtureHostPath = fileURLToPath(new URL("./fixtures/vite-dev-server", import.meta.url));
const ViteFixtureSandboxPath = "/tmp/mistle-port-access-vite-fixture";
const ViteLogPath = "/tmp/mistle-port-access-vite-fixture/vite.log";
const VitePort = 6006;
const ViteInstallTimeoutMs = 4 * 60_000;
const SandboxProbeTimeoutMs = 10_000;
const ListenerReadyTimeoutMs = 30_000;
const RefreshRounds = 3;
const ViteRequestTimeoutMs = 30_000;
const TestTimeoutMs = 12 * 60_000;

const HmrConnectedMessageSchema = z.object({
  type: z.literal("connected"),
});

const HmrUpdateMessageSchema = z.object({
  type: z.literal("update"),
  updates: z
    .array(
      z.object({
        acceptedPath: z.string().min(1).optional(),
        path: z.string().min(1),
        timestamp: z.number(),
        type: z.string().min(1),
      }),
    )
    .min(1),
});

type AuthenticatedSystemSession = Awaited<ReturnType<SystemTestFixture["authSession"]>>;
type FixtureFile = {
  contents: string;
  sandboxPath: string;
};

type PreparedViteSandbox = {
  sandboxInstanceId: string;
  session: AuthenticatedSystemSession;
};

type OpenVitePortAccessSession = {
  bootstrap: Awaited<ReturnType<typeof mintPortAccess>>;
  readTunnelCloseDescription: () => string;
  sessionCookie: string;
  tunnelSocket: WebSocket;
};
type HmrMessagePump = {
  close: () => void;
  waitForTextMessage: (timeoutMs: number) => Promise<string>;
};
type PendingHmrMessageWaiter = {
  reject: (error: Error) => void;
  resolve: (message: string) => void;
  timeout: TimerHandle;
};

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function wrapShellScriptWithHeartbeat(input: { script: string; intervalSeconds: number }): string {
  return [
    "set -eu",
    "heartbeat() {",
    `  while :; do printf '__mistle_heartbeat__\\n'; sleep ${String(input.intervalSeconds)}; done`,
    "}",
    "heartbeat &",
    "heartbeat_pid=$!",
    "cleanup() {",
    '  kill "$heartbeat_pid" 2>/dev/null || true',
    '  wait "$heartbeat_pid" 2>/dev/null || true',
    "}",
    "trap cleanup EXIT",
    input.script,
  ].join("\n");
}

function requireMatchedValue(input: {
  description: string;
  pattern: RegExp;
  text: string;
}): string {
  const match = input.text.match(input.pattern);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`Failed to find ${input.description}.`);
  }

  return value;
}

function decodeWebSocketText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function createHmrMessagePump(socket: WebSocket): HmrMessagePump {
  const queuedMessages: string[] = [];
  const waiters: PendingHmrMessageWaiter[] = [];
  let closed = false;

  const removeWaiter = (waiter: PendingHmrMessageWaiter): void => {
    systemScheduler.cancel(waiter.timeout);
    const waiterIndex = waiters.indexOf(waiter);
    if (waiterIndex !== -1) {
      waiters.splice(waiterIndex, 1);
    }
  };

  const rejectAll = (error: Error): void => {
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      systemScheduler.cancel(waiter.timeout);
      waiter.reject(error);
    }
  };

  const onMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      rejectAll(new Error("Expected a text Vite HMR websocket message."));
      return;
    }

    const message = decodeWebSocketText(data);
    const waiter = waiters.shift();
    if (waiter === undefined) {
      queuedMessages.push(message);
      return;
    }

    systemScheduler.cancel(waiter.timeout);
    waiter.resolve(message);
  };

  const onError = (): void => {
    rejectAll(new Error("Vite HMR websocket emitted an error while waiting for a message."));
  };

  const onClose = (): void => {
    rejectAll(new Error("Vite HMR websocket closed while waiting for a message."));
  };

  socket.on("message", onMessage);
  socket.on("error", onError);
  socket.on("close", onClose);

  return {
    close: () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
      rejectAll(new Error("Vite HMR message pump was closed."));
    },
    waitForTextMessage: async (timeoutMs) => {
      const queuedMessage = queuedMessages.shift();
      if (queuedMessage !== undefined) {
        return queuedMessage;
      }
      if (closed) {
        throw new Error("Vite HMR websocket is closed.");
      }

      return await new Promise<string>((resolve, reject) => {
        const waiter: PendingHmrMessageWaiter = {
          reject,
          resolve,
          timeout: systemScheduler.schedule(() => {
            removeWaiter(waiter);
            reject(
              new Error(`Timed out after ${String(timeoutMs)}ms waiting for Vite HMR message.`),
            );
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

function extractHmrPath(viteClientSource: string): string {
  const wsToken = requireMatchedValue({
    description: "Vite HMR websocket token",
    pattern: /const wsToken = "([^"]+)";/,
    text: viteClientSource,
  });
  const hmrBasePath = requireMatchedValue({
    description: "Vite HMR websocket base path",
    pattern: /const socketHost = `\$\{[^`]+\}:\$\{[^`]+\}([^`]*)`;/,
    text: viteClientSource,
  });

  return `${hmrBasePath}?token=${encodeURIComponent(wsToken)}`;
}

function extractLogoImportPath(mainModuleSource: string): string {
  return requireMatchedValue({
    description: "logo asset import path",
    pattern: /"(\/src\/logo\.svg[^"]+)"/,
    text: mainModuleSource,
  });
}

function extractRawTextImportPath(mainModuleSource: string): string {
  return requireMatchedValue({
    description: "raw text import path",
    pattern: /"(\/src\/note\.txt[^"]+)"/,
    text: mainModuleSource,
  });
}

async function collectFixtureFiles(input: {
  hostFixturePath: string;
  sandboxFixturePath: string;
}): Promise<FixtureFile[]> {
  const fixtureFiles: FixtureFile[] = [];
  const entries = await readdir(input.hostFixturePath, { withFileTypes: true });

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".vite" ||
      entry.name === ".vite-temp" ||
      entry.name === ".pnpm-store"
    ) {
      continue;
    }

    const hostPath = join(input.hostFixturePath, entry.name);
    const sandboxPath = `${input.sandboxFixturePath}/${entry.name}`;

    if (entry.isDirectory()) {
      fixtureFiles.push(
        ...(await collectFixtureFiles({
          hostFixturePath: hostPath,
          sandboxFixturePath: sandboxPath,
        })),
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    fixtureFiles.push({
      contents: await readFile(hostPath, "utf8"),
      sandboxPath,
    });
  }

  fixtureFiles.sort((left, right) => left.sandboxPath.localeCompare(right.sandboxPath));
  return fixtureFiles;
}

async function expectSuccessfulSandboxCommand(input: {
  fixture: SystemTestFixture;
  authenticatedSession: Awaited<ReturnType<SystemTestFixture["authSession"]>>;
  sandboxInstanceId: string;
  command: string;
  args?: string[];
  description: string;
  timeoutMs?: number;
}): Promise<string> {
  const commandInput: {
    fixture: SystemTestFixture;
    authenticatedSession: Awaited<ReturnType<SystemTestFixture["authSession"]>>;
    sandboxInstanceId: string;
    command: string;
    args?: string[];
    timeoutMs?: number;
  } = {
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: input.command,
  };

  if (input.args !== undefined) {
    commandInput.args = input.args;
  }

  if (input.timeoutMs !== undefined) {
    commandInput.timeoutMs = input.timeoutMs;
  }

  const result = await runSandboxExecCommandInSandbox(commandInput).catch((error: unknown) => {
    throw new Error(
      `${input.description} failed before command completion: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${input.description} failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

async function stageFixtureDirectoryInSandbox(input: {
  fixture: SystemTestFixture;
  authenticatedSession: Awaited<ReturnType<SystemTestFixture["authSession"]>>;
  sandboxInstanceId: string;
  hostFixturePath: string;
  sandboxFixturePath: string;
}): Promise<void> {
  const fixtureFiles = await collectFixtureFiles({
    hostFixturePath: input.hostFixturePath,
    sandboxFixturePath: input.sandboxFixturePath,
  });

  await expectSuccessfulSandboxCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    description: `creating sandbox fixture directory '${input.sandboxFixturePath}'`,
    command: "sh",
    args: [
      "-lc",
      `rm -rf ${shellQuote(input.sandboxFixturePath)} && mkdir -p ${shellQuote(input.sandboxFixturePath)}`,
    ],
  });

  for (const fixtureFile of fixtureFiles) {
    const relativePath = relative(input.sandboxFixturePath, fixtureFile.sandboxPath);
    const delimiter = `MISTLE_FIXTURE_${randomUUID().replaceAll("-", "")}`;
    const script = [
      "set -eu",
      `mkdir -p ${shellQuote(fixtureFile.sandboxPath.slice(0, fixtureFile.sandboxPath.lastIndexOf("/")))}`,
      `cat > ${shellQuote(fixtureFile.sandboxPath)} <<'${delimiter}'`,
      fixtureFile.contents,
      delimiter,
    ].join("\n");

    await expectSuccessfulSandboxCommand({
      fixture: input.fixture,
      authenticatedSession: input.authenticatedSession,
      sandboxInstanceId: input.sandboxInstanceId,
      description: `staging fixture file '${relativePath}'`,
      command: "sh",
      args: ["-lc", script],
    });
  }
}

async function readViteLog(input: {
  fixture: SystemTestFixture;
  authenticatedSession: Awaited<ReturnType<SystemTestFixture["authSession"]>>;
  sandboxInstanceId: string;
}): Promise<string> {
  return await expectSuccessfulSandboxCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    description: "reading Vite dev server log",
    timeoutMs: SandboxProbeTimeoutMs,
    command: "sh",
    args: ["-lc", `tail -n 200 ${shellQuote(ViteLogPath)} || true`],
  }).catch((error: unknown) => {
    return `<failed to read Vite log: ${error instanceof Error ? error.message : String(error)}>`;
  });
}

async function waitForTcpListenerReadyInSandbox(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSystemSession;
  sandboxInstanceId: string;
  port: number;
  description: string;
}): Promise<void> {
  try {
    await waitForCondition({
      description: input.description,
      timeoutMs: ListenerReadyTimeoutMs,
      evaluate: async () => {
        const result = await runSandboxExecCommandInSandbox({
          fixture: input.fixture,
          authenticatedSession: input.authenticatedSession,
          sandboxInstanceId: input.sandboxInstanceId,
          timeoutMs: SandboxProbeTimeoutMs,
          command: "sh",
          args: [
            "-lc",
            [
              "set -eu",
              `${NodeToolCommand} -e ${shellQuote(
                [
                  'const net = require("node:net");',
                  `const socket = net.createConnection({ host: "127.0.0.1", port: ${String(input.port)} });`,
                  "socket.setTimeout(1000);",
                  'socket.once("connect", () => { socket.end(); process.exit(0); });',
                  'socket.once("timeout", () => { socket.destroy(); process.exit(1); });',
                  'socket.once("error", () => { process.exit(1); });',
                ].join(" "),
              )}`,
            ].join("\n"),
          ],
        });

        return result.exitCode === 0 ? true : null;
      },
    });
  } catch (error) {
    throw new Error(
      `${input.description} failed: ${error instanceof Error ? error.message : String(error)}. ViteLog=${await readViteLog(
        {
          fixture: input.fixture,
          authenticatedSession: input.authenticatedSession,
          sandboxInstanceId: input.sandboxInstanceId,
        },
      )}`,
    );
  }
}

async function prepareViteSandboxFixture(input: {
  fixture: SystemTestFixture;
}): Promise<PreparedViteSandbox> {
  const session = await input.fixture.authSession();
  const openAiConnectionId = await createOpenAiConnection({
    fixture: input.fixture,
    session,
    displayName: `Port Access Vite ${randomUUID()}`,
  });
  const sandboxProfileId = await createSandboxProfile({
    fixture: input.fixture,
    session,
    displayName: `Port Access Vite ${randomUUID()}`,
  });
  await updateSandboxBindings({
    fixture: input.fixture,
    session,
    sandboxProvider: input.fixture.sandboxProvider,
    sandboxProfileId,
    bindings: [
      {
        connectionId: openAiConnectionId,
        kind: "agent",
        config: {},
      },
    ],
  });

  const sandboxInstanceId = await startSandboxInstance({
    fixture: input.fixture,
    session,
    sandboxProfileId,
  });
  await waitForSandboxInstanceRunning({
    fixture: input.fixture,
    session,
    sandboxInstanceId,
  });

  await stageFixtureDirectoryInSandbox({
    fixture: input.fixture,
    authenticatedSession: session,
    sandboxInstanceId,
    hostFixturePath: ViteFixtureHostPath,
    sandboxFixturePath: ViteFixtureSandboxPath,
  });

  await expectSuccessfulSandboxCommand({
    fixture: input.fixture,
    authenticatedSession: session,
    sandboxInstanceId,
    description: "installing Vite fixture dependencies in sandbox",
    timeoutMs: ViteInstallTimeoutMs,
    command: "sh",
    args: [
      "-lc",
      wrapShellScriptWithHeartbeat({
        intervalSeconds: 5,
        script: [
          `cd ${shellQuote(ViteFixtureSandboxPath)}`,
          `/usr/local/bin/corepack pnpm@10.30.2 install --frozen-lockfile --ignore-workspace`,
        ].join("\n"),
      }),
    ],
  });

  await expectSuccessfulSandboxCommand({
    fixture: input.fixture,
    authenticatedSession: session,
    sandboxInstanceId,
    description: "starting Vite dev server inside sandbox",
    timeoutMs: 60_000,
    command: "sh",
    args: [
      "-lc",
      [
        "set -eu",
        `mkdir -p ${shellQuote("/tmp/mistle-port-access-vite-fixture")}`,
        `cd ${shellQuote(ViteFixtureSandboxPath)}`,
        `nohup /usr/local/bin/corepack pnpm@10.30.2 run dev > ${shellQuote(ViteLogPath)} 2>&1 &`,
        "printf 'started\\n'",
      ].join("\n"),
    ],
  });

  await waitForTcpListenerReadyInSandbox({
    fixture: input.fixture,
    authenticatedSession: session,
    sandboxInstanceId,
    port: VitePort,
    description: "Vite dev server to become reachable inside sandbox",
  });

  return {
    sandboxInstanceId,
    session,
  };
}

async function openVitePortAccessSession(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSystemSession;
  sandboxInstanceId: string;
}): Promise<OpenVitePortAccessSession> {
  const connectionToken = await mintConnectionToken({
    fixture: input.fixture,
    session: input.session,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const tunnelSocket = new WebSocket(
    resolveGatewayTunnelWebSocketUrl({
      mintedUrl: connectionToken.url,
      gatewayBaseUrl: input.fixture.dataPlaneGatewayBaseUrl,
    }),
  );
  let tunnelCloseDescription = "<open>";

  tunnelSocket.on("close", (code, reason) => {
    const text = reason.length > 0 ? reason.toString("utf8") : "<empty>";
    tunnelCloseDescription = `code=${String(code)} reason=${text}`;
  });

  await waitForWebSocketOpen(tunnelSocket, WebSocketOpenTimeoutMs);

  const bootstrap = await mintPortAccess({
    fixture: input.fixture,
    session: input.session,
    sandboxInstanceId: input.sandboxInstanceId,
    port: VitePort,
  });
  const sessionCookie = await bootstrapPortAccess({
    fixture: input.fixture,
    bootstrap,
  });

  return {
    bootstrap,
    readTunnelCloseDescription: () => tunnelCloseDescription,
    sessionCookie,
    tunnelSocket,
  };
}

async function waitForHmrUpdateMessage(input: {
  messagePump: HmrMessagePump;
  timeoutMs: number;
}): Promise<z.infer<typeof HmrUpdateMessageSchema>> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    const message = await input.messagePump.waitForTextMessage(
      Math.max(1, deadlineEpochMs - Date.now()),
    );
    const parsedMessage: unknown = JSON.parse(message);
    const updateMessage = HmrUpdateMessageSchema.safeParse(parsedMessage);
    if (updateMessage.success) {
      return updateMessage.data;
    }
  }

  throw new Error(
    `Timed out after ${String(input.timeoutMs)}ms waiting for an HMR update message.`,
  );
}

describe("system port access vite dev server", () => {
  it(
    "serves a real Vite dev server including HMR and mixed assets without resetting bootstrap",
    async ({ fixture }) => {
      const { sandboxInstanceId, session } = await prepareViteSandboxFixture({
        fixture,
      });
      const { bootstrap, readTunnelCloseDescription, sessionCookie, tunnelSocket } =
        await openVitePortAccessSession({
          fixture,
          session,
          sandboxInstanceId,
        });

      try {
        for (let round = 0; round < RefreshRounds; round += 1) {
          if (tunnelSocket.readyState !== WebSocket.OPEN) {
            throw new Error(
              `Bootstrap tunnel closed before refresh round ${String(round)}. TunnelClose=${readTunnelCloseDescription()} ViteLog=${await readViteLog(
                {
                  fixture,
                  authenticatedSession: session,
                  sandboxInstanceId,
                },
              )}`,
            );
          }

          const indexResponse = await withTimeout({
            operation: sendGatewayHttpRequest({
              baseUrl: fixture.dataPlaneGatewayBaseUrl,
              path: "/",
              method: "GET",
              headers: {
                cookie: sessionCookie,
                host: bootstrap.host,
              },
            }),
            timeoutMs: ViteRequestTimeoutMs,
            description: "fixture index request",
          });
          expect(indexResponse.status).toBe(200);
          expect(indexResponse.body).toContain("/src/main.ts");
          expect(indexResponse.body).toContain("/favicon.ico");

          const viteClientResponse = await withTimeout({
            operation: sendGatewayHttpRequest({
              baseUrl: fixture.dataPlaneGatewayBaseUrl,
              path: "/@vite/client",
              method: "GET",
              headers: {
                cookie: sessionCookie,
                host: bootstrap.host,
              },
            }),
            timeoutMs: ViteRequestTimeoutMs,
            description: "Vite client request",
          });
          expect(viteClientResponse.status).toBe(200);
          expect(extractHmrPath(viteClientResponse.body)).toContain("?token=");

          const mainModuleResponse = await withTimeout({
            operation: sendGatewayHttpRequest({
              baseUrl: fixture.dataPlaneGatewayBaseUrl,
              path: "/src/main.ts",
              method: "GET",
              headers: {
                cookie: sessionCookie,
                host: bootstrap.host,
              },
            }),
            timeoutMs: ViteRequestTimeoutMs,
            description: "Vite main module request",
          });
          expect(mainModuleResponse.status).toBe(200);
          expect(mainModuleResponse.body).toContain("virtual:mistle-vite-fixture");

          const stylesheetResponse = await withTimeout({
            operation: sendGatewayHttpRequest({
              baseUrl: fixture.dataPlaneGatewayBaseUrl,
              path: "/src/styles.css",
              method: "GET",
              headers: {
                cookie: sessionCookie,
                host: bootstrap.host,
              },
            }),
            timeoutMs: ViteRequestTimeoutMs,
            description: "Vite stylesheet request",
          });
          expect(stylesheetResponse.status).toBe(200);
          expect(stylesheetResponse.body).toContain("background-image");

          const assetResponses = await Promise.all([
            withTimeout({
              operation: sendGatewayHttpRequest({
                baseUrl: fixture.dataPlaneGatewayBaseUrl,
                path: extractLogoImportPath(mainModuleResponse.body),
                method: "GET",
                headers: {
                  cookie: sessionCookie,
                  host: bootstrap.host,
                },
              }),
              timeoutMs: ViteRequestTimeoutMs,
              description: "Vite logo asset request",
            }),
            withTimeout({
              operation: sendGatewayHttpRequest({
                baseUrl: fixture.dataPlaneGatewayBaseUrl,
                path: extractRawTextImportPath(mainModuleResponse.body),
                method: "GET",
                headers: {
                  cookie: sessionCookie,
                  host: bootstrap.host,
                },
              }),
              timeoutMs: ViteRequestTimeoutMs,
              description: "Vite raw text request",
            }),
            withTimeout({
              operation: sendGatewayHttpRequest({
                baseUrl: fixture.dataPlaneGatewayBaseUrl,
                path: "/src/pattern.svg",
                method: "GET",
                headers: {
                  cookie: sessionCookie,
                  host: bootstrap.host,
                },
              }),
              timeoutMs: ViteRequestTimeoutMs,
              description: "Vite stylesheet asset request",
            }),
            withTimeout({
              operation: sendGatewayHttpRequest({
                baseUrl: fixture.dataPlaneGatewayBaseUrl,
                path: "/favicon.ico",
                method: "GET",
                headers: {
                  cookie: sessionCookie,
                  host: bootstrap.host,
                },
              }),
              timeoutMs: ViteRequestTimeoutMs,
              description: "Vite favicon request",
            }),
          ]);

          const [logoResponse, rawTextResponse, patternResponse, faviconResponse] = assetResponses;

          expect(logoResponse.status).toBe(200);
          expect(logoResponse.body).toContain('export default "data:image/svg+xml,');

          expect(rawTextResponse.status).toBe(200);
          expect(rawTextResponse.body).toContain("bootstrap tunnel");

          expect(patternResponse.status).toBe(200);
          expect(patternResponse.body).toContain("<svg");

          expect(faviconResponse.status).toBe(200);
          expect(faviconResponse.body).toBe("mistle-vite-fixture-favicon");
          expect(readHeaderValue(faviconResponse.headers, "content-type") ?? "").toBe("");

          if (tunnelSocket.readyState !== WebSocket.OPEN) {
            throw new Error(
              `Bootstrap tunnel closed after refresh round ${String(round)}. TunnelClose=${readTunnelCloseDescription()} ViteLog=${await readViteLog(
                {
                  fixture,
                  authenticatedSession: session,
                  sandboxInstanceId,
                },
              )}`,
            );
          }
        }
      } finally {
        await closeWebSocketIfOpen(tunnelSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "delivers an HMR update when a sandbox source file changes",
    async ({ fixture }) => {
      const { sandboxInstanceId, session } = await prepareViteSandboxFixture({
        fixture,
      });
      const { bootstrap, readTunnelCloseDescription, sessionCookie, tunnelSocket } =
        await openVitePortAccessSession({
          fixture,
          session,
          sandboxInstanceId,
        });

      try {
        const viteClientResponse = await withTimeout({
          operation: sendGatewayHttpRequest({
            baseUrl: fixture.dataPlaneGatewayBaseUrl,
            path: "/@vite/client",
            method: "GET",
            headers: {
              cookie: sessionCookie,
              host: bootstrap.host,
            },
          }),
          timeoutMs: ViteRequestTimeoutMs,
          description: "Vite client request",
        });
        expect(viteClientResponse.status).toBe(200);

        const mainModuleResponse = await withTimeout({
          operation: sendGatewayHttpRequest({
            baseUrl: fixture.dataPlaneGatewayBaseUrl,
            path: "/src/main.ts",
            method: "GET",
            headers: {
              cookie: sessionCookie,
              host: bootstrap.host,
            },
          }),
          timeoutMs: ViteRequestTimeoutMs,
          description: "Vite main module request before HMR change",
        });
        expect(mainModuleResponse.status).toBe(200);

        const stylesheetResponse = await withTimeout({
          operation: sendGatewayHttpRequest({
            baseUrl: fixture.dataPlaneGatewayBaseUrl,
            path: "/src/styles.css",
            method: "GET",
            headers: {
              cookie: sessionCookie,
              host: bootstrap.host,
            },
          }),
          timeoutMs: ViteRequestTimeoutMs,
          description: "Vite stylesheet request before HMR change",
        });
        expect(stylesheetResponse.status).toBe(200);

        const hmrSocket = new WebSocket(
          resolvePortAccessWebSocketUrl({
            gatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
            path: extractHmrPath(viteClientResponse.body),
          }),
          "vite-hmr",
          {
            headers: {
              cookie: sessionCookie,
              host: bootstrap.host,
            },
          },
        );

        try {
          const hmrMessagePump = createHmrMessagePump(hmrSocket);
          await waitForWebSocketOpen(hmrSocket, WebSocketOpenTimeoutMs).catch(
            async (error: unknown) => {
              throw new Error(
                `Timed out opening Vite HMR websocket. TunnelClose=${readTunnelCloseDescription()} ViteLog=${await readViteLog(
                  {
                    fixture,
                    authenticatedSession: session,
                    sandboxInstanceId,
                  },
                )}`,
                { cause: error },
              );
            },
          );
          const connectedMessage = await hmrMessagePump
            .waitForTextMessage(WebSocketMessageTimeoutMs)
            .catch(async (error: unknown) => {
              throw new Error(
                `Timed out waiting for Vite HMR connected message. HmrSocketState=${String(
                  hmrSocket.readyState,
                )} TunnelClose=${readTunnelCloseDescription()} ViteLog=${await readViteLog({
                  fixture,
                  authenticatedSession: session,
                  sandboxInstanceId,
                })}`,
                { cause: error },
              );
            });
          const connectedPayload = HmrConnectedMessageSchema.parse(JSON.parse(connectedMessage));
          expect(connectedPayload.type).toBe("connected");

          const hmrMarker = `hmr-${randomUUID()}`;
          const updateMessagePromise = waitForHmrUpdateMessage({
            messagePump: hmrMessagePump,
            timeoutMs: WebSocketMessageTimeoutMs,
          });
          await expectSuccessfulSandboxCommand({
            fixture,
            authenticatedSession: session,
            sandboxInstanceId,
            description: "updating Vite stylesheet in sandbox",
            timeoutMs: SandboxProbeTimeoutMs,
            command: "sh",
            args: [
              "-lc",
              [
                "set -eu",
                `cat <<'__MISTLE_HMR_APPEND__' >> ${shellQuote(`${ViteFixtureSandboxPath}/src/styles.css`)}`,
                "",
                `:root { --hmr-marker-${hmrMarker}: 1; }`,
                "__MISTLE_HMR_APPEND__",
              ].join("\n"),
            ],
          });

          const updateMessage = await updateMessagePromise.catch(async (error: unknown) => {
            const updatedStylesheetResponse = await withTimeout({
              operation: sendGatewayHttpRequest({
                baseUrl: fixture.dataPlaneGatewayBaseUrl,
                path: "/src/styles.css",
                method: "GET",
                headers: {
                  cookie: sessionCookie,
                  host: bootstrap.host,
                },
              }),
              timeoutMs: ViteRequestTimeoutMs,
              description: "Vite stylesheet request after HMR timeout",
            });
            throw new Error(
              `Timed out waiting for Vite HMR update. UpdatedStylesheetStatus=${String(
                updatedStylesheetResponse.status,
              )} UpdatedStylesheetContainsMarker=${String(
                updatedStylesheetResponse.body.includes(`--hmr-marker-${hmrMarker}`),
              )} ViteLog=${await readViteLog({
                fixture,
                authenticatedSession: session,
                sandboxInstanceId,
              })}`,
              { cause: error },
            );
          });
          expect(
            updateMessage.updates.some((update) => update.path.includes("/src/styles.css")),
          ).toBe(true);
          expect(
            updateMessage.updates.some(
              (update) =>
                (update.acceptedPath?.includes("/src/styles.css") ?? false) ||
                update.path.includes("/src/styles.css"),
            ),
          ).toBe(true);

          const updatedStylesheetResponse = await withTimeout({
            operation: sendGatewayHttpRequest({
              baseUrl: fixture.dataPlaneGatewayBaseUrl,
              path: "/src/styles.css",
              method: "GET",
              headers: {
                cookie: sessionCookie,
                host: bootstrap.host,
              },
            }),
            timeoutMs: ViteRequestTimeoutMs,
            description: "Vite stylesheet request after HMR change",
          });
          expect(updatedStylesheetResponse.status).toBe(200);
          expect(updatedStylesheetResponse.body).toContain(`--hmr-marker-${hmrMarker}`);
          hmrMessagePump.close();
        } finally {
          await closeWebSocketIfOpen(hmrSocket);
        }

        if (tunnelSocket.readyState !== WebSocket.OPEN) {
          throw new Error(
            `Bootstrap tunnel closed during HMR update validation. TunnelClose=${readTunnelCloseDescription()} ViteLog=${await readViteLog(
              {
                fixture,
                authenticatedSession: session,
                sandboxInstanceId,
              },
            )}`,
          );
        }
      } finally {
        await closeWebSocketIfOpen(tunnelSocket);
      }
    },
    TestTimeoutMs,
  );
});
