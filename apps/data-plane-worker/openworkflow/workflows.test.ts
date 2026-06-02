import {
  DeleteSandboxInstanceWorkflowSpec,
  MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
  HandleSandboxInstanceDeadlineWorkflowSpec,
  ReconcileSandboxInstanceWorkflowSpec,
  ResumeSandboxInstanceWorkflowSpec,
  StartSandboxInstanceWorkflowSpec,
  StopSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import { SnapshotProviderRequestTimeoutMs } from "./materialize-sandbox-profile-version-snapshot/workflow.js";
import { DataPlaneWorkerWorkflows } from "./workflows.js";

const workflows = new Map(
  DataPlaneWorkerWorkflows.map((workflow) => [workflow.spec.name, workflow]),
);

describe("data-plane worker openworkflow entrypoints", () => {
  it("preserves the start sandbox instance workflow identity", () => {
    expect(readWorkflowSpec(StartSandboxInstanceWorkflowSpec.name)).toMatchObject(
      StartSandboxInstanceWorkflowSpec,
    );
  });

  it("preserves the snapshot materialization workflow identity", () => {
    expect(
      readWorkflowSpec(MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name),
    ).toMatchObject(MaterializeSandboxProfileVersionSnapshotWorkflowSpec);
  });

  it("allows snapshot provider requests to run for one hour", () => {
    expect(SnapshotProviderRequestTimeoutMs).toBe(60 * 60 * 1000);
  });

  it("preserves the resume sandbox instance workflow identity", () => {
    expect(readWorkflowSpec(ResumeSandboxInstanceWorkflowSpec.name)).toMatchObject(
      ResumeSandboxInstanceWorkflowSpec,
    );
  });

  it("preserves the stop sandbox instance workflow identity", () => {
    expect(readWorkflowSpec(StopSandboxInstanceWorkflowSpec.name)).toMatchObject(
      StopSandboxInstanceWorkflowSpec,
    );
  });

  it("preserves the delete sandbox instance workflow identity", () => {
    expect(readWorkflowSpec(DeleteSandboxInstanceWorkflowSpec.name)).toMatchObject(
      DeleteSandboxInstanceWorkflowSpec,
    );
  });

  it("preserves the reconcile sandbox instance workflow identity", () => {
    expect(readWorkflowSpec(ReconcileSandboxInstanceWorkflowSpec.name)).toMatchObject(
      ReconcileSandboxInstanceWorkflowSpec,
    );
  });

  it("preserves the handle sandbox instance deadline workflow identity", () => {
    expect(readWorkflowSpec(HandleSandboxInstanceDeadlineWorkflowSpec.name)).toMatchObject(
      HandleSandboxInstanceDeadlineWorkflowSpec,
    );
  });
});

function readWorkflowSpec(name: string): unknown {
  const workflow = workflows.get(name);
  if (workflow === undefined) {
    throw new Error(`Expected data-plane worker workflow ${name} to be registered.`);
  }

  return workflow.spec;
}
