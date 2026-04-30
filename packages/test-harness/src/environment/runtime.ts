import { randomUUID } from "node:crypto";

import { registerProcessCleanupTask, runCleanupTasks, type CleanupTask } from "../cleanup/index.js";
import { createTestHttpClient } from "./http-client.js";
import { createTestEnvironmentPlan } from "./plan.js";
import { resolveTestServiceRequests } from "./registry.js";
import type {
  ResolvedTestInfra,
  SelectedTestServiceId,
  TestService,
  TestEnvironment,
  TestEnvironmentRegistryInput,
  TestInfraProvisioner,
  TestInfraRequirement,
  TestServiceCollection,
  TestServiceHandle,
  TestServiceSelection,
  TestServiceRegistry,
  TestServiceRequest,
} from "./types.js";

function createTestEnvironmentId(): string {
  return `test_env_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
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

      const expectedRequirementIds = new Set(requirements.map((requirement) => requirement.id));
      const resolvedInfra = await provisioner.provision({
        environmentId: input.environmentId,
        requirements,
      });

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
  // Stop in reverse insertion order. This mirrors provisioning order for simple
  // cases while still running every cleanup task and aggregating failures.
  const tasks: CleanupTask[] = [];

  for (const resolvedInfra of Array.from(infra.values()).reverse()) {
    tasks.push(resolvedInfra.stop);
  }

  await runCleanupTasks({
    tasks,
    context: "test environment infra cleanup",
  });
}

async function stopServices(services: ReadonlyMap<string, TestServiceHandle>): Promise<void> {
  // Services stop before infra. Reverse startup order gives dependents a chance
  // to drain before the services they call are torn down.
  const tasks: CleanupTask[] = [];

  for (const service of Array.from(services.values()).reverse()) {
    tasks.push(service.stop);
  }

  await runCleanupTasks({
    tasks,
    context: "test environment service cleanup",
  });
}

async function startServiceLayer(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  servicesById: Map<string, TestServiceHandle>;
  layer: readonly TestServiceRequest[];
}): Promise<void> {
  // The planner only groups services whose dependencies are already started, so
  // a layer can start concurrently without callers hand-tuning parallelism.
  const startedServices = await Promise.all(
    input.layer.map(async (request) =>
      request.service.start({
        environmentId: input.environmentId,
        mode: request.mode,
        infra: input.infra,
        services: input.servicesById,
      }),
    ),
  );

  for (const service of startedServices) {
    if (input.servicesById.has(service.id)) {
      throw new Error(`Test service '${service.id}' started more than once.`);
    }

    input.servicesById.set(service.id, createTestServiceHandle(service));
  }
}

function createTestServiceHandle(service: TestService): TestServiceHandle {
  const httpEndpoint = service.endpoints.http;
  const http =
    httpEndpoint === undefined
      ? undefined
      : createTestHttpClient({
          baseUrl: httpEndpoint.hostBaseUrl,
        });
  let stopped = false;
  const stopHttp = http === undefined ? async () => {} : http.close;

  const handle = {
    ...service,
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await runCleanupTasks({
        tasks: [stopHttp, service.stop],
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

async function startServices(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  serviceLayers: readonly (readonly TestServiceRequest[])[];
}): Promise<ReadonlyMap<string, TestServiceHandle>> {
  const servicesById = new Map<string, TestServiceHandle>();

  for (const layer of input.serviceLayers) {
    await startServiceLayer({
      environmentId: input.environmentId,
      infra: input.infra,
      servicesById,
      layer,
    });
  }

  return servicesById;
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

  if (environmentId.length === 0) {
    throw new Error("Test environment id must be non-empty.");
  }

  const requestedServices = resolveTestServiceRequests(input);
  const plan = createTestEnvironmentPlan({
    services: requestedServices,
  });
  // Provision infrastructure by kind before any service starts. Provisioners get
  // batched requirements so they can share physical containers and isolate
  // logical resources such as databases, buckets, or key prefixes.
  const infra = await provisionInfra({
    environmentId,
    requirements: plan.infraRequirements,
  });

  let services: ReadonlyMap<string, TestServiceHandle> | undefined;

  try {
    services = await startServices({
      environmentId,
      infra,
      serviceLayers: plan.serviceLayers,
    });
  } catch (error) {
    // If service startup fails, no environment handle is returned. Clean up infra
    // here so callers do not need a partially-started-environment protocol.
    await stopInfra(infra);
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;

  const stopInternal = async (): Promise<void> => {
    if (cleanupPromise !== undefined) {
      await cleanupPromise;
      return;
    }

    cleanupPromise = runCleanupTasks({
      tasks: [
        async () => {
          if (services !== undefined) {
            await stopServices(services);
          }
        },
        async () => {
          await stopInfra(infra);
        },
      ],
      context: `test environment '${environmentId}' cleanup`,
    });

    await cleanupPromise;
  };
  const unregisterProcessCleanupTask = registerProcessCleanupTask(stopInternal);

  return {
    id: environmentId,
    infra,
    services: createTestServiceCollection({
      servicesById: services,
      selections: input.services,
    }),
    stop: async () => {
      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}
