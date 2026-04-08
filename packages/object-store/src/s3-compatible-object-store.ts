import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type S3CompatibleObjectStoreConfig = {
  bucketName: string;
  region: NonNullable<S3ClientConfig["region"]>;
  endpoint?: S3ClientConfig["endpoint"];
  forcePathStyle?: NonNullable<S3ClientConfig["forcePathStyle"]>;
  credentials?: S3ClientConfig["credentials"];
};

export type PutObjectInput = {
  objectKey: string;
  Body: NonNullable<PutObjectCommandInput["Body"]>;
} & Pick<PutObjectCommandInput, "ContentType" | "CacheControl">;

export type CreatePresignedGetUrlInput = {
  objectKey: string;
  expiresInSeconds: number;
};

const MaxPresignedGetUrlExpiresInSeconds = 7 * 24 * 60 * 60;

export class S3CompatibleObjectStore {
  readonly #bucketName: string;
  readonly #client: S3Client;

  constructor(input: S3CompatibleObjectStoreConfig) {
    this.#bucketName = input.bucketName;
    this.#client = new S3Client({
      bucketEndpoint: false,
      forcePathStyle: input.forcePathStyle ?? true,
      region: input.region,
      ...(input.credentials === undefined
        ? {}
        : {
            credentials: input.credentials,
          }),
      ...(input.endpoint === undefined
        ? {}
        : {
            endpoint: input.endpoint,
          }),
    });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectCommandOutput> {
    return this.#client.send(
      new PutObjectCommand({
        Body: input.Body,
        Bucket: this.#bucketName,
        CacheControl: input.CacheControl,
        ContentType: input.ContentType,
        Key: input.objectKey,
      }),
    );
  }

  async headObject(objectKey: string): Promise<HeadObjectCommandOutput> {
    return this.#client.send(
      new HeadObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }

  async readObject(objectKey: string): Promise<GetObjectCommandOutput> {
    return this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }

  async createPresignedGetUrl(input: CreatePresignedGetUrlInput): Promise<string> {
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds <= 0) {
      throw new Error("expiresInSeconds must be a positive integer.");
    }

    if (input.expiresInSeconds > MaxPresignedGetUrlExpiresInSeconds) {
      throw new Error(
        `expiresInSeconds must be less than or equal to ${String(MaxPresignedGetUrlExpiresInSeconds)}.`,
      );
    }

    return getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
      {
        expiresIn: input.expiresInSeconds,
      },
    );
  }

  async deleteObject(objectKey: string): Promise<DeleteObjectCommandOutput> {
    return this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }

  destroy(): void {
    this.#client.destroy();
  }
}
