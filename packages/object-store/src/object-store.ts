export type PutObjectInput = {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
};

export type HeadObjectInput = {
  objectKey: string;
};

export type HeadObjectResult = {
  contentType: string | undefined;
  contentLength: number | undefined;
};

export type ReadObjectInput = {
  objectKey: string;
};

export type ReadObjectResult = {
  bytes: Uint8Array;
  contentType: string | undefined;
};

export type DeleteObjectInput = {
  objectKey: string;
};

export interface ObjectStore {
  putObject(input: PutObjectInput): Promise<void>;
  headObject(input: HeadObjectInput): Promise<HeadObjectResult>;
  readObject(input: ReadObjectInput): Promise<ReadObjectResult>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
}
