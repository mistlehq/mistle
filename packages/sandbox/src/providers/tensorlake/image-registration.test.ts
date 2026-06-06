import { describe, expect, it } from "vitest";

import { formatTensorlakeBuildFailure } from "./image-registration.js";

describe("formatTensorlakeBuildFailure", () => {
  it("preserves Tensorlake sandbox image build output on failure", () => {
    const error = formatTensorlakeBuildFailure(new Error("image build failed"), [
      { label: "stderr", message: "mkdir: cannot create directory: Permission denied" },
      { label: "stdout", message: "diagnostic output" },
    ]);

    expect(error.message).toContain("image build failed");
    expect(error.message).toContain("Tensorlake sandbox image build output:");
    expect(error.message).toContain("stderr:\nmkdir: cannot create directory: Permission denied");
    expect(error.message).toContain("stdout:\ndiagnostic output");
  });
});
