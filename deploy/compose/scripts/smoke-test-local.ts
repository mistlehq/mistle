import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import {
  PtyStreamClient,
  SandboxSessionTransport,
} from "../../../packages/sandbox-session-client/src/index.ts";
import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.ts";
import { createMailpitInbox } from "../../../packages/test-harness/src/index.ts";
import { systemClock, systemSleeper } from "../../../packages/time/src/index.ts";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../../..");
const DefaultEnvFilePath = resolve(ScriptDirectoryPath, "../local/.env");
const DashboardBaseUrl = "http://localhost:3000";
const ControlPlaneApiBaseUrl = "http://localhost:8080";
const DataPlaneGatewayBaseUrl = "http://localhost:8084";
const MailpitBaseUrl = "http://localhost:8025";
const AuthOrigin = DashboardBaseUrl;
const WaitTimeoutMs = 3 * 60_000;
const PollIntervalMs = 1_000;
const OpenAiTargetKey = "openai-default";
const OpenAiConnectionMethodId = "api-key";
const OpenAiApiKey = "sk-local-compose-smoke-test";

type SmokeTestOptions = {
  envFilePath: string;
  restartCheck: boolean;
};

type SmokeTestConfig = {
  envFilePath: string;
};

type AuthSession = {
  cookie: string;
  organizationId: string;
};

type IntegrationConnectionResponse = {
  id: string;
};

type IntegrationTargetDirectoryItem = {
  targetKey: string;
  enabled: boolean;
  connectionMethods:
    | Array<{
        id: string;
        kind: string;
      }>
    | undefined;
};

type SandboxProfileResponse = {
  id: string;
};

type StartSandboxInstanceResponse = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

type SandboxInstanceStatus = {
  id: string;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  connectable: boolean;
  failureCode: string | null;
  failureMessage: string | null;
};

type SandboxInstanceConnectionTokenResponse = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

type ComposePsService = {
  Service: string;
  State: string;
  Health?: string;
};

function parseArgs(argv: string[]): SmokeTestOptions {
  let envFilePath = DefaultEnvFilePath;
  let restartCheck = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--restart-check") {
      restartCheck = true;
      continue;
    }

    if (argument === "--env-file") {
      const nextArgument = argv[index + 1];
      if (nextArgument === undefined) {
        throw new Error("--env-file requires a path.");
      }
      envFilePath = resolve(process.cwd(), nextArgument);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument '${argument}'.`);
  }

  return {
    envFilePath,
    restartCheck,
  };
}

async function loadSmokeTestConfig(envFilePath: string): Promise<SmokeTestConfig> {
  const envFileContent = await readFile(envFilePath, "utf8");
  parseEnv(envFileContent);

  return {
    envFilePath,
  };
}

function expectRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${description} to be an object.`);
  }

  return value;
}

function expectStringField(
  record: Record<string, unknown>,
  key: string,
  description: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${description}.${key} to be a non-empty string.`);
  }

  return value;
}

function expectBooleanField(
  record: Record<string, unknown>,
  key: string,
  description: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${description}.${key} to be a boolean.`);
  }

  return value;
}

async function assertHttpOk(url: string, description: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `${description} check failed with status ${String(response.status)}. Response body: ${bodyText}`,
    );
  }
}

async function runDockerComposeCommand(args: string[], envFilePath: string): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(
      "docker",
      ["compose", "-f", "deploy/compose/local/compose.yaml", "--env-file", envFilePath, ...args],
      {
        cwd: RepositoryRootPath,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectPromise(
            new Error(
              `docker compose ${args.join(" ")} failed: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

function parseComposePsOutput(stdout: string): ComposePsService[] {
  const trimmedOutput = stdout.trim();
  if (trimmedOutput.length === 0) {
    return [];
  }

  if (trimmedOutput.startsWith("[")) {
    const parsed = JSON.parse(trimmedOutput);
    if (!Array.isArray(parsed)) {
      throw new Error("Expected docker compose ps JSON output to be an array.");
    }
    return parsed.map((entry) => expectComposePsService(entry));
  }

  return trimmedOutput
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => expectComposePsService(JSON.parse(line)));
}

function expectComposePsService(value: unknown): ComposePsService {
  const record = expectRecord(value, "docker compose ps service");
  const health = record.Health;
  if (health !== undefined && typeof health !== "string") {
    throw new Error("Expected docker compose ps service.Health to be a string.");
  }

  return {
    Service: expectStringField(record, "Service", "docker compose ps service"),
    State: expectStringField(record, "State", "docker compose ps service"),
    Health: health === "" ? undefined : health,
  };
}

async function waitForComposeServices(input: {
  envFilePath: string;
  services: string[];
  description: string;
}): Promise<void> {
  const deadlineMs = systemClock.nowMs() + WaitTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const stdout = await runDockerComposeCommand(["ps", "--format", "json"], input.envFilePath);
    const services = parseComposePsOutput(stdout);
    const servicesByName = new Map(services.map((service) => [service.Service, service]));

    const allReady = input.services.every((serviceName) => {
      const service = servicesByName.get(serviceName);
      if (service === undefined) {
        return false;
      }

      if (service.State !== "running") {
        return false;
      }

      if (service.Health !== undefined && service.Health !== "healthy") {
        return false;
      }

      return true;
    });

    if (allReady) {
      return;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description}.`);
}

async function requestApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, ControlPlaneApiBaseUrl), init);
}

async function requestJsonOrThrow<T>(input: {
  path: string;
  init?: RequestInit;
  expectedStatus: number;
  description: string;
  parse: (value: unknown) => T;
}): Promise<T> {
  const response = await requestApi(input.path, input.init);
  const bodyText = await response.text().catch(() => "");

  if (response.status !== input.expectedStatus) {
    throw new Error(
      `${input.description} returned status ${String(response.status)} instead of ${String(input.expectedStatus)}. Response body: ${bodyText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = bodyText.length === 0 ? null : JSON.parse(bodyText);
  } catch (error) {
    throw new Error(
      `${input.description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return input.parse(parsed);
}

function parseIntegrationConnectionResponse(value: unknown): IntegrationConnectionResponse {
  const record = expectRecord(value, "integration connection response");
  return {
    id: expectStringField(record, "id", "integration connection response"),
  };
}

function parseIntegrationTargetsResponse(value: unknown): IntegrationTargetDirectoryItem[] {
  const record = expectRecord(value, "integration targets response");
  if (!Array.isArray(record.items)) {
    throw new Error("Expected integration targets response.items to be an array.");
  }

  return record.items.map((item, index) => {
    const itemRecord = expectRecord(item, `integration targets response.items[${String(index)}]`);
    const connectionMethodsValue = itemRecord.connectionMethods;

    return {
      targetKey: expectStringField(
        itemRecord,
        "targetKey",
        `integration targets response.items[${String(index)}]`,
      ),
      enabled: expectBooleanField(
        itemRecord,
        "enabled",
        `integration targets response.items[${String(index)}]`,
      ),
      connectionMethods:
        connectionMethodsValue === undefined
          ? undefined
          : Array.isArray(connectionMethodsValue)
            ? connectionMethodsValue.map((method, methodIndex) => {
                const methodRecord = expectRecord(
                  method,
                  `integration targets response.items[${String(index)}].connectionMethods[${String(methodIndex)}]`,
                );

                return {
                  id: expectStringField(
                    methodRecord,
                    "id",
                    `integration targets response.items[${String(index)}].connectionMethods[${String(methodIndex)}]`,
                  ),
                  kind: expectStringField(
                    methodRecord,
                    "kind",
                    `integration targets response.items[${String(index)}].connectionMethods[${String(methodIndex)}]`,
                  ),
                };
              })
            : (() => {
                throw new Error(
                  `Expected integration targets response.items[${String(index)}].connectionMethods to be an array when present.`,
                );
              })(),
    };
  });
}

function parseSandboxProfileResponse(value: unknown): SandboxProfileResponse {
  const record = expectRecord(value, "sandbox profile response");
  return {
    id: expectStringField(record, "id", "sandbox profile response"),
  };
}

function parseBindingsResponse(value: unknown): null {
  const record = expectRecord(value, "sandbox bindings response");
  if (!Array.isArray(record.bindings)) {
    throw new Error("Expected sandbox bindings response.bindings to be an array.");
  }

  return null;
}

function parseStartSandboxInstanceResponse(value: unknown): StartSandboxInstanceResponse {
  const record = expectRecord(value, "start sandbox instance response");
  const status = expectStringField(record, "status", "start sandbox instance response");
  if (status !== "accepted") {
    throw new Error(`Expected start sandbox instance response.status to be 'accepted'.`);
  }

  return {
    status,
    workflowRunId: expectStringField(record, "workflowRunId", "start sandbox instance response"),
    sandboxInstanceId: expectStringField(
      record,
      "sandboxInstanceId",
      "start sandbox instance response",
    ),
  };
}

function parseSandboxInstanceStatus(value: unknown): SandboxInstanceStatus {
  const record = expectRecord(value, "sandbox instance status response");
  const status = expectStringField(record, "status", "sandbox instance status response");
  if (
    status !== "pending" &&
    status !== "starting" &&
    status !== "running" &&
    status !== "stopped" &&
    status !== "failed"
  ) {
    throw new Error(`Unexpected sandbox status '${status}'.`);
  }

  const failureCode = record.failureCode;
  const failureMessage = record.failureMessage;
  if (failureCode !== null && typeof failureCode !== "string") {
    throw new Error("Expected sandbox instance status failureCode to be a string or null.");
  }
  if (failureMessage !== null && typeof failureMessage !== "string") {
    throw new Error("Expected sandbox instance status failureMessage to be a string or null.");
  }

  return {
    id: expectStringField(record, "id", "sandbox instance status response"),
    status,
    connectable: expectBooleanField(record, "connectable", "sandbox instance status response"),
    failureCode,
    failureMessage,
  };
}

function parseSandboxInstanceConnectionTokenResponse(
  value: unknown,
): SandboxInstanceConnectionTokenResponse {
  const record = expectRecord(value, "sandbox connection token response");
  return {
    instanceId: expectStringField(record, "instanceId", "sandbox connection token response"),
    url: expectStringField(record, "url", "sandbox connection token response"),
    token: expectStringField(record, "token", "sandbox connection token response"),
    expiresAt: expectStringField(record, "expiresAt", "sandbox connection token response"),
  };
}

function extractRequestCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const cookiePair = setCookie.split(";")[0];
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function extractOtpCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/u);
  const otp = match?.[1];
  if (otp === undefined) {
    throw new Error("OTP was not found in the Mailpit message text.");
  }

  return otp;
}

async function createOrganization(cookie: string): Promise<string> {
  const response = await requestApi("/v1/auth/organization/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: AuthOrigin,
    },
    body: JSON.stringify({
      name: "Local Compose Smoke Test Organization",
      slug: `local-compose-${randomUUID()}`,
    }),
  });

  const bodyText = await response.text().catch(() => "");
  if (response.status !== 200) {
    throw new Error(
      `Expected organization create response status 200, got ${String(response.status)}. Response body: ${bodyText}`,
    );
  }

  const record = expectRecord(JSON.parse(bodyText), "organization create response");
  return expectStringField(record, "id", "organization create response");
}

async function authenticateThroughMailpit(): Promise<AuthSession> {
  const email = `local-compose-smoke-${randomUUID()}@example.com`;
  const sendOtpResponse = await requestApi("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: AuthOrigin,
    },
    body: JSON.stringify({
      email,
      type: "sign-in",
    }),
  });

  if (sendOtpResponse.status !== 200) {
    throw new Error(
      `Expected OTP send response status 200, got ${String(sendOtpResponse.status)}.`,
    );
  }

  const mailpitInbox = createMailpitInbox({
    httpBaseUrl: MailpitBaseUrl,
  });
  const message = await mailpitInbox.waitForMessage({
    timeoutMs: 15_000,
    description: `OTP email for ${email}`,
    matcher: ({ message: candidate }) =>
      candidate.Subject === "Your sign-in code" &&
      candidate.To.some((address) => address.Address === email),
  });
  const messageSummary = await mailpitInbox.getMessageSummary(message.ID);
  const otp = extractOtpCode(messageSummary.Text);

  const signInResponse = await requestApi("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: AuthOrigin,
    },
    body: JSON.stringify({
      email,
      otp,
    }),
  });

  if (signInResponse.status !== 200) {
    const responseBody = await signInResponse.text().catch(() => "");
    throw new Error(
      `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}. Response body: ${responseBody}`,
    );
  }

  const cookie = extractRequestCookie(signInResponse);
  const organizationId = await createOrganization(cookie);

  return {
    cookie,
    organizationId,
  };
}

async function assertAuthenticatedHome(cookie: string): Promise<void> {
  const response = await requestApi("/v1/home", {
    headers: {
      cookie,
    },
  });
  if (response.status !== 200) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Expected authenticated /v1/home status 200, got ${String(response.status)}. Response body: ${bodyText}`,
    );
  }
}

async function assertSmokeTestIntegrationTargetAvailable(cookie: string): Promise<void> {
  const targets = await requestJsonOrThrow({
    path: "/v1/integration/targets?limit=100",
    expectedStatus: 200,
    description: "integration target listing",
    parse: parseIntegrationTargetsResponse,
    init: {
      headers: {
        cookie,
      },
    },
  });

  const openAiTarget = targets.find((target) => target.targetKey === OpenAiTargetKey);
  if (openAiTarget === undefined) {
    throw new Error(
      `Local compose smoke test requires integration target '${OpenAiTargetKey}' to be provisioned. Update integration-targets.provision.example.json or adjust the smoke test prerequisites.`,
    );
  }

  if (!openAiTarget.enabled) {
    throw new Error(
      `Local compose smoke test requires integration target '${OpenAiTargetKey}' to be enabled.`,
    );
  }

  const supportsExpectedMethod = openAiTarget.connectionMethods?.some(
    (method) => method.id === OpenAiConnectionMethodId && method.kind === "form",
  );
  if (!supportsExpectedMethod) {
    throw new Error(
      `Local compose smoke test requires '${OpenAiTargetKey}' to expose form connection method '${OpenAiConnectionMethodId}'.`,
    );
  }
}

async function configureBaselineIntegrationAndProfile(cookie: string): Promise<string> {
  await assertSmokeTestIntegrationTargetAvailable(cookie);

  const connection = await requestJsonOrThrow({
    path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/form`,
    expectedStatus: 201,
    description: "OpenAI form connection creation",
    parse: parseIntegrationConnectionResponse,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        displayName: `Local Compose Smoke OpenAI ${randomUUID()}`,
        methodId: OpenAiConnectionMethodId,
        config: {
          connection_method: OpenAiConnectionMethodId,
        },
        secrets: {
          apiKey: OpenAiApiKey,
        },
      }),
    },
  });

  const sandboxProfile = await requestJsonOrThrow({
    path: "/v1/sandbox/profiles",
    expectedStatus: 201,
    description: "sandbox profile creation",
    parse: parseSandboxProfileResponse,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        displayName: `Local Compose Smoke Sandbox ${randomUUID()}`,
      }),
    },
  });

  await requestJsonOrThrow({
    path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/integration-bindings`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    parse: parseBindingsResponse,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        bindings: [
          {
            connectionId: connection.id,
            kind: "agent",
            config: {
              runtime: {
                runtimeId: "codex",
                config: {},
              },
              model: {
                defaultModel: "gpt-5.3-codex",
                options: {
                  reasoningEffort: "medium",
                },
              },
            },
          },
        ],
      }),
    },
  });

  return sandboxProfile.id;
}

async function startSandboxInstance(cookie: string, sandboxProfileId: string): Promise<string> {
  const accepted = await requestJsonOrThrow({
    path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfileId)}/versions/1/instances`,
    expectedStatus: 201,
    description: "sandbox instance start",
    parse: parseStartSandboxInstanceResponse,
    init: {
      method: "POST",
      headers: {
        cookie,
      },
    },
  });

  return accepted.sandboxInstanceId;
}

async function waitForSandboxRunningAndConnectable(
  cookie: string,
  sandboxInstanceId: string,
): Promise<void> {
  const deadlineMs = systemClock.nowMs() + WaitTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const response = await requestApi(
      `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}`,
      {
        headers: {
          cookie,
        },
      },
    );
    const bodyText = await response.text().catch(() => "");

    if (response.status === 200) {
      const sandboxStatus = parseSandboxInstanceStatus(JSON.parse(bodyText));
      if (sandboxStatus.status === "failed") {
        throw new Error(
          `Sandbox '${sandboxStatus.id}' entered terminal status 'failed': ${sandboxStatus.failureMessage ?? "no failure message"}`,
        );
      }

      if (sandboxStatus.status === "running" && sandboxStatus.connectable) {
        return;
      }
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${sandboxInstanceId}' to become running and connectable.`,
  );
}

function resolveGatewayTunnelWebSocketUrl(mintedUrl: string): string {
  const mintUrl = new URL(mintedUrl);
  const gatewayBaseUrl = new URL(DataPlaneGatewayBaseUrl);

  mintUrl.protocol = gatewayBaseUrl.protocol === "https:" ? "wss:" : "ws:";
  mintUrl.hostname = gatewayBaseUrl.hostname;
  mintUrl.port = gatewayBaseUrl.port;

  return mintUrl.toString();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function assertPtyRoundTrip(cookie: string, sandboxInstanceId: string): Promise<void> {
  const connectionToken = await requestJsonOrThrow({
    path: `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/connection-tokens`,
    expectedStatus: 201,
    description: "sandbox connection token minting",
    parse: parseSandboxInstanceConnectionTokenResponse,
    init: {
      method: "POST",
      headers: {
        cookie,
      },
    },
  });
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });

  await transport.connect({
    connectionUrl: resolveGatewayTunnelWebSocketUrl(connectionToken.url),
  });

  try {
    const ptyClient = new PtyStreamClient({
      transport,
    });
    let output = "";

    ptyClient.onData((chunk) => {
      output += Buffer.from(chunk).toString("utf8");
    });

    await ptyClient.connect();

    const marker = `mistle-local-compose-${randomUUID()}`;
    let cleanupPtyListeners = (): void => {};
    const waitForPtyExit = new Promise<void>((resolvePromise, rejectPromise) => {
      const timeoutSignal = AbortSignal.timeout(30_000);
      const removeExitListener = ptyClient.onExit((exitInfo) => {
        cleanup();
        if (exitInfo.exitCode !== 0) {
          rejectPromise(
            new Error(
              `PTY round-trip command exited with ${String(exitInfo.exitCode)}. Output: ${output}`,
            ),
          );
          return;
        }
        if (!output.includes(marker)) {
          rejectPromise(
            new Error(
              `PTY round-trip output did not include marker '${marker}'. Output: ${output}`,
            ),
          );
          return;
        }
        resolvePromise();
      });
      const removeErrorListener = ptyClient.onError((error) => {
        cleanup();
        rejectPromise(error);
      });
      const removeResetListener = ptyClient.onReset((resetInfo) => {
        cleanup();
        rejectPromise(new Error(`Sandbox PTY reset (${resetInfo.code}): ${resetInfo.message}`));
      });

      const onTimeout = (): void => {
        cleanup();
        rejectPromise(new Error("Timed out waiting for PTY round-trip command exit."));
      };

      const cleanup = (): void => {
        removeExitListener();
        removeErrorListener();
        removeResetListener();
        timeoutSignal.removeEventListener("abort", onTimeout);
      };
      cleanupPtyListeners = cleanup;

      timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    });

    try {
      await ptyClient.open({
        ptySessionId: "terminal",
        cols: 120,
        rows: 40,
        cwd: "/root",
        command: "sh",
        args: ["-lc", `printf '%s\\n' ${shellQuote(marker)}`],
      });

      await waitForPtyExit;
    } catch (error) {
      cleanupPtyListeners();
      throw error;
    }
  } finally {
    transport.disconnect(1000, "local compose smoke test cleanup");
  }
}

async function restartLocalComposeStack(envFilePath: string): Promise<void> {
  await runDockerComposeCommand(["restart"], envFilePath);
}

async function waitForCoreServicesAfterRestart(envFilePath: string): Promise<void> {
  const deadlineMs = systemClock.nowMs() + WaitTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    try {
      await assertHttpOk(DashboardBaseUrl, "dashboard");
      await assertHttpOk(
        new URL("/__healthz", ControlPlaneApiBaseUrl).toString(),
        "control-plane API",
      );
      await assertHttpOk(
        new URL("/__healthz", DataPlaneGatewayBaseUrl).toString(),
        "data-plane gateway",
      );
      await assertHttpOk(MailpitBaseUrl, "Mailpit");
      await waitForComposeServices({
        envFilePath,
        services: ["control-plane-worker", "data-plane-worker", "mailpit"],
        description: "local worker and Mailpit services after docker compose restart",
      });
      return;
    } catch {}

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error("Timed out waiting for core services after docker compose restart.");
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadSmokeTestConfig(options.envFilePath);

  console.log("Checking public local endpoints...");
  await assertHttpOk(DashboardBaseUrl, "dashboard");
  await assertHttpOk(new URL("/__healthz", ControlPlaneApiBaseUrl).toString(), "control-plane API");
  await assertHttpOk(
    new URL("/__healthz", DataPlaneGatewayBaseUrl).toString(),
    "data-plane gateway",
  );
  await assertHttpOk(MailpitBaseUrl, "Mailpit");
  await waitForComposeServices({
    envFilePath: config.envFilePath,
    services: ["control-plane-worker", "data-plane-worker", "mailpit"],
    description: "local worker and Mailpit services",
  });

  console.log("Authenticating through Mailpit-backed OTP...");
  const session = await authenticateThroughMailpit();
  await assertAuthenticatedHome(session.cookie);

  console.log("Configuring baseline integration and sandbox profile...");
  const sandboxProfileId = await configureBaselineIntegrationAndProfile(session.cookie);

  console.log("Starting sandbox instance and waiting for it to become usable...");
  const sandboxInstanceId = await startSandboxInstance(session.cookie, sandboxProfileId);
  await waitForSandboxRunningAndConnectable(session.cookie, sandboxInstanceId);

  console.log("Verifying PTY round-trip...");
  await assertPtyRoundTrip(session.cookie, sandboxInstanceId);

  if (options.restartCheck) {
    console.log("Restarting local compose stack to verify persisted state...");
    await restartLocalComposeStack(config.envFilePath);
    await waitForCoreServicesAfterRestart(config.envFilePath);
    await assertAuthenticatedHome(session.cookie);

    console.log("Starting a second sandbox instance after restart...");
    const restartedSandboxInstanceId = await startSandboxInstance(session.cookie, sandboxProfileId);
    await waitForSandboxRunningAndConnectable(session.cookie, restartedSandboxInstanceId);
  }

  console.log("Local compose smoke test passed.");
}

await run();
