import { describe, expect, test } from "vitest";

import {
  ReconcileSandboxInstanceWorkflowSpec,
  ResumeSandboxInstanceWorkflowSpec,
  StartSandboxInstanceWorkflowSpec,
  StopSandboxInstanceWorkflowSpec,
} from "./data-plane.js";

describe("data-plane workflow registry", () => {
  test("exports the expected workflow name and version", () => {
    expect(StartSandboxInstanceWorkflowSpec).toEqual({
      name: "data-plane.sandbox-instances.start",
      version: "1",
    });
    expect(ResumeSandboxInstanceWorkflowSpec).toEqual({
      name: "data-plane.sandbox-instances.resume",
      version: "1",
    });
    expect(StopSandboxInstanceWorkflowSpec).toEqual({
      name: "data-plane.sandbox-instances.stop",
      version: "1",
    });
    expect(ReconcileSandboxInstanceWorkflowSpec).toEqual({
      name: "data-plane.sandbox-instances.reconcile",
      version: "1",
    });
  });
});
