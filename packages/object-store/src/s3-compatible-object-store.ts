import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type {
  DeleteObjectInput,
  HeadObjectInput,
  HeadObjectResult,
  ObjectStore,
  PutObjectInput,
  ReadObjectInput,
  ReadObjectResult,
} from "./object-store.js";

export type S3CompatibleObjectStoreConfig = {
  bucketName: string;
  region: NonNullable<S3ClientConfig["region"]>;
  endpoint?: S3ClientConfig["endpoint"];
  forcePathStyle?: NonNullable<S3ClientConfig["forcePathStyle"]>;
  credentials?: S3ClientConfig["credentials"];
};

type ByteArrayReadable = {
  transformToByteArray: () => Promise<Uint8Array>;
};

function hasTransformToByteArray(body: unknown): body is ByteArrayReadable {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  if (!("transformToByteArray" in body)) {
    return false;
  }

  const candidate = body.transformToByteArray;
  return typeof candidate === "function";
}

export class S3CompatibleObjectStore implements ObjectStore {
  readonly #bucketName: string;
  readonly #client: S3Client;

  constructor(input: S3CompatibleObjectStoreConfig) {
    this.#bucketName = input.bucketName;
    this.#client = new S3Client({
      bucketEndpoint: false,
      forcePathStyle: input.forcePathStyle ?? false,
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

  async putObject(input: PutObjectInput): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.#bucketName,
        CacheControl: input.cacheControl,
        ContentType: input.contentType,
        Key: input.objectKey,
      }),
    );
  }

  async headObject(input: HeadObjectInput): Promise<HeadObjectResult> {
    const response = await this.#client.send(
      new HeadObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );

    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
    };
  }

  async readObject(input: ReadObjectInput): Promise<ReadObjectResult> {
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );

    if (!hasTransformToByteArray(response.Body)) {
      throw new Error(`Expected object body for key "${input.objectKey}" to be readable.`);
    }

    return {
      bytes: await response.Body.transformToByteArray(),
      contentType: response.ContentType,
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );
  }
}
