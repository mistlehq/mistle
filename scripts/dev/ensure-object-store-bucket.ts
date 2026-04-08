import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const DEV_OBJECT_STORE_ACCESS_KEY_ID_ENV_VAR = "DEV_OBJECT_STORE_ACCESS_KEY_ID";
const DEV_OBJECT_STORE_SECRET_ACCESS_KEY_ENV_VAR = "DEV_OBJECT_STORE_SECRET_ACCESS_KEY";
const DEV_OBJECT_STORE_PORT_ENV_VAR = "DEV_OBJECT_STORE_PORT";
const DEV_OBJECT_STORE_BUCKET_NAME_ENV_VAR = "DEV_OBJECT_STORE_BUCKET_NAME";
const DEFAULT_DEV_OBJECT_STORE_ACCESS_KEY_ID = "mistle-access-key";
const DEFAULT_DEV_OBJECT_STORE_SECRET_ACCESS_KEY = "mistle-secret-key";
const DEFAULT_DEV_OBJECT_STORE_PORT = "8333";
const DEFAULT_DEV_OBJECT_STORE_BUCKET_NAME = "mistle-assets";
const DEV_OBJECT_STORE_REGION = "us-east-1";
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

export type EnsureDevObjectStoreBucketInput = {
  env?: NodeJS.ProcessEnv;
  endpoint?: string;
  startupTimeoutMs?: number;
};

export async function ensureDevObjectStoreBucketExists(
  input: EnsureDevObjectStoreBucketInput = {},
): Promise<void> {
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  };
  const accessKeyId = readEnvWithDefault(
    env,
    DEV_OBJECT_STORE_ACCESS_KEY_ID_ENV_VAR,
    DEFAULT_DEV_OBJECT_STORE_ACCESS_KEY_ID,
  );
  const secretAccessKey = readEnvWithDefault(
    env,
    DEV_OBJECT_STORE_SECRET_ACCESS_KEY_ENV_VAR,
    DEFAULT_DEV_OBJECT_STORE_SECRET_ACCESS_KEY,
  );
  const bucketName = readEnvWithDefault(
    env,
    DEV_OBJECT_STORE_BUCKET_NAME_ENV_VAR,
    DEFAULT_DEV_OBJECT_STORE_BUCKET_NAME,
  );
  const endpoint =
    input.endpoint ??
    `http://127.0.0.1:${readEnvWithDefault(env, DEV_OBJECT_STORE_PORT_ENV_VAR, DEFAULT_DEV_OBJECT_STORE_PORT)}`;
  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const deadline = Date.now() + startupTimeoutMs;
  let lastError: unknown;

  const client = new S3Client({
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint,
    forcePathStyle: true,
    region: DEV_OBJECT_STORE_REGION,
  });

  try {
    while (Date.now() < deadline) {
      try {
        await client.send(
          new CreateBucketCommand({
            Bucket: bucketName,
          }),
        );
        return;
      } catch (error) {
        if (
          hasErrorName(error, "BucketAlreadyExists") ||
          hasErrorName(error, "BucketAlreadyOwnedByYou")
        ) {
          return;
        }

        if (isRetryableSeaweedfsStartupError(error) === false) {
          throw error;
        }

        lastError = error;
      }

      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    client.destroy();
  }

  throw new Error(
    `Timed out waiting for SeaweedFS S3 bucket "${bucketName}" within ${String(startupTimeoutMs)}ms.`,
    {
      cause: lastError,
    },
  );
}

function readEnvWithDefault(
  env: NodeJS.ProcessEnv,
  envVarName: string,
  defaultValue: string,
): string {
  const value = env[envVarName];

  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultValue;
  }

  return value.trim();
}

function hasErrorName(error: unknown, expectedName: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!("name" in error)) {
    return false;
  }

  return error.name === expectedName;
}

function isRetryableSeaweedfsStartupError(error: unknown): boolean {
  const httpStatusCode = getHttpStatusCode(error);
  if (httpStatusCode !== undefined) {
    return httpStatusCode >= 500;
  }

  const errorName = getErrorName(error);
  if (
    errorName === "TimeoutError" ||
    errorName === "NetworkingError" ||
    errorName === "ECONNREFUSED" ||
    errorName === "ECONNRESET" ||
    errorName === "ETIMEDOUT"
  ) {
    return true;
  }

  const errorCode = getErrorCode(error);
  return (
    errorCode === "ECONNREFUSED" ||
    errorCode === "ECONNRESET" ||
    errorCode === "ETIMEDOUT" ||
    errorCode === "EPIPE"
  );
}

function getErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if (!("name" in error) || typeof error.name !== "string") {
    return undefined;
  }

  return error.name;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if (!("code" in error) || typeof error.code !== "string") {
    return undefined;
  }

  return error.code;
}

function getHttpStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if (!("$metadata" in error) || typeof error.$metadata !== "object" || error.$metadata === null) {
    return undefined;
  }

  if (
    !("httpStatusCode" in error.$metadata) ||
    typeof error.$metadata.httpStatusCode !== "number"
  ) {
    return undefined;
  }

  return error.$metadata.httpStatusCode;
}

const invokedPath = process.argv[1];

if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  try {
    await ensureDevObjectStoreBucketExists();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    process.exitCode = 1;
  }
}
