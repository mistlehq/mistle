import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { GenericContainer, type StartedNetwork, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";
import { stopContainerIgnoringMissing } from "../../docker/cleanup.js";
import { pollUntilReady } from "../../readiness/poll-until-ready.js";

const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.17_full";
const SEAWEEDFS_S3_PORT = 8333;
const SEAWEEDFS_REGION = "us-east-1";
const SEAWEEDFS_POLL_INTERVAL_MS = 250;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SEAWEEDFS_NETWORK_ALIAS = "seaweedfs";

export type StartSeaweedfsS3Input = {
  bucketName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  startupTimeoutMs?: number;
  manageProcessCleanup?: boolean;
  containerLabels?: Record<string, string>;
  network?: StartedNetwork;
  networkAlias?: string;
};

export type SeaweedfsS3Service = {
  bucketName: string;
  endpoint: string;
  containerEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  runtimeMetadata: {
    containerId: string;
  };
  stop: () => Promise<void>;
};

export async function startSeaweedfsS3(
  input: StartSeaweedfsS3Input = {},
): Promise<SeaweedfsS3Service> {
  const bucketName = input.bucketName ?? "mistle";
  const accessKeyId = input.accessKeyId ?? "mistle-access-key";
  const secretAccessKey = input.secretAccessKey ?? "mistle-secret-key";
  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const networkAlias = input.networkAlias ?? DEFAULT_SEAWEEDFS_NETWORK_ALIAS;

  let container: StartedTestContainer | undefined;
  let stopped = false;

  try {
    let containerDefinition = new GenericContainer(SEAWEEDFS_IMAGE)
      .withExposedPorts(SEAWEEDFS_S3_PORT)
      .withLabels(input.containerLabels ?? {})
      .withEnvironment({
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
      })
      .withCommand(["server", "-ip=0.0.0.0", "-dir=/data", "-s3"]);

    if (input.network !== undefined) {
      containerDefinition = containerDefinition
        .withNetwork(input.network)
        .withNetworkAliases(networkAlias);
    }

    container = await containerDefinition.start();

    const hostEndpoint = `http://${container.getHost()}:${String(container.getMappedPort(SEAWEEDFS_S3_PORT))}`;
    const containerEndpoint =
      input.network === undefined
        ? undefined
        : `http://${networkAlias}:${String(SEAWEEDFS_S3_PORT)}`;

    await ensureSeaweedfsS3BucketExists({
      accessKeyId,
      bucketName,
      endpoint: hostEndpoint,
      secretAccessKey,
      startupTimeoutMs,
    });

    const stopInternal = async (): Promise<void> => {
      stopped = true;

      if (container === undefined) {
        throw new Error("SeaweedFS container was not started.");
      }

      await stopContainerIgnoringMissing(container, {
        remove: true,
        removeVolumes: true,
        timeout: 0,
      });
      container = undefined;
    };

    const unregisterProcessCleanupTask =
      (input.manageProcessCleanup ?? true)
        ? registerProcessCleanupTask(async () => {
            if (stopped || container === undefined) {
              return;
            }

            await stopInternal();
          })
        : () => {};

    return {
      accessKeyId,
      bucketName,
      endpoint: hostEndpoint,
      ...(containerEndpoint === undefined ? {} : { containerEndpoint }),
      region: SEAWEEDFS_REGION,
      runtimeMetadata: {
        containerId: container.getId(),
      },
      secretAccessKey,
      stop: async () => {
        if (stopped) {
          throw new Error("SeaweedFS container was already stopped.");
        }

        await stopInternal();
        unregisterProcessCleanupTask();
      },
    };
  } catch (error) {
    if (container !== undefined) {
      await stopContainerIgnoringMissing(container, {
        remove: true,
        removeVolumes: true,
        timeout: 0,
      });
    }

    throw error;
  }
}

export async function ensureSeaweedfsS3BucketExists(input: {
  bucketName: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  startupTimeoutMs: number;
}): Promise<void> {
  const client = new S3Client({
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
    endpoint: input.endpoint,
    forcePathStyle: true,
    region: SEAWEEDFS_REGION,
  });

  await pollUntilReady({
    createTimeoutError: (lastError) =>
      new Error(
        `Timed out waiting for SeaweedFS S3 bucket "${input.bucketName}" within ${input.startupTimeoutMs}ms.`,
        {
          cause: lastError,
        },
      ),
    intervalMs: SEAWEEDFS_POLL_INTERVAL_MS,
    poll: async () => {
      await client.send(
        new CreateBucketCommand({
          Bucket: input.bucketName,
        }),
      );
    },
    shouldRetry: (error) => {
      if (hasErrorName(error, "BucketAlreadyOwnedByYou")) {
        return false;
      }

      return isRetryableSeaweedfsStartupError(error);
    },
    timeoutMs: input.startupTimeoutMs,
  }).catch((error: unknown) => {
    if (hasErrorName(error, "BucketAlreadyOwnedByYou")) {
      return;
    }

    throw error;
  });
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
