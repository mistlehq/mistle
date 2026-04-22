const SystemSandboxProvider = Object.freeze({
  DOCKER: "docker",
  E2B: "e2b",
});

const DefaultArchilRegion = "gcp-us-central1";

function withOptionalEnv(currentEnv, key, value) {
  if (value === undefined || value.length === 0) {
    return currentEnv;
  }

  return {
    ...currentEnv,
    [key]: value,
  };
}

function buildArchilMountsJson(env) {
  const bucket = env.MISTLE_TEST_ARCHIL_S3_BUCKET;
  const endpoint = env.MISTLE_TEST_ARCHIL_S3_ENDPOINT;
  const accessKeyId = env.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY;

  if (
    bucket === undefined ||
    endpoint === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    return undefined;
  }

  return JSON.stringify([
    {
      type: "s3-compatible",
      bucket,
      endpoint,
      accessKeyId,
      secretAccessKey,
    },
  ]);
}

export function resolveIntegrationProviders(env) {
  const explicitProviders = env.MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS;
  if (explicitProviders !== undefined && explicitProviders.trim().length > 0) {
    return explicitProviders;
  }

  const selectedProvider = env.MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER;
  if (selectedProvider === undefined || selectedProvider.trim().length === 0) {
    return `${SystemSandboxProvider.DOCKER},${SystemSandboxProvider.E2B}`;
  }

  if (
    selectedProvider === SystemSandboxProvider.DOCKER ||
    selectedProvider === SystemSandboxProvider.E2B
  ) {
    return selectedProvider;
  }

  throw new Error(
    `Unsupported MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER '${selectedProvider}'. Expected 'docker' or 'e2b'.`,
  );
}

export function buildPrepareEnvironment(env) {
  let nextEnv = {
    ...env,
    MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: resolveIntegrationProviders(env),
  };

  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY",
    env.MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY ?? env.E2B_API_KEY,
  );
  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY",
    env.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY ?? env.E2B_API_KEY,
  );
  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY",
    env.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY ??
      env.MISTLE_TEST_ARCHIL_API_KEY,
  );
  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION",
    env.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION ??
      env.MISTLE_TEST_ARCHIL_REGION ??
      DefaultArchilRegion,
  );
  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON",
    env.MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON ??
      buildArchilMountsJson(env),
  );

  return nextEnv;
}
