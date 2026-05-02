import { fileURLToPath } from "node:url";

import {
  acquireHostedRuntimeService,
  createServiceRegistry,
  ensureRunnerPoolSession,
  startTestEnvironment,
  type TestHttpClient,
  type TestService,
  type TestServiceDefinition,
  type TestServiceHandle,
  type TestServiceRuntime,
  type TestServiceStartInput,
} from "@mistle/test-harness";
import { expect } from "vitest";

const PooledServiceId = "stress-pooled-http-service";
const DefaultEnvironmentsPerFile = 40;
const DefaultRequestsPerEnvironment = 3;
const HostedRuntimeKey = `default/${PooledServiceId}/runtime`;
const HostedRuntimeModulePath = fileURLToPath(
  new URL("./stress-hosted-runtime.ts", import.meta.url),
);

export async function runPooledEnvironmentStressScenario(input: { label: string }): Promise<void> {
  const environmentCount = readPositiveIntegerEnv({
    name: "MISTLE_TEST_HARNESS_STRESS_ENVIRONMENTS_PER_FILE",
    defaultValue: DefaultEnvironmentsPerFile,
  });
  const requestsPerEnvironment = readPositiveIntegerEnv({
    name: "MISTLE_TEST_HARNESS_STRESS_REQUESTS_PER_ENVIRONMENT",
    defaultValue: DefaultRequestsPerEnvironment,
  });
  const registry = createServiceRegistry({
    services: {
      [PooledServiceId]: {
        id: PooledServiceId,
        infra: [],
        serviceReferences: [],
        supportedModes: ["runtime"],
        healthCheck: checkHttpHealth,
        start: createStressServiceLauncher(),
      } satisfies TestServiceDefinition,
    },
  });

  const initialMemory = process.memoryUsage();
  const startTime = process.hrtime.bigint();
  const environments = await Promise.all(
    Array.from({ length: environmentCount }, async () =>
      startTestEnvironment({
        registry,
        services: [{ service: PooledServiceId, mode: "runtime" }],
      }),
    ),
  );
  const environmentStartupMs = elapsedMs(startTime);

  try {
    const hostBaseUrls = new Set(
      environments.map((environment) => readHostBaseUrl(environment.services.get(PooledServiceId))),
    );
    expect(hostBaseUrls.size).toBe(1);

    const requestStartTime = process.hrtime.bigint();
    const requestRemotePorts = new Set<number>();
    const payloads = await Promise.all(
      environments.flatMap((environment) => {
        const http = readHttpClient(environment.services.get(PooledServiceId));
        return Array.from({ length: requestsPerEnvironment }, async () => fetchStressPayload(http));
      }),
    );
    const requestMs = elapsedMs(requestStartTime);

    for (const payload of payloads) {
      assertStressPayload(payload);
      expect(payload.service).toBe(PooledServiceId);
      requestRemotePorts.add(payload.remotePort);
    }

    const finalMemory = process.memoryUsage();
    console.info(
      JSON.stringify({
        label: input.label,
        environmentCount,
        environmentStartupMs: Math.round(environmentStartupMs),
        requestCount: payloads.length,
        requestMs: Math.round(requestMs),
        rssDeltaMb: Math.round((finalMemory.rss - initialMemory.rss) / 1024 / 1024),
        uniqueRemotePorts: requestRemotePorts.size,
      }),
    );
  } finally {
    await Promise.all(environments.map(async (environment) => environment.stop()));
  }
}

function createStressServiceLauncher(): (
  startInput: TestServiceStartInput,
) => Promise<TestService> {
  return async (startInput) => {
    const session = ensureRunnerPoolSession(process.env);
    const lease = await acquireHostedRuntimeService({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
      key: HostedRuntimeKey,
      modulePath: HostedRuntimeModulePath,
      exportName: "startStressRuntime",
      healthCheckPath: "/__healthz",
    });

    return {
      id: PooledServiceId,
      mode: startInput.mode,
      endpoints: lease.endpoints,
      ...(lease.pid === undefined ? {} : { pid: lease.pid }),
      stop: lease.release,
    };
  };
}

function readPositiveIntegerEnv(input: { name: string; defaultValue: number }): number {
  const raw = process.env[input.name];
  if (raw === undefined) {
    return input.defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${input.name} must be a positive integer.`);
  }

  return value;
}

function readHostBaseUrl(service: TestServiceRuntime): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected stress service to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

function readHttpClient(service: TestServiceHandle): TestHttpClient {
  if (service.http === undefined) {
    throw new Error("Expected stress service to expose an HTTP client.");
  }

  return service.http;
}

async function checkHttpHealth(service: TestServiceRuntime): Promise<void> {
  const response = await fetch(new URL("/__healthz", readHostBaseUrl(service)));
  if (!response.ok) {
    throw new Error(`Expected stress service health check to return OK.`);
  }
}

async function fetchStressPayload(http: TestHttpClient): Promise<unknown> {
  const response = await http.fetch("/");
  if (!response.ok) {
    throw new Error(`Expected stress service to return OK, received ${String(response.status)}.`);
  }

  return response.json();
}

function assertStressPayload(value: unknown): asserts value is {
  remotePort: number;
  requestCount: number;
  service: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected stress payload to be an object.");
  }

  const remotePort = Reflect.get(value, "remotePort");
  const requestCount = Reflect.get(value, "requestCount");
  const service = Reflect.get(value, "service");
  if (
    typeof remotePort !== "number" ||
    typeof requestCount !== "number" ||
    typeof service !== "string"
  ) {
    throw new Error("Expected stress payload to contain remotePort, requestCount, and service.");
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
