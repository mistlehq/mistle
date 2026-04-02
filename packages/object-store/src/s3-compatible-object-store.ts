import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export type S3CompatibleObjectStoreConfig = {
  bucketName: string;
  region: NonNullable<S3ClientConfig["region"]>;
  endpoint?: S3ClientConfig["endpoint"];
  forcePathStyle?: NonNullable<S3ClientConfig["forcePathStyle"]>;
  credentials?: S3ClientConfig["credentials"];
};

export type PutObjectInput = {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
};

export class S3CompatibleObjectStore {
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

  async putObject(input: PutObjectInput): Promise<PutObjectCommandOutput> {
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

  async headObject(objectKey: string): Promise<HeadObjectCommandOutput> {
    return await this.#client.send(
      new HeadObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }

  async readObject(objectKey: string): Promise<GetObjectCommandOutput> {
    return await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }

  async deleteObject(objectKey: string): Promise<DeleteObjectCommandOutput> {
    return await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: objectKey,
      }),
    );
  }
}
