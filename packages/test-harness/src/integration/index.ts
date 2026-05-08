/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { it as base } from "vitest";

import { createServiceRegistry } from "../environment/registry.js";
import type { DangerouslyIsolatedTestRegistry } from "../environment/registry.js";
import { startTestEnvironment } from "../environment/runtime.js";
import { TestEnvironmentIdHeader } from "../environment/test-isolation.js";
import type {
  TestEnvironment,
  TestInfraRequirement,
  TestServiceLaunchMode,
  TestServiceDefinition,
  TestServiceRegistry,
  TestServiceSelection,
} from "../environment/types.js";
import type { IntegrationTestEnvironment } from "./environment.js";
import type { IntegrationServiceOptions } from "./services/options.js";
import { ServiceIds, type ServiceId } from "./services/service-ids.js";
import {
  formatIntegrationDuration,
  writeIntegrationTimingEvent,
  writeIntegrationTimingLine,
} from "./timing.js";

export { TestEnvironmentIdHeader };
export type { IntegrationAuthenticatedSession, IntegrationAuth } from "./auth.js";
export type { IntegrationTestEnvironment } from "./environment.js";

type MistleTestExtraInfraId = "mailpit" | "otlp" | "seaweedfs";

type ServiceAttachableInfraId =
  | MistleTestExtraInfraId
  | "sandbox-base-image"
  | "sandbox-docker-network";

type IntegrationServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: TestServiceLaunchMode;
    };

type CreateIntegrationTestInput = {
  services: readonly IntegrationServiceSelection[];
  extraInfra?: readonly MistleTestExtraInfraId[];
  auth?: {
    google?: "simulated";
  };
  __dangerouslyIsolatedServices?: DangerouslyIsolatedTestRegistry;
  __internalInfra?: readonly TestInfraRequirement[];
  __afterStart?: (input: {
    environment: TestEnvironment<ServiceId>;
    integrationEnvironment: IntegrationTestEnvironment;
  }) => Promise<void | (() => Promise<void>)>;
  __serviceOptions?:
    | {
        sandbox?: IntegrationServiceOptions["sandbox"];
      }
    | (() => Promise<{
        sandbox?: IntegrationServiceOptions["sandbox"];
      }>);
};

type IntegrationTestFixture = {
  env: IntegrationTestEnvironment;
};

function formatSelectedServices(selectionsInput: readonly IntegrationServiceSelection[]): string {
  return selectionsInput
    .map((selection) => {
      if (typeof selection === "string") {
        return selection;
      }

      return `${selection.service}:${selection.mode}`;
    })
    .join(", ");
}

// The integration API is intentionally small: app tests choose services and get
// a single env fixture. Registry, infra, ports, service pooling, and cleanup all
// stay inside the harness.
export function createIntegrationTest(input: CreateIntegrationTestInput) {
  const selectedServices = formatSelectedServices(input.services);
  writeIntegrationTimingEvent(
    "createIntegrationTest evaluated",
    `caller=${readCallerFromStack()} services=${selectedServices}`,
  );

  return base.extend<IntegrationTestFixture>({
    env: [
      async ({}, use) => {
        writeIntegrationTimingEvent("env fixture start", `services=${selectedServices}`);
        const setupStartedAt = Date.now();
        const registry = await registryFor(input);
        const services = selections({
          registry,
          selections: input.services,
        });
        const environment = await startTestEnvironment({
          registry,
          services,
        });
        const { createIntegrationEnvironment } = await import("./environment.js");
        const integrationEnvironment = createIntegrationEnvironment({
          environment,
        });
        const extraCleanupTasks: Array<() => Promise<void>> = [];
        if (input.__afterStart !== undefined) {
          const cleanup = await input.__afterStart({
            environment,
            integrationEnvironment,
          });
          if (cleanup !== undefined) {
            extraCleanupTasks.unshift(cleanup);
          }
        }
        const setupDurationMs = Date.now() - setupStartedAt;

        writeIntegrationTimingLine(
          `[integration] env ${environment.id} setup completed in ${formatIntegrationDuration(setupDurationMs)} for ${selectedServices}.`,
        );

        try {
          const testStartedAt = Date.now();
          await use(integrationEnvironment);
          writeIntegrationTimingLine(
            `[integration] env ${environment.id} test body completed in ${formatIntegrationDuration(Date.now() - testStartedAt)}.`,
          );
        } finally {
          const teardownStartedAt = Date.now();
          for (const cleanup of extraCleanupTasks) {
            await cleanup();
          }
          await integrationEnvironment.stop();
          await environment.stop();
          writeIntegrationTimingLine(
            `[integration] env ${environment.id} teardown completed in ${formatIntegrationDuration(Date.now() - teardownStartedAt)}.`,
          );
        }
      },
      {
        scope: "file",
      },
    ],
  });
}

function readCallerFromStack(): string {
  const stack = new Error().stack;
  if (stack === undefined) {
    return "unknown";
  }

  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("Error") ||
      trimmed.includes("createIntegrationTest") ||
      trimmed.includes("readCallerFromStack") ||
      trimmed.includes("packages/test-harness/src/integration/index.ts")
    ) {
      continue;
    }

    return trimmed;
  }

  return "unknown";
}

async function registryFor(input: CreateIntegrationTestInput): Promise<TestServiceRegistry> {
  const serviceEntries = await loadSelectedServices(input.services);
  const { createTestExtraInfra, createTestRegistry } =
    await import("../environment/service-catalog.js");
  const serviceCatalog = createTestRegistry();
  const extraInfra =
    input.extraInfra === undefined
      ? []
      : createTestExtraInfra({
          ids: input.extraInfra,
        });
  const internalInfra = input.__internalInfra ?? [];
  const attachableInfra = [...extraInfra, ...internalInfra];
  const services: Record<string, TestServiceDefinition> = {};
  const inputServiceOptions =
    typeof input.__serviceOptions === "function"
      ? await input.__serviceOptions()
      : input.__serviceOptions;

  for (const entry of serviceEntries) {
    const catalogService = serviceCatalog[entry.serviceId];
    if (catalogService === undefined) {
      throw new Error(`Unknown integration test service '${entry.serviceId}'.`);
    }
    services[entry.serviceId] = entry.service(
      [
        ...catalogService.infra,
        ...extraInfraForService({
          serviceId: entry.serviceId,
          extraInfra: attachableInfra,
        }),
      ],
      {
        controlPlaneApi:
          input.auth?.google === undefined
            ? {}
            : {
                googleAuth: input.auth.google,
              },
        ...(inputServiceOptions?.sandbox === undefined
          ? {}
          : {
              sandbox: inputServiceOptions?.sandbox,
            }),
      },
    );
  }

  return createServiceRegistry({
    services,
    ...(input.__dangerouslyIsolatedServices === undefined
      ? {}
      : {
          __dangerouslyIsolatedServices: input.__dangerouslyIsolatedServices,
        }),
  });
}

function extraInfraForService(input: {
  serviceId: ServiceId;
  extraInfra: readonly TestInfraRequirement[];
}): readonly TestInfraRequirement[] {
  const supportedInfraIds = supportedExtraInfraIdsForService(input.serviceId);
  return input.extraInfra.filter((infra) => supportedInfraIds.some((id) => id === infra.id));
}

function supportedExtraInfraIdsForService(
  serviceId: ServiceId,
): readonly ServiceAttachableInfraId[] {
  switch (serviceId) {
    case ServiceIds.CONTROL_PLANE_API:
      return ["sandbox-base-image", "seaweedfs"];
    case ServiceIds.CONTROL_PLANE_WORKER:
      return ["mailpit", "sandbox-base-image"];
    case ServiceIds.DATA_PLANE_GATEWAY:
      return ["otlp", "sandbox-base-image"];
    case ServiceIds.DATA_PLANE_WORKER:
      return ["sandbox-base-image", "sandbox-docker-network"];
    case ServiceIds.DATA_PLANE_API:
      return [];
  }
}

type IntegrationServiceEntry = {
  serviceId: ServiceId;
  service: (
    infra: TestServiceDefinition["infra"],
    options: IntegrationServiceOptions,
  ) => TestServiceDefinition;
};

async function loadSelectedServices(
  selectionsInput: readonly IntegrationServiceSelection[],
): Promise<readonly IntegrationServiceEntry[]> {
  const selectedServiceIds = uniqueSelectedServiceIds(selectionsInput);

  return Promise.all(selectedServiceIds.map(loadService));
}

function uniqueSelectedServiceIds(
  selectionsInput: readonly IntegrationServiceSelection[],
): readonly ServiceId[] {
  const serviceIds: ServiceId[] = [];

  for (const selection of selectionsInput) {
    const serviceId = typeof selection === "string" ? selection : selection.service;
    if (!serviceIds.includes(serviceId)) {
      serviceIds.push(serviceId);
    }
  }

  return serviceIds;
}

async function loadService(serviceId: ServiceId): Promise<IntegrationServiceEntry> {
  // Dynamic imports are intentionally isolated to the integration harness. The
  // public API asks tests to declare selected services, so loading every app and
  // worker runtime up front makes small integration tests pay for unrelated
  // service graphs before fixtures even start.
  switch (serviceId) {
    case ServiceIds.CONTROL_PLANE_API: {
      const module = await loadServiceModule("./services/control-plane-api.ts");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.CONTROL_PLANE_WORKER: {
      const module = await loadServiceModule("./services/control-plane-worker.ts");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_API: {
      const module = await loadServiceModule("./services/data-plane-api.ts");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_GATEWAY: {
      const module = await loadServiceModule("./services/data-plane-gateway.ts");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_WORKER: {
      const module = await loadServiceModule("./services/data-plane-worker.ts");
      return {
        serviceId,
        service: module.service,
      };
    }
  }
}

async function loadServiceModule(
  modulePath: string,
): Promise<{ service: IntegrationServiceEntry["service"] }> {
  const moduleUrl = new URL(modulePath, import.meta.url).href;
  const module: unknown = await import(/* @vite-ignore */ moduleUrl);
  if (!isIntegrationServiceModule(module)) {
    throw new Error(`Expected integration service module '${modulePath}' to export service().`);
  }

  return module;
}

function isIntegrationServiceModule(
  value: unknown,
): value is { service: IntegrationServiceEntry["service"] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "service" in value &&
    typeof value.service === "function"
  );
}

function selections(input: {
  registry: TestServiceRegistry;
  selections: readonly IntegrationServiceSelection[];
}): readonly TestServiceSelection<TestServiceRegistry>[] {
  const normalized: TestServiceSelection<TestServiceRegistry>[] = [];

  for (const selection of input.selections) {
    if (typeof selection !== "string") {
      normalized.push(selection);
      continue;
    }

    const service = input.registry[selection];
    if (service === undefined) {
      throw new Error(`Unknown integration test service '${selection}'.`);
    }
    if (!service.supportedModes.includes("runtime")) {
      throw new Error(
        `Integration test service '${selection}' does not support the default runtime mode. Select an explicit supported mode instead.`,
      );
    }

    normalized.push({
      service: selection,
      mode: "runtime",
    });
  }

  return normalized;
}
