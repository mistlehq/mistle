import { describe, expect, it } from "vitest";

import { drainProcessCleanupTasks } from "../cleanup/index.js";
import { defineTestServiceRegistry } from "./registry.js";
import { startTestEnvironment } from "./runtime.js";
import type {
  ResolvedTestInfra,
  TestInfraProvisioner,
  TestInfraRequirement,
  TestServiceDefinition,
} from "./types.js";

function createResolvedInfra(input: {
  id: string;
  kind: string;
  cleanupEvents: string[];
}): ResolvedTestInfra {
  return {
    id: input.id,
    kind: input.kind,
    values: new Map([["url", `postgresql://${input.id}`]]),
    stop: async () => {
      input.cleanupEvents.push(`infra:${input.id}`);
    },
  };
}

function createPostgresRequirement(provisioner: TestInfraProvisioner): TestInfraRequirement {
  return {
    id: "postgres.control-plane",
    kind: "postgres-database",
    provisioner,
  };
}

function createPostgresProvisioner(cleanupEvents: string[]): TestInfraProvisioner {
  return {
    kind: "postgres-database",
    provision: async (input) =>
      input.requirements.map((requirement) =>
        createResolvedInfra({
          id: requirement.id,
          kind: requirement.kind,
          cleanupEvents,
        }),
      ),
  };
}

function createService(input: {
  id: string;
  requirement: TestInfraRequirement;
  serviceReferences?: readonly string[];
  startEvents: string[];
  cleanupEvents: string[];
}): TestServiceDefinition {
  return {
    id: input.id,
    infra: [input.requirement],
    serviceReferences: input.serviceReferences ?? [],
    supportedModes: ["runtime"],
    healthCheck: async () => {},
    start: async (startInput) => {
      const database = startInput.infra.get(input.requirement.id);
      if (database === undefined) {
        throw new Error("Expected postgres infra to be resolved.");
      }

      input.startEvents.push(`${input.id}:${startInput.environmentId}:${database.id}`);

      return {
        id: input.id,
        mode: startInput.mode,
        endpoints: {
          http: {
            hostBaseUrl: `http://127.0.0.1/${input.id}`,
          },
        },
        stop: async () => {
          input.cleanupEvents.push(`service:${input.id}`);
        },
      };
    },
  };
}

function createSingleServiceRegistry(input: {
  serviceId: string;
  requirement: TestInfraRequirement;
  startEvents: string[];
  cleanupEvents: string[];
}) {
  return defineTestServiceRegistry({
    [input.serviceId]: createService({
      id: input.serviceId,
      requirement: input.requirement,
      startEvents: input.startEvents,
      cleanupEvents: input.cleanupEvents,
    }),
  });
}

describe("startTestEnvironment", () => {
  it("provisions deduped infra and starts services in reference order", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = defineTestServiceRegistry({
      "control-plane-api": createService({
        id: "control-plane-api",
        requirement: postgresRequirement,
        startEvents,
        cleanupEvents,
      }),
      "control-plane-worker": createService({
        id: "control-plane-worker",
        requirement: postgresRequirement,
        serviceReferences: ["control-plane-api"],
        startEvents,
        cleanupEvents,
      }),
    });

    const environment = await startTestEnvironment({
      id: "env_123",
      registry,
      services: [
        { service: "control-plane-api", mode: "runtime" },
        { service: "control-plane-worker", mode: "runtime" },
      ],
    });

    expect(Array.from(environment.infra.keys())).toEqual(["postgres.control-plane"]);
    expect(Array.from(environment.services.keys())).toEqual([
      "control-plane-api",
      "control-plane-worker",
    ]);
    expect(startEvents).toEqual([
      "control-plane-api:env_123:postgres.control-plane",
      "control-plane-worker:env_123:postgres.control-plane",
    ]);

    await environment.stop();

    expect(cleanupEvents).toEqual([
      "service:control-plane-worker",
      "service:control-plane-api",
      "infra:postgres.control-plane",
    ]);
  });

  it("generates an environment id when one is not provided", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = createSingleServiceRegistry({
      serviceId: "control-plane-api",
      requirement: postgresRequirement,
      startEvents,
      cleanupEvents,
    });

    const environment = await startTestEnvironment({
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });

    expect(environment.id).toMatch(/^test_env_[a-z0-9]+$/u);
    expect(startEvents).toEqual([`control-plane-api:${environment.id}:postgres.control-plane`]);

    await environment.stop();
  });

  it("starts services selected from a registry", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = defineTestServiceRegistry({
      "control-plane-api": createService({
        id: "control-plane-api",
        requirement: postgresRequirement,
        startEvents,
        cleanupEvents,
      }),
      "control-plane-worker": createService({
        id: "control-plane-worker",
        requirement: postgresRequirement,
        serviceReferences: ["control-plane-api"],
        startEvents,
        cleanupEvents,
      }),
    });

    const environment = await startTestEnvironment({
      id: "env_registry",
      registry,
      services: [
        { service: "control-plane-api", mode: "runtime" },
        { service: "control-plane-worker", mode: "runtime" },
      ],
    });

    expect(Array.from(environment.services.keys())).toEqual([
      "control-plane-api",
      "control-plane-worker",
    ]);
    expect(startEvents).toEqual([
      "control-plane-api:env_registry:postgres.control-plane",
      "control-plane-worker:env_registry:postgres.control-plane",
    ]);

    await environment.stop();
  });

  it("allows explicit stop to be called more than once", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = createSingleServiceRegistry({
      serviceId: "control-plane-api",
      requirement: postgresRequirement,
      startEvents,
      cleanupEvents,
    });

    const environment = await startTestEnvironment({
      id: "env_idempotent",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });

    await environment.stop();
    await environment.stop();

    expect(cleanupEvents).toEqual(["service:control-plane-api", "infra:postgres.control-plane"]);
  });

  it("registers process cleanup so explicit stop is optional", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = createSingleServiceRegistry({
      serviceId: "control-plane-api",
      requirement: postgresRequirement,
      startEvents,
      cleanupEvents,
    });

    await startTestEnvironment({
      id: "env_process_cleanup",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });

    await drainProcessCleanupTasks("test environment forgotten teardown");

    expect(cleanupEvents).toEqual(["service:control-plane-api", "infra:postgres.control-plane"]);
  });

  it("cleans up provisioned infra when service startup fails", async () => {
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = defineTestServiceRegistry({
      "broken-service": {
        id: "broken-service",
        infra: [postgresRequirement],
        serviceReferences: [],
        supportedModes: ["runtime"],
        healthCheck: async () => {},
        start: async () => {
          throw new Error("broken-service failed to start");
        },
      },
    });

    await expect(
      startTestEnvironment({
        id: "env_broken",
        registry,
        services: [{ service: "broken-service", mode: "runtime" }],
      }),
    ).rejects.toThrow("broken-service failed to start");

    expect(cleanupEvents).toEqual(["infra:postgres.control-plane"]);
  });
});
