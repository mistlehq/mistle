export class ObjectStoreObjectNotFoundError extends Error {
  readonly objectKey: string;

  constructor(input: { objectKey: string }) {
    super(`Object not found for key "${input.objectKey}".`);
    this.name = "ObjectStoreObjectNotFoundError";
    this.objectKey = input.objectKey;
  }
}
