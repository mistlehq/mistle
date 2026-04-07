// Older control-plane deployments omit refreshAfterSeconds but still issue one-hour URLs.
const LEGACY_SIGNED_IMAGE_REFRESH_AFTER_SECONDS = 55 * 60;

function validateRefreshAfterSeconds(input: {
  payload: object;
  responseName: string;
}): number | null {
  if (!("refreshAfterSeconds" in input.payload)) {
    return LEGACY_SIGNED_IMAGE_REFRESH_AFTER_SECONDS;
  }

  if (input.payload.refreshAfterSeconds === null) {
    return null;
  }

  if (
    typeof input.payload.refreshAfterSeconds !== "number" ||
    !Number.isFinite(input.payload.refreshAfterSeconds) ||
    input.payload.refreshAfterSeconds < 0
  ) {
    throw new Error(`${input.responseName} refreshAfterSeconds was invalid.`);
  }

  return input.payload.refreshAfterSeconds;
}

export function parseSignedImagePayload(input: { payload: unknown; responseName: string }): {
  imageUrl: string | null;
  refreshAfterSeconds: number | null;
} {
  if (typeof input.payload !== "object" || input.payload === null) {
    throw new Error(`${input.responseName} was invalid.`);
  }

  if (!("imageUrl" in input.payload)) {
    throw new Error(`${input.responseName} was missing imageUrl.`);
  }

  if (input.payload.imageUrl !== null && typeof input.payload.imageUrl !== "string") {
    throw new Error(`${input.responseName} imageUrl was invalid.`);
  }

  return {
    imageUrl: input.payload.imageUrl,
    refreshAfterSeconds:
      input.payload.imageUrl === null
        ? null
        : validateRefreshAfterSeconds({
            payload: input.payload,
            responseName: input.responseName,
          }),
  };
}
