import type {
  DeleteObjectCommandOutput,
  GetObjectCommandOutput,
  HeadObjectCommandOutput,
  PutObjectCommandOutput,
} from "@aws-sdk/client-s3";

export type PutObjectInput = {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
};

export type HeadObjectInput = {
  objectKey: string;
};

export type ReadObjectInput = {
  objectKey: string;
};

export type DeleteObjectInput = {
  objectKey: string;
};

export interface ObjectStore {
  putObject(input: PutObjectInput): Promise<PutObjectCommandOutput>;
  headObject(input: HeadObjectInput): Promise<HeadObjectCommandOutput>;
  readObject(input: ReadObjectInput): Promise<GetObjectCommandOutput>;
  deleteObject(input: DeleteObjectInput): Promise<DeleteObjectCommandOutput>;
}
