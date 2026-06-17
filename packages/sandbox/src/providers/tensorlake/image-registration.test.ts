import { describe, expect, it } from "vitest";

import { formatTensorlakeImportFailure } from "./image-registration.js";

describe("formatTensorlakeImportFailure", () => {
  it("preserves Tensorlake sandbox image import output on failure", () => {
    const error = formatTensorlakeImportFailure(new Error("image import failed"), [
      { label: "stderr", message: "mkdir: cannot create directory: Permission denied" },
      { label: "stdout", message: "diagnostic output" },
    ]);

    expect(error.message).toContain("image import failed");
    expect(error.message).toContain("Tensorlake sandbox image import output:");
    expect(error.message).toContain("stderr:\nmkdir: cannot create directory: Permission denied");
    expect(error.message).toContain("stdout:\ndiagnostic output");
  });
});
