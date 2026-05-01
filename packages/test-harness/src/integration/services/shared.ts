import { spawn } from "node:child_process";

import { systemSleeper } from "@mistle/time";

import type {
  ResolvedTestInfra,
  TestHttpClient,
  TestInfraRequirement,
  TestService,
  TestServiceHandle,
  TestServiceLaunchMode,
  TestServiceRuntime,
  TestServiceStartInput,
} from "../../environment/index.js";

export type IntegrationHttpService = TestServiceHandle & {
  http: TestHttpClient;
  hostBaseUrl: string;
};

export function httpService(service: TestServiceHandle): IntegrationHttpService {
  const http = service.http;
  const httpEndpoint = service.endpoints.http;
  if (http === undefined || httpEndpoint === undefined) {
    throw new Error(`Expected test service '${service.id}' to expose an HTTP endpoint and client.`);
  }

  return {
    ...service,
    http,
    hostBaseUrl: httpEndpoint.hostBaseUrl,
  };
}

export function httpEndpoint(
  startInput: TestServiceStartInput,
  serviceId: string,
): { hostBaseUrl: string; port: number } {
  const endpoint = startInput.plannedEndpoints.get(serviceId)?.http;
  if (endpoint === undefined) {
    throw new Error(`Expected test service '${serviceId}' to have a planned HTTP endpoint.`);
  }

  const url = new URL(endpoint.hostBaseUrl);
  const port = Number(url.port);
  if (!Number.isInteger(port)) {
    throw new Error(`Planned HTTP endpoint for '${serviceId}' does not include a port.`);
  }

  return {
    hostBaseUrl: endpoint.hostBaseUrl,
    port,
  };
}

export function singleInfra(
  infra: readonly TestInfraRequirement[],
  serviceId: string,
): TestInfraRequirement {
  const requirement = infra[0];
  if (requirement === undefined || infra.length !== 1) {
    throw new Error(`Expected '${serviceId}' to declare exactly one infra requirement.`);
  }

  return requirement;
}

export function resolvedInfra(
  infra: ReadonlyMap<string, ResolvedTestInfra>,
  infraId: string,
): ResolvedTestInfra {
  const resolvedInfra = infra.get(infraId);
  if (resolvedInfra === undefined) {
    throw new Error(`Expected test infra '${infraId}' to be resolved.`);
  }

  return resolvedInfra;
}

export function infraValue(infra: ResolvedTestInfra, key: string): string {
  const value = infra.values.get(key);
  if (value === undefined) {
    throw new Error(`Expected test infra '${infra.id}' to expose value '${key}'.`);
  }

  return value;
}

export async function httpHealth(service: TestServiceRuntime, serviceId: string): Promise<void> {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error(`Expected test service '${serviceId}' to expose an HTTP endpoint.`);
  }

  const response = await fetch(new URL("/__healthz", httpEndpoint.hostBaseUrl));
  if (!response.ok) {
    throw new Error(
      `Test service '${serviceId}' health check returned ${String(response.status)}.`,
    );
  }
}

export async function processHealth(service: TestServiceRuntime, serviceId: string): Promise<void> {
  const pid = service.pid;
  if (pid === undefined) {
    throw new Error(`Expected test service '${serviceId}' to expose a process id.`);
  }

  if (!isAlive(pid)) {
    throw new Error(`Test service '${serviceId}' process '${String(pid)}' is not running.`);
  }
}

export function infraRequirement(
  requirements: readonly TestInfraRequirement[],
  requirementId: string,
  serviceId: string,
): TestInfraRequirement {
  const requirement = requirements.find((candidate) => candidate.id === requirementId);
  if (requirement === undefined) {
    throw new Error(`Expected '${serviceId}' to declare infra requirement '${requirementId}'.`);
  }

  return requirement;
}

export function assertMode(
  actualMode: TestServiceLaunchMode,
  expectedMode: TestServiceLaunchMode,
  serviceId: string,
): void {
  if (actualMode !== expectedMode) {
    throw new Error(`${serviceId} supports ${expectedMode} mode in integration tests.`);
  }
}

export async function processService(input: {
  id: string;
  mode: TestServiceLaunchMode;
  cwd: string;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}): Promise<TestService> {
  assertMode(input.mode, "process", input.id);

  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    detached: true,
    env: {
      ...process.env,
      ...input.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    console.info(`[${input.id}] ${chunk.toString("utf8").trimEnd()}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    console.error(`[${input.id}] ${chunk.toString("utf8").trimEnd()}`);
  });
  child.unref();

  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });

  await systemSleeper.sleep(2_500);

  const pid = child.pid;
  if (exit !== undefined) {
    throw new Error(
      `Test service '${input.id}' process exited during startup with code ${String(
        exit.code,
      )} and signal ${String(exit.signal)}.`,
    );
  }

  if (!isAlive(pid)) {
    throw new Error(`Test service '${input.id}' process did not stay running after startup.`);
  }

  return {
    id: input.id,
    mode: input.mode,
    endpoints: {},
    pid,
    stop: async () => {
      if (isAlive(pid)) {
        process.kill(pid, "SIGTERM");
      }
    },
  };
}

function isAlive(pid: number | undefined): pid is number {
  if (pid === undefined) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
