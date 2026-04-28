import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  ControlPlaneWorkerControlPlaneApiEnvDescriptors,
  ControlPlaneWorkerDataPlaneApiEnvDescriptors,
  ControlPlaneWorkerEmailEnvDescriptors,
  ControlPlaneWorkerWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";
import {
  ControlPlaneWorkerControlPlaneApiConfigSchema,
  ControlPlaneWorkerDataPlaneApiConfigSchema,
  type PartialControlPlaneWorkerConfigInput,
  ControlPlaneWorkerEmailConfigSchema,
  ControlPlaneWorkerWorkflowConfigSchema,
  PartialControlPlaneWorkerConfigSchema,
} from "./schema.js";

export {
  ControlPlaneWorkerControlPlaneApiEnvDescriptors,
  ControlPlaneWorkerDataPlaneApiEnvDescriptors,
  ControlPlaneWorkerEmailEnvDescriptors,
  ControlPlaneWorkerWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";

const loadWorkflowEnv = createEnvLoader<typeof ControlPlaneWorkerWorkflowConfigSchema>(
  ControlPlaneWorkerWorkflowEnvDescriptors,
);
const loadEmailEnv = createEnvLoader<typeof ControlPlaneWorkerEmailConfigSchema>(
  ControlPlaneWorkerEmailEnvDescriptors,
);
const loadDataPlaneApiEnv = createEnvLoader<typeof ControlPlaneWorkerDataPlaneApiConfigSchema>(
  ControlPlaneWorkerDataPlaneApiEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<
  typeof ControlPlaneWorkerControlPlaneApiConfigSchema
>(ControlPlaneWorkerControlPlaneApiEnvDescriptors);

export function loadControlPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialControlPlaneWorkerConfigInput {
  const partialConfig: PartialControlPlaneWorkerConfigInput = {};

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const email = loadEmailEnv(env);
  if (hasEntries(email)) {
    partialConfig.email = email;
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  return PartialControlPlaneWorkerConfigSchema.parse(partialConfig);
}
