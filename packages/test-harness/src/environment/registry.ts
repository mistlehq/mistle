import { ensureRunnerPoolSession } from "./runner-pool-session.js";
import { acquireRunnerServicePoolLease } from "./runner-service-pool.js";
import type {
  TestEnvironmentRegistryInput,
  TestServiceDefinition,
  TestServiceRegistry,
  TestServiceRequest,
} from "./types.js";

export type DangerouslyIsolatedTestRegistry = {
  reason: string;
  services?: readonly string[];
};

export type CreateServiceRegistryInput<TRegistry extends TestServiceRegistry> = {
  services: TRegistry;
  __dangerouslyIsolatedServices?: DangerouslyIsolatedTestRegistry;
};

/**
 * Defines a registry once while preserving literal service ids and supported
 * launch modes for type-safe `startTestEnvironment` calls.
 */
export function defineTestServiceRegistry<const TRegistry extends TestServiceRegistry>(
  registry: TRegistry,
): TRegistry {
  for (const serviceId in registry) {
    const service = registry[serviceId];
    if (service === undefined) {
      throw new Error(`Test service registry entry '${serviceId}' is undefined.`);
    }

    if (service.id !== serviceId) {
      throw new Error(
        `Test service registry key '${serviceId}' must match service id '${service.id}'.`,
      );
    }
  }

  return registry;
}

/**
 * Creates the public test registry used by `startTestEnvironment`.
 *
 * Services are pooled by default for the current runner session. Tests should
 * only opt out when they intentionally mutate the service process itself, such
 * as restart/reconnect behavior.
 */
export function createServiceRegistry<const TRegistry extends TestServiceRegistry>(
  input: CreateServiceRegistryInput<TRegistry>,
): TRegistry {
  const registry = defineTestServiceRegistry(input.services);
  const session = ensureRunnerPoolSession(process.env);

  validateDangerousIsolationOption({
    registry,
    option: input.__dangerouslyIsolatedServices,
  });

  for (const serviceId in registry) {
    const service = registry[serviceId];
    if (service === undefined) {
      throw new Error(`Test service registry entry '${serviceId}' is undefined.`);
    }

    Object.defineProperty(registry, serviceId, {
      configurable: true,
      enumerable: true,
      value: shouldIsolateService({
        serviceId,
        option: input.__dangerouslyIsolatedServices,
      })
        ? service
        : createPooledServiceDefinition({
            service,
            runId: session.runId,
            coordinatorDir: session.coordinatorDir,
          }),
      writable: false,
    });
  }

  return registry;
}

function createPooledServiceDefinition(input: {
  service: TestServiceDefinition;
  runId: string;
  coordinatorDir: string;
}): TestServiceDefinition {
  return {
    ...input.service,
    start: async (startInput) => {
      const lease = await acquireRunnerServicePoolLease({
        runId: input.runId,
        coordinatorDir: input.coordinatorDir,
        key: createPooledServiceKey({
          service: input.service,
          mode: startInput.mode,
          environmentId: startInput.environmentId,
        }),
        healthCheck: input.service.healthCheck,
        start: async () => {
          const startedService = await input.service.start(startInput);
          return {
            endpoints: startedService.endpoints,
            ...(startedService.pid === undefined ? {} : { pid: startedService.pid }),
            ...(startedService.containerId === undefined
              ? {}
              : { containerId: startedService.containerId }),
            stop: startedService.stop,
          };
        },
      });

      return {
        id: input.service.id,
        mode: startInput.mode,
        isPooled: true,
        endpoints: lease.endpoints,
        ...(lease.pid === undefined ? {} : { pid: lease.pid }),
        ...(lease.containerId === undefined ? {} : { containerId: lease.containerId }),
        stop: lease.release,
      };
    },
  };
}

function createPooledServiceKey(input: {
  service: TestServiceDefinition;
  mode: string;
  environmentId: string;
}): string {
  const infraKey =
    input.service.infra.length === 0
      ? "infra:none"
      : `infra:${input.service.infra
          .map((requirement) => requirement.id)
          .sort()
          .join("+")}`;
  const scope = input.service.poolScope ?? "runner";
  if (scope === "environment") {
    return `${input.service.id}/${input.mode}/${infraKey}/${input.environmentId}`;
  }

  if (input.mode === "runtime") {
    // Runtime services run in-process inside the current Vitest worker. They
    // cannot be safely shared by other workers because the owning worker can
    // exit while another worker still has a persisted lease for its port.
    return `${input.service.id}/${input.mode}/${infraKey}/${String(process.pid)}`;
  }

  return `${input.service.id}/${input.mode}/${infraKey}`;
}

function shouldIsolateService(input: {
  serviceId: string;
  option: DangerouslyIsolatedTestRegistry | undefined;
}): boolean {
  if (input.option === undefined) {
    return false;
  }

  const isolatedServices = input.option.services;
  return isolatedServices === undefined || isolatedServices.includes(input.serviceId);
}

function validateDangerousIsolationOption(input: {
  registry: TestServiceRegistry;
  option: DangerouslyIsolatedTestRegistry | undefined;
}): void {
  if (input.option === undefined) {
    return;
  }

  if (input.option.reason.length === 0) {
    throw new Error("__dangerouslyIsolatedServices requires a non-empty reason.");
  }

  for (const serviceId of input.option.services ?? []) {
    if (input.registry[serviceId] === undefined) {
      throw new Error(`__dangerouslyIsolatedServices references unknown service '${serviceId}'.`);
    }
  }
}

export function resolveTestServiceRequests<const TRegistry extends TestServiceRegistry>(
  input: TestEnvironmentRegistryInput<TRegistry>,
): readonly TestServiceRequest[] {
  const requests: TestServiceRequest[] = [];
  const registry: TestServiceRegistry = input.registry;

  for (const selection of input.services) {
    const serviceId = String(selection.service);
    const service: TestServiceDefinition | undefined = registry[serviceId];
    if (service === undefined) {
      throw new Error(`Unknown test service '${serviceId}'.`);
    }

    requests.push({
      service,
      mode: selection.mode,
    });
  }

  return requests;
}
