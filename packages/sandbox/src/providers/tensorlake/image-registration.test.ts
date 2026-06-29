import { describe, expect, it } from "vitest";

import { formatTensorlakeImageImportFailure } from "./image-registration.js";

describe("formatTensorlakeImageImportFailure", () => {
  it("preserves Tensorlake sandbox image import output on failure", () => {
    const error = formatTensorlakeImageImportFailure(new Error("image import failed"), [
      { label: "stderr", message: "mkdir: cannot create directory: Permission denied" },
      { label: "stdout", message: "diagnostic output" },
    ]);

    expect(error.message).toContain("image import failed");
    expect(error.message).toContain("Tensorlake sandbox image import output:");
    expect(error.message).toContain("stderr:\nmkdir: cannot create directory: Permission denied");
    expect(error.message).toContain("stdout:\ndiagnostic output");
  });
});
