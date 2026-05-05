/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { createIntegrationTest, type IntegrationTestEnvironment } from "../integration/index.js";
import { ServiceIds, type ServiceId } from "../integration/services/service-ids.js";

export type SystemTestServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: "runtime" | "process";
    };

export type SystemTestExtraInfraId = "mailpit" | "otlp" | "seaweedfs";

export type CreateSystemTestInput = {
  services?: readonly SystemTestServiceSelection[];
  extraInfra?: readonly SystemTestExtraInfraId[];
  auth?: {
    google?: "simulated";
  };
};

export type RuntimeSystemTestEnvironment = {
  id: string;
  env: IntegrationTestEnvironment;
  controlPlaneApi: IntegrationTestEnvironment["controlPlaneApi"];
  controlPlaneWorker: IntegrationTestEnvironment["controlPlaneWorker"];
  dataPlaneApi: IntegrationTestEnvironment["dataPlaneApi"];
  dataPlaneGateway: IntegrationTestEnvironment["dataPlaneGateway"];
  dataPlaneWorker: IntegrationTestEnvironment["dataPlaneWorker"];
  tokenizerProxy: IntegrationTestEnvironment["tokenizerProxy"];
};

type SystemTestFixture = {
  system: RuntimeSystemTestEnvironment;
};

const DefaultSystemServices: readonly SystemTestServiceSelection[] = [
  ServiceIds.CONTROL_PLANE_API,
  ServiceIds.CONTROL_PLANE_WORKER,
  ServiceIds.DATA_PLANE_API,
  ServiceIds.DATA_PLANE_GATEWAY,
  ServiceIds.DATA_PLANE_WORKER,
  ServiceIds.TOKENIZER_PROXY,
];

const DefaultSystemExtraInfra: readonly SystemTestExtraInfraId[] = ["mailpit", "otlp", "seaweedfs"];

export function createSystemTest(input: CreateSystemTestInput = {}) {
  const base = createIntegrationTest({
    services: input.services ?? DefaultSystemServices,
    extraInfra: input.extraInfra ?? DefaultSystemExtraInfra,
    ...(input.auth === undefined ? {} : { auth: input.auth }),
  });

  return base.extend<SystemTestFixture>({
    system: [
      async ({ env }, use) => {
        await use(createRuntimeSystemEnvironment(env));
      },
      {
        scope: "file",
      },
    ],
  });
}

function createRuntimeSystemEnvironment(
  env: IntegrationTestEnvironment,
): RuntimeSystemTestEnvironment {
  return {
    id: env.id,
    env,
    get controlPlaneApi() {
      return env.controlPlaneApi;
    },
    get controlPlaneWorker() {
      return env.controlPlaneWorker;
    },
    get dataPlaneApi() {
      return env.dataPlaneApi;
    },
    get dataPlaneGateway() {
      return env.dataPlaneGateway;
    },
    get dataPlaneWorker() {
      return env.dataPlaneWorker;
    },
    get tokenizerProxy() {
      return env.tokenizerProxy;
    },
  };
}
