/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { it as base } from "vitest";

import {
  createServiceRegistry,
  createTestRegistry,
  startTestEnvironment,
} from "../environment/index.js";
import type {
  DangerouslyIsolatedTestRegistry,
  TestInfraRequirement,
  TestServiceLaunchMode,
  TestServiceDefinition,
  TestServiceRegistry,
  TestServiceSelection,
} from "../environment/index.js";
import type { IntegrationTestEnvironment } from "./environment.js";
import { ServiceIds, type ServiceId } from "./services/service-ids.js";
import {
  formatIntegrationDuration,
  writeIntegrationTimingEvent,
  writeIntegrationTimingLine,
} from "./timing.js";

export { TestEnvironmentIdHeader } from "../environment/index.js";
export type { IntegrationAuthenticatedSession, IntegrationAuth } from "./auth.js";
export type { IntegrationTestEnvironment } from "./environment.js";

type IntegrationServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: TestServiceLaunchMode;
    };

type CreateIntegrationTestInput = {
  services: readonly IntegrationServiceSelection[];
  __dangerouslyIsolatedServices?: DangerouslyIsolatedTestRegistry;
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
        const setupDurationMs = Date.now() - setupStartedAt;

        writeIntegrationTimingLine(
          `[integration-new] env ${environment.id} setup completed in ${formatIntegrationDuration(setupDurationMs)} for ${selectedServices}.`,
        );

        try {
          const testStartedAt = Date.now();
          await use(integrationEnvironment);
          writeIntegrationTimingLine(
            `[integration-new] env ${environment.id} test body completed in ${formatIntegrationDuration(Date.now() - testStartedAt)}.`,
          );
        } finally {
          const teardownStartedAt = Date.now();
          await integrationEnvironment.stop();
          await environment.stop();
          writeIntegrationTimingLine(
            `[integration-new] env ${environment.id} teardown completed in ${formatIntegrationDuration(Date.now() - teardownStartedAt)}.`,
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
  const serviceCatalog = createTestRegistry();
  const services: Record<string, TestServiceDefinition> = {};

  for (const entry of serviceEntries) {
    const catalogService = serviceCatalog[entry.serviceId];
    if (catalogService === undefined) {
      throw new Error(`Unknown integration test service '${entry.serviceId}'.`);
    }
    services[entry.serviceId] = entry.service(catalogService.infra);
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

type IntegrationServiceEntry = {
  serviceId: ServiceId;
  service: (infra: readonly TestInfraRequirement[]) => TestServiceDefinition;
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
      const module = await import("./services/control-plane-api.js");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.CONTROL_PLANE_WORKER: {
      const module = await import("./services/control-plane-worker.js");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_API: {
      const module = await import("./services/data-plane-api.js");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_GATEWAY: {
      const module = await import("./services/data-plane-gateway.js");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.DATA_PLANE_WORKER: {
      const module = await import("./services/data-plane-worker.js");
      return {
        serviceId,
        service: module.service,
      };
    }
    case ServiceIds.TOKENIZER_PROXY: {
      const module = await import("./services/tokenizer-proxy.js");
      return {
        serviceId,
        service: module.service,
      };
    }
  }
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
