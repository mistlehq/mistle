import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createServiceRegistry,
  startTestEnvironment,
  type ResolvedTestInfra,
  type TestService,
  type TestInfraProvisioner,
  type TestInfraRequirement,
  type TestServiceDefinition,
  type TestServiceRuntime,
} from "@mistle/test-harness";
import { afterEach, describe, expect, it } from "vitest";

type StartedHttpService = TestService;

const EnvironmentCount = 8;
const TempDirectoryInfraId = "temp-dir.state";

const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];

function createTempDirectoryProvisioner(): TestInfraProvisioner {
  return {
    kind: "temp-directory",
    provision: async (input) => {
      const resolvedInfra: ResolvedTestInfra[] = [];

      for (const requirement of input.requirements) {
        const directoryPath = await mkdtemp(
          join(tmpdir(), `${input.environmentId}-${requirement.id.replaceAll(".", "-")}-`),
        );
        const markerPath = join(directoryPath, "environment-id.txt");
        await writeFile(markerPath, input.environmentId, "utf8");

        resolvedInfra.push({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([
            ["directoryPath", directoryPath],
            ["markerPath", markerPath],
          ]),
          stop: async () => {
            await rm(directoryPath, {
              force: true,
              recursive: true,
            });
          },
        });
      }

      return resolvedInfra;
    },
  };
}

function createTempDirectoryRequirement(provisioner: TestInfraProvisioner): TestInfraRequirement {
  return {
    id: TempDirectoryInfraId,
    kind: "temp-directory",
    provisioner,
  };
}

function readStringValue(input: {
  values: ReadonlyMap<string, string>;
  key: string;
  label: string;
}): string {
  const value = input.values.get(input.key);
  if (value === undefined) {
    throw new Error(`Missing ${input.label} value '${input.key}'.`);
  }

  return value;
}

async function startHttpStateService(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
}): Promise<StartedHttpService> {
  const tempDirectory = input.infra.get(TempDirectoryInfraId);
  if (tempDirectory === undefined) {
    throw new Error(`Missing required infra '${TempDirectoryInfraId}'.`);
  }

  const markerPath = readStringValue({
    values: tempDirectory.values,
    key: "markerPath",
    label: TempDirectoryInfraId,
  });

  const server = createServer(async (_request, response) => {
    try {
      const markerValue = await readFile(markerPath, "utf8");
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          environmentId: input.environmentId,
          markerValue,
        }),
      );
    } catch (error) {
      response.writeHead(500, {
        "content-type": "text/plain",
      });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected HTTP state service to listen on a TCP port.");
  }

  return {
    id: "http-state-service",
    mode: "runtime",
    endpoints: createHttpEndpoints(`http://127.0.0.1:${String(address.port)}`),
    stop: async () => {
      await closeServer(server);
    },
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

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Expected ${url} to return OK, received ${String(response.status)}.`);
  }

  return response.json();
}

function createHttpEndpoints(hostBaseUrl: string): {
  http: {
    hostBaseUrl: string;
  };
} {
  return {
    http: {
      hostBaseUrl,
    },
  };
}

function readHostBaseUrl(service: TestServiceRuntime): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected HTTP state service to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

async function checkHttpHealth(service: TestServiceRuntime): Promise<void> {
  const response = await fetch(readHostBaseUrl(service));
  if (!response.ok) {
    throw new Error(`Expected HTTP state service health check to return OK.`);
  }
}

function assertStatePayload(value: unknown): asserts value is {
  environmentId: string;
  markerValue: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected state payload to be an object.");
  }

  const environmentId = Reflect.get(value, "environmentId");
  const markerValue = Reflect.get(value, "markerValue");
  if (typeof environmentId !== "string" || typeof markerValue !== "string") {
    throw new Error("Expected state payload to contain string environmentId and markerValue.");
  }
}

describe("parallel test environments", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
  });

  it("starts isolated environments concurrently with shared registry definitions", async () => {
    const tempDirectoryProvisioner = createTempDirectoryProvisioner();
    const tempDirectoryRequirement = createTempDirectoryRequirement(tempDirectoryProvisioner);
    const registry = createServiceRegistry({
      services: {
        "http-state-service": {
          id: "http-state-service",
          infra: [tempDirectoryRequirement],
          serviceReferences: [],
          supportedModes: ["runtime"],
          healthCheck: checkHttpHealth,
          start: async (input) =>
            startHttpStateService({
              environmentId: input.environmentId,
              infra: input.infra,
            }),
        } satisfies TestServiceDefinition,
      },
      __dangerouslyIsolatedServices: {
        reason: "This test proves per-environment service isolation.",
      },
    });

    const environments = await Promise.all(
      Array.from({ length: EnvironmentCount }, async () =>
        startTestEnvironment({
          registry,
          services: [{ service: "http-state-service", mode: "runtime" }],
        }),
      ),
    );
    startedEnvironments.push(...environments);

    const environmentIds = new Set(environments.map((environment) => environment.id));
    expect(environmentIds.size).toBe(EnvironmentCount);

    const hostBaseUrls = new Set<string>();
    const directoryPaths = new Set<string>();

    await Promise.all(
      environments.map(async (environment) => {
        const service = environment.services.get("http-state-service");
        const hostBaseUrl = readHostBaseUrl(service);
        hostBaseUrls.add(hostBaseUrl);

        const tempDirectory = environment.infra.get(TempDirectoryInfraId);
        if (tempDirectory === undefined) {
          throw new Error(
            `Expected environment ${environment.id} to resolve temp directory infra.`,
          );
        }
        directoryPaths.add(
          readStringValue({
            values: tempDirectory.values,
            key: "directoryPath",
            label: TempDirectoryInfraId,
          }),
        );

        const payload = await fetchJson(hostBaseUrl);
        assertStatePayload(payload);
        expect(payload.environmentId).toBe(environment.id);
        expect(payload.markerValue).toBe(environment.id);
      }),
    );

    expect(hostBaseUrls.size).toBe(EnvironmentCount);
    expect(directoryPaths.size).toBe(EnvironmentCount);
  });
});
