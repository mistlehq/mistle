import { FileUploadRejectedError, FileUploadResetCodes } from "@mistle/sandbox-session-client";
import { describe, expect, it } from "vitest";

import { resolveUploadErrorMessage } from "./session-composer-upload-errors.js";

describe("session-composer-upload-errors", () => {
  it("maps structured upload reset codes to user-facing copy", () => {
    expect(
      resolveUploadErrorMessage(
        new FileUploadRejectedError({
          code: FileUploadResetCodes.INVALID_FILE_TYPE,
          message: "invalid",
        }),
      ),
    ).toBe("That file is not a supported PNG, JPEG, WebP, or GIF image.");

    expect(
      resolveUploadErrorMessage(
        new FileUploadRejectedError({
          code: FileUploadResetCodes.MIME_TYPE_MISMATCH,
          message: "mismatch",
        }),
      ),
    ).toBe("That file's contents do not match its declared image type.");

    expect(
      resolveUploadErrorMessage(
        new FileUploadRejectedError({
          code: FileUploadResetCodes.INVALID_IMAGE_CONTENT,
          message: "invalid-image",
        }),
      ),
    ).toBe("That image file could not be validated.");
  });

  it("falls back to generic error messages for non-structured failures", () => {
    expect(resolveUploadErrorMessage(new Error("Upload exploded"))).toBe("Upload exploded");
    expect(resolveUploadErrorMessage("bad")).toBe("Could not upload attached image.");
  });
});
