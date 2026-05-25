import { randomUUID } from "node:crypto";

import { registerProcessCleanupTask, runCleanupTasks, type CleanupTask } from "../cleanup/index.js";
import {
  formatIntegrationDuration,
  writeIntegrationTimingEvent,
  writeIntegrationTimingLine,
} from "../integration/timing.js";
import { releaseReservedPort, reserveAvailablePort } from "../network/reserve-available-port.js";
import { createTestHttpClient } from "./http-client.js";
import { createTestEnvironmentPlan } from "./plan.js";
import { resolveTestServiceRequests } from "./registry.js";
import { TestEnvironmentIdHeader } from "./test-isolation.js";
import type {
  ResolvedTestInfra,
  SelectedTestServiceId,
  TestService,
  TestEnvironment,
  TestEnvironmentRegistryInput,
  TestInfraProvisioner,
  TestInfraRequirement,
  TestServiceCollection,
  TestServiceEndpoints,
  TestServiceHandle,
  TestServiceSelection,
  TestServiceRegistry,
  TestServiceRequest,
  TestServiceStartInput,
} from "./types.js";

function createTestEnvironmentId(): string {
  return `test_env_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function formatDuration(milliseconds: number): string {
  return formatIntegrationDuration(milliseconds);
}

async function measure<T>(
  timings: Map<string, number>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    timings.set(label, Date.now() - startedAt);
  }
}

function measureSync<T>(timings: Map<string, number>, label: string, callback: () => T): T {
  const startedAt = Date.now();
  try {
    return callback();
  } finally {
    timings.set(label, Date.now() - startedAt);
  }
}

function writeEnvironmentTimingSummary(input: {
  environmentId: string;
  phase: "setup" | "cleanup";
  timings: ReadonlyMap<string, number>;
  force?: boolean;
}): void {
  const parts = Array.from(input.timings.entries()).map(
    ([label, durationMs]) => `${label}=${formatDuration(durationMs)}`,
  );

  writeIntegrationTimingLine(
    `[integration] env ${input.environmentId} ${input.phase} phases: ${parts.join(", ")}.`,
    input.force === undefined ? {} : { force: input.force },
  );
}

function formatServiceRequests(requests: readonly TestServiceRequest[]): string {
  return requests
    .map((request) => `${request.service.id}:${request.mode}`)
    .sort()
    .join(", ");
}

function formatIds(items: readonly { id: string }[]): string {
  return items
    .map((item) => item.id)
    .sort()
    .join(", ");
}

function groupInfraRequirementsByKind(
  requirements: readonly TestInfraRequirement[],
): ReadonlyMap<string, readonly TestInfraRequirement[]> {
  // Provisioners own an infra kind, not individual requirement ids. Batching by
  // kind lets one provisioner share a physical container across many logical
  // resources, such as multiple databases in one Postgres instance.
  const groupedRequirements = new Map<string, TestInfraRequirement[]>();

  for (const requirement of requirements) {
    const existing = groupedRequirements.get(requirement.kind);
    if (existing === undefined) {
      groupedRequirements.set(requirement.kind, [requirement]);
    } else {
      existing.push(requirement);
    }
  }

  return groupedRequirements;
}

function createProvisionersByKind(
  requirements: readonly TestInfraRequirement[],
): ReadonlyMap<string, TestInfraProvisioner> {
  // A single owner per kind keeps provisioning deterministic and avoids two
  // provisioners racing to create the same physical backing service.
  const provisionersByKind = new Map<string, TestInfraProvisioner>();

  for (const requirement of requirements) {
    const provisioner = requirement.provisioner;

    if (provisioner.kind.length === 0) {
      throw new Error("Test infra provisioner kind must be non-empty.");
    }

    const existingProvisioner = provisionersByKind.get(provisioner.kind);
    if (existingProvisioner === provisioner) {
      continue;
    }

    if (existingProvisioner !== undefined) {
      throw new Error(`Duplicate test infra provisioner for kind '${provisioner.kind}'.`);
    }

    provisionersByKind.set(provisioner.kind, provisioner);
  }

  return provisionersByKind;
}

function addResolvedInfra(input: {
  infraById: Map<string, ResolvedTestInfra>;
  infra: ResolvedTestInfra;
  expectedRequirementIds: ReadonlySet<string>;
}): void {
  // Provisioners must resolve exactly the logical requirements they were given.
  // Returning extra ids usually means a service typo or a stale registry entry.
  if (!input.expectedRequirementIds.has(input.infra.id)) {
    throw new Error(
      `Infra provisioner for kind '${input.infra.kind}' returned unexpected infra '${input.infra.id}'.`,
    );
  }

  if (input.infraById.has(input.infra.id)) {
    throw new Error(`Duplicate resolved test infra '${input.infra.id}'.`);
  }

  input.infraById.set(input.infra.id, input.infra);
}

async function provisionInfra(input: {
  environmentId: string;
  requirements: readonly TestInfraRequirement[];
}): Promise<ReadonlyMap<string, ResolvedTestInfra>> {
  const groupedRequirements = groupInfraRequirementsByKind(input.requirements);
  const provisionersByKind = createProvisionersByKind(input.requirements);
  const infraById = new Map<string, ResolvedTestInfra>();

  // Different infra kinds are independent by contract, so they can provision in
  // parallel. Dependencies within a kind are the provisioner's responsibility.
  await Promise.all(
    Array.from(groupedRequirements.entries()).map(async ([kind, requirements]) => {
      const provisioner = provisionersByKind.get(kind);
      if (provisioner === undefined) {
        throw new Error(`Missing test infra provisioner for kind '${kind}'.`);
      }

      writeIntegrationTimingEvent(
        "infra provision begin",
        `env=${input.environmentId} kind=${kind} requirements=${formatIds(requirements)}`,
      );
      const expectedRequirementIds = new Set(requirements.map((requirement) => requirement.id));
      const resolvedInfra = await provisioner.provision({
        environmentId: input.environmentId,
        requirements,
      });
      writeIntegrationTimingEvent(
        "infra provision end",
        `env=${input.environmentId} kind=${kind} resolved=${formatIds(resolvedInfra)}`,
      );

      for (const infra of resolvedInfra) {
        addResolvedInfra({
          infraById,
          infra,
          expectedRequirementIds,
        });
      }

      for (const requirement of requirements) {
        if (!infraById.has(requirement.id)) {
          throw new Error(
            `Infra provisioner for kind '${kind}' did not resolve requirement '${requirement.id}'.`,
          );
        }
      }
    }),
  );

  return infraById;
}

async function stopInfra(infra: ReadonlyMap<string, ResolvedTestInfra>): Promise<void> {
  // Stop in dependency-sensitive order while preserving reverse insertion order
  // inside each priority bucket.
  const tasks: CleanupTask[] = [];

  for (const resolvedInfra of orderInfraForCleanup(infra)) {
    tasks.push(resolvedInfra.stop);
  }

  await runCleanupTasks({
    tasks,
    context: "test environment infra cleanup",
  });
}

function orderInfraForCleanup(
  infra: ReadonlyMap<string, ResolvedTestInfra>,
): readonly ResolvedTestInfra[] {
  return Array.from(infra.values())
    .reverse()
    .sort((left, right) => readInfraCleanupPriority(left) - readInfraCleanupPriority(right));
}

function readInfraCleanupPriority(infra: ResolvedTestInfra): number {
  if (infra.kind === "docker-network") {
    return 0;
  }

  if (infra.kind === "postgres-database") {
    return 20;
  }

  return 10;
}

type ManagedTestServiceHandle = TestServiceHandle & {
  cleanup: () => Promise<void>;
};

async function stopServices(
  services: ReadonlyMap<string, ManagedTestServiceHandle>,
): Promise<void> {
  // Services stop before infra. Reverse startup order gives dependents a chance
  // to drain before the services they call are torn down.
  const tasks: CleanupTask[] = [];

  for (const service of Array.from(services.values()).reverse()) {
    tasks.push(service.cleanup);
  }

  await runCleanupTasks({
    tasks,
    context: "test environment service cleanup",
  });
}

async function startServiceLayer(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  servicesById: Map<string, ManagedTestServiceHandle>;
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>;
  layer: readonly TestServiceRequest[];
}): Promise<void> {
  // The planner only groups services whose dependencies are already started, so
  // a layer can start concurrently without callers hand-tuning parallelism.
  const startedServices = await Promise.all(
    input.layer.map(async (request) => {
      const startInput: TestServiceStartInput = {
        environmentId: input.environmentId,
        mode: request.mode,
        infra: input.infra,
        services: input.servicesById,
        plannedEndpoints: input.plannedEndpoints,
      };

      writeIntegrationTimingEvent(
        "service start begin",
        `env=${input.environmentId} service=${request.service.id} mode=${request.mode}`,
      );
      const startedAt = Date.now();
      const service = await request.service.start(startInput);
      writeIntegrationTimingEvent(
        "service start end",
        `env=${input.environmentId} service=${request.service.id} mode=${request.mode} duration=${formatDuration(Date.now() - startedAt)}`,
      );

      return {
        request,
        service,
        startInput,
      };
    }),
  );

  for (const { request, service, startInput } of startedServices) {
    if (input.servicesById.has(service.id)) {
      throw new Error(`Test service '${service.id}' started more than once.`);
    }

    input.servicesById.set(
      service.id,
      createTestServiceHandle({
        request,
        service,
        startInput,
      }),
    );
  }
}

function createTestServiceHandle(input: {
  request: TestServiceRequest;
  service: TestService;
  startInput: TestServiceStartInput;
}): ManagedTestServiceHandle {
  let service = input.service;
  const httpEndpoint = service.endpoints.http;
  const http =
    httpEndpoint === undefined
      ? undefined
      : createTestHttpClient({
          baseUrl: httpEndpoint.hostBaseUrl,
          defaultHeaders: new Map([[TestEnvironmentIdHeader, input.startInput.environmentId]]),
        });
  let stopped = false;
  let cleanedUp = false;
  const closeHttp = http === undefined ? async () => {} : http.close;

  const assertIsolated = (operation: string): void => {
    if (service.isPooled === true) {
      throw new Error(
        `Cannot ${operation} pooled test service '${service.id}'. Use __dangerouslyIsolatedServices when a test needs to mutate service lifecycle.`,
      );
    }
  };

  const handle = {
    ...service,
    start: async () => {
      assertIsolated("start");
      if (!stopped) {
        return;
      }

      service = await input.request.service.start(input.startInput);
      syncHandleRuntime(handle, service);
      stopped = false;
    },
    stop: async () => {
      assertIsolated("stop");
      if (stopped) {
        return;
      }

      await service.stop();
      stopped = true;
    },
    restart: async () => {
      assertIsolated("restart");
      writeIntegrationTimingEvent(
        "service restart begin",
        `env=${input.startInput.environmentId} service=${service.id}`,
      );
      const startedAt = Date.now();
      await handle.stop();
      await handle.start();
      writeIntegrationTimingEvent(
        "service restart end",
        `env=${input.startInput.environmentId} service=${service.id} duration=${formatDuration(Date.now() - startedAt)}`,
      );
    },
    cleanup: async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await runCleanupTasks({
        tasks: [
          closeHttp,
          async () => {
            if (stopped) {
              return;
            }

            await service.stop();
            stopped = true;
          },
        ],
        context: `test service '${service.id}' cleanup`,
      });
    },
  };

  if (http === undefined) {
    return handle;
  }

  return {
    ...handle,
    http,
  };
}

function syncHandleRuntime(handle: TestServiceHandle, service: TestService): void {
  handle.endpoints = service.endpoints;

  if (service.pid === undefined) {
    delete handle.pid;
  } else {
    handle.pid = service.pid;
  }

  if (service.containerId === undefined) {
    delete handle.containerId;
  } else {
    handle.containerId = service.containerId;
  }
}

async function startServices(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>;
  serviceLayers: readonly (readonly TestServiceRequest[])[];
}): Promise<ReadonlyMap<string, ManagedTestServiceHandle>> {
  const servicesById = new Map<string, ManagedTestServiceHandle>();

  for (const layer of input.serviceLayers) {
    await startServiceLayer({
      environmentId: input.environmentId,
      infra: input.infra,
      plannedEndpoints: input.plannedEndpoints,
      servicesById,
      layer,
    });
  }

  return servicesById;
}

async function planServiceEndpoints(
  requests: readonly TestServiceRequest[],
): Promise<ReadonlyMap<string, TestServiceEndpoints>> {
  const plannedEndpoints = new Map<string, TestServiceEndpoints>();

  for (const request of requests) {
    const http = request.service.endpoints?.http;
    if (http === undefined) {
      plannedEndpoints.set(request.service.id, {});
      continue;
    }

    const reservedHost = http.bindHost ?? http.host;
    const port = await reserveAvailablePort({
      host: reservedHost,
    });
    const hostBaseUrl = `http://${http.host}:${String(port)}`;

    plannedEndpoints.set(request.service.id, {
      http: {
        hostBaseUrl,
        internalBaseUrl: hostBaseUrl,
        reservedHost,
      },
    });
  }

  return plannedEndpoints;
}

async function releasePlannedEndpoints(
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>,
): Promise<void> {
  await Promise.all(
    Array.from(plannedEndpoints.values()).map(async (endpoints) => {
      const httpEndpoint = endpoints.http;
      if (httpEndpoint === undefined) {
        return;
      }

      const url = new URL(httpEndpoint.hostBaseUrl);
      const port = Number(url.port);
      if (!Number.isInteger(port)) {
        throw new Error(`Cannot release planned HTTP endpoint '${httpEndpoint.hostBaseUrl}'.`);
      }
      if (httpEndpoint.reservedHost === undefined) {
        throw new Error(`Cannot release planned HTTP endpoint '${httpEndpoint.hostBaseUrl}'.`);
      }

      await releaseReservedPort({
        host: httpEndpoint.reservedHost,
        port,
      });
    }),
  );
}

function createTestServiceCollection<
  const TServices extends readonly TestServiceSelection<TestServiceRegistry>[],
>(input: {
  servicesById: ReadonlyMap<string, TestServiceHandle>;
  selections: TServices;
}): TestServiceCollection<SelectedTestServiceId<TServices>> {
  const selectedServiceIds = input.selections.map((selection) => String(selection.service));

  return {
    get: (serviceId) => {
      const service = input.servicesById.get(serviceId);
      if (service === undefined) {
        throw new Error(`Test service '${serviceId}' was not started.`);
      }

      return service;
    },
    keys: () => selectedServiceIds,
    values: () =>
      selectedServiceIds.map((serviceId) => {
        const service = input.servicesById.get(serviceId);
        if (service === undefined) {
          throw new Error(`Test service '${serviceId}' was not started.`);
        }

        return service;
      }),
  };
}

export async function startTestEnvironment<
  const TRegistry extends TestServiceRegistry,
  const TServices extends readonly TestServiceSelection<TRegistry>[],
>(
  input: TestEnvironmentRegistryInput<TRegistry> & {
    services: TServices;
  },
): Promise<TestEnvironment<SelectedTestServiceId<TServices>>> {
  const environmentId = input.id ?? createTestEnvironmentId();
  const setupTimings = new Map<string, number>();

  if (environmentId.length === 0) {
    throw new Error("Test environment id must be non-empty.");
  }

  writeIntegrationTimingEvent("startTestEnvironment begin", `env=${environmentId}`, input.timing);
  const requestedServices = measureSync(setupTimings, "resolve-services", () =>
    resolveTestServiceRequests(input),
  );
  writeIntegrationTimingEvent(
    "startTestEnvironment resolved services",
    `env=${environmentId} services=${formatServiceRequests(requestedServices)}`,
    input.timing,
  );
  const plan = measureSync(setupTimings, "plan", () =>
    createTestEnvironmentPlan({
      services: requestedServices,
      ...(input.extraInfra === undefined ? {} : { extraInfra: input.extraInfra }),
    }),
  );
  writeIntegrationTimingEvent(
    "startTestEnvironment planned",
    `env=${environmentId} infra=${formatIds(plan.infraRequirements)} layers=${String(plan.serviceLayers.length)}`,
    input.timing,
  );
  // Provision infrastructure by kind before any service starts. Provisioners get
  // batched requirements so they can share physical containers and isolate
  // logical resources such as databases, buckets, or key prefixes.
  const infra = await measure(setupTimings, "infra", async () =>
    provisionInfra({
      environmentId,
      requirements: plan.infraRequirements,
    }),
  );

  let plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints> | undefined;
  let services: ReadonlyMap<string, ManagedTestServiceHandle> | undefined;

  try {
    const endpoints = await measure(setupTimings, "endpoints", async () =>
      planServiceEndpoints(requestedServices),
    );
    plannedEndpoints = endpoints;
    services = await measure(setupTimings, "services", async () =>
      startServices({
        environmentId,
        infra,
        plannedEndpoints: endpoints,
        serviceLayers: plan.serviceLayers,
      }),
    );
  } catch (error) {
    // If service startup fails, no environment handle is returned. Clean up infra
    // here so callers do not need a partially-started-environment protocol.
    if (services !== undefined) {
      await stopServices(services);
    }
    await stopInfra(infra);
    if (plannedEndpoints !== undefined) {
      await releasePlannedEndpoints(plannedEndpoints);
    }
    throw error;
  }
  writeEnvironmentTimingSummary({
    environmentId,
    phase: "setup",
    timings: setupTimings,
    ...(input.timing?.force === undefined ? {} : { force: input.timing.force }),
  });
  writeIntegrationTimingEvent("startTestEnvironment ready", `env=${environmentId}`, input.timing);

  let cleanupPromise: Promise<void> | undefined;

  const stopInternal = async (
    stopInput: { afterServicesStopped?: () => Promise<void> } = {},
  ): Promise<void> => {
    if (cleanupPromise !== undefined) {
      await cleanupPromise;
      return;
    }

    const cleanupTimings = new Map<string, number>();
    cleanupPromise = runCleanupTasks({
      tasks: [
        async () => {
          if (services !== undefined) {
            await measure(cleanupTimings, "services", async () => stopServices(services));
          }
        },
        async () => {
          if (stopInput.afterServicesStopped !== undefined) {
            await measure(cleanupTimings, "after-services", stopInput.afterServicesStopped);
          }
        },
        async () => {
          await measure(cleanupTimings, "infra", async () => stopInfra(infra));
        },
        async () => {
          await measure(cleanupTimings, "endpoints", async () =>
            releasePlannedEndpoints(plannedEndpoints),
          );
        },
      ],
      context: `test environment '${environmentId}' cleanup`,
    });

    await cleanupPromise;
    writeEnvironmentTimingSummary({
      environmentId,
      phase: "cleanup",
      timings: cleanupTimings,
      ...(input.timing?.force === undefined ? {} : { force: input.timing.force }),
    });
    writeIntegrationTimingEvent(
      "startTestEnvironment stopped",
      `env=${environmentId}`,
      input.timing,
    );
  };
  const unregisterProcessCleanupTask = registerProcessCleanupTask(stopInternal);

  return {
    id: environmentId,
    infra,
    services: createTestServiceCollection({
      servicesById: services,
      selections: input.services,
    }),
    stop: async (input) => {
      await stopInternal(input);
      unregisterProcessCleanupTask();
    },
  };
}
