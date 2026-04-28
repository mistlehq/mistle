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

const DefaultSandboxStorageRegion = "us-east-1";

function withOptionalArchilObjectStoreEnv(currentEnv, env) {
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
    return currentEnv;
  }

  return {
    ...currentEnv,
    MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE:
      currentEnv.MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE ?? "sandbox_storage",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME ?? bucket,
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_REGION:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_REGION ?? DefaultSandboxStorageRegion,
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT ?? endpoint,
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_FORCE_PATH_STYLE:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_FORCE_PATH_STYLE ?? "true",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID ?? accessKeyId,
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY:
      currentEnv.MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY ?? secretAccessKey,
  };
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
  const archilApiKey = env.MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY ?? env.MISTLE_TEST_ARCHIL_API_KEY;

  let nextEnv = {
    ...env,
    MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: resolveIntegrationProviders(env),
  };

  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_SANDBOX_E2B_API_KEY",
    env.MISTLE_SANDBOX_E2B_API_KEY ?? env.E2B_API_KEY,
  );
  nextEnv = withOptionalEnv(nextEnv, "MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY", archilApiKey);
  nextEnv = withOptionalEnv(nextEnv, "MISTLE_TEST_ARCHIL_API_KEY", archilApiKey);
  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_SANDBOX_STORAGE_ARCHIL_REGION",
    env.MISTLE_SANDBOX_STORAGE_ARCHIL_REGION ??
      env.MISTLE_TEST_ARCHIL_REGION ??
      DefaultArchilRegion,
  );

  return withOptionalArchilObjectStoreEnv(nextEnv, env);
}
