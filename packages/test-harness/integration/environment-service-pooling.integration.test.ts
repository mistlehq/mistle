import { once } from "node:events";
import { createServer, type Server } from "node:http";

import {
  createServiceRegistry,
  ensureRunnerPoolSession,
  startTestEnvironment,
  stopRunnerServicePools,
  type TestService,
  type TestHttpClient,
  type TestServiceDefinition,
  type TestServiceHandle,
  type TestServiceRuntime,
  type TestServiceStartInput,
} from "@mistle/test-harness";
import { afterEach, describe, expect, it } from "vitest";

const EnvironmentCount = 12;
const ExpectedMaxHttpConnectionsPerOrigin = 4;
const PooledServiceId = "pooled-http-service";

const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];

function createPooledHttpServiceLauncher(input: {
  lifecycleEvents: string[];
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    const service = await startSharedHttpServer(input.lifecycleEvents);
    let stopped = false;

    return {
      id: PooledServiceId,
      mode: startInput.mode,
      endpoints: {
        http: {
          hostBaseUrl: service.hostBaseUrl,
        },
      },
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await closeServer(service.server);
        input.lifecycleEvents.push("stopped");
      },
    };
  };
}

async function startSharedHttpServer(lifecycleEvents: string[]): Promise<{
  hostBaseUrl: string;
  server: Server;
}> {
  let requestCount = 0;

  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        remotePort: _request.socket.remotePort,
        requestCount,
        service: PooledServiceId,
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected pooled HTTP service to listen on a TCP port.");
  }

  lifecycleEvents.push("started");

  return {
    hostBaseUrl: `http://127.0.0.1:${String(address.port)}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function fetchJson(http: TestHttpClient): Promise<unknown> {
  const response = await http.fetch("/");
  if (!response.ok) {
    throw new Error(`Expected pooled service to return OK, received ${String(response.status)}.`);
  }

  return response.json();
}

function readHostBaseUrl(service: TestServiceRuntime): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected pooled HTTP service to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

function readHttpClient(service: TestServiceHandle): TestHttpClient {
  if (service.http === undefined) {
    throw new Error("Expected pooled HTTP service to expose an HTTP client.");
  }

  return service.http;
}

async function checkHttpHealth(service: TestServiceRuntime): Promise<void> {
  const response = await fetch(readHostBaseUrl(service));
  if (!response.ok) {
    throw new Error(`Expected pooled HTTP service health check to return OK.`);
  }
}

function assertPooledServicePayload(value: unknown): asserts value is {
  remotePort: number;
  requestCount: number;
  service: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected pooled service payload to be an object.");
  }

  const remotePort = Reflect.get(value, "remotePort");
  const requestCount = Reflect.get(value, "requestCount");
  const service = Reflect.get(value, "service");
  if (
    typeof remotePort !== "number" ||
    typeof requestCount !== "number" ||
    typeof service !== "string"
  ) {
    throw new Error(
      "Expected pooled service payload to contain remotePort, requestCount, and service.",
    );
  }
}

describe("pooled test services", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
    const session = ensureRunnerPoolSession(process.env);
    await stopRunnerServicePools({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
    });
  });

  it("leases one shared service instance across concurrent environments", async () => {
    const lifecycleEvents: string[] = [];
    const registry = createServiceRegistry({
      services: {
        [PooledServiceId]: {
          id: PooledServiceId,
          infra: [],
          serviceReferences: [],
          supportedModes: ["runtime"],
          healthCheck: checkHttpHealth,
          start: createPooledHttpServiceLauncher({
            lifecycleEvents,
          }),
        } satisfies TestServiceDefinition,
      },
    });

    const environments = await Promise.all(
      Array.from({ length: EnvironmentCount }, async () =>
        startTestEnvironment({
          registry,
          services: [{ service: PooledServiceId, mode: "runtime" }],
        }),
      ),
    );
    startedEnvironments.push(...environments);

    const hostBaseUrls = new Set(
      environments.map((environment) => readHostBaseUrl(environment.services.get(PooledServiceId))),
    );
    expect(hostBaseUrls.size).toBe(1);
    expect(lifecycleEvents).toEqual(["started"]);

    const firstEnvironment = environments[0];
    const secondEnvironment = environments[1];
    if (firstEnvironment === undefined || secondEnvironment === undefined) {
      throw new Error("Expected at least two test environments.");
    }

    const payloads = await Promise.all(
      environments.map(async (environment) => {
        const service = environment.services.get(PooledServiceId);
        const payload = await fetchJson(readHttpClient(service));
        assertPooledServicePayload(payload);
        expect(payload.service).toBe(PooledServiceId);
        return payload;
      }),
    );
    const remotePorts = new Set(payloads.map((payload) => payload.remotePort));
    expect(remotePorts.size).toBeLessThanOrEqual(ExpectedMaxHttpConnectionsPerOrigin);

    await firstEnvironment.stop();

    const payloadAfterOneRelease = await fetchJson(
      readHttpClient(secondEnvironment.services.get(PooledServiceId)),
    );
    assertPooledServicePayload(payloadAfterOneRelease);
    expect(payloadAfterOneRelease.service).toBe(PooledServiceId);
    expect(lifecycleEvents).toEqual(["started"]);

    await Promise.all(environments.map(async (environment) => environment.stop()));

    expect(lifecycleEvents).toEqual(["started"]);

    const session = ensureRunnerPoolSession(process.env);
    await stopRunnerServicePools({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
    });

    expect(lifecycleEvents).toEqual(["started", "stopped"]);
  });
});
