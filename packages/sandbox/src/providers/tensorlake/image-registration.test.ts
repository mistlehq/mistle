import { describe, expect, it } from "vitest";

import { formatTensorlakeBuildCommandFailure } from "./image-registration.js";

describe("formatTensorlakeBuildCommandFailure", () => {
  it("preserves Tensorlake rootfs builder stderr and stdout for failed commands", () => {
    const message = formatTensorlakeBuildCommandFailure(
      "mkdir",
      ["-p", "/var/lib/tensorlake/rootfs-builder/build/context"],
      {
        exitCode: 1,
        stderr: "mkdir: cannot create directory: Permission denied\n",
        stdout: "diagnostic output\n",
      },
    );

    expect(message).toContain(
      "Tensorlake rootfs builder command 'mkdir -p /var/lib/tensorlake/rootfs-builder/build/context' failed with exit code 1.",
    );
    expect(message).toContain("stderr:\nmkdir: cannot create directory: Permission denied");
    expect(message).toContain("stdout:\ndiagnostic output");
  });
});
