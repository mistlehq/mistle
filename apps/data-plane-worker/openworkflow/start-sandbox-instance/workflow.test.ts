import { SandboxInstancePurposes } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { startSandboxWorkflowTestInternals } from "./workflow.js";

describe("StartSandboxInstanceWorkflow operation kind", () => {
  it("uses setup_check operation streams for setup-check sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.resolveStartSandboxOperationKind(
        SandboxInstancePurposes.SETUP_CHECK,
      ),
    ).toBe("setup_check");
  });

  it("uses start operation streams for session sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.resolveStartSandboxOperationKind(
        SandboxInstancePurposes.SESSION,
      ),
    ).toBe("start");
  });

  it("uses start operation streams for setup-assistant sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.resolveStartSandboxOperationKind(
        SandboxInstancePurposes.SETUP_ASSISTANT,
      ),
    ).toBe("start");
  });

  it("uses snapshot operation streams for snapshot sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.resolveStartSandboxOperationKind(
        SandboxInstancePurposes.SNAPSHOT,
      ),
    ).toBe("snapshot");
  });
});

describe("StartSandboxInstanceWorkflow runtime initialization path", () => {
  it("uses activation only for interactive start operation streams", () => {
    expect(
      startSandboxWorkflowTestInternals.usesActivationForStartRuntimeInitialization("start"),
    ).toBe(true);
    expect(
      startSandboxWorkflowTestInternals.usesActivationForStartRuntimeInitialization("setup_check"),
    ).toBe(false);
    expect(
      startSandboxWorkflowTestInternals.usesActivationForStartRuntimeInitialization("snapshot"),
    ).toBe(false);
    expect(
      startSandboxWorkflowTestInternals.usesActivationForStartRuntimeInitialization("resume"),
    ).toBe(false);
  });
});
