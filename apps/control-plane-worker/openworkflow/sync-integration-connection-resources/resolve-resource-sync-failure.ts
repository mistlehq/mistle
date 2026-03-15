import { z } from "zod";

export function resolveResourceSyncFailure(error: unknown): { code: string; message: string } {
  if (error instanceof z.ZodError) {
    return {
      code: "resource_sync_invalid_provider_payload",
      message: error.issues.map((issue) => issue.message).join("; "),
    };
  }

  if (error instanceof Error) {
    return {
      code: "resource_sync_failed",
      message: error.message,
    };
  }

  return {
    code: "resource_sync_failed",
    message: "Resource sync failed with a non-error exception.",
  };
}
