/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createDockerSandboxProviderInfra } from "../environment/service-catalog.js";
import type { TestInfraRequirement } from "../environment/types.js";
import { createIntegrationTest, type IntegrationTestEnvironment } from "../integration/index.js";
import { ServiceIds, type ServiceId } from "../integration/services/service-ids.js";

const execFileAsync = promisify(execFile);
const DefaultBuildContextHostPath = fileURLToPath(new URL("../../../..", import.meta.url));

export type SystemTestServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: "runtime" | "process";
    };

export type SystemTestExtraInfraId = "mailpit" | "otlp" | "seaweedfs";

export type SystemTestSandbox = {
  provider: "docker";
};

export type CreateSystemTestInput = {
  services?: readonly SystemTestServiceSelection[];
  extraInfra?: readonly SystemTestExtraInfraId[];
  sandbox?: SystemTestSandbox;
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
    __internalInfra: createInternalInfra(input),
    __afterStart: async ({ integrationEnvironment }) => {
      await syncControlPlaneIntegrationTargets(integrationEnvironment);
    },
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

function createInternalInfra(input: CreateSystemTestInput): readonly TestInfraRequirement[] {
  if (input.sandbox === undefined) {
    return [];
  }

  switch (input.sandbox.provider) {
    case "docker":
      return createDockerSandboxProviderInfra();
  }
}

async function syncControlPlaneIntegrationTargets(
  environment: IntegrationTestEnvironment,
): Promise<void> {
  await runCommand({
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
    cwd: DefaultBuildContextHostPath,
    env: {
      MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: environment.controlPlaneDatabase.pooledUrl,
      MISTLE_CONTROL_PLANE_SCHEMA_NAME: environment.controlPlaneDatabase.schemaName,
    },
  });
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  try {
    await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
    });
  } catch (error) {
    const stderr = readErrorOutput(error, "stderr");
    const stdout = readErrorOutput(error, "stdout");
    const output = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : "no command output";
    throw new Error(`Command failed: ${input.command} ${input.args.join(" ")}. Output: ${output}`);
  }
}

function readErrorOutput(error: unknown, property: "stderr" | "stdout"): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, property);
  const output = descriptor?.value;
  if (typeof output === "string") {
    return output;
  }

  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }

  return "";
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
