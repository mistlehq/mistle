import { once } from "node:events";
import { createServer, type Server } from "node:http";

import {
  createServiceRegistry,
  startTestEnvironment,
  type TestService,
  type TestServiceDefinition,
  type TestServiceRuntime,
} from "@mistle/test-harness";
import { afterEach, describe, expect, it } from "vitest";

import { createAliasedServiceDefinition } from "../src/integration/service-alias.js";

const BaseServiceId = "http-alias-target";
const FirstAliasId = "http-alias-target-a";
const SecondAliasId = "http-alias-target-b";

const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];

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

function readHostBaseUrl(service: TestServiceRuntime): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected aliased HTTP service to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

async function checkHttpHealth(service: TestServiceRuntime): Promise<void> {
  const response = await fetch(readHostBaseUrl(service));
  if (!response.ok) {
    throw new Error(`Expected aliased HTTP service health check to return OK.`);
  }
}

function createHttpServiceDefinition(): TestServiceDefinition {
  return {
    id: BaseServiceId,
    infra: [],
    serviceReferences: [],
    endpoints: {
      http: {
        host: "127.0.0.1",
      },
    },
    supportedModes: ["runtime"],
    healthCheck: checkHttpHealth,
    start: async (input): Promise<TestService> => {
      const plannedEndpoint = input.plannedEndpoints.get(BaseServiceId)?.http;
      if (plannedEndpoint === undefined) {
        throw new Error("Expected aliased service start input to include the base HTTP endpoint.");
      }

      const server = createServer((_request, response) => {
        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            baseUrl: plannedEndpoint.hostBaseUrl,
          }),
        );
      });
      const url = new URL(plannedEndpoint.hostBaseUrl);
      server.listen(Number(url.port), url.hostname);
      await once(server, "listening");

      return {
        id: BaseServiceId,
        mode: input.mode,
        endpoints: {
          http: {
            hostBaseUrl: plannedEndpoint.hostBaseUrl,
            internalBaseUrl: plannedEndpoint.hostBaseUrl,
          },
        },
        stop: async () => {
          await closeServer(server);
        },
      };
    },
  };
}

describe("aliased integration service definitions", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
  });

  it("starts two aliases of one service definition with distinct planned endpoints", async () => {
    const service = createHttpServiceDefinition();
    const registry = createServiceRegistry({
      services: {
        [FirstAliasId]: createAliasedServiceDefinition({
          registryId: FirstAliasId,
          serviceId: BaseServiceId,
          service,
        }),
        [SecondAliasId]: createAliasedServiceDefinition({
          registryId: SecondAliasId,
          serviceId: BaseServiceId,
          service,
        }),
      },
      __dangerouslyIsolatedServices: {
        reason: "This test mutates the lifecycle of two local HTTP service instances.",
      },
    });
    const environment = await startTestEnvironment({
      registry,
      services: [
        { service: FirstAliasId, mode: "runtime" },
        { service: SecondAliasId, mode: "runtime" },
      ],
    });
    startedEnvironments.push(environment);

    const first = environment.services.get(FirstAliasId);
    const second = environment.services.get(SecondAliasId);
    const firstBaseUrl = readHostBaseUrl(first);
    const secondBaseUrl = readHostBaseUrl(second);

    expect(first.id).toBe(FirstAliasId);
    expect(second.id).toBe(SecondAliasId);
    expect(firstBaseUrl).not.toBe(secondBaseUrl);

    const [firstResponse, secondResponse] = await Promise.all([
      first.http?.fetch("/"),
      second.http?.fetch("/"),
    ]);
    if (firstResponse === undefined || secondResponse === undefined) {
      throw new Error("Expected aliased HTTP services to expose HTTP clients.");
    }

    expect(await firstResponse.json()).toEqual({ baseUrl: firstBaseUrl });
    expect(await secondResponse.json()).toEqual({ baseUrl: secondBaseUrl });
  });
});
