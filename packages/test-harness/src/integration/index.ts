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
  TestServiceLaunchMode,
  TestServiceRegistry,
  TestServiceSelection,
} from "../environment/index.js";
import { createIntegrationEnvironment, type IntegrationTestEnvironment } from "./environment.js";
import { service as controlPlaneApi } from "./services/control-plane-api.js";
import { service as controlPlaneWorker } from "./services/control-plane-worker.js";
import { service as dataPlaneApi } from "./services/data-plane-api.js";
import { service as dataPlaneGateway } from "./services/data-plane-gateway.js";
import { service as dataPlaneWorker } from "./services/data-plane-worker.js";
import { ServiceIds, type ServiceId } from "./services/service-ids.js";
import { service as tokenizerProxy } from "./services/tokenizer-proxy.js";

export { TestEnvironmentIdHeader } from "../environment/index.js";

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

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

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

function writeTimingLine(message: string): void {
  if (process.env["MISTLE_TEST_TIMING"] !== "1") {
    return;
  }

  process.stderr.write(`${message}\n`);
}

// The integration API is intentionally small: app tests choose services and get
// a single env fixture. Registry, infra, ports, service pooling, and cleanup all
// stay inside the harness.
export function createIntegrationTest(input: CreateIntegrationTestInput) {
  const registry = registryFor(input);
  const services = selections({
    registry,
    selections: input.services,
  });

  return base.extend<IntegrationTestFixture>({
    env: [
      async ({}, use) => {
        const setupStartedAt = Date.now();
        const environment = await startTestEnvironment({
          registry,
          services,
        });
        const integrationEnvironment = createIntegrationEnvironment({
          environment,
        });
        const setupDurationMs = Date.now() - setupStartedAt;

        writeTimingLine(
          `[integration-new] env ${environment.id} setup completed in ${formatDuration(setupDurationMs)} for ${formatSelectedServices(input.services)}.`,
        );

        try {
          const testStartedAt = Date.now();
          await use(integrationEnvironment);
          writeTimingLine(
            `[integration-new] env ${environment.id} test body completed in ${formatDuration(Date.now() - testStartedAt)}.`,
          );
        } finally {
          const teardownStartedAt = Date.now();
          await integrationEnvironment.stop();
          await environment.stop();
          writeTimingLine(
            `[integration-new] env ${environment.id} teardown completed in ${formatDuration(Date.now() - teardownStartedAt)}.`,
          );
        }
      },
      {
        scope: "file",
      },
    ],
  });
}

function registryFor(input: CreateIntegrationTestInput): TestServiceRegistry {
  const serviceCatalog = createTestRegistry();

  return createServiceRegistry({
    services: {
      [ServiceIds.CONTROL_PLANE_API]: controlPlaneApi(
        serviceCatalog[ServiceIds.CONTROL_PLANE_API].infra,
      ),
      [ServiceIds.CONTROL_PLANE_WORKER]: controlPlaneWorker(
        serviceCatalog[ServiceIds.CONTROL_PLANE_WORKER].infra,
      ),
      [ServiceIds.DATA_PLANE_API]: dataPlaneApi(serviceCatalog[ServiceIds.DATA_PLANE_API].infra),
      [ServiceIds.DATA_PLANE_GATEWAY]: dataPlaneGateway(
        serviceCatalog[ServiceIds.DATA_PLANE_GATEWAY].infra,
      ),
      [ServiceIds.DATA_PLANE_WORKER]: dataPlaneWorker(
        serviceCatalog[ServiceIds.DATA_PLANE_WORKER].infra,
      ),
      [ServiceIds.TOKENIZER_PROXY]: tokenizerProxy(
        serviceCatalog[ServiceIds.TOKENIZER_PROXY].infra,
      ),
    },
    ...(input.__dangerouslyIsolatedServices === undefined
      ? {}
      : {
          __dangerouslyIsolatedServices: input.__dangerouslyIsolatedServices,
        }),
  });
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
