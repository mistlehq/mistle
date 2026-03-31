import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { systemSleeper } from "@mistle/time";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

const SeaweedfsImage = "chrislusf/seaweedfs";
const SeaweedfsS3Port = 8333;
const SeaweedfsRegion = "us-east-1";

export type SeaweedfsS3Service = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
};

export async function startSeaweedfsS3(input: { bucket: string }): Promise<SeaweedfsS3Service> {
  const accessKeyId = "integration-access-key";
  const secretAccessKey = "integration-secret-key";
  let container: StartedTestContainer | undefined;

  try {
    container = await new GenericContainer(SeaweedfsImage)
      .withExposedPorts(SeaweedfsS3Port)
      .withEnvironment({
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
      })
      .withCommand(["server", "-ip=0.0.0.0", "-dir=/data", "-s3"])
      .start();

    const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(SeaweedfsS3Port))}`;
    await ensureBucketExists({
      bucket: input.bucket,
      endpoint,
      accessKeyId,
      secretAccessKey,
    });

    return {
      endpoint,
      region: SeaweedfsRegion,
      accessKeyId,
      secretAccessKey,
      stop: async () => {
        await container?.stop();
      },
    };
  } catch (error) {
    if (container !== undefined) {
      await container.stop().catch(() => undefined);
    }
    throw error;
  }
}

async function ensureBucketExists(input: {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<void> {
  const client = new S3Client({
    region: SeaweedfsRegion,
    endpoint: input.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: input.bucket,
        }),
      );
      return;
    } catch (error) {
      if (attempt === 20) {
        throw error;
      }

      await systemSleeper.sleep(250);
    }
  }
}
