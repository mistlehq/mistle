import { describe, expect, it } from "vitest";

import { StartSandboxProfileInstanceWorkflow } from "./start-sandbox-profile-instance.js";

describe("start sandbox profile instance workflow scaffold", () => {
  it("exports the expected workflow spec metadata", () => {
    expect(StartSandboxProfileInstanceWorkflow.spec.name).toBe(
      "control-plane.sandbox-instances.start-profile-instance",
    );
    expect(StartSandboxProfileInstanceWorkflow.spec.version).toBe("1");
  });
});
