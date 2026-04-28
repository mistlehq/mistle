import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  ControlPlaneApiAuthEnvDescriptors,
  ControlPlaneApiCommitSignEnvDescriptors,
  ControlPlaneApiDashboardEnvDescriptors,
  ControlPlaneApiDatabaseEnvDescriptors,
  ControlPlaneApiDataPlaneApiEnvDescriptors,
  ControlPlaneApiIntegrationsEnvDescriptors,
  ControlPlaneApiObjectStoreEnvDescriptors,
  ControlPlaneApiServerEnvDescriptors,
  ControlPlaneApiWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";
import {
  type PartialControlPlaneApiConfigInput,
  ControlPlaneApiAuthConfigSchema,
  ControlPlaneApiDashboardConfigSchema,
  ControlPlaneApiDataPlaneApiConfigSchema,
  ControlPlaneApiDatabaseConfigSchema,
  ControlPlaneApiCommitSignConfigSchema,
  ControlPlaneApiIntegrationsConfigSchema,
  ControlPlaneApiObjectStoreConfigSchema,
  ControlPlaneApiServerConfigSchema,
  ControlPlaneApiWorkflowConfigSchema,
  PartialControlPlaneApiConfigSchema,
} from "./schema.js";

export {
  ControlPlaneApiAuthEnvDescriptors,
  ControlPlaneApiAuthGoogleEnvDescriptors,
  ControlPlaneApiCommitSignEnvDescriptors,
  ControlPlaneApiDashboardEnvDescriptors,
  ControlPlaneApiDatabaseEnvDescriptors,
  ControlPlaneApiDataPlaneApiEnvDescriptors,
  ControlPlaneApiIntegrationsEnvDescriptors,
  ControlPlaneApiObjectStoreEnvDescriptors,
  ControlPlaneApiServerEnvDescriptors,
  ControlPlaneApiWorkflowEnvDescriptors,
} from "./legacy-env-descriptors.js";

const loadServerEnv = createEnvLoader<typeof ControlPlaneApiServerConfigSchema>(
  ControlPlaneApiServerEnvDescriptors,
);
const loadDatabaseEnv = createEnvLoader<typeof ControlPlaneApiDatabaseConfigSchema>(
  ControlPlaneApiDatabaseEnvDescriptors,
);
const loadObjectStoreEnv = createEnvLoader<typeof ControlPlaneApiObjectStoreConfigSchema>(
  ControlPlaneApiObjectStoreEnvDescriptors,
);
const loadAuthEnv = createEnvLoader<typeof ControlPlaneApiAuthConfigSchema>(
  ControlPlaneApiAuthEnvDescriptors,
);
const loadDashboardEnv = createEnvLoader<typeof ControlPlaneApiDashboardConfigSchema>(
  ControlPlaneApiDashboardEnvDescriptors,
);
const loadWorkflowEnv = createEnvLoader<typeof ControlPlaneApiWorkflowConfigSchema>(
  ControlPlaneApiWorkflowEnvDescriptors,
);
const loadDataPlaneApiEnv = createEnvLoader<typeof ControlPlaneApiDataPlaneApiConfigSchema>(
  ControlPlaneApiDataPlaneApiEnvDescriptors,
);
const loadCommitSignEnv = createEnvLoader<typeof ControlPlaneApiCommitSignConfigSchema>(
  ControlPlaneApiCommitSignEnvDescriptors,
);
const loadIntegrationsEnv = createEnvLoader<typeof ControlPlaneApiIntegrationsConfigSchema>(
  ControlPlaneApiIntegrationsEnvDescriptors,
);

export function loadControlPlaneApiFromEnv(
  env: NodeJS.ProcessEnv,
): PartialControlPlaneApiConfigInput {
  const partialConfig: PartialControlPlaneApiConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const objectStore = loadObjectStoreEnv(env);
  if (hasEntries(objectStore)) {
    partialConfig.objectStore = objectStore;
  }

  const auth = loadAuthEnv(env);
  const googleClientId = env.MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID;
  const googleClientSecret = env.MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET;
  if (googleClientId !== undefined || googleClientSecret !== undefined) {
    auth.google = {
      clientId: googleClientId ?? "",
      clientSecret: googleClientSecret ?? "",
    };
  }
  if (hasEntries(auth)) {
    partialConfig.auth = auth;
  }

  const dashboard = loadDashboardEnv(env);
  if (hasEntries(dashboard)) {
    partialConfig.dashboard = dashboard;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  const commitSign = loadCommitSignEnv(env);
  if (hasEntries(commitSign)) {
    partialConfig.commitSign = commitSign;
  }

  const integrations = loadIntegrationsEnv(env);
  if (hasEntries(integrations)) {
    partialConfig.integrations = integrations;
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
