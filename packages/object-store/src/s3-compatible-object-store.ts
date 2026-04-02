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
  ObjectStore,
  PutObjectInput,
  HeadObjectInput,
  ReadObjectInput,
} from "./object-store.js";

export type S3CompatibleObjectStoreConfig = {
  bucketName: string;
  region: NonNullable<S3ClientConfig["region"]>;
  endpoint?: S3ClientConfig["endpoint"];
  forcePathStyle?: NonNullable<S3ClientConfig["forcePathStyle"]>;
  credentials?: S3ClientConfig["credentials"];
};

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

  async putObject(input: PutObjectInput) {
    return await this.#client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.#bucketName,
        CacheControl: input.cacheControl,
        ContentType: input.contentType,
        Key: input.objectKey,
      }),
    );
  }

  async headObject(input: HeadObjectInput) {
    return await this.#client.send(
      new HeadObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );
  }

  async readObject(input: ReadObjectInput) {
    return await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );
  }

  async deleteObject(input: DeleteObjectInput) {
    return await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: input.objectKey,
      }),
    );
  }
}
