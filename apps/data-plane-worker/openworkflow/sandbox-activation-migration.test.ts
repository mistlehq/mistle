import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const WorkerLifecycleSourceFiles: readonly URL[] = [
  new URL("./start-sandbox-instance/workflow.ts", import.meta.url),
  new URL("./start-sandbox-instance/initialize-sandbox-runtime.ts", import.meta.url),
  new URL("./start-sandbox-instance/resume-sandbox-runtime.ts", import.meta.url),
  new URL("./resume-sandbox-instance/workflow.ts", import.meta.url),
  new URL("./materialize-sandbox-profile-version-snapshot/workflow.ts", import.meta.url),
];

const LegacyRuntimeControlCalls: readonly string[] = [
  "sandboxRuntimeControl.beginInit",
  "sandboxRuntimeControl.waitInit",
  "sandboxRuntimeControl.init",
  "sandboxRuntimeControl.resume",
];

describe("sandbox runtime activation migration", () => {
  it("keeps worker lifecycle code off legacy sandboxd runtime-control methods", async () => {
    for (const sourceFile of WorkerLifecycleSourceFiles) {
      const source = await readFile(sourceFile, "utf8");

      for (const legacyCall of LegacyRuntimeControlCalls) {
        expect(source).not.toContain(legacyCall);
      }
    }
  });

  it("materializes snapshots through activation with the snapshot operation kind", async () => {
    const source = await readFile(
      new URL("./materialize-sandbox-profile-version-snapshot/workflow.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("activateSandboxRuntime");
    expect(source).toContain('operationKind: "snapshot"');
    expect(source).not.toContain("initializeSandboxRuntime");
    expect(source).not.toContain("SandboxStartupModes");
    expect(source).not.toContain("SandboxExecutionModes");
  });

  it("keeps clean sandboxd shutdown inside the shared provider stop helper", async () => {
    const source = await readFile(new URL("./shared/stop-sandbox.ts", import.meta.url), "utf8");

    const shutdownIndex = source.indexOf("sandboxRuntimeControl.shutdown");
    const providerStopIndex = source.indexOf("sandboxAdapter.stop");

    expect(shutdownIndex).toBeGreaterThanOrEqual(0);
    expect(providerStopIndex).toBeGreaterThan(shutdownIndex);
  });
});
