import { describe, expect, it } from "vitest";

import { StartSandboxInstanceWorkflow } from "./start-sandbox-instance.js";

describe("start sandbox instance workflow scaffold", () => {
  it("exports the expected workflow spec metadata", () => {
    expect(StartSandboxInstanceWorkflow.spec.name).toBe("data-plane.sandbox-instances.start");
    expect(StartSandboxInstanceWorkflow.spec.version).toBe("1");
  });
});
