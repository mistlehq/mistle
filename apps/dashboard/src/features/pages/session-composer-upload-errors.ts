import { FileUploadRejectedError, FileUploadResetCodes } from "@mistle/sandbox-session-client";

export function resolveUploadErrorMessage(error: unknown): string {
  if (error instanceof FileUploadRejectedError) {
    if (error.code === FileUploadResetCodes.INVALID_FILE_TYPE) {
      return "That file is not a supported PNG, JPEG, WebP, or GIF image.";
    }

    if (error.code === FileUploadResetCodes.MIME_TYPE_MISMATCH) {
      return "That file's contents do not match its declared image type.";
    }

    if (error.code === FileUploadResetCodes.INVALID_IMAGE_CONTENT) {
      return "That image file could not be validated.";
    }
  }

  return error instanceof Error ? error.message : "Could not upload attached image.";
}
