import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";

type S3MediaConfig = {
  mediaBaseUrl: string;
  bucket: string;
  provider: "s3";
  s3: {
    region: string;
    endpoint?: string | undefined;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

export type MediaConfig = S3MediaConfig;

export type StableMediaSubject =
  | {
      kind: "user";
      userId: string;
    }
  | {
      kind: "organization";
      organizationId: string;
    };

export type CreateDirectUploadResult = {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
};

type StoredObject = {
  bytes: Buffer;
  contentType: string | null;
};

type ObjectStorage = {
  createDirectUpload(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<CreateDirectUploadResult>;
  readObject(input: { objectKey: string }): Promise<StoredObject>;
  putObject(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string | undefined;
  }): Promise<void>;
  deleteObject(input: { objectKey: string }): Promise<void>;
  getSignedReadUrl(input: { objectKey: string; expiresAt: Date }): Promise<string>;
};

class S3CompatibleStorage implements ObjectStorage {
  readonly #bucket: string;
  readonly #client: S3Client;

  constructor(input: { bucket: string; config: S3MediaConfig["s3"] }) {
    this.#bucket = input.bucket;
    this.#client = new S3Client({
      region: input.config.region,
      ...(input.config.endpoint === undefined ? {} : { endpoint: input.config.endpoint }),
      forcePathStyle: input.config.forcePathStyle,
      credentials: {
        accessKeyId: input.config.accessKeyId,
        secretAccessKey: input.config.secretAccessKey,
      },
    });
  }

  async createDirectUpload(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<CreateDirectUploadResult> {
    const url = await getS3SignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      {
        expiresIn: resolveSignedUrlExpirySeconds(input.expiresAt),
      },
    );

    return {
      method: "PUT",
      url,
      headers: {
        "Content-Type": input.contentType,
      },
    };
  }

  async readObject(input: { objectKey: string }): Promise<StoredObject> {
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
      }),
    );

    const body = response.Body;
    if (body === undefined || typeof body.transformToByteArray !== "function") {
      throw new Error(`Stored object '${input.objectKey}' is missing a readable body.`);
    }

    const bytes = await body.transformToByteArray();

    return {
      bytes: Buffer.from(bytes),
      contentType: response.ContentType ?? null,
    };
  }

  async putObject(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string | undefined;
  }): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.cacheControl === undefined ? {} : { CacheControl: input.cacheControl }),
      }),
    );
  }

  async deleteObject(input: { objectKey: string }): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
      }),
    );
  }

  async getSignedReadUrl(input: { objectKey: string; expiresAt: Date }): Promise<string> {
    return getS3SignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: input.objectKey,
      }),
      {
        expiresIn: resolveSignedUrlExpirySeconds(input.expiresAt),
      },
    );
  }
}

export type MediaService = {
  createDirectUpload(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<CreateDirectUploadResult>;
  readObject(input: { objectKey: string }): Promise<StoredObject>;
  putObject(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string | undefined;
  }): Promise<void>;
  deleteObject(input: { objectKey: string }): Promise<void>;
  getSignedReadUrl(input: { objectKey: string; expiresAt: Date }): Promise<string>;
  buildTempObjectKey(input: {
    subject: StableMediaSubject;
    uploadSessionId: string;
    filename: string;
  }): string;
  buildFinalObjectKey(input: { subject: StableMediaSubject }): string;
  buildStableMediaUrl(input: { subject: StableMediaSubject; versionToken: string }): string;
};

export function createMediaService(input: { config: MediaConfig }): MediaService {
  const objectStorage = createObjectStorage(input.config);

  return {
    createDirectUpload: (uploadInput) => objectStorage.createDirectUpload(uploadInput),
    readObject: (readInput) => objectStorage.readObject(readInput),
    putObject: (putInput) => objectStorage.putObject(putInput),
    deleteObject: (deleteInput) => objectStorage.deleteObject(deleteInput),
    getSignedReadUrl: (readInput) => objectStorage.getSignedReadUrl(readInput),
    buildTempObjectKey: ({ subject, uploadSessionId, filename }) => {
      const safeFilename = normalizeFilename(filename);
      if (subject.kind === "user") {
        return `tmp/avatars/users/${subject.userId}/${uploadSessionId}/${safeFilename}`;
      }

      return `tmp/avatars/organizations/${subject.organizationId}/${uploadSessionId}/${safeFilename}`;
    },
    buildFinalObjectKey: ({ subject }) => {
      const objectId = randomUUID().replaceAll("-", "");
      if (subject.kind === "user") {
        return `avatars/users/${subject.userId}/obj_${objectId}-avatar.webp`;
      }

      return `avatars/organizations/${subject.organizationId}/obj_${objectId}-logo.webp`;
    },
    buildStableMediaUrl: ({ subject, versionToken }) => {
      const relativePath =
        subject.kind === "user"
          ? `/v1/media/users/${encodeURIComponent(subject.userId)}/avatar`
          : `/v1/media/organizations/${encodeURIComponent(subject.organizationId)}/logo`;
      const url = new URL(relativePath, input.config.mediaBaseUrl);
      url.searchParams.set("v", versionToken);
      return url.toString();
    },
  };
}

function createObjectStorage(config: MediaConfig): ObjectStorage {
  return new S3CompatibleStorage({
    bucket: config.bucket,
    config: config.s3,
  });
}

function resolveSignedUrlExpirySeconds(expiresAt: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return Math.max(seconds, 1);
}

function normalizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    return "upload";
  }

  return trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
}
