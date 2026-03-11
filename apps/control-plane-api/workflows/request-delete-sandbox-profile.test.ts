import { describe, expect, it } from "vitest";

import { RequestDeleteSandboxProfileWorkflow } from "./request-delete-sandbox-profile.js";

describe("request delete sandbox profile workflow scaffold", () => {
  it("exports the expected workflow spec metadata", () => {
    expect(RequestDeleteSandboxProfileWorkflow.spec.name).toBe(
      "control-plane.sandbox-profiles.request-delete-profile",
    );
    expect(RequestDeleteSandboxProfileWorkflow.spec.version).toBe("1");
  });
});
