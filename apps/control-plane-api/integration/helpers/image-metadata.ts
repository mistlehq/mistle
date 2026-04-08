export function readImageMetadata(payload: unknown): {
  hasImage: boolean;
  imageVersion: string | null;
} {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Expected image metadata payload.");
  }

  if (!("hasImage" in payload) || typeof payload.hasImage !== "boolean") {
    throw new Error("Expected image metadata hasImage.");
  }

  if (
    !("imageVersion" in payload) ||
    (payload.imageVersion !== null && typeof payload.imageVersion !== "string")
  ) {
    throw new Error("Expected image metadata imageVersion.");
  }

  return {
    hasImage: payload.hasImage,
    imageVersion: payload.imageVersion,
  };
}
