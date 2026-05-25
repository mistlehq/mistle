import { SandboxInstancePersistenceModes, SandboxInstancePurposes } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import {
  resolveSandboxInstancePersistenceMode,
  resolveWorkflowSandboxInstanceId,
} from "./start-sandbox-instance.js";

describe("resolveWorkflowSandboxInstanceId", () => {
  it("returns the sandbox instance id from the workflow run input", () => {
    expect(
      resolveWorkflowSandboxInstanceId({
        workflowRunId: "workflow_run_test",
        workflowRunInput: {
          sandboxInstanceId: "sbi_test",
          organizationId: "org_test",
        },
      }),
    ).toBe("sbi_test");
  });

  it("throws when the workflow run input does not include a sandbox instance id", () => {
    expect(() =>
      resolveWorkflowSandboxInstanceId({
        workflowRunId: "workflow_run_test",
        workflowRunInput: {
          organizationId: "org_test",
        },
      }),
    ).toThrow("Workflow run 'workflow_run_test' has invalid stored input.");
  });
});

describe("resolveSandboxInstancePersistenceMode", () => {
  it("returns ephemeral when the effective persistence mode is ephemeral", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SESSION,
        effectivePersistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
        sandboxProvider: "e2b",
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });

  it("returns persistent when persistent sandboxes are enabled and archil is configured", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SESSION,
        effectivePersistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxProvider: "e2b",
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.PERSISTENT);
  });

  it("returns persistent when persistent sandboxes are enabled and docker_volume is configured", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SESSION,
        effectivePersistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxProvider: "docker",
        configuredStorageBackend: "docker_volume",
      }),
    ).toBe(SandboxInstancePersistenceModes.PERSISTENT);
  });

  it("throws when persistent sandboxes are enabled without a supported backend", () => {
    expect(() =>
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SESSION,
        effectivePersistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxProvider: "docker",
        configuredStorageBackend: undefined,
      }),
    ).toThrow(
      "Persistent sandbox was requested for organization 'org_test' but no supported durable storage backend is configured for this deployment.",
    );
  });

  it("returns ephemeral for setup-check sandboxes even when persistent sandboxes are enabled", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SETUP_CHECK,
        effectivePersistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxProvider: "e2b",
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });

  it("returns ephemeral for setup-assistant sandboxes even when persistent sandboxes are enabled", () => {
    expect(
      resolveSandboxInstancePersistenceMode({
        organizationId: "org_test",
        purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
        effectivePersistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        sandboxProvider: "e2b",
        configuredStorageBackend: "archil",
      }),
    ).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });
});
