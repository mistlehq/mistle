import { Buffer } from "node:buffer";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { drainProcessCleanupTasks } from "../cleanup/index.js";
import { createServiceRegistry, defineTestServiceRegistry } from "./registry.js";
import { MISTLE_TEST_COORDINATOR_DIR_ENV, MISTLE_TEST_RUN_ID_ENV } from "./runner-pool-session.js";
import { stopRunnerServicePools } from "./runner-service-pool.js";
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

function createRestartableHttpService(input: {
  id: string;
  requirement: TestInfraRequirement;
  bindHost?: string;
  startEvents: string[];
  cleanupEvents: string[];
}): TestServiceDefinition {
  return {
    id: input.id,
    infra: [input.requirement],
    serviceReferences: [],
    endpoints: {
      http: {
        host: "127.0.0.1",
        ...(input.bindHost === undefined ? {} : { bindHost: input.bindHost }),
      },
    },
    supportedModes: ["runtime", "process"],
    healthCheck: async () => {},
    start: async (startInput) => {
      const httpEndpoint = startInput.plannedEndpoints.get(input.id)?.http;
      if (httpEndpoint === undefined) {
        throw new Error("Expected HTTP endpoint to be planned.");
      }

      input.startEvents.push(
        input.bindHost === undefined
          ? httpEndpoint.hostBaseUrl
          : `${httpEndpoint.hostBaseUrl}:${httpEndpoint.reservedHost ?? ""}`,
      );

      return {
        id: input.id,
        mode: startInput.mode,
        endpoints: {
          http: httpEndpoint,
        },
        stop: async () => {
          input.cleanupEvents.push(`service:${input.id}`);
        },
      };
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

function createMailpitRequirement(provisioner: TestInfraProvisioner): TestInfraRequirement {
  return {
    id: "mailpit",
    kind: "mailpit",
    provisioner,
  };
}

function createPostgresProvisioner(cleanupEvents: string[]): TestInfraProvisioner {
  return createProvisioner({
    kind: "postgres-database",
    cleanupEvents,
  });
}

function createMailpitProvisioner(cleanupEvents: string[]): TestInfraProvisioner {
  return createProvisioner({
    kind: "mailpit",
    cleanupEvents,
  });
}

function createProvisioner(input: { kind: string; cleanupEvents: string[] }): TestInfraProvisioner {
  return {
    kind: input.kind,
    provision: async (provisionInput) =>
      provisionInput.requirements.map((requirement) =>
        createResolvedInfra({
          id: requirement.id,
          kind: requirement.kind,
          cleanupEvents: input.cleanupEvents,
        }),
      ),
  };
}

function createService(input: {
  id: string;
  requirement: TestInfraRequirement;
  poolScope?: "runner" | "environment";
  serviceReferences?: readonly string[];
  startEvents: string[];
  cleanupEvents: string[];
}): TestServiceDefinition {
  return {
    id: input.id,
    infra: [input.requirement],
    serviceReferences: input.serviceReferences ?? [],
    ...(input.poolScope === undefined ? {} : { poolScope: input.poolScope }),
    supportedModes: ["runtime", "process"],
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

async function withRunnerPoolEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const previousRunId = process.env[MISTLE_TEST_RUN_ID_ENV];
  const previousCoordinatorDir = process.env[MISTLE_TEST_COORDINATOR_DIR_ENV];
  const runId = `runtime_test_${Date.now().toString(36)}`;
  const coordinatorDir = await mkdtemp(join(tmpdir(), "mistle-runtime-test-"));

  process.env[MISTLE_TEST_RUN_ID_ENV] = runId;
  process.env[MISTLE_TEST_COORDINATOR_DIR_ENV] = coordinatorDir;

  try {
    return await callback();
  } finally {
    await stopRunnerServicePools({
      runId,
      coordinatorDir,
    });

    if (previousRunId === undefined) {
      delete process.env[MISTLE_TEST_RUN_ID_ENV];
    } else {
      process.env[MISTLE_TEST_RUN_ID_ENV] = previousRunId;
    }

    if (previousCoordinatorDir === undefined) {
      delete process.env[MISTLE_TEST_COORDINATOR_DIR_ENV];
    } else {
      process.env[MISTLE_TEST_COORDINATOR_DIR_ENV] = previousCoordinatorDir;
    }
  }
}

async function captureStderrOutput(callback: () => Promise<void>): Promise<string> {
  const originalWrite = process.stderr.write.bind(process.stderr);
  let output = "";

  process.stderr.write = function write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    if (typeof encodingOrCallback === "function") {
      encodingOrCallback();
    } else {
      callback?.();
    }

    return true;
  };

  try {
    await callback();
  } finally {
    process.stderr.write = originalWrite;
  }

  return output;
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

  it("can reserve an HTTP port on a distinct bind host while keeping the client URL on loopback", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = defineTestServiceRegistry({
      "data-plane-gateway": createRestartableHttpService({
        id: "data-plane-gateway",
        requirement: postgresRequirement,
        bindHost: "0.0.0.0",
        startEvents,
        cleanupEvents,
      }),
    });

    const environment = await startTestEnvironment({
      id: "env_bind_host",
      registry,
      services: [{ service: "data-plane-gateway", mode: "runtime" }],
    });

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+:0\.0\.0\.0$/u);

    await environment.stop();
  });

  it("makes explicit extra infra available to selected services", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const mailpitProvisioner = createMailpitProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const mailpitRequirement = createMailpitRequirement(mailpitProvisioner);
    const registry = defineTestServiceRegistry({
      "control-plane-api": {
        id: "control-plane-api",
        infra: [postgresRequirement],
        serviceReferences: [],
        supportedModes: ["runtime"],
        healthCheck: async () => {},
        start: async (startInput) => {
          const postgres = startInput.infra.get("postgres.control-plane");
          const mailpit = startInput.infra.get("mailpit");
          if (postgres === undefined || mailpit === undefined) {
            throw new Error("Expected postgres and mailpit infra to be resolved.");
          }

          startEvents.push(`${postgres.id}:${mailpit.id}`);

          return {
            id: "control-plane-api",
            mode: startInput.mode,
            endpoints: {},
            stop: async () => {
              cleanupEvents.push("service:control-plane-api");
            },
          };
        },
      },
    });

    const environment = await startTestEnvironment({
      id: "env_extra_infra",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
      extraInfra: [mailpitRequirement],
    });

    expect(Array.from(environment.infra.keys())).toEqual(["postgres.control-plane", "mailpit"]);
    expect(startEvents).toEqual(["postgres.control-plane:mailpit"]);

    await environment.stop();

    expect(cleanupEvents).toEqual([
      "service:control-plane-api",
      "infra:mailpit",
      "infra:postgres.control-plane",
    ]);
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

  it("runs caller cleanup after services stop and before infra stops", async () => {
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
      id: "env_after_services_cleanup",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });

    await environment.stop({
      afterServicesStopped: async () => {
        cleanupEvents.push("after-services:provider-cleanup");
      },
    });

    expect(cleanupEvents).toEqual([
      "service:control-plane-api",
      "after-services:provider-cleanup",
      "infra:postgres.control-plane",
    ]);
  });

  it("reports aggregate and per-service cleanup timings in cleanup order", async () => {
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
      id: "env_cleanup_timing",
      registry,
      services: [
        { service: "control-plane-api", mode: "runtime" },
        { service: "control-plane-worker", mode: "runtime" },
      ],
      timing: { force: true },
    });

    const stderr = await captureStderrOutput(async () => {
      await environment.stop();
    });
    const cleanupSummary = stderr
      .split("\n")
      .find((line) => line.includes("env env_cleanup_timing cleanup phases:"));

    expect(cleanupSummary).toBeDefined();
    expect(cleanupSummary).toContain("services=");
    expect(cleanupSummary).toContain("service.control-plane-worker=");
    expect(cleanupSummary).toContain("service.control-plane-api=");

    const servicesIndex = cleanupSummary?.indexOf("services=") ?? -1;
    const workerIndex = cleanupSummary?.indexOf("service.control-plane-worker=") ?? -1;
    const apiIndex = cleanupSummary?.indexOf("service.control-plane-api=") ?? -1;
    const infraIndex = cleanupSummary?.indexOf("infra=") ?? -1;

    expect([servicesIndex, workerIndex, apiIndex, infraIndex].every((index) => index >= 0)).toBe(
      true,
    );
    expect(servicesIndex).toBeLessThan(workerIndex);
    expect(workerIndex).toBeLessThan(apiIndex);
    expect(apiIndex).toBeLessThan(infraIndex);
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

  it("restarts an isolated service with the same planned endpoint", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = defineTestServiceRegistry({
      "control-plane-api": createRestartableHttpService({
        id: "control-plane-api",
        requirement: postgresRequirement,
        startEvents,
        cleanupEvents,
      }),
    });

    const environment = await startTestEnvironment({
      id: "env_restart",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });
    const service = environment.services.get("control-plane-api");
    const firstUrl = service.endpoints.http?.hostBaseUrl;

    await service.restart();

    expect(service.endpoints.http?.hostBaseUrl).toBe(firstUrl);
    expect(startEvents).toEqual([firstUrl, firstUrl]);

    await environment.stop();

    expect(cleanupEvents).toEqual([
      "service:control-plane-api",
      "service:control-plane-api",
      "infra:postgres.control-plane",
    ]);
  });

  it("requires dangerous service isolation before mutating service lifecycle", async () => {
    const startEvents: string[] = [];
    const cleanupEvents: string[] = [];
    const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
    const postgresRequirement = createPostgresRequirement(postgresProvisioner);
    const registry = createServiceRegistry({
      services: {
        "control-plane-api": createRestartableHttpService({
          id: "control-plane-api",
          requirement: postgresRequirement,
          startEvents,
          cleanupEvents,
        }),
      },
    });

    const environment = await startTestEnvironment({
      id: "env_pooled_lifecycle",
      registry,
      services: [{ service: "control-plane-api", mode: "runtime" }],
    });
    const service = environment.services.get("control-plane-api");

    await expect(service.restart()).rejects.toThrow(
      "Use __dangerouslyIsolatedServices when a test needs to mutate service lifecycle.",
    );

    await environment.stop();
  });

  it("stops pooled runtime services when each environment is stopped", async () => {
    await withRunnerPoolEnvironment(async () => {
      const startEvents: string[] = [];
      const cleanupEvents: string[] = [];
      const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
      const postgresRequirement = createPostgresRequirement(postgresProvisioner);
      const registry = createServiceRegistry({
        services: {
          "control-plane-api": createService({
            id: "control-plane-api",
            requirement: postgresRequirement,
            startEvents,
            cleanupEvents,
          }),
        },
      });

      const firstEnvironment = await startTestEnvironment({
        id: "env_pooled_runtime_a",
        registry,
        services: [{ service: "control-plane-api", mode: "runtime" }],
      });
      await firstEnvironment.stop();

      const secondEnvironment = await startTestEnvironment({
        id: "env_pooled_runtime_b",
        registry,
        services: [{ service: "control-plane-api", mode: "runtime" }],
      });
      await secondEnvironment.stop();

      expect(startEvents).toEqual([
        "control-plane-api:env_pooled_runtime_a:postgres.control-plane",
        "control-plane-api:env_pooled_runtime_b:postgres.control-plane",
      ]);
      expect(cleanupEvents).toEqual([
        "service:control-plane-api",
        "infra:postgres.control-plane",
        "service:control-plane-api",
        "infra:postgres.control-plane",
      ]);
    });
  });

  it("pools environment-scoped services by environment id", async () => {
    await withRunnerPoolEnvironment(async () => {
      const startEvents: string[] = [];
      const cleanupEvents: string[] = [];
      const postgresProvisioner = createPostgresProvisioner(cleanupEvents);
      const postgresRequirement = createPostgresRequirement(postgresProvisioner);
      const registry = createServiceRegistry({
        services: {
          "control-plane-worker": createService({
            id: "control-plane-worker",
            requirement: postgresRequirement,
            poolScope: "environment",
            startEvents,
            cleanupEvents,
          }),
        },
      });

      const firstEnvironment = await startTestEnvironment({
        id: "env_worker_a",
        registry,
        services: [{ service: "control-plane-worker", mode: "process" }],
      });
      const secondEnvironment = await startTestEnvironment({
        id: "env_worker_a",
        registry,
        services: [{ service: "control-plane-worker", mode: "process" }],
      });
      const thirdEnvironment = await startTestEnvironment({
        id: "env_worker_b",
        registry,
        services: [{ service: "control-plane-worker", mode: "process" }],
      });

      expect(startEvents).toEqual([
        "control-plane-worker:env_worker_a:postgres.control-plane",
        "control-plane-worker:env_worker_b:postgres.control-plane",
      ]);

      await thirdEnvironment.stop();
      await secondEnvironment.stop();
      await firstEnvironment.stop();
    });
  });
});
