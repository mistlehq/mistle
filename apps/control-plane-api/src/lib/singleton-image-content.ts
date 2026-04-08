import { NotFoundError } from "@mistle/http/errors.js";

export function requireCurrentSingletonImageObjectKey(input: {
  currentObjectKey: string | null;
  notFoundMessage: string;
  requestedImageVersion: string | undefined;
}): string {
  if (
    input.currentObjectKey === null ||
    input.requestedImageVersion === undefined ||
    input.requestedImageVersion !== input.currentObjectKey
  ) {
    throw new NotFoundError("NOT_FOUND", input.notFoundMessage);
  }

  return input.currentObjectKey;
}
