import { describe, expect, test } from "vitest";

import { StartSandboxInstanceWorkflowSpec } from "./data-plane.js";

describe("data-plane workflow registry", () => {
  test("exports the expected workflow name and version", () => {
    expect(StartSandboxInstanceWorkflowSpec).toEqual({
      name: "data-plane.sandbox-instances.start",
      version: "1",
    });
  });
});
