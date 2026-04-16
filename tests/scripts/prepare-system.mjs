import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IntegrationProviders = "docker,e2b";
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

function buildPrepareEnvironment(env) {
  let nextEnv = {
    ...env,
    MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: IntegrationProviders,
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

function run(command, args, env) {
  execFileSync(command, args, {
    stdio: "inherit",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env,
  });
}

const env = buildPrepareEnvironment(process.env);

run("pnpm", ["--dir", "..", "config:init:integration"], env);
run(
  "pnpm",
  [
    "--filter",
    "@mistle/control-plane-api...",
    "--filter",
    "@mistle/control-plane-worker...",
    "--filter",
    "@mistle/data-plane-api...",
    "--filter",
    "@mistle/data-plane-worker...",
    "--filter",
    "@mistle/data-plane-gateway...",
    "--filter",
    "@mistle/tokenizer-proxy...",
    "build",
  ],
  env,
);
run("pnpm", ["--dir", "..", "run", "test-harness:prepare-runtime"], env);
