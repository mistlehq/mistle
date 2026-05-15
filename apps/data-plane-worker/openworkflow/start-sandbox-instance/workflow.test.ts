import { SandboxInstancePersistenceModes, SandboxInstancePurposes } from "@mistle/db/data-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { startSandboxWorkflowTestInternals } from "./workflow.js";

describe("StartSandboxInstanceWorkflow storage attach ordering", () => {
  it("waits for post-start storage attachment for persistent E2B sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.shouldWaitForPostStartStorageAttach({
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: SandboxProvider.E2B,
      }),
    ).toBe(true);
  });

  it("keeps Docker persistent storage attached during provider start", () => {
    expect(
      startSandboxWorkflowTestInternals.shouldWaitForPostStartStorageAttach({
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: SandboxProvider.DOCKER,
      }),
    ).toBe(false);
  });

  it("does not emit no-op post-start storage attachment for ephemeral sandboxes", () => {
    expect(
      startSandboxWorkflowTestInternals.shouldWaitForPostStartStorageAttach({
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
        runtimeProvider: SandboxProvider.E2B,
      }),
    ).toBe(false);
  });
});

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
});
