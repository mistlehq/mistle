import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { systemClock, systemSleeper } from "@mistle/time";
import { GenericContainer, type StartedNetwork, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";
import { stopContainerIgnoringMissing } from "../../docker/cleanup.js";

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
    const endpoint =
      input.network === undefined
        ? hostEndpoint
        : `http://${networkAlias}:${String(SEAWEEDFS_S3_PORT)}`;

    await ensureBucketExists({
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
      endpoint,
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

async function ensureBucketExists(input: {
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

  const deadline = systemClock.nowMs() + input.startupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: input.bucketName,
        }),
      );
      return;
    } catch (error) {
      if (hasErrorName(error, "BucketAlreadyOwnedByYou")) {
        return;
      }

      if (systemClock.nowMs() + SEAWEEDFS_POLL_INTERVAL_MS >= deadline) {
        throw error;
      }

      await systemSleeper.sleep(SEAWEEDFS_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out waiting for SeaweedFS S3 bucket "${input.bucketName}" within ${input.startupTimeoutMs}ms.`,
  );
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
