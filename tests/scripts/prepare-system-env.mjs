const SystemSandboxProvider = Object.freeze({
  DOCKER: "docker",
  E2B: "e2b",
});

function withOptionalEnv(currentEnv, key, value) {
  if (value === undefined || value.length === 0) {
    return currentEnv;
  }

  return {
    ...currentEnv,
    [key]: value,
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
  let nextEnv = {
    ...env,
    MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: resolveIntegrationProviders(env),
  };

  nextEnv = withOptionalEnv(
    nextEnv,
    "MISTLE_SANDBOX_E2B_API_KEY",
    env.MISTLE_SANDBOX_E2B_API_KEY ?? env.E2B_API_KEY,
  );

  return nextEnv;
}
